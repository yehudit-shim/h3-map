"""Write tests/fixtures/h3_parity_10k.json: the seeded 10k points and their H3 cells (h3-py, resolution 9).

    python -m scripts.seed.gen_h3_parity

The JSON is committed. Tests check that SQL (h3-pg), the API (both engines) and the frontend library (h3-js, via
tests/js/verify_h3js.mjs) reproduce exactly these cell ids.
"""
import json
from pathlib import Path

import h3

from scripts.seed.fixtures import PARITY_RES, parity_points

OUT = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "h3_parity_10k.json"

if __name__ == "__main__":
    pts = parity_points()
    cells = [h3.latlng_to_cell(lat, lon, PARITY_RES) for lon, lat in pts]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"generator": f"h3-py {h3.__version__}", "resolution": PARITY_RES,
                               "points": [[lon, lat] for lon, lat in pts], "cells": cells}, separators=(",", ":")))
    print(f"wrote {OUT} ({len(pts)} points, {len(set(cells))} distinct cells)")
