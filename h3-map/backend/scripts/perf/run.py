"""Backend performance measurements against the generated datasets (scripts/seed/seed_large.py create).

    H3MAP_TEST_ADMIN_DSN=... python -m scripts.perf.run

Runs the real app in-process (ASGI transport, real PostgreSQL) and prints/writes JSON to perf-results/.
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import random
import statistics
import time
from pathlib import Path

import httpx
from psycopg.conninfo import conninfo_to_dict

from app.config import Settings
from app.main import create_app
from app.services.connections import ConnectionDef
from tests.conftest import token_for

C = "/api/v1/connections/perf"


def pct(vals: list[float], p: float) -> float:
    s = sorted(vals)
    return s[min(len(s) - 1, math.ceil(p * len(s)) - 1)]


def summarize(ms: list[float]) -> dict:
    return {"n": len(ms), "min": round(min(ms), 1), "median": round(statistics.median(ms), 1), "p95": round(pct(ms, 0.95), 1),
            "max": round(max(ms), 1)}


def tile_of(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


async def timed(client, url, **kw) -> tuple[float, httpx.Response]:
    t0 = time.perf_counter()
    r = await client.get(url, **kw)
    return (time.perf_counter() - t0) * 1000, r


async def main() -> None:
    info = conninfo_to_dict(os.environ["H3MAP_TEST_ADMIN_DSN"])
    settings = Settings(jwt_secret="perf-secret-perf-secret-perf-secret", admin_password="x", connections_file=None,
                        pool_max_size=10, statement_timeout_ms=60_000)
    defs = {"perf": ConnectionDef(id="perf", name="perf", host=info.get("host", "localhost"), port=int(info.get("port", 5432)),
                                  database="h3map_perf", username=info["user"], password=info.get("password", ""), sslmode="disable")}
    app = create_app(settings, defs)
    H = {"Authorization": "Bearer " + token_for(settings, "admin")}
    rng = random.Random(7)
    out: dict = {"generatedAt": time.strftime("%Y-%m-%d %H:%M:%S")}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://perf", headers=H, timeout=120) as c:
        await c.post(f"{C}/test")  # warm the pool

        # P6-04 profile latency
        prof = {}
        for t in ("points_100k", "points_1m", "polys_1m", "points_10m", "h3_1m"):
            ms = [(await timed(c, f"{C}/tables/perf/{t}/profile"))[0] for _ in range(10)]
            r = await c.get(f"{C}/tables/perf/{t}/profile")
            prof[t] = {**summarize(ms), "strategy": r.json()["recommendedStrategy"], "estimatedRows": r.json()["estimatedRows"]}
        out["profile_ms"] = prof

        # bbox /features p95 for a city-sized box (~0.05 deg), limit 10k
        feat = {}
        for t in ("points_100k", "points_1m", "points_10m"):
            ms = []
            for _ in range(30):
                x, y = rng.uniform(34.3, 35.8), rng.uniform(29.5, 33.3)
                ms.append((await timed(c, f"{C}/tables/perf/{t}/features", params={"bbox": f"{x},{y},{x + 0.05},{y + 0.05}", "limit": 10000}))[0])
            feat[t] = summarize(ms)
        out["features_bbox_ms"] = feat

        # P6-07 MVT: cold = distinct tiles never requested before in this run
        r = await c.post(f"{C}/tiles/sessions", json={"schema": "perf", "table": "polys_1m", "columns": ["cat", "val"], "minzoom": 8})
        sess = r.json()
        url = sess["urlTemplate"]
        cold = {}
        for z in (8, 10, 12, 14):
            seen, ms, sizes, empty = set(), [], [], 0
            while len(seen) < 40:
                lon, lat = rng.uniform(34.3, 35.8), rng.uniform(29.5, 33.3)
                xy = tile_of(lon, lat, z)
                if xy in seen:
                    continue
                seen.add(xy)
                t, resp = await timed(c, url.format(z=z, x=xy[0], y=xy[1]))
                ms.append(t)
                sizes.append(len(resp.content))
                empty += resp.status_code == 204
            cold[f"z{z}"] = {**summarize(ms), "medianBytes": int(statistics.median(sizes)), "empty": empty}
        out["mvt_cold_polys_1m_ms"] = cold

        # warm (repeat the same tiles)
        x, y = tile_of(35.0, 31.0, 12)
        ms = [(await timed(c, url.format(z=12, x=x, y=y)))[0] for _ in range(30)]
        out["mvt_warm_z12_ms"] = summarize(ms)

        # 50 concurrent tile requests (distinct tiles), pool size 10
        coords = set()
        while len(coords) < 50:
            coords.add(tile_of(rng.uniform(34.3, 35.8), rng.uniform(29.5, 33.3), 11))
        t0 = time.perf_counter()
        rs = await asyncio.gather(*[timed(c, url.format(z=11, x=x, y=y)) for x, y in coords])
        wall = (time.perf_counter() - t0) * 1000
        out["mvt_concurrent_50"] = {"wallMs": round(wall, 1), "statuses": sorted({r.status_code for _, r in rs}),
                                    "failed": sum(r.status_code >= 500 for _, r in rs), **{k: v for k, v in summarize([t for t, _ in rs]).items() if k in ("median", "p95", "max")}}

        # P6-08 H3
        h3 = {}
        ms = []
        for _ in range(20):
            x, y = rng.uniform(34.3, 35.5), rng.uniform(29.5, 33.0)
            ms.append((await timed(c, f"{C}/tables/perf/h3_1m/h3/cells", params={"bbox": f"{x},{y},{x + 0.4},{y + 0.3}", "resolution": 9, "agg": "sum", "value": "population"}))[0])
        h3["cells_viewport_h3_1m"] = summarize(ms)
        ms = []
        for _ in range(10):
            x, y = rng.uniform(34.3, 35.5), rng.uniform(29.5, 33.0)
            ms.append((await timed(c, f"{C}/tables/perf/points_1m/h3/aggregate", params={"bbox": f"{x},{y},{x + 0.4},{y + 0.3}", "resolution": 8}))[0])
        h3["aggregate_viewport_points_1m"] = summarize(ms)
        out["h3_ms"] = h3
        await app.state.pools.close()

    Path("perf-results").mkdir(exist_ok=True)
    Path("perf-results/latest.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
