"""S&P 500 coverage + market-cap priority for cache builds."""

from __future__ import annotations

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
TICKERS_PATH = DATA_DIR / "sp500_tickers.json"
CUSTOM_PATH = DATA_DIR / "custom_tickers.json"
MANIFEST_PATH = DATA_DIR / "sp500_manifest.json"
QUEUE_PATH = DATA_DIR / "sp500_download_queue.json"

# Approximate USD market caps (billions) for download priority — not live quotes.
# Larger number = fetch first when building cache.
MCAP_PRIORITY_B: dict[str, float] = {
    "NVDA": 4962,
    "AAPL": 4342,
    "GOOGL": 4327,
    "MSFT": 2900,
    "AMZN": 2598,
    "AVGO": 1834,
    "META": 1700,
    "TSLA": 1630,
    "BRK-B": 1048,
    "LLY": 1100,
    "WMT": 1030,
    "JPM": 700,
    "V": 620,
    "ORCL": 550,
    "NFLX": 520,
    "MA": 480,
    "XOM": 470,
    "UNH": 460,
    "CVX": 280,
    "PG": 370,
    "JNJ": 430,
    "HD": 380,
    "COST": 433,
    "ABBV": 320,
    "KO": 280,
    "MRK": 280,
    "AMD": 796,
    "CRM": 136,
    "BAC": 391,
    "PLTR": 280,
    "MU": 260,
    "GEV": 250,
    "PM": 240,
    "RTX": 230,
    "COP": 220,
    "NOW": 210,
    "UBER": 200,
    "WDAY": 195,
    "TMUS": 190,
    "SCHW": 185,
    "PFE": 180,
    "NEE": 175,
    "CMCSA": 170,
    "NKE": 165,
    "SBUX": 160,
    "MO": 155,
    "ISRG": 150,
    "PANW": 145,
    "CRWD": 140,
    "VRTX": 135,
    "REGN": 130,
    "LMT": 125,
    "ETN": 120,
    "SYK": 115,
    "MDT": 110,
    "CI": 105,
    "ELV": 100,
    "HCA": 98,
    "SNPS": 95,
    "CDNS": 92,
    "KLAC": 90,
    "LRCX": 88,
    "FTNT": 85,
    "ORLY": 82,
    "MNST": 80,
    "DUK": 78,
    "SO": 76,
    "CSCO": 250,
    "IBM": 180,
    "QCOM": 180,
    "INTU": 170,
    "TXN": 170,
    "AMGN": 150,
    "BLK": 150,
    "SPGI": 150,
    "BA": 145,
    "C": 145,
    "HON": 140,
    "LOW": 140,
    "DE": 120,
    "DHR": 120,
    "ADP": 120,
    "BSX": 120,
    "BX": 120,
    "APO": 120,
    "ANET": 120,
    "ADI": 115,
    "CB": 110,
    "ACN": 103,
    "ADBE": 88,
    "ABNB": 85,
    "UPS": 80,
    "AON": 78,
    "BDX": 70,
    "ADSK": 65,
    "AZO": 62,
}


def load_sp500_tickers() -> list[str]:
    data = json.loads(TICKERS_PATH.read_text(encoding="utf-8"))
    return list(data.get("tickers") or data)


def load_custom_tickers() -> dict[str, list[str]]:
    if not CUSTOM_PATH.is_file():
        return {"extra": [], "priority_boost": []}
    data = json.loads(CUSTOM_PATH.read_text(encoding="utf-8"))
    return {
        "extra": [str(t).upper() for t in data.get("extra") or []],
        "priority_boost": [str(t).upper() for t in data.get("priority_boost") or []],
    }


def list_ready_tickers() -> set[str]:
    ready: set[str] = set()
    for path in DATA_DIR.glob("*_1data.json"):
        base = path.stem.replace("_edgar_1data", "").replace("_fmp_1data", "").replace("_1data", "")
        if base:
            ready.add(base.upper())
    return ready


