#!/usr/bin/env python3
"""
Overnight cache builder — EDGAR fundamentals + optional FMP sidecars.

Run before sleep (PowerShell):
  cd backend
  $env:SEC_USER_AGENT = "YourName your@email.com"
  # optional for multiples/profile:
  # $env:FMP_API_KEY = "your_key"
  .venv\\Scripts\\python.exe scripts\\overnight_build.py --hours 5.75

Log: backend/data/overnight_build.log
Report: backend/data/overnight_report.json
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=True)

from services.analyst_consensus import fetch_analyst_consensus
from services.data_cache import load_cached
from services.edgar_provider import EdgarError, fetch_company_facts
from services.fmp_provider import FMPError
from services.magic_numbers import DataSheet, compute_magic_numbers, enrich_payload_consensus, enrich_payload_multiples
from services.multiples_series import fetch_and_build_multiples_series
from services.normalize_edgar import normalize_edgar_facts
from services.one_pager import enrich_payload_profile

DATA_DIR = ROOT / "data"
STATIC_DIR = ROOT / "static"
SP500_URL = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
LOG_PATH = DATA_DIR / "overnight_build.log"
REPORT_PATH = DATA_DIR / "overnight_report.json"
TICKERS_PATH = DATA_DIR / "sp500_tickers.json"

# Rough FMP budget (free tier 250/day). Stop after this many *successful* FMP enrichments.
FMP_DAILY_BUDGET = int(os.environ.get("OVERNIGHT_FMP_BUDGET", "240"))
FMP_CALLS_PER_FULL = 9
YF_SLEEP = 0.35


def log(msg: str) -> None:
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def load_sp500_tickers() -> list[str]:
    if TICKERS_PATH.exists():
        data = json.loads(TICKERS_PATH.read_text(encoding="utf-8"))
        return list(data.get("tickers") or data)

    log("Downloading S&P 500 constituent list…")
    ua = os.environ.get("SEC_USER_AGENT", "ValueInvestingAnalyzer contact@example.com")
    res = requests.get(SP500_URL, timeout=60, headers={"User-Agent": ua})
    res.raise_for_status()
    tickers: list[str] = []
    for row in csv.DictReader(io.StringIO(res.text)):
        sym = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
        if sym:
            tickers.append(sym.replace(".", "-"))
    tickers = sorted(set(tickers))
    TICKERS_PATH.write_text(
        json.dumps({"updated": datetime.now(timezone.utc).isoformat(), "tickers": tickers}, indent=2),
        encoding="utf-8",
    )
    log(f"S&P 500 list saved: {len(tickers)} tickers")
    return tickers


def edgar_path(ticker: str) -> Path:
    return DATA_DIR / f"{ticker.lower()}_edgar_1data.json"


def has_edgar(ticker: str) -> bool:
    return edgar_path(ticker).exists()


def fetch_edgar(ticker: str) -> bool:
    sym = ticker.upper()
    out = edgar_path(sym)
    t0 = time.time()
    try:
        facts = fetch_company_facts(sym)
        payload = normalize_edgar_facts(sym, facts)
        out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        log(f"EDGAR OK {sym} ({len(payload.get('years', []))} yrs) {time.time() - t0:.0f}s")
        return True
    except (EdgarError, ValueError) as exc:
        log(f"EDGAR FAIL {sym}: {exc}")
        return False


def save_consensus(ticker: str) -> bool:
    sym = ticker.upper()
    try:
        data = fetch_analyst_consensus(sym)
        payload = {"ticker": sym, "analyst_consensus": data}
        for base in (DATA_DIR, STATIC_DIR / "consensus"):
            base.mkdir(parents=True, exist_ok=True)
            (base / f"{sym.lower()}_consensus.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
        ok = not data.get("error")
        log(f"CONSENSUS {'OK' if ok else 'WARN'} {sym}")
        time.sleep(YF_SLEEP)
        return ok
    except Exception as exc:
        log(f"CONSENSUS FAIL {sym}: {exc}")
        return False


def save_multiples(ticker: str) -> bool:
    sym = ticker.upper()
    if not os.environ.get("FMP_API_KEY", "").strip():
        return False
    payload = load_cached(sym, "edgar") or load_cached(sym, "preload")
    if not payload:
        return False
    try:
        series = fetch_and_build_multiples_series(sym, payload=payload)
        (DATA_DIR / f"{sym.lower()}_multiples.json").write_text(json.dumps(series, indent=2), encoding="utf-8")
        log(f"MULTIPLES OK {sym}")
        return True
    except FMPError as exc:
        log(f"MULTIPLES SKIP {sym}: {exc}")
        return False


def save_profile(ticker: str) -> bool:
    sym = ticker.upper()
    if not os.environ.get("FMP_API_KEY", "").strip():
        return False
    try:
        payload = enrich_payload_profile({"ticker": sym})
        if not payload.get("company_profile"):
            return False
        for base in (DATA_DIR, STATIC_DIR / "profile"):
            base.mkdir(parents=True, exist_ok=True)
            (base / f"{sym.lower()}_profile.json").write_text(
                json.dumps({"ticker": sym, "company_profile": payload["company_profile"]}, indent=2),
                encoding="utf-8",
            )
        log(f"PROFILE OK {sym}")
        return True
    except Exception as exc:
        log(f"PROFILE SKIP {sym}: {exc}")
        return False


def save_one_pager(ticker: str) -> bool:
    sym = ticker.upper()
    payload = load_cached(sym, "edgar") or load_cached(sym, "preload")
    if not payload:
        return False
    try:
        payload = dict(payload)
        payload["ticker"] = sym
        payload = enrich_payload_profile(enrich_payload_consensus(enrich_payload_multiples(payload)))
        result = compute_magic_numbers(DataSheet(payload))
        op = result.get("one_pager")
        out_dir = STATIC_DIR / "one_pager"
        out_dir.mkdir(parents=True, exist_ok=True)
        out = {"ticker": sym, "one_pager": op, "market_bar": result.get("market_bar")}
        (out_dir / f"{sym.lower()}_one_pager.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
        log(f"ONE_PAGER OK {sym}")
        return True
    except Exception as exc:
        log(f"ONE_PAGER FAIL {sym}: {exc}")
        return False


def full_fmp_stack(ticker: str, fmp_used: int) -> tuple[int, bool]:
    if fmp_used >= FMP_DAILY_BUDGET:
        return fmp_used, False
    if not os.environ.get("FMP_API_KEY", "").strip():
        return fmp_used, False
    sym = ticker.upper()
    ok_m = save_multiples(sym)
    ok_p = save_profile(sym)
    used = fmp_used + FMP_CALLS_PER_FULL if (ok_m or ok_p) else fmp_used
    save_consensus(sym)
    save_one_pager(sym)
    return used, ok_m or ok_p


def validate_sec_access(*, retries: int = 36, wait_sec: int = 600) -> bool:
    """Wait up to retries * wait_sec for SEC (e.g. 6h) if temporarily blocked."""
    ua = os.environ.get("SEC_USER_AGENT", "").strip()
    if not ua or "example.com" in ua or "@" not in ua:
        log("FATAL: Set SEC_USER_AGENT in backend/.env (format: AppName your.real@email.com)")
        return False
    log(f"SEC User-Agent: {ua.split('@')[0].strip()}@…")
    from services.edgar_provider import fetch_company_facts

    for attempt in range(1, retries + 1):
        try:
            fetch_company_facts("AAPL")
            log("SEC preflight OK (test fetch AAPL)")
            return True
        except EdgarError as exc:
            if "403" not in str(exc):
                log(f"FATAL: SEC error — {exc}")
                return False
            if attempt >= retries:
                log("FATAL: SEC still blocked after waiting — try again tomorrow or use a real email in .env")
                return False
            log(f"SEC blocked (403) — wait {wait_sec // 60} min then retry ({attempt}/{retries})…")
            time.sleep(wait_sec)
    return False


def main() -> None:
    p = argparse.ArgumentParser(description="Overnight S&P 500 cache builder")
    p.add_argument("--hours", type=float, default=5.75, help="Stop EDGAR phase after N hours")
    p.add_argument("--skip-edgar", action="store_true", help="Only enrich existing cache")
    p.add_argument("--edgar-only", action="store_true", help="Skip FMP (free fundamentals night)")
    args = p.parse_args()

    if args.edgar_only:
        args.skip_edgar = False

    deadline = time.time() + args.hours * 3600
    has_fmp = bool(os.environ.get("FMP_API_KEY", "").strip()) and not args.edgar_only

    log("=" * 60)
    log(f"OVERNIGHT BUILD START · budget {args.hours}h · FMP={'yes' if has_fmp else 'NO (fundamentals+consensus only)'}")
    if args.skip_edgar and not args.edgar_only:
        log("Mode: enrich existing cache only")
    elif args.edgar_only:
        log("Mode: EDGAR-only (recommended free overnight)")

    if not args.skip_edgar and not validate_sec_access(retries=36, wait_sec=600):
        REPORT_PATH.write_text(json.dumps({"error": "sec_preflight_failed"}, indent=2), encoding="utf-8")
        sys.exit(1)

    report: dict = {
        "started": datetime.now(timezone.utc).isoformat(),
        "hours_budget": args.hours,
        "has_fmp": has_fmp,
        "edgar_ok": [],
        "edgar_fail": [],
        "full_stack": [],
        "consensus_ok": [],
        "one_pager_ok": [],
    }

    all_tickers = load_sp500_tickers()
    cached = [t for t in all_tickers if has_edgar(t)]
    missing = [t for t in all_tickers if not has_edgar(t)]
    log(f"Cached EDGAR: {len(cached)} · Missing: {len(missing)} · S&P total: {len(all_tickers)}")

    # Priority: enrich existing 50 first if FMP available
    priority_full = sorted(set(cached), key=str)
    fmp_used = 0
    if has_fmp and not args.skip_edgar:
        log("FMP phase 1: full stack for already-cached tickers…")
        for sym in priority_full:
            if fmp_used >= FMP_DAILY_BUDGET:
                break
            fmp_used, did = full_fmp_stack(sym, fmp_used)
            if did:
                report["full_stack"].append(sym)

    # EDGAR download loop
    if not args.skip_edgar:
        est = min(len(missing), int(max(0, deadline - time.time()) / 92))
        log(f"EDGAR phase: up to ~{est} tickers before deadline (~92s each)…")
        for sym in missing:
            if time.time() >= deadline:
                log("EDGAR deadline reached")
                break
            if fetch_edgar(sym):
                report["edgar_ok"].append(sym)
                consecutive_403 = 0
                if has_fmp and fmp_used < FMP_DAILY_BUDGET:
                    fmp_used, did = full_fmp_stack(sym, fmp_used)
                    if did:
                        report["full_stack"].append(sym)
            else:
                report["edgar_fail"].append(sym)
                if len(report["edgar_ok"]) == 0 and len(report["edgar_fail"]) >= 10:
                    log("STOP: 10 EDGAR failures, 0 OK — check SEC_USER_AGENT in backend/.env")
                    break

    # Consensus + one-pager for all EDGAR tickers without full stack
    log("Consensus + one-pager for all cached tickers…")
    all_cached = sorted(t for t in all_tickers if has_edgar(t))
    for sym in all_cached:
        if sym in report["full_stack"]:
            continue
        if save_consensus(sym):
            report["consensus_ok"].append(sym)
        if save_one_pager(sym):
            report["one_pager_ok"].append(sym)

    report["finished"] = datetime.now(timezone.utc).isoformat()
    report["edgar_total"] = len(all_cached)
    report["fmp_used_estimate"] = fmp_used
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")

    log("=" * 60)
    log(f"DONE · EDGAR total {len(all_cached)} · new tonight {len(report['edgar_ok'])}")
    log(f"Full stack (multiples+profile): {len(report['full_stack'])}")
    log(f"Consensus: {len(report['consensus_ok'])} · One-pager extras: {len(report['one_pager_ok'])}")
    log(f"Report: {REPORT_PATH}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("FATAL: " + traceback.format_exc())
        raise
