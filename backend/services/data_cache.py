"""Resolve cached 1 DATA JSON files (production: serve cache before live APIs)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def list_cached_tickers() -> list[str]:
    tickers: set[str] = set()
    for path in DATA_DIR.glob("*_1data.json"):
        name = path.stem
        base = name.replace("_edgar_1data", "").replace("_fmp_1data", "").replace("_1data", "")
        if base:
            tickers.add(base.upper())
    return sorted(tickers)


def list_ready_tickers() -> list[str]:
    """Tickers with a 1 DATA JSON on disk (edgar, fmp, or preload)."""
    return list_cached_tickers()


def _catalog_payload(symbol: str) -> dict | None:
    sym = symbol.upper()
    if sym == "MSFT":
        return load_cached("MSFT", "preload") or load_cached("MSFT", "edgar")
    return load_cached(sym, "edgar") or load_cached(sym, "preload") or load_cached(sym, "fmp")


def list_ticker_catalog() -> list[dict[str, str]]:
    """Ticker + company name for browse/search UI."""
    rows: list[dict[str, str]] = []
    for sym in list_ready_tickers():
        payload = _catalog_payload(sym)
        company = ""
        if payload:
            company = str(payload.get("company") or payload.get("company_name") or "").strip()
            if not company:
                profile = payload.get("profile")
                if isinstance(profile, dict):
                    company = str(profile.get("companyName") or profile.get("name") or "").strip()
        rows.append({"ticker": sym, "company": company or sym})
    return rows


def is_ticker_ready(symbol: str) -> bool:
    sym = symbol.upper()
    if sym == "MSFT":
        return bool(load_cached("MSFT", "preload") or load_cached("MSFT", "edgar"))
    return bool(load_cached(sym, "edgar") or load_cached(sym, "preload") or load_cached(sym, "fmp"))


def cache_path(symbol: str, source: str) -> Path | None:
    sym = symbol.lower()
    src = source.lower()
    if src == "edgar":
        candidates = [DATA_DIR / f"{sym}_edgar_1data.json"]
    elif src == "fmp":
        candidates = [DATA_DIR / f"{sym}_fmp_1data.json"]
    elif src == "preload":
        candidates = [DATA_DIR / f"{sym}_1data.json"]
    else:
        candidates = [
            DATA_DIR / f"{sym}_1data.json",
            DATA_DIR / f"{sym}_edgar_1data.json",
            DATA_DIR / f"{sym}_fmp_1data.json",
        ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def load_cached(symbol: str, source: str = "auto") -> dict | None:
    path = cache_path(symbol, source)
    if not path:
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_cached(symbol: str, source: str, payload: dict[str, Any]) -> Path:
    sym = symbol.lower()
    if source == "edgar":
        path = DATA_DIR / f"{sym}_edgar_1data.json"
    elif source == "fmp":
        path = DATA_DIR / f"{sym}_fmp_1data.json"
    else:
        path = DATA_DIR / f"{sym}_1data.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path
