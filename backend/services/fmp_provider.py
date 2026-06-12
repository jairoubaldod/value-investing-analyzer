"""Financial Modeling Prep (FMP) stable API — Starter plan ~$22/mo fits <$30 budget."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

# New accounts (2025+) use /stable/ — legacy /api/v3/ returns 403 for new keys.
FMP_BASE = "https://financialmodelingprep.com/stable"
# Free FMP tier: limit max 5. Starter+ allows 20+. Set FMP_STATEMENT_LIMIT or HISTORY_YEARS.
DEFAULT_LIMIT = int(os.environ.get("FMP_STATEMENT_LIMIT", os.environ.get("HISTORY_YEARS", "20")))
FMP_QUARTERLY_LIMIT = int(os.environ.get("FMP_QUARTERLY_LIMIT", "5"))


class FMPError(RuntimeError):
    pass


def get_api_key() -> str:
    key = os.environ.get("FMP_API_KEY", "").strip()
    if not key:
        raise FMPError(
            "FMP_API_KEY not set. Put your key in backend/.env (see .env.example). "
            "Free key: https://site.financialmodelingprep.com/register"
        )
    return key


def _get(endpoint: str, *, params: dict[str, Any] | None = None) -> Any:
    params = dict(params or {})
    params["apikey"] = get_api_key()
    url = f"{FMP_BASE}/{endpoint.lstrip('/')}"
    resp = requests.get(url, params=params, timeout=45)
    if resp.status_code != 200:
        raise FMPError(f"FMP HTTP {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    if isinstance(data, dict) and data.get("Error Message"):
        raise FMPError(str(data["Error Message"]))
    return data


def _symbol_params(symbol: str, **extra: Any) -> dict[str, Any]:
    return {"symbol": symbol.upper(), **extra}


def fetch_profile(symbol: str) -> dict[str, Any]:
    rows = _get("profile", params=_symbol_params(symbol))
    if not rows:
        raise FMPError(f"No profile for {symbol}")
    return rows[0]


def fetch_income(symbol: str, *, limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    return _get(
        "income-statement",
        params=_symbol_params(symbol, period="annual", limit=limit),
    )


def fetch_balance(symbol: str, *, limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    return _get(
        "balance-sheet-statement",
        params=_symbol_params(symbol, period="annual", limit=limit),
    )


def fetch_cashflow(symbol: str, *, limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    return _get(
        "cash-flow-statement",
        params=_symbol_params(symbol, period="annual", limit=limit),
    )


def fetch_key_metrics(symbol: str, *, limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    return _get(
        "key-metrics",
        params=_symbol_params(symbol, period="annual", limit=limit),
    )


def fetch_income_quarterly(symbol: str, *, limit: int | None = None) -> list[dict[str, Any]]:
    return _get(
        "income-statement",
        params=_symbol_params(symbol, period="quarter", limit=limit or FMP_QUARTERLY_LIMIT),
    )


def fetch_key_metrics_quarterly(symbol: str, *, limit: int | None = None) -> list[dict[str, Any]]:
    return _get(
        "key-metrics",
        params=_symbol_params(symbol, period="quarter", limit=limit or FMP_QUARTERLY_LIMIT),
    )


def fetch_historical_prices_eod(symbol: str, *, years: int = 10) -> list[dict[str, Any]]:
    from datetime import date, timedelta

    end = date.today()
    start = end - timedelta(days=years * 366)
    data = _get(
        "historical-price-eod/full",
        params={
            "symbol": symbol.upper(),
            "from": start.isoformat(),
            "to": end.isoformat(),
        },
    )
    if isinstance(data, dict):
        rows = data.get("historical") or data.get("data") or []
    elif isinstance(data, list):
        rows = data
    else:
        rows = []
    if not rows:
        raise FMPError(f"No historical prices for {symbol}")
    return rows


def fetch_multiples_bundle(symbol: str, *, years: int = 10) -> dict[str, Any]:
    return {
        "price_rows": fetch_historical_prices_eod(symbol, years=years),
        "income_quarterly": fetch_income_quarterly(symbol),
        "key_metrics_quarterly": fetch_key_metrics_quarterly(symbol),
    }


def fetch_quote(symbol: str) -> dict[str, Any]:
    rows = _get("quote", params=_symbol_params(symbol))
    if not rows:
        raise FMPError(f"No quote for {symbol}")
    return rows[0]


def fetch_price_target_consensus(symbol: str) -> dict[str, Any] | None:
    rows = _get("price-target-consensus", params=_symbol_params(symbol))
    if not rows:
        return None
    return rows[0] if isinstance(rows, list) else rows


def fetch_price_target_summary(symbol: str) -> dict[str, Any] | None:
    rows = _get("price-target-summary", params=_symbol_params(symbol))
    if not rows:
        return None
    return rows[0] if isinstance(rows, list) else rows


def fetch_grades_consensus(symbol: str) -> dict[str, Any] | None:
    rows = _get("grades-consensus", params=_symbol_params(symbol))
    if not rows:
        return None
    return rows[0] if isinstance(rows, list) else rows


def fetch_revenue_product_segmentation(
    symbol: str, *, period: str = "annual", structure: str = "flat"
) -> list[dict[str, Any]]:
    try:
        data = _get(
            "revenue-product-segmentation",
            params=_symbol_params(symbol, period=period, structure=structure),
        )
    except FMPError:
        return []
    if isinstance(data, list):
        return data
    return []


def _normalize_segments(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Latest annual revenue mix by product segment."""
    if not rows:
        return []
    latest = rows[0]
    seg_map = latest.get("data") or latest.get("segment") or {}
    if isinstance(seg_map, list):
        return []
    if not isinstance(seg_map, dict):
        return []
    total = sum(float(v) for v in seg_map.values() if v is not None)
    if total <= 0:
        return []
    items = [
        {"name": str(name), "revenue": float(val), "pct": float(val) / total}
        for name, val in seg_map.items()
        if val is not None and float(val) > 0
    ]
    items.sort(key=lambda x: x["revenue"], reverse=True)
    return items[:6]


def fetch_company_profile_bundle(symbol: str) -> dict[str, Any]:
    sym = symbol.upper()
    raw = fetch_profile(sym)
    seg_rows = fetch_revenue_product_segmentation(sym)
    segments = _normalize_segments(seg_rows)
    mcap = raw.get("mktCap") or raw.get("marketCap")
    return {
        "name": raw.get("companyName") or raw.get("symbol"),
        "ticker": sym,
        "description": (raw.get("description") or "").strip(),
        "sector": raw.get("sector"),
        "industry": raw.get("industry"),
        "country": raw.get("country"),
        "exchange": raw.get("exchange"),
        "market_cap": float(mcap) if mcap is not None else None,
        "market_cap_label": None,
        "segments": segments,
        "source": "fmp",
    }


def fetch_bundle(symbol: str) -> dict[str, Any]:
    """All statements needed for 1 DATA homologation."""
    return {
        "profile": fetch_profile(symbol),
        "income": fetch_income(symbol),
        "balance": fetch_balance(symbol),
        "cashflow": fetch_cashflow(symbol),
        "key_metrics": fetch_key_metrics(symbol),
        "quote": fetch_quote(symbol),
    }
