"""Generate src/h3/fixtures/h3py-parity.json with h3-py (run ONCE; the JS tests only read the JSON).

    pip install h3          # h3-py >= 4
    python scripts/gen_h3_fixture.py

The fixture holds deterministic points, their cells and per-cell aggregates at three resolutions, and
parent / children / grid_disk results for a few cells. src/h3/parity.test.js checks that h3-js and the
app's aggregation produce identical ids and statistics. No Python is needed when running the tests.
"""
import json
import math
import random
from pathlib import Path

import h3

OUT = Path(__file__).resolve().parent.parent / "src" / "h3" / "fixtures" / "h3py-parity.json"
RESOLUTIONS = [3, 6, 9]

rng = random.Random(20260101)
points = []
for i in range(1500):
    if i % 3 == 0:  # world-wide, including high latitudes
        lat, lon = rng.uniform(-80, 80), rng.uniform(-179.9, 179.9)
    else:  # clustered around Paris
        lat, lon = 48.86 + rng.gauss(0, 0.08), 2.34 + rng.gauss(0, 0.12)
    points.append([round(lon, 6), round(lat, 6), round(rng.uniform(0, 100), 2)])
points.append([-122.4194, 37.7749, 42.0])  # the published San Francisco vector

aggregates = {}
for res in RESOLUTIONS:
    cells = {}
    for lon, lat, value in points:
        cell = h3.latlng_to_cell(lat, lon, res)
        c = cells.setdefault(cell, {"count": 0, "sum": 0.0, "min": math.inf, "max": -math.inf})
        c["count"] += 1
        c["sum"] += value
        c["min"] = min(c["min"], value)
        c["max"] = max(c["max"], value)
    aggregates[str(res)] = cells

sample = sorted({h3.latlng_to_cell(lat, lon, 7) for lon, lat, _ in points[:60]})[:12]
sample += list(h3.get_pentagons(5))[:2]  # pentagons behave differently
relations = {}
for cell in sample:
    res = h3.get_resolution(cell)
    relations[cell] = {
        "parent": h3.cell_to_parent(cell, res - 1),
        "children": sorted(h3.cell_to_children(cell, res + 1)),
        "grid_disk_2": sorted(h3.grid_disk(cell, 2)),
        "is_pentagon": h3.is_pentagon(cell),
        "center": list(h3.cell_to_latlng(cell)),
    }

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(
    json.dumps(
        {
            "generator": f"h3-py {h3.__version__}",
            "resolutions": RESOLUTIONS,
            "points": points,
            "aggregates": aggregates,
            "relations": relations,
        },
        separators=(",", ":"),
    )
)
print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KiB) with h3-py {h3.__version__}")
