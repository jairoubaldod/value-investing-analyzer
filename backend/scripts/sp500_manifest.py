#!/usr/bin/env python3
"""Build S&P 500 coverage manifest + market-cap download queue."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.sp500_priority import MANIFEST_PATH, QUEUE_PATH, build_manifest


def main() -> None:
    manifest = build_manifest()
    print(f"S&P 500 target: {manifest['sp500_total']}")
    print(f"Cached: {manifest['cached_count']} · Missing: {manifest['missing_count']}")
    print(f"Manifest: {MANIFEST_PATH}")
    print(f"Queue: {QUEUE_PATH}")
    print("\nTop 25 missing (market-cap priority):")
    for row in manifest["missing"][:25]:
        cap = row["priority_mcap_b"]
        cap_s = f"${cap/1000:.2f}T" if cap >= 1000 else f"~${cap:.0f}B"
        print(f"  {row['rank']:3}. {row['ticker']:<6} {cap_s:>9}  {row['name']}")


if __name__ == "__main__":
    main()
