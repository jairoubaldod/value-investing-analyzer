"""Print available companies ranked by approximate market cap."""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
ROOT = Path(__file__).resolve().parents[1]

# Approximate market caps in USD billions (cached profiles where available, otherwise public large-cap references).
APPROX_B = {
    "A": 35,
    "AAPL": 4342,
    "ABBV": 320,
    "ABNB": 85,
    "ABT": 210,
    "ACGL": 38,
    "ACN": 103,
    "ADBE": 88,
    "ADI": 115,
    "ADM": 28,
    "ADP": 120,
    "ADSK": 65,
    "AEE": 28,
    "AEP": 52,
    "AES": 12,
    "AFL": 56,
    "AIG": 46,
    "AIZ": 11,
    "AJG": 58,
    "AKAM": 18,
    "ALB": 9,
    "ALGN": 15,
    "ALL": 52,
    "ALLE": 14,
    "AMAT": 439,
    "AMCR": 14,
    "AMD": 796,
    "AME": 42,
    "AMGN": 150,
    "AMP": 52,
    "AMT": 95,
    "AMZN": 2598,
    "ANET": 120,
    "AON": 78,
    "AOS": 11,
    "APD": 58,
    "APH": 140,
    "APO": 120,
    "APP": 200,
    "APTV": 18,
    "ARES": 80,
    "ATO": 25,
    "AVB": 28,
    "AVGO": 1834,
    "AVY": 16,
    "AWK": 28,
    "AXON": 55,
    "AXP": 220,
    "AZO": 62,
    "BA": 145,
    "BAC": 391,
    "BALL": 16,
    "BAX": 22,
    "BBY": 18,
    "BDX": 70,
    "BEN": 12,
    "BF-B": 15,
    "BG": 18,
    "BIIB": 22,
    "BKNG": 127,
    "BKR": 42,
    "BLDR": 22,
    "BLK": 150,
    "BMY": 95,
    "BNY": 58,
    "BR": 22,
    "BRK-B": 1048,
    "BRO": 28,
    "BSX": 120,
    "BX": 120,
    "BXP": 12,
    "C": 145,
    "CAG": 10,
    "CAH": 38,
    "CARR": 58,
    "CASY": 18,
    "CAT": 413,
    "CB": 110,
    "COST": 433,
    "CRM": 136,
    "CSCO": 250,
    "DE": 120,
    "DHR": 120,
    "DIS": 200,
    "GE": 200,
    "GOOGL": 4327,
    "HD": 380,
    "HON": 140,
    "IBM": 180,
    "INTU": 170,
    "JNJ": 430,
    "JPM": 700,
    "KO": 280,
    "LIN": 200,
    "LLY": 1100,
    "LOW": 140,
    "MA": 480,
    "MCD": 210,
    "META": 1700,
    "MRK": 280,
    "MS": 180,
    "MSFT": 2900,
    "NFLX": 520,
    "NVDA": 4962,
    "ORCL": 550,
    "PEP": 210,
    "PG": 370,
    "QCOM": 180,
    "SPGI": 150,
    "TMO": 180,
    "TSLA": 1630,
    "TXN": 170,
    "UNH": 460,
    "UPS": 80,
    "V": 620,
    "WFC": 180,
    "WMT": 1030,
    "XOM": 470,
}


def ready_tickers() -> list[str]:
    tickers: set[str] = set()
    for path in DATA.glob("*_1data.json"):
        base = path.stem.replace("_edgar_1data", "").replace("_fmp_1data", "").replace("_1data", "")
        if base:
            tickers.add(base.upper())
    return sorted(tickers)


def cached_billions(sym: str) -> float | None:
    sym_l = sym.lower()
    for path in [
        DATA / f"{sym_l}_profile.json",
        ROOT / "static" / "profile" / f"{sym_l}_profile.json",
        ROOT / "static" / "one_pager" / f"{sym_l}_one_pager.json",
    ]:
        if not path.is_file():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        profile = data.get("company_profile") or data.get("one_pager", {}).get("identity") or {}
        market_cap = profile.get("market_cap")
        if market_cap:
            return float(market_cap) / 1_000_000_000
    return None


def company_name(sym: str) -> str:
    for path in [DATA / f"{sym.lower()}_profile.json", DATA / f"{sym.lower()}_edgar_1data.json"]:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            if "company_profile" in data:
                return str(data["company_profile"].get("name") or sym)
            return str(data.get("company") or sym)
    return sym


def fmt_billions(value: float | None) -> str:
    if value is None:
        return "—"
    if value >= 1000:
        return f"~${value / 1000:.2f}T"
    return f"~${value:.0f}B"


def main() -> None:
    rows = []
    for sym in ready_tickers():
        cap = cached_billions(sym) or APPROX_B.get(sym)
        rows.append({"ticker": sym, "name": company_name(sym), "mcap_b": cap})
    rows.sort(key=lambda row: (row["mcap_b"] is None, -(row["mcap_b"] or 0)))
    for index, row in enumerate(rows, 1):
        print(f"{index:3}. {row['ticker']:<6} {fmt_billions(row['mcap_b']):>9}  {row['name']}")
    print(f"TOTAL {len(rows)}")


if __name__ == "__main__":
    main()
