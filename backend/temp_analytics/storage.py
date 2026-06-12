"""Append-only JSONL event log for temp analytics."""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
LOG_PATH = DATA_DIR / "temp_analytics.jsonl"

_lock = threading.Lock()


def append_event(row: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    line = json.dumps(row, ensure_ascii=False) + "\n"
    with _lock:
        with LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(line)


def read_events(limit: int = 50_000) -> list[dict[str, Any]]:
    if not LOG_PATH.is_file():
        return []
    rows: list[dict[str, Any]] = []
    with _lock:
        text = LOG_PATH.read_text(encoding="utf-8")
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    if len(rows) > limit:
        rows = rows[-limit:]
    return rows


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
