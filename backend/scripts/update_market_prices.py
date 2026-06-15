#!/usr/bin/env python3
"""Refresh live market quotes (PX_LAST) for all cached 1 DATA tickers."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=True)

from services.data_cache import cache_path, list_cached_tickers
from services.fmp_provider import FMPError, fetch_quote
from services.magic_numbers import DataSheet, compute_magic_numbers, enrich_payload_consensus, enrich_payload_multiples
from services.one_pager import enrich_payload_profile

DATA_DIR = ROOT / "data"
STATIC_DIR = ROOT / "static" / "one_pager"
LOG_PATH = DATA_DIR / "overnight_build.log"
CHUNK_SLEEP = float(os.environ.get("QUOTE_CHUNK_SLEEP", "2.0"))
TICKER_SLEEP = float(os.environ.get("QUOTE_SLEEP", "1.0"))


def log(msg: str) -> None:
    line = f"[{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC] {msg}"
    print(line, flush=True)
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def primary_cache_file(symbol: str) -> Path | None:
    sym = symbol.upper()
    if sym == "MSFT":
        return cache_path(sym, "preload") or cache_path(sym, "edgar")
    return cache_path(sym, "edgar") or cache_path(sym, "preload") or cache_path(sym, "fmp")


def _float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if value != value:  # NaN
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _yahoo_symbol(symbol: str) -> str:
    return symbol.upper().replace(".", "-")


def fetch_quotes_yahoo_batch(symbols: list[str], *, retries: int = 3) -> dict[str, dict[str, Any]]:
    """Fetch latest/previous close for many tickers in one Yahoo request."""
    try:
        import yfinance as yf
    except ImportError as exc:
        raise RuntimeError("yfinance not installed") from exc

    if not symbols:
        return {}

    yahoo_syms = [_yahoo_symbol(s) for s in symbols]
    joined = " ".join(yahoo_syms)
    last_err: Exception | None = None

    for attempt in range(retries):
        try:
            frame = yf.download(
                joined,
                period="10d",
                group_by="ticker",
                auto_adjust=False,
                threads=False,
                progress=False,
            )
            break
        except Exception as exc:
            last_err = exc
            wait = 5 * (attempt + 1)
            log(f"Yahoo batch retry {attempt + 1}/{retries} after {wait}s ({exc})")
            time.sleep(wait)
    else:
        raise RuntimeError(f"Yahoo batch failed: {last_err}")

    out: dict[str, dict[str, Any]] = {}
    multi = len(yahoo_syms) > 1

    for orig, ysym in zip(symbols, yahoo_syms):
        sym = orig.upper()
        try:
            if multi:
                if ysym not in frame.columns.get_level_values(0):
                    continue
                closes = frame[ysym]["Close"].dropna()
            else:
                closes = frame["Close"].dropna()
            if closes.empty:
                continue
            price = _float(closes.iloc[-1])
            prev = _float(closes.iloc[-2]) if len(closes) >= 2 else None
            if price is None:
                continue
            out[sym] = {
                "price": price,
                "previousClose": prev,
                "pe": None,
                "priceToBook": None,
                "source": "yahoo",
            }
        except Exception:
            continue
    return out


def fetch_quote_yahoo_single(symbol: str, *, retries: int = 3) -> dict[str, Any] | None:
    batch = fetch_quotes_yahoo_batch([symbol], retries=retries)
    return batch.get(symbol.upper())


def fetch_quote_fmp(symbol: str) -> dict[str, Any] | None:
    if not os.environ.get("FMP_API_KEY", "").strip():
        return None
    try:
        row = fetch_quote(symbol.upper())
        price = _float(row.get("price"))
        if price is None:
            return None
        return {
            "price": price,
            "previousClose": _float(row.get("previousClose")),
            "pe": _float(row.get("pe") or row.get("peRatio")),
            "priceToBook": _float(row.get("priceToBook") or row.get("priceToBookRatio")),
            "source": "fmp",
        }
    except FMPError:
        return None


def fetch_quote_from_multiples(symbol: str) -> dict[str, Any] | None:
    """Last month-end price from multiples sidecar (offline fallback)."""
    path = DATA_DIR / f"{symbol.lower()}_multiples.json"
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    ms = raw.get("multiples_series") or raw
    pe_pts = (ms.get("pe") or {}).get("points") or []
    pb_pts = (ms.get("pbv") or {}).get("points") or []
    if not pe_pts:
        return None
    last = pe_pts[-1]
    prev = pe_pts[-2] if len(pe_pts) >= 2 else None
    price = _float(last.get("price"))
    if price is None:
        return None
    quote: dict[str, Any] = {
        "price": price,
        "previousClose": _float(prev.get("price")) if prev else None,
        "pe": _float(last.get("pe")),
        "priceToBook": _float(pb_pts[-1].get("pbv")) if pb_pts else None,
        "source": "multiples_cache",
        "as_of": last.get("asof") or last.get("month"),
    }
    return quote


def fetch_live_quote(symbol: str) -> dict[str, Any]:
    sym = symbol.upper()
    quote = fetch_quote_fmp(sym)
    if quote:
        return quote
    quote = fetch_quote_yahoo_single(sym)
    if quote:
        return quote
    quote = fetch_quote_from_multiples(sym)
    if quote:
        return quote
    raise RuntimeError(f"No live quote for {sym}")


def apply_quote_to_payload(payload: dict[str, Any], quote: dict[str, Any]) -> dict[str, Any]:
    out = dict(payload)
    grid = dict(out.get("grid") or {})
    price = quote.get("price")
    prev = quote.get("previousClose")
    pe = quote.get("pe")
    pb = quote.get("priceToBook")

    if price is not None:
        row15 = dict(grid.get("15") or {})
        if not row15.get("label"):
            row15["label"] = "PX_LAST"
        vals15 = dict(row15.get("values") or {})
        vals15["39"] = price
        if prev is not None:
            vals15["38"] = prev
        row15["values"] = vals15
        grid["15"] = row15

    if pe is not None:
        row16 = dict(grid.get("16") or {"label": "P/E", "values": {}})
        vals16 = dict(row16.get("values") or {})
        vals16["39"] = pe
        row16["values"] = vals16
        grid["16"] = row16

    if pb is not None:
        row17 = dict(grid.get("17") or {"label": "P/BV", "values": {}})
        vals17 = dict(row17.get("values") or {})
        vals17["39"] = pb
        row17["values"] = vals17
        grid["17"] = row17

    out["grid"] = grid
    out["market_quote"] = {
        "price": price,
        "previous_close": prev,
        "pe": pe,
        "pb": pb,
        "source": quote.get("source"),
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    return out


def save_quote(symbol: str, quote: dict[str, Any], *, rebuild: bool) -> bool:
    sym = symbol.upper()
    path = primary_cache_file(sym)
    if not path:
        return False
    payload = json.loads(path.read_text(encoding="utf-8"))
    updated = apply_quote_to_payload(payload, quote)
    path.write_text(json.dumps(updated, indent=2), encoding="utf-8")
    if rebuild:
        rebuild_one_pager(sym, updated)
    return True


def rebuild_one_pager(symbol: str, payload: dict[str, Any]) -> bool:
    sym = symbol.upper()
    try:
        enriched = enrich_payload_profile(enrich_payload_consensus(enrich_payload_multiples(dict(payload))))
        enriched["ticker"] = sym
        result = compute_magic_numbers(DataSheet(enriched))
        op = result.get("one_pager")
        out = {"ticker": sym, "one_pager": op, "market_bar": result.get("market_bar")}
        STATIC_DIR.mkdir(parents=True, exist_ok=True)
        (STATIC_DIR / f"{sym.lower()}_one_pager.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
        return bool(op)
    except Exception as exc:
        log(f"ONE_PAGER FAIL {sym}: {exc}")
        return False


def update_batch_mode(tickers: list[str], *, chunk_size: int, rebuild: bool) -> tuple[int, int, list[str]]:
    ok = fail = 0
    missing: list[str] = []
    chunks = [tickers[i : i + chunk_size] for i in range(0, len(tickers), chunk_size)]

    for idx, chunk in enumerate(chunks, start=1):
        log(f"Batch {idx}/{len(chunks)} · size={len(chunk)}")
        try:
            quotes = fetch_quotes_yahoo_batch(chunk)
        except Exception as exc:
            log(f"Batch {idx} failed: {exc}")
            quotes = {}

        for sym in chunk:
            quote = quotes.get(sym.upper())
            if not quote:
                missing.append(sym)
                fail += 1
                continue
            try:
                if save_quote(sym, quote, rebuild=rebuild):
                    ok += 1
                    log(f"QUOTE OK {sym.upper()}: ${quote['price']:.2f} ({quote.get('source')})")
                else:
                    missing.append(sym)
                    fail += 1
            except Exception as exc:
                log(f"SAVE FAIL {sym.upper()}: {exc}")
                missing.append(sym)
                fail += 1

        if idx < len(chunks):
            time.sleep(CHUNK_SLEEP)

    return ok, fail, missing


def retry_missing(missing: list[str], *, rebuild: bool) -> tuple[int, int]:
    ok = fail = 0
    for sym in missing:
        try:
            quote = fetch_live_quote(sym)
            if save_quote(sym, quote, rebuild=rebuild):
                ok += 1
                log(f"RETRY OK {sym.upper()}: ${quote['price']:.2f} ({quote.get('source')})")
            else:
                fail += 1
                log(f"RETRY SKIP {sym.upper()}: no cache")
        except Exception as exc:
            fail += 1
            log(f"RETRY FAIL {sym.upper()}: {exc}")
        time.sleep(TICKER_SLEEP)
    return ok, fail


def update_multiples_mode(tickers: list[str], *, rebuild: bool, skip_fresh_hours: float) -> tuple[int, int]:
    ok = fail = 0
    cutoff = None
    if skip_fresh_hours > 0:
        cutoff = datetime.now(timezone.utc).timestamp() - skip_fresh_hours * 3600

    for sym in tickers:
        sym_u = sym.upper()
        path = primary_cache_file(sym_u)
        if not path:
            fail += 1
            log(f"QUOTE SKIP {sym_u}: no cache")
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            mq = payload.get("market_quote") or {}
            if cutoff and mq.get("source") in ("fmp", "yahoo"):
                as_of = mq.get("as_of") or ""
                try:
                    ts = datetime.fromisoformat(as_of.replace("Z", "+00:00")).timestamp()
                    if ts >= cutoff:
                        ok += 1
                        log(f"QUOTE KEEP {sym_u}: fresh ({mq.get('source')})")
                        continue
                except ValueError:
                    pass
            quote = fetch_quote_from_multiples(sym_u)
            if not quote:
                fail += 1
                log(f"QUOTE SKIP {sym_u}: no multiples sidecar")
                continue
            save_quote(sym_u, quote, rebuild=rebuild)
            ok += 1
            log(f"QUOTE OK {sym_u}: ${quote['price']:.2f} (multiples {quote.get('as_of')})")
        except Exception as exc:
            fail += 1
            log(f"QUOTE FAIL {sym_u}: {exc}")
    return ok, fail


def main() -> None:
    p = argparse.ArgumentParser(description="Refresh market prices for cached tickers")
    p.add_argument("tickers", nargs="*", help="Optional tickers (default: all cached)")
    p.add_argument("--chunk-size", type=int, default=40, help="Yahoo batch size (default 40)")
    p.add_argument("--no-one-pager", action="store_true", help="Skip one-pager rebuild")
    p.add_argument("--retry-failures", action="store_true", help="Sequential retry for batch misses")
    p.add_argument("--source", choices=("auto", "multiples"), default="auto")
    p.add_argument("--skip-fresh-hours", type=float, default=6.0, help="Keep recent live quotes (multiples mode)")
    args = p.parse_args()

    tickers = [t.upper() for t in args.tickers] if args.tickers else list_cached_tickers()
    rebuild = not args.no_one_pager

    log("=" * 60)
    if args.source == "multiples":
        log(f"UPDATE MARKET PRICES · tickers={len(tickers)} · mode=multiples_cache")
        ok, fail = update_multiples_mode(tickers, rebuild=rebuild, skip_fresh_hours=args.skip_fresh_hours)
    else:
        log(f"UPDATE MARKET PRICES · tickers={len(tickers)} · chunk={args.chunk_size} · mode=yahoo_batch")
        ok, fail, missing = update_batch_mode(tickers, chunk_size=max(1, args.chunk_size), rebuild=rebuild)

        if missing:
            log(f"Multiples fallback for {len(missing)} tickers…")
            m_ok, m_fail = update_multiples_mode(missing, rebuild=rebuild, skip_fresh_hours=0)
            ok += m_ok
            fail = fail - m_ok + m_fail

        if args.retry_failures and missing:
            still_missing = [sym for sym in missing if not fetch_quote_from_multiples(sym)]
            if still_missing:
                log(f"Sequential live retry for {len(still_missing)} tickers…")
                r_ok, r_fail = retry_missing(still_missing, rebuild=rebuild)
                ok += r_ok
                fail = fail - r_ok + r_fail

    log(f"DONE · ok={ok} · fail={fail} · total={len(tickers)}")
    log("=" * 60)


if __name__ == "__main__":
    main()
