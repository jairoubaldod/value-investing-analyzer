"""Session analytics API + dashboard — remove temp_analytics package to delete."""

from __future__ import annotations

import csv
import io
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from temp_analytics.device import client_ip, lookup_geo, parse_user_agent
from temp_analytics.storage import append_event, read_events, retention_days, utc_now_iso

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
_geo_cache: dict[str, dict[str, Any]] = {}

SECTION_LABELS: dict[str, str] = {
    "one-pager": "One-Pager",
    "fundamentals": "Fundamentals",
    "valuation": "DCF · Method 1",
    "valuation-dcf-draft": "DCF · Draft",
    "valuation-multiples": "Multiples · P/E & P/BV",
    "valuation-consensus": "Analyst consensus",
}

router = APIRouter(prefix="/api/temp-analytics", tags=["temp-analytics"])


def _dashboard_key() -> str:
    return os.environ.get("TEMP_ANALYTICS_KEY", "thesis-today").strip() or "thesis-today"


def _require_key(key: str | None) -> None:
    if not key or key != _dashboard_key():
        raise HTTPException(status_code=403, detail="Invalid analytics key")


def section_label(hash_raw: str) -> str:
    h = (hash_raw or "").lstrip("#").lower()
    if not h:
        return "One-Pager"
    if h.startswith("block-"):
        return f"Fundamentals · Block {h.replace('block-', '')}"
    if h.startswith("chart-"):
        return f"Fundamentals · Chart {h.replace('chart-', '')}"
    return SECTION_LABELS.get(h, h)


