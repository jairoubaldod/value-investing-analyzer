import json
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from services.data_cache import is_ticker_ready, list_ready_tickers, list_ticker_catalog, load_cached
from services.magic_numbers import DataSheet, compute_magic_numbers, enrich_payload_consensus, enrich_payload_multiples
from services.one_pager import enrich_payload_profile
from services.ticker_lookup import normalize_symbol
from services.top_tickers import TOP_US_TICKERS

STATIC_DIR = Path(__file__).parent / "static"

load_dotenv(Path(__file__).parent / ".env")

app = FastAPI(title="Financial Thesis Tool")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _cached_payload(symbol: str) -> dict | None:
    if symbol == "MSFT":
        return load_cached("MSFT", "preload") or load_cached("MSFT", "edgar")
    return load_cached(symbol, "edgar")


@app.get("/api/health")
def health():
    ready = list_ready_tickers()
    return {
        "status": "ok",
        "mode": "cache_expanded",
        "ready_count": len(ready),
        "ready": ready,
        "engine": "magic_numbers_v9_valuation_bundle",
        "valuation_bundle": True,
    }


@app.get("/api/tickers")
def tickers():
    ready = list_ready_tickers()
    return {
        "ready": ready,
        "count": len(ready),
        "featured": list(TOP_US_TICKERS),
        "catalog": list_ticker_catalog(),
    }


@app.get("/api/consensus/{ticker}")
def consensus(ticker: str):
    symbol = normalize_symbol(ticker)
    if not is_ticker_ready(symbol):
        raise HTTPException(status_code=404, detail=f"No cache for {symbol}. Run overnight_build.py or pick another ticker.")
    sidecar = Path(__file__).parent / "data" / f"{symbol.lower()}_consensus.json"
    if sidecar.is_file():
        try:
            return json.loads(sidecar.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
    from services.analyst_consensus import fetch_analyst_consensus

    return {"ticker": symbol, "analyst_consensus": fetch_analyst_consensus(symbol)}


@app.get("/api/thesis/{ticker}")
def thesis(ticker: str):
    symbol = normalize_symbol(ticker)
    if not is_ticker_ready(symbol):
        raise HTTPException(
            status_code=404,
            detail=f"No cache for {symbol}. Available: {len(list_ready_tickers())} tickers — see /api/tickers",
        )
    payload = _cached_payload(symbol)
    if not payload:
        raise HTTPException(status_code=404, detail=f"No cache file for {symbol} on server.")
    payload = enrich_payload_profile(enrich_payload_consensus(enrich_payload_multiples(payload)))
    return compute_magic_numbers(DataSheet(payload))


@app.get("/api/thesis")
def thesis_default():
    payload = json.loads(
        (Path(__file__).parent / "data" / "msft_1data.json").read_text(encoding="utf-8")
    )
    payload = enrich_payload_profile(enrich_payload_consensus(enrich_payload_multiples(payload)))
    result = compute_magic_numbers(DataSheet(payload))
    result["ticker"] = "MSFT"
    return result


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
