"""Build analyst consensus sidecars for preloaded tickers."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.analyst_consensus import fetch_analyst_consensus
from services.top_tickers import PRELOADED_TICKERS

DATA_DIR = ROOT / "data"


def main() -> None:
    p = argparse.ArgumentParser(description="Fetch analyst consensus → data/*_consensus.json")
    p.add_argument("tickers", nargs="*", default=list(PRELOADED_TICKERS))
    args = p.parse_args()

    for ticker in args.tickers:
        sym = ticker.upper()
        data = fetch_analyst_consensus(sym)
        path = DATA_DIR / f"{sym.lower()}_consensus.json"
        static_path = ROOT / "static" / "consensus" / f"{sym.lower()}_consensus.json"
        payload = {"ticker": sym, "analyst_consensus": data}
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        static_path.parent.mkdir(parents=True, exist_ok=True)
        static_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        if data.get("error"):
            print(f"  {sym}: ERROR — {data['error']}")
        else:
            ratings = data.get("ratings") or {}
            r_total = ratings.get("total")
            r_note = f" · {r_total} ratings" if r_total else ""
            print(
                f"  {sym}: low=${data['low']} med=${data['median']} "
                f"mean=${data['mean']} high=${data['high']} ({data['source']}){r_note}"
            )


if __name__ == "__main__":
    main()