class AnalyticsEventIn(BaseModel):
    session_id: str = Field(min_length=8, max_length=64)
    visitor_id: str | None = Field(default=None, max_length=64)
    event: str = Field(min_length=1, max_length=32)
    ts: int | None = None
    hash: str | None = None
    section_label: str | None = None
    ticker: str | None = None
    referrer: str | None = None
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
    lang: str | None = None
    screen: str | None = None
    viewport: str | None = None
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

    hash_val = body.hash or ""
    row = {
        "at": utc_now_iso(),
        "client_ts": body.ts,
        "session_id": body.session_id,
        "visitor_id": (body.visitor_id or "")[:64],
        "event": body.event,
        "ip": ip,
        "device": ua_meta["device"],
        "device_model": ua_meta.get("device_model") or "",
        "os": ua_meta["os"],
        "browser": ua_meta["browser"],
        "ua": ua_meta["ua"],
        "referrer": (body.referrer or "")[:500],
        "utm_source": (body.utm_source or "")[:120],
        "utm_medium": (body.utm_medium or "")[:120],
        "utm_campaign": (body.utm_campaign or "")[:120],
        "lang": body.lang or "",
        "screen": body.screen or "",
        "viewport": body.viewport or "",
        "path": body.path or "",
        "hash": hash_val,
        "section_label": body.section_label or section_label(hash_val),
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
            "totals": {
                "events": 0,
                "sessions": 0,
                "visitors": 0,
                "active_now": 0,
                "avg_duration_sec": 0,
                "retention_days": retention_days(),
            },
            "devices": {"desktop": 0, "mobile": 0, "tablet": 0},
            "top_tickers": [],
            "top_sections": [],
            "top_sources": [],
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
    source_counts: dict[str, int] = defaultdict(int)
    device_counts = {"desktop": 0, "mobile": 0, "tablet": 0}
    visitors: set[str] = set()

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
        section_hashes = sorted({str(r.get("hash") or "") for r in rows if r.get("hash")})
        section_labels = sorted(
            {
                str(r.get("section_label") or section_label(str(r.get("hash") or "")))
                for r in rows
                if r.get("hash") or r.get("section_label")
            }
        )
        for t in tickers:
            ticker_counts[t] += 1
        for label in section_labels:
            section_counts[label] += 1

        visitor_id = next((str(r.get("visitor_id") or "") for r in rows if r.get("visitor_id")), "")
        if visitor_id:
            visitors.add(visitor_id)

        device = str(first.get("device") or "desktop")
        if device in device_counts:
            device_counts[device] += 1

        utm = str(first.get("utm_source") or "").strip()
        ref = str(first.get("referrer") or "").strip()
        source = utm or (_referrer_label(ref) if ref else "Direct")
        source_counts[source] += 1

        sessions_out.append(
            {
                "session_id": sid[:8],
                "visitor_id": visitor_id[:8] if visitor_id else "",
                "started_at": first.get("at"),
                "last_at": last.get("at"),
                "duration_sec": duration_sec,
                "duration_label": _fmt_duration(duration_sec),
                "ip": first.get("ip") or "",
                "country": first.get("country") or "",
                "region": first.get("region") or "",
                "city": first.get("city") or "",
                "isp": first.get("isp") or "",
                "device": device,
                "device_model": first.get("device_model") or "",
                "os": first.get("os") or "",
                "browser": first.get("browser") or "",
                "lang": first.get("lang") or "",
                "screen": first.get("screen") or "",
                "viewport": first.get("viewport") or "",
                "referrer": ref,
                "utm_source": utm,
                "utm_medium": first.get("utm_medium") or "",
                "utm_campaign": first.get("utm_campaign") or "",
                "source": source,
                "tickers": tickers,
                "sections": section_labels,
                "section_hashes": section_hashes,
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

    oldest = events[0].get("at") if events else ""
    newest = events[-1].get("at") if events else ""

    return {
        "sessions": sessions_out,
        "totals": {
            "events": len(events),
            "sessions": len(sessions_out),
            "visitors": len(visitors) or len(sessions_out),
            "active_now": active_now,
            "avg_duration_sec": avg_duration,
            "avg_duration_label": _fmt_duration(avg_duration),
            "retention_days": retention_days(),
            "oldest_at": oldest,
            "newest_at": newest,
        },
        "devices": device_counts,
        "top_tickers": _top_counts(ticker_counts, 10),
        "top_sections": _top_counts(section_counts, 10),
        "top_sources": _top_counts(source_counts, 10),
    }


def _referrer_label(ref: str) -> str:
    low = ref.lower()
    if "linkedin.com" in low:
        return "LinkedIn"
    if "twitter.com" in low or "x.com" in low:
        return "X / Twitter"
    if "google." in low:
        return "Google"
    if "facebook.com" in low or "fb.com" in low:
        return "Facebook"
    try:
        from urllib.parse import urlparse

        host = urlparse(ref).netloc
        return host.replace("www.", "") if host else "Referral"
    except Exception:
        return "Referral"


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


@router.get("/export.csv")
def analytics_export_csv(key: str = Query("")) -> Response:
    _require_key(key)
    data = build_summary()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "started_at",
            "duration",
            "visitor_id",
            "device",
            "device_model",
            "os",
            "browser",
            "screen",
            "country",
            "region",
            "city",
            "source",
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "referrer",
            "tickers",
            "sections",
            "lang",
            "ip",
        ]
    )
    for s in data.get("sessions") or []:
        writer.writerow(
            [
                s.get("started_at", ""),
                s.get("duration_label", ""),
                s.get("visitor_id", ""),
                s.get("device", ""),
                s.get("device_model", ""),
                s.get("os", ""),
                s.get("browser", ""),
                s.get("screen", ""),
                s.get("country", ""),
                s.get("region", ""),
                s.get("city", ""),
                s.get("source", ""),
                s.get("utm_source", ""),
                s.get("utm_medium", ""),
                s.get("utm_campaign", ""),
                s.get("referrer", ""),
                ", ".join(s.get("tickers") or []),
                ", ".join(s.get("sections") or []),
                s.get("lang", ""),
                s.get("ip", ""),
            ]
        )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="thesis-analytics-{stamp}.csv"'},
    )


@router.get("/page")
def analytics_page(key: str = Query("")):
    _require_key(key)
    return FileResponse(STATIC_DIR / "temp-analytics.html")