def cached_mcap_billions(symbol: str) -> float | None:
    sym_l = symbol.lower()
    root = DATA_DIR.parent
    for path in [
        DATA_DIR / f"{sym_l}_profile.json",
        root / "static" / "profile" / f"{sym_l}_profile.json",
        root / "static" / "one_pager" / f"{sym_l}_one_pager.json",
    ]:
        if not path.is_file():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        profile = data.get("company_profile") or data.get("one_pager", {}).get("identity") or {}
        market_cap = profile.get("market_cap")
        if market_cap:
            return float(market_cap) / 1_000_000_000
    return None


def priority_billions(symbol: str) -> float:
    cached = cached_mcap_billions(symbol)
    if cached is not None:
        return cached
    return MCAP_PRIORITY_B.get(symbol.upper(), 25.0)


def format_mcap_billions(value: float | None) -> str:
    if value is None:
        return "—"
    if value >= 1000:
        return f"~${value / 1000:.2f}T"
    return f"~${value:.0f}B"


def sort_tickers_for_display(tickers: list[str], *, top_n: int = 20) -> list[str]:
    """Top N by approximate market cap, remainder alphabetical."""
    unique = sorted(set(tickers))
    ranked = sorted(unique, key=lambda sym: (-priority_billions(sym), sym))
    top = ranked[:top_n]
    top_set = set(top)
    rest = sorted(sym for sym in unique if sym not in top_set)
    return top + rest


def sort_missing(symbols: list[str], boost: set[str]) -> list[str]:
    del boost  # queue is strictly by approximate market cap (largest first)
    return sorted(symbols, key=lambda sym: (-priority_billions(sym), sym))


def company_name(symbol: str) -> str:
    sym_l = symbol.lower()
    for path in [DATA_DIR / f"{sym_l}_profile.json", DATA_DIR / f"{sym_l}_edgar_1data.json"]:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            if "company_profile" in data:
                return str(data["company_profile"].get("name") or symbol)
            return str(data.get("company") or symbol)
    return symbol


def build_manifest() -> dict:
    custom = load_custom_tickers()
    boost = set(custom["priority_boost"])
    sp500 = load_sp500_tickers()
    extra = [t for t in custom["extra"] if t not in sp500]
    universe = sorted(set(sp500) | set(extra))
    ready = list_ready_tickers()

    rows = []
    for sym in universe:
        rows.append(
            {
                "ticker": sym,
                "name": company_name(sym),
                "in_sp500": sym in sp500,
                "cached": sym in ready,
                "priority_mcap_b": priority_billions(sym),
                "priority_boost": sym in boost,
            }
        )

    missing_syms = [row["ticker"] for row in rows if not row["cached"]]
    missing_sorted = sort_missing(missing_syms, boost)
    rank_by_ticker = {sym: index + 1 for index, sym in enumerate(missing_sorted)}

    rows.sort(key=lambda row: (-row["priority_mcap_b"], row["ticker"]))
    for index, row in enumerate(rows, 1):
        row["rank_overall"] = index
        if not row["cached"]:
            row["rank"] = rank_by_ticker[row["ticker"]]

    missing = [row for row in rows if not row["cached"]]
    missing.sort(key=lambda row: row["rank"])
    cached_rows = [row for row in rows if row["cached"]]

    manifest = {
        "sp500_total": len(sp500),
        "universe_total": len(universe),
        "cached_count": len(cached_rows),
        "missing_count": len(missing),
        "custom_extra": extra,
        "priority_boost": custom["priority_boost"],
        "cached": cached_rows,
        "missing": missing,
        "ranked_all": rows,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    queue = {
        "order": "market_cap_priority",
        "tickers": missing_sorted,
    }
    QUEUE_PATH.write_text(json.dumps(queue, indent=2), encoding="utf-8")
    return manifest


def download_queue(*, order: str = "market_cap") -> list[str]:
    if order == "alphabetical":
        sp500 = load_sp500_tickers()
        custom = load_custom_tickers()
        universe = sorted(set(sp500) | set(custom["extra"]))
        ready = list_ready_tickers()
        return [sym for sym in universe if sym not in ready]

    if QUEUE_PATH.is_file():
        data = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
        queued = [str(t).upper() for t in data.get("tickers") or []]
        ready = list_ready_tickers()
        return [sym for sym in queued if sym not in ready]

    build_manifest()
    data = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
    ready = list_ready_tickers()
    return [str(t).upper() for t in data.get("tickers") or [] if str(t).upper() not in ready]
