"""Connection definitions (env/YAML, secrets from the environment) and the pool manager."""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import re
import socket
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any
from pathlib import Path

import psycopg
import psycopg_pool
import yaml
from psycopg.rows import dict_row

from ..config import Settings
from ..errors import ApiError, not_found
from ..logging_setup import register_secret

log = logging.getLogger("h3map.connections")
_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")


@dataclass(frozen=True)
class ConnectionDef:
    id: str
    name: str
    host: str
    port: int
    database: str
    username: str
    password: str = field(default="", repr=False)
    sslmode: str = "prefer"
    statement_timeout_ms: int | None = None
    max_pool_size: int | None = None
    source: str = "env"
    allowed_users: tuple[str, ...] = ()  # env connections: empty = every authenticated user

    def public(self, status: str = "unknown") -> dict:
        """Everything a client may see. There is deliberately no password field here."""
        return {"id": self.id, "name": self.name, "host": self.host, "port": self.port, "database": self.database,
                "username": self.username, "sslmode": self.sslmode, "readOnly": True, "source": self.source,
                "status": status}


def _resolve(value, env=os.environ) -> str:
    if isinstance(value, str):
        m = re.fullmatch(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", value)
        if m:
            return env.get(m.group(1), "")
    return "" if value is None else str(value)


def load_connection_defs(settings: Settings, env=os.environ) -> dict[str, ConnectionDef]:
    path = Path(settings.connections_file) if settings.connections_file else None
    if not path or not path.exists():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out: dict[str, ConnectionDef] = {}
    for raw in data.get("connections", []):
        cid = str(raw["id"])
        if not _ID.match(cid):
            raise ValueError(f"invalid connection id {cid!r}")
        pw = env.get(raw["password_env"], "") if raw.get("password_env") else _resolve(raw.get("password"), env)
        out[cid] = ConnectionDef(id=cid, name=str(raw.get("name", cid)), host=str(raw["host"]),
                                 port=int(raw.get("port", 5432)), database=str(raw["database"]),
                                 username=str(raw["username"]), password=pw, sslmode=str(raw.get("sslmode", "prefer")),
                                 statement_timeout_ms=raw.get("statement_timeout_ms"),
                                 max_pool_size=raw.get("max_pool_size"),
                                 allowed_users=tuple(str(u) for u in raw.get("allowed_users", []) or []))
    return out


# --- SSRF guard ---------------------------------------------------------------

def check_host(host: str, settings: Settings) -> None:
    """Refuse hosts that resolve to link-local/metadata/unspecified/multicast addresses, and
    loopback/private ones unless allowed. Raises ApiError(403)."""
    allowed = host.lower() in {h.lower() for h in settings.host_allowlist}
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise ApiError(502, "db_unavailable", "The database host cannot be resolved.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if ip.is_link_local or ip.is_unspecified or ip.is_multicast or (ip.is_reserved and not ip.is_loopback):
            raise ApiError(403, "forbidden", "This database host is not allowed.")
        if (ip.is_loopback or ip.is_private) and not (allowed or settings.allow_private_hosts):
            raise ApiError(403, "forbidden", "This database host is not allowed.")


# --- pools ----------------------------------------------------------------------

class PoolManager:
    """One lazily created ``AsyncConnectionPool`` per connection id."""

    def __init__(self, settings: Settings, defs: dict[str, ConnectionDef], store: Any = None):
        self.settings = settings
        self.store = store  # UserConnectionStore | None
        self.defs = dict(defs)
        self._pools: dict[str, psycopg_pool.AsyncConnectionPool] = {}
        self._lock = asyncio.Lock()
        self._h3: dict[str, bool] = {}
        for d in self.defs.values():
            register_secret(d.password)

    # --- user-defined connections and access ------------------------------------------------------------
    def add_def(self, d: ConnectionDef) -> None:
        self.defs[d.id] = d
        register_secret(d.password)

    async def remove_def(self, cid: str) -> None:
        self.defs.pop(cid, None)
        self._h3.pop(cid, None)
        pool = self._pools.pop(cid, None)
        if pool is not None:
            await pool.close()

    async def load_user_defs(self) -> None:
        if self.store is not None:
            for d in await self.store.list():
                self.add_def(d)

    async def resolve(self, cid: str) -> None:
        """Make sure a user connection created by another worker is known here."""
        if cid not in self.defs and self.store is not None:
            try:
                self.add_def(await self.store.get(cid))
            except ApiError:
                pass

    async def can_access(self, cid: str, user: Any) -> bool:
        if user.role == "admin":
            return True
        d = self.get_def(cid)
        allowed = list(d.allowed_users) if d.source == "env" else (await self.store.grants(cid) if self.store else [])
        return not allowed or user.sub in allowed

    def get_def(self, cid: str) -> ConnectionDef:
        d = self.defs.get(cid)
        if d is None:
            raise not_found("Unknown connection.", connectionId=cid)
        return d

    def status(self, cid: str) -> str:
        p = self._pools.get(cid)
        return "unknown" if p is None else ("open" if not p.closed else "closed")

    def _conninfo(self, d: ConnectionDef) -> dict:
        s = self.settings
        stmt = d.statement_timeout_ms or s.statement_timeout_ms
        opts = (f"-c default_transaction_read_only=on -c statement_timeout={int(stmt)} "
                f"-c idle_in_transaction_session_timeout={s.idle_in_tx_timeout_ms} -c lock_timeout={s.lock_timeout_ms}")
        return {"host": d.host, "port": d.port, "dbname": d.database, "user": d.username, "password": d.password,
                "sslmode": d.sslmode, "options": opts, "connect_timeout": 5, "application_name": "h3map",
                "autocommit": True, "row_factory": dict_row}

    async def pool(self, cid: str) -> psycopg_pool.AsyncConnectionPool:
        d = self.get_def(cid)
        pool = self._pools.get(cid)
        if pool is not None and not pool.closed:
            return pool
        async with self._lock:
            pool = self._pools.get(cid)
            if pool is not None and not pool.closed:
                return pool
            await asyncio.to_thread(check_host, d.host, self.settings)
            kwargs = self._conninfo(d)
            pool = psycopg_pool.AsyncConnectionPool(
                conninfo="", kwargs=kwargs, min_size=0, max_size=d.max_pool_size or self.settings.pool_max_size,
                max_idle=300, max_lifetime=3600, reconnect_timeout=10, open=False,
                check=psycopg_pool.AsyncConnectionPool.check_connection, name=f"pool-{cid}")
            await pool.open()
            self._pools[cid] = pool
            return pool

    @asynccontextmanager
    async def connection(self, cid: str):
        pool = await self.pool(cid)
        try:
            async with pool.connection(timeout=self.settings.pool_timeout_s) as conn:
                yield conn
        except psycopg_pool.PoolTimeout as exc:
            log.warning("pool timeout for connection %s", cid)
            raise ApiError(502, "db_unavailable", "The database is not reachable or the pool is exhausted.") from exc

    async def test(self, cid: str) -> dict:
        d = self.get_def(cid)
        t0 = time.perf_counter()
        try:
            async with self.connection(cid) as conn:
                cur = await conn.execute("SELECT version() AS v, (SELECT extversion FROM pg_extension WHERE extname='postgis') AS postgis, "
                                         "EXISTS (SELECT 1 FROM pg_extension WHERE extname='h3') AS h3")
                row = await cur.fetchone()
        except (psycopg.Error, psycopg_pool.PoolTimeout, psycopg_pool.PoolClosed) as exc:
            log.warning("connection test failed for %s: %s", d.id, type(exc).__name__)
            raise ApiError(502, "db_unavailable", "The database is not reachable.") from exc
        return {"ok": True, "postgis": row["postgis"], "h3Extension": bool(row["h3"]),
                "serverVersion": row["v"].split(",")[0], "latencyMs": round((time.perf_counter() - t0) * 1000, 1)}

    async def has_h3(self, cid: str) -> bool:
        """Is the h3 extension installed in this database? Cached per connection."""
        if cid not in self._h3:
            async with self.connection(cid) as conn:
                cur = await conn.execute("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='h3') AS h3")
                self._h3[cid] = bool((await cur.fetchone())["h3"])
        return self._h3[cid]

    async def close(self) -> None:
        for p in self._pools.values():
            await p.close()
        self._pools.clear()
