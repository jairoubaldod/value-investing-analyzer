"""Disposable analytics API + dashboard — remove temp_analytics package to delete."""

from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from temp_analytics.device import client_ip, lookup_geo, parse_user_agent
from temp_analytics.storage import append_event, read_events, utc_now_iso

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
_geo_cache: dict[str, dict[str, Any]] = {}

router = APIRouter(prefix="/api/temp-analytics", tags=["temp-analytics"])


def _dashboard_key() -> str:
    return os.environ.get("TEMP_ANALYTICS_KEY", "thesis-today").strip() or "thesis-today"


def _require_key(key: str | None) -> None:
    if not key or key != _dashboard_key():
        raise HTTPException(status_code=403, detail="Invalid analytics key")


class AnalyticsEventIn(BaseModel):
    session_id: str = Field(min_length=8, max_length=64)
    event: str = Field(min_length=1, max_length=32)
    ts: int | None = None
    hash: str | None = None
    ticker: str | None = None
    referrer: str | None = None
    lang: str | None = None
    screen: str | None = None
    path: str | None = None


@router.post("/event")
def ingest_event(body: AnalyticsEventIn, request: Request) -> dict[str, str]:
    ip = client_ip(request.headers.get("x-forwarded-for"), request.client.host if request.client else None)
    ua_meta = parse_user_agent(request.headers.get("user-agent") or "")

    geo: dict[str, Any] = {}
    if body.event == "session_start":
        if ip in _geo_cache:
            geo = _geo_cache[ip]
        else:
            geo = lookup_geo(ip)
            if geo:
                _geo_cache[ip] = geo

    row = {
        "at": utc_now_iso(),
        "client_ts": body.ts,
        "session_id": body.session_id,
        "event": body.event,
        "ip": ip,
        "device": ua_meta["device"],
        "os": ua_meta["os"],
        "browser": ua_meta["browser"],
        "ua": ua_meta["ua"],
        "referrer": (body.referrer or "")[:500],
        "lang": body.lang or "",
        "screen": body.screen or "",
        "path": body.path or "",
        "hash": body.hash or "",
        "ticker": (body.ticker or "").upper()[:12],
        **geo,
    }
    append_event(row)
    return {"status": "ok"}


def _parse_ts(row: dict[str, Any]) -> datetime:
    raw = row.get("at") or ""
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


def build_summary() -> dict[str, Any]:
    events = read_events()
    if not events:
        return {
            "sessions": [],
            "totals": {"events": 0, "sessions": 0, "active_now": 0, "avg_duration_sec": 0},
            "top_tickers": [],
            "top_sections": [],
        }

    by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in events:
        sid = str(row.get("session_id") or "")
        if sid:
            by_session[sid].append(row)

    now = datetime.now(timezone.utc)
    sessions_out: list[dict[str, Any]] = []
    ticker_counts: dict[str, int] = defaultdict(int)
    section_counts: dict[str, int] = defaultdict(int)

    for sid, rows in by_session.items():
        rows.sort(key=_parse_ts)
        first = rows[0]
        last = rows[-1]
        t0 = _parse_ts(first)
        t1 = _parse_ts(last)
        duration_sec = max(0, int((t1 - t0).total_seconds()))
        if any(r.get("event") == "session_end" for r in rows):
            duration_sec = max(duration_sec, 30)

        tickers = sorted({str(r.get("ticker") or "") for r in rows if r.get("ticker")})
        sections = sorted({str(r.get("hash") or "") for r in rows if r.get("hash")})
        for t in tickers:
            ticker_counts[t] += 1
        for h in sections:
            section_counts[h] += 1

        sessions_out.append(
            {
                "session_id": sid,
                "started_at": first.get("at"),
                "last_at": last.get("at"),
                "duration_sec": duration_sec,
                "duration_label": _fmt_duration(duration_sec),
                "ip": first.get("ip") or "",
                "country": first.get("country") or "",
                "region": first.get("region") or "",
                "city": first.get("city") or "",
                "isp": first.get("isp") or "",
                "device": first.get("device") or "",
                "os": first.get("os") or "",
                "browser": first.get("browser") or "",
                "lang": first.get("lang") or "",
                "screen": first.get("screen") or "",
                "referrer": first.get("referrer") or "",
                "tickers": tickers,
                "sections": sections,
                "events": len(rows),
            }
        )

    sessions_out.sort(key=lambda s: s.get("last_at") or "", reverse=True)
    active_now = sum(
        1
        for s in sessions_out
        if s.get("last_at")
        and (now - _parse_ts({"at": s["last_at"]})).total_seconds() <= 300
    )
    durations = [s["duration_sec"] for s in sessions_out if s["duration_sec"] > 0]
    avg_duration = int(sum(durations) / len(durations)) if durations else 0

    return {
        "sessions": sessions_out,
        "totals": {
            "events": len(events),
            "sessions": len(sessions_out),
            "active_now": active_now,
            "avg_duration_sec": avg_duration,
            "avg_duration_label": _fmt_duration(avg_duration),
        },
        "top_tickers": _top_counts(ticker_counts, 10),
        "top_sections": _top_counts(section_counts, 10),
    }


def _top_counts(counts: dict[str, int], n: int) -> list[dict[str, Any]]:
    items = [(k, v) for k, v in counts.items() if k]
    items.sort(key=lambda x: (-x[1], x[0]))
    return [{"label": k, "count": v} for k, v in items[:n]]


def _fmt_duration(sec: int) -> str:
    if sec < 60:
        return f"{sec}s"
    m, s = divmod(sec, 60)
    if m < 60:
        return f"{m}m {s}s"
    h, m = divmod(m, 60)
    return f"{h}h {m}m"


@router.get("/summary")
def analytics_summary(key: str = Query("")) -> dict[str, Any]:
    _require_key(key)
    return build_summary()


@router.get("/page")
def analytics_page(key: str = Query("")):
    _require_key(key)
    return FileResponse(STATIC_DIR / "temp-analytics.html")
