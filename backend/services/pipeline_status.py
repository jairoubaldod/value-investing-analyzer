"""Live overnight build pipeline status (current ticker, queue, progress)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.sp500_priority import build_manifest, company_name, download_queue, priority_billions

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
PIPELINE_PATH = DATA_DIR / "overnight_pipeline.json"
LOG_PATH = DATA_DIR / "overnight_build.log"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fmt_mcap_b(value: float | None) -> str:
    if value is None:
        return "—"
    if value >= 1000:
        return f"~${value / 1000:.2f}T"
    return f"~${value:.0f}B"


def _queue_row(sym: str, rank: int, status: str = "pending") -> dict[str, Any]:
    cap = priority_billions(sym)
    return {
        "rank": rank,
        "ticker": sym,
        "name": company_name(sym),
        "market_cap_b": cap,
        "market_cap_label": _fmt_mcap_b(cap),
        "status": status,
    }


def init_pipeline(
    *,
    queue: list[str],
    phase: str = "edgar",
    hours_budget: float | None = None,
    order: str = "market_cap",
) -> dict[str, Any]:
    rows = [_queue_row(sym, index + 1, "pending") for index, sym in enumerate(queue)]
    status = {
        "running": True,
        "phase": phase,
        "order": order,
        "hours_budget": hours_budget,
        "started_at": _now_iso(),
        "updated_at": _now_iso(),
        "current": None,
        "next": rows[:10],
        "queue": rows,
        "completed": [],
        "failed": [],
        "progress": {
            "done": 0,
            "failed": 0,
            "total": len(queue),
            "remaining": len(queue),
            "pct": 0.0,
        },
    }
    save_pipeline(status)
    return status


def set_current(ticker: str, *, step: str = "edgar") -> None:
    status = load_pipeline()
    if not status.get("running"):
        return
    sym = ticker.upper()
    queue = status.get("queue") or []
    for row in queue:
        if row.get("ticker") == sym:
            row["status"] = "running"
            row["step"] = step
            break
    pending = [row for row in queue if row.get("status") == "pending"]
    status["current"] = {
        "ticker": sym,
        "name": company_name(sym),
        "step": step,
        "started_at": _now_iso(),
        "market_cap_label": _fmt_mcap_b(priority_billions(sym)),
    }
    status["next"] = pending[:10]
    status["updated_at"] = _now_iso()
    save_pipeline(status)


def mark_done(ticker: str, *, detail: str | None = None) -> None:
    status = load_pipeline()
    sym = ticker.upper()
    queue = status.get("queue") or []
    row = next((item for item in queue if item.get("ticker") == sym), None)
    if row:
        row["status"] = "done"
        if detail:
            row["detail"] = detail
    completed = status.setdefault("completed", [])
    if sym not in completed:
        completed.append(sym)
    status["current"] = None
    pending = [item for item in queue if item.get("status") == "pending"]
    status["next"] = pending[:10]
    done = len([item for item in queue if item.get("status") == "done"])
    failed = len([item for item in queue if item.get("status") == "failed"])
    total = len(queue)
    status["progress"] = {
        "done": done,
        "failed": failed,
        "total": total,
        "remaining": max(0, total - done - failed),
        "pct": round(100 * done / total, 1) if total else 0.0,
    }
    status["updated_at"] = _now_iso()
    save_pipeline(status)


def mark_failed(ticker: str, *, error: str) -> None:
    status = load_pipeline()
    sym = ticker.upper()
    queue = status.get("queue") or []
    row = next((item for item in queue if item.get("ticker") == sym), None)
    if row:
        row["status"] = "failed"
        row["error"] = error
    failed_list = status.setdefault("failed", [])
    failed_list.append({"ticker": sym, "error": error, "at": _now_iso()})
    status["current"] = None
    pending = [item for item in queue if item.get("status") == "pending"]
    status["next"] = pending[:10]
    done = len([item for item in queue if item.get("status") == "done"])
    failed = len([item for item in queue if item.get("status") == "failed"])
    total = len(queue)
    status["progress"] = {
        "done": done,
        "failed": failed,
        "total": total,
        "remaining": max(0, total - done - failed),
        "pct": round(100 * done / total, 1) if total else 0.0,
    }
    status["updated_at"] = _now_iso()
    save_pipeline(status)


def begin_enrich_phase(symbols: list[str]) -> None:
    rows = [_queue_row(sym, index + 1, "pending") for index, sym in enumerate(symbols)]
    manifest = build_manifest()
    status = load_pipeline()
    status["running"] = True
    status["phase"] = "enrich"
    status["order"] = "alphabetical"
    status["queue"] = rows
    status["current"] = None
    status["next"] = rows[:10]
    status["completed"] = []
    status["failed"] = []
    status["message"] = f"Consensus + one-pager for {len(rows)} cached companies"
    status["coverage"] = {
        "sp500_total": manifest.get("sp500_total", 503),
        "cached_count": manifest.get("cached_count", 0),
        "missing_count": manifest.get("missing_count", 0),
        "coverage_pct": round(
            100 * manifest.get("cached_count", 0) / manifest.get("sp500_total", 503), 1
        )
        if manifest.get("sp500_total")
        else 0,
    }
    status["progress"] = {
        "done": 0,
        "failed": 0,
        "total": len(rows),
        "remaining": len(rows),
        "pct": 0.0,
    }
    status["updated_at"] = _now_iso()
    save_pipeline(status)


def read_build_log_tail(lines: int = 80) -> list[str]:
    if not LOG_PATH.is_file():
        return []
    try:
        content = LOG_PATH.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    return content.splitlines()[-max(1, lines) :]


def finish_pipeline(*, phase: str = "done", message: str | None = None) -> None:
    status = load_pipeline()
    status["running"] = False
    status["phase"] = phase
    status["current"] = None
    status["finished_at"] = _now_iso()
    status["updated_at"] = _now_iso()
    if message:
        status["message"] = message
    save_pipeline(status)


def save_pipeline(status: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PIPELINE_PATH.write_text(json.dumps(status, indent=2), encoding="utf-8")


def load_pipeline() -> dict[str, Any]:
    if not PIPELINE_PATH.is_file():
        return idle_pipeline_status()
    try:
        return json.loads(PIPELINE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return idle_pipeline_status()


def idle_pipeline_status(*, rebuild_queue: bool = True) -> dict[str, Any]:
    manifest = build_manifest() if rebuild_queue else {}
    missing = manifest.get("missing") or []
    queue_rows = [
        {
            "rank": row.get("rank") or index + 1,
            "ticker": row["ticker"],
            "name": row.get("name") or row["ticker"],
            "market_cap_b": row.get("priority_mcap_b"),
            "market_cap_label": _fmt_mcap_b(row.get("priority_mcap_b")),
            "status": "pending",
        }
        for index, row in enumerate(missing)
    ]
    cached = manifest.get("cached_count", 0)
    sp500_total = manifest.get("sp500_total", 503)
    return {
        "running": False,
        "phase": "idle",
        "order": "market_cap",
        "updated_at": _now_iso(),
        "current": None,
        "next": queue_rows[:10],
        "queue": queue_rows,
        "completed": [],
        "failed": [],
        "coverage": {
            "sp500_total": sp500_total,
            "cached_count": cached,
            "missing_count": manifest.get("missing_count", 0),
            "coverage_pct": round(100 * cached / sp500_total, 1) if sp500_total else 0,
        },
        "progress": {
            "done": cached,
            "failed": 0,
            "total": sp500_total,
            "remaining": manifest.get("missing_count", 0),
            "pct": round(100 * cached / sp500_total, 1) if sp500_total else 0,
        },
    }


def pipeline_status(*, queue_limit: int = 503) -> dict[str, Any]:
    saved = load_pipeline()
    manifest = build_manifest()
    coverage = {
        "sp500_total": manifest.get("sp500_total", 503),
        "cached_count": manifest.get("cached_count", 0),
        "missing_count": manifest.get("missing_count", 0),
        "coverage_pct": round(
            100 * manifest.get("cached_count", 0) / manifest.get("sp500_total", 503), 1
        )
        if manifest.get("sp500_total")
        else 0,
    }
    saved["coverage"] = coverage
    saved["log_tail"] = read_build_log_tail(80)
    saved["log_path"] = str(LOG_PATH)
    queue = saved.get("queue") or []
    saved["queue_preview"] = queue[:queue_limit]
    saved["queue_total"] = len(queue)
    if not saved.get("running"):
        saved.setdefault("phase", "idle")
        idle_queue = [
            {
                "rank": row.get("rank") or index + 1,
                "ticker": row["ticker"],
                "name": row.get("name") or row["ticker"],
                "market_cap_b": row.get("priority_mcap_b"),
                "market_cap_label": _fmt_mcap_b(row.get("priority_mcap_b")),
                "status": "pending",
            }
            for index, row in enumerate(manifest.get("missing") or [])
        ]
        saved["next"] = idle_queue[:10]
        saved["queue"] = idle_queue
        saved["queue_preview"] = idle_queue[:queue_limit]
        saved["queue_total"] = len(idle_queue)
        saved["progress"] = {
            "done": coverage["cached_count"],
            "failed": 0,
            "total": coverage["sp500_total"],
            "remaining": coverage["missing_count"],
            "pct": coverage["coverage_pct"],
        }
    return saved
