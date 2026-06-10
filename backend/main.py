from pathlib import Path
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from services.data_cache import list_cached_tickers, load_cached
from services.magic_numbers import DataSheet, compute_magic_numbers, load_preloaded
from services.stock_analyzer import analyze_ticker
from services.top_tickers import TOP_US_TICKERS

STATIC_DIR = Path(__file__).parent / "static"
DATA_DIR = Path(__file__).parent / "data"

load_dotenv(Path(__file__).parent / ".env")

app = FastAPI(title="Financial Thesis Tool")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _live_fetch_enabled() -> bool:
    return os.environ.get("ALLOW_LIVE_FETCH", "false").strip().lower() in ("1", "true", "yes")


@app.get("/api/health")
def health():
    cached = list_cached_tickers()
    return {
        "status": "ok",
        "cached_tickers": cached,
        "live_fetch": _live_fetch_enabled(),
        "fmp_key_loaded": bool(os.environ.get("FMP_API_KEY", "").strip()),
        "engine": "magic_numbers_v3_multi_source",
        "sources": ["preload", "fmp", "edgar"],
    }


@app.get("/api/tickers")
def tickers():
    cached = set(list_cached_tickers())
    return {
        "top_us": list(TOP_US_TICKERS),
        "cached": sorted(cached),
        "ready": [t for t in TOP_US_TICKERS if t in cached],
    }


def _thesis_from_payload(payload: dict) -> dict:
    return compute_magic_numbers(DataSheet(payload))


def _live_fmp(symbol: str) -> dict:
    from services.fmp_provider import fetch_bundle
    from services.normalize_fmp import normalize_fmp_bundle

    bundle = fetch_bundle(symbol)
    return normalize_fmp_bundle(symbol, bundle)


def _live_edgar(symbol: str) -> dict:
    from services.edgar_provider import fetch_company_facts
    from services.normalize_edgar import normalize_edgar_facts

    facts = fetch_company_facts(symbol)
    return normalize_edgar_facts(symbol, facts)


@app.get("/api/thesis/{ticker}")
def thesis(ticker: str, source: str = "preload"):
    symbol = ticker.strip().upper()
    src = source.lower()

    # 1) Always prefer on-disk cache (fast, no API cost — required for serverless hosts).
    cached = load_cached(symbol, src)
    if cached:
        return _thesis_from_payload(cached)

    # 2) Live APIs only when explicitly enabled (background jobs / dev).
    if not _live_fetch_enabled():
        available = list_cached_tickers()
        raise HTTPException(
            status_code=404,
            detail=(
                f"No cached data for {symbol} (source={src}). "
                f"Available: {', '.join(available) or 'none'}. "
                "Live fetch is disabled in production."
            ),
        )

    if src == "fmp":
        try:
            return _thesis_from_payload(_live_fmp(symbol))
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"FMP homologation failed: {exc}") from exc

    if src == "edgar":
        try:
            return _thesis_from_payload(_live_edgar(symbol))
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"EDGAR homologation failed: {exc}") from exc

    if src == "preload":
        json_path = DATA_DIR / f"{symbol.lower()}_1data.json"
        if json_path.exists():
            import json

            payload = json.loads(json_path.read_text(encoding="utf-8"))
            return _thesis_from_payload(payload)

    raise HTTPException(
        status_code=404,
        detail=f"Ticker {symbol} not found. Cached: {', '.join(list_cached_tickers())}",
    )


@app.get("/api/thesis")
def thesis_default():
    return load_preloaded("MSFT")


@app.get("/api/analyze/{ticker}")
def analyze(ticker: str, years: int = 10):
    if years < 1 or years > 15:
        raise HTTPException(status_code=400, detail="years debe estar entre 1 y 15")

    try:
        return analyze_ticker(ticker, years=years)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Error al obtener datos del ticker: {exc}",
        ) from exc


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
