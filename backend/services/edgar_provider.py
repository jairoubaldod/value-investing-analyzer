"""SEC EDGAR companyfacts API — free, US listed companies."""

from __future__ import annotations

import json
import os
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

SEC_BASE = "https://data.sec.gov"
DEFAULT_USER_AGENT = "ValueInvestingAnalyzer contact@example.com"
_last_request = 0.0

# Common tickers for Phase 1 tests (avoid extra download when possible).
KNOWN_CIK: dict[str, str] = {
    "MSFT": "0000789019",
    "AAPL": "0000320193",
    "GOOGL": "0001652044",
    "GOOG": "0001652044",
    "JPM": "0000019617",
    "BRK-B": "0001067983",
    "BRK.B": "0001067983",
}


class EdgarError(RuntimeError):
    pass


def _user_agent() -> str:
    return os.environ.get("SEC_USER_AGENT", DEFAULT_USER_AGENT).strip()


def _throttle() -> None:
    global _last_request
    elapsed = time.time() - _last_request
    if elapsed < 0.12:
        time.sleep(0.12 - elapsed)
    _last_request = time.time()


def _get(url: str) -> Any:
    _throttle()
    resp = requests.get(url, headers={"User-Agent": _user_agent()}, timeout=90)
    if resp.status_code != 200:
        raise EdgarError(f"SEC HTTP {resp.status_code}: {resp.text[:200]}")
    return resp.json()


@lru_cache(maxsize=1)
def _ticker_cik_map() -> dict[str, str]:
    data = _get("https://www.sec.gov/files/company_tickers.json")
    out: dict[str, str] = {}
    for item in data.values():
        t = str(item.get("ticker", "")).upper()
        cik = str(item.get("cik_str", "")).zfill(10)
        if t:
            out[t] = cik
    out.update(KNOWN_CIK)
    return out


def resolve_cik(symbol: str) -> str:
    sym = symbol.upper().replace(".", "-")
    if sym in KNOWN_CIK:
        return KNOWN_CIK[sym]
    mapping = _ticker_cik_map()
    if sym not in mapping:
        raise EdgarError(f"CIK not found for ticker {sym}")
    return mapping[sym]


def fetch_company_facts(symbol: str) -> dict[str, Any]:
    cik = resolve_cik(symbol)
    return _get(f"{SEC_BASE}/api/xbrl/companyfacts/CIK{cik}.json")


def fetch_submissions(symbol: str) -> dict[str, Any]:
    cik = resolve_cik(symbol)
    return _get(f"{SEC_BASE}/submissions/CIK{cik}.json")
