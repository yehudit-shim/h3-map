"""LDAP login: search-then-bind.

1. bind with the service account (or anonymously) and look the user up by ``ldap_user_filter``;
2. require exactly one entry, then bind as that entry's DN with the password the user typed.

The username is escaped before it goes into the filter, and an empty password is rejected up front (many
directories treat a bind with a DN and an empty password as an unauthenticated bind that "succeeds").
All calls here block; the login route runs them in a worker thread.
"""
from __future__ import annotations

import logging
import ssl

from ldap3 import NONE, SUBTREE, SYNC, Connection, Server, Tls
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars

from ..config import Settings
from .jwt import User

log = logging.getLogger("h3map.ldap")

# Replaced by tests (ldap3's in-memory MOCK_SYNC strategy) so the real code path runs without a directory server.
_CLIENT_STRATEGY = SYNC
_INVALID_CREDENTIALS = 49


class LdapUnavailable(Exception):
    """The directory could not be reached or the service account/config is wrong (not the user's fault)."""


def _server(s: Settings) -> Server:
    secure = s.ldap_url.lower().startswith("ldaps://")
    tls = None
    if secure or s.ldap_start_tls:
        tls = Tls(validate=ssl.CERT_REQUIRED, ca_certs_file=s.ldap_ca_file)
    return Server(s.ldap_url, use_ssl=secure, tls=tls, connect_timeout=s.ldap_timeout_s, get_info=NONE)


def _connection(s: Settings, server: Server, user: str | None, password: str | None) -> Connection:
    return Connection(server, user=user, password=password, client_strategy=_CLIENT_STRATEGY,
                      receive_timeout=s.ldap_timeout_s, raise_exceptions=False)


def role_for(s: Settings, username: str) -> str:
    name = username.lower()
    if name in {u.lower() for u in s.ldap_admin_users}:
        return "admin"
    if name in {u.lower() for u in s.ldap_editor_users}:
        return "editor"
    return s.ldap_default_role


def _bind(conn: Connection, s: Settings) -> bool:
    if s.ldap_start_tls and not conn.start_tls():
        raise LdapUnavailable("start_tls failed")
    return bool(conn.bind())


def authenticate(s: Settings, username: str, password: str) -> User | None:
    """Return the user, ``None`` for wrong credentials/unknown user, raise ``LdapUnavailable`` for directory problems."""
    username = username.strip()
    if not username or not password:
        return None
    try:
        server = _server(s)
        service = _connection(s, server, s.ldap_bind_dn,
                              s.ldap_bind_password.get_secret_value() if s.ldap_bind_password else None)
        if not _bind(service, s):
            raise LdapUnavailable("service bind failed")
        try:
            flt = s.ldap_user_filter.replace("{username}", escape_filter_chars(username))
            ok = service.search(s.ldap_base_dn, flt, search_scope=SUBTREE, attributes=[], size_limit=2)
            entries = [r for r in (service.response or []) if r.get("type") == "searchResEntry"]
            # sizeLimitExceeded (4) is expected when two entries match; anything else that failed is a server problem
            ok = ok or (service.result or {}).get("result") in (0, 4)
        finally:
            service.unbind()
        if not ok:
            raise LdapUnavailable("search failed")
        if len(entries) != 1:
            if len(entries) > 1:
                log.warning("ldap filter matched %d entries for one login; refusing", len(entries))
            return None
        user_conn = _connection(s, server, entries[0]["dn"], password)
        try:
            if not _bind(user_conn, s):
                if user_conn.result and user_conn.result.get("result") not in (_INVALID_CREDENTIALS, None):
                    log.info("ldap bind refused with result %s", user_conn.result.get("result"))
                return None
        finally:
            user_conn.unbind()
    except LDAPException as exc:
        raise LdapUnavailable(type(exc).__name__) from exc
    except OSError as exc:  # sockets, timeouts, TLS verification failures
        raise LdapUnavailable(type(exc).__name__) from exc
    return User(sub=username.lower(), role=role_for(s, username))
