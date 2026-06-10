#!/usr/bin/env python3
"""Download EDGAR 1 DATA for demo tickers (run locally before deploy)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.edgar_provider import EdgarError, fetch_company_facts
from services.normalize_edgar import normalize_edgar_facts
from services.top_tickers import TOP_US_TICKERS

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def main() -> None:
    ok, fail = [], []
    for ticker in TOP_US_TICKERS:
        out = DATA_DIR / f"{ticker.lower()}_edgar_1data.json"
        if out.exists():
            print(f"  skip {ticker} (already cached)")
            ok.append(ticker)
            continue
        print(f"  fetch {ticker}…", flush=True)
        try:
            facts = fetch_company_facts(ticker)
            payload = normalize_edgar_facts(ticker, facts)
            out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            print(f"  OK {ticker} -> {out.name}")
            ok.append(ticker)
        except (EdgarError, ValueError) as exc:
            print(f"  FAIL {ticker}: {exc}")
            fail.append(ticker)
    print(f"\nDone: {len(ok)} ok, {len(fail)} failed")
    if fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
