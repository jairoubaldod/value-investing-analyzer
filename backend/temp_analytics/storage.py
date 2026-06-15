"""Persistent SQLite event store for temp analytics (accumulative across restarts)."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
_DEFAULT_DB = DATA_DIR / "temp_analytics.db"
_LEGACY_LOG = DATA_DIR / "temp_analytics.jsonl"

_lock = threading.Lock()
_migrated = False


def retention_days() -> int:
    raw = os.environ.get("TEMP_ANALYTICS_RETENTION_DAYS", "30").strip()
    try:
        return max(7, int(raw))
    except ValueError:
        return 30


def _db_path() -> Path:
    raw = os.environ.get("TEMP_ANALYTICS_DB", "").strip()
    return Path(raw) if raw else _DEFAULT_DB


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            at TEXT NOT NULL,
            session_id TEXT NOT NULL,
            event TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_at ON events(at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)")
    conn.commit()
    return conn


def _maybe_purge(conn: sqlite3.Connection) -> None:
    """Drop events older than retention window (default 30 days, minimum 7)."""
    today = datetime.now(timezone.utc).date().isoformat()
    last = conn.execute("SELECT value FROM meta WHERE key = 'last_purge'").fetchone()
    if last and last[0] == today:
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days())
    cutoff_iso = cutoff.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    conn.execute("DELETE FROM events WHERE at < ?", (cutoff_iso,))
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('last_purge', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (today,),
    )
    conn.commit()


def _migrate_jsonl(conn: sqlite3.Connection) -> None:
    global _migrated
    if _migrated:
        return
    _migrated = True

    if conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] > 0:
        return
    if not _LEGACY_LOG.is_file():
        return

    rows: list[tuple[str, str, str, str]] = []
    for line in _LEGACY_LOG.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        rows.append(
            (
                str(row.get("at") or ""),
                str(row.get("session_id") or ""),
                str(row.get("event") or ""),
                json.dumps(row, ensure_ascii=False),
            )
        )
    if rows:
        conn.executemany(
            "INSERT INTO events (at, session_id, event, payload) VALUES (?, ?, ?, ?)",
            rows,
        )
        conn.commit()


def append_event(row: dict[str, Any]) -> None:
    line = json.dumps(row, ensure_ascii=False)
    with _lock:
        conn = _connect()
        try:
            _migrate_jsonl(conn)
            conn.execute(
                "INSERT INTO events (at, session_id, event, payload) VALUES (?, ?, ?, ?)",
                (
                    str(row.get("at") or ""),
                    str(row.get("session_id") or ""),
                    str(row.get("event") or ""),
                    line,
                ),
            )
            conn.commit()
            _maybe_purge(conn)
        finally:
            conn.close()


def read_events(limit: int = 50_000) -> list[dict[str, Any]]:
    with _lock:
        conn = _connect()
        try:
            _migrate_jsonl(conn)
            if limit > 0:
                cur = conn.execute(
                    """
                    SELECT payload FROM events
                    ORDER BY id DESC
                    LIMIT ?
                    """,
                    (limit,),
                )
                rows = [json.loads(r[0]) for r in reversed(cur.fetchall())]
            else:
                cur = conn.execute("SELECT payload FROM events ORDER BY id ASC")
                rows = [json.loads(r[0]) for r in cur.fetchall()]
            return rows
        finally:
            conn.close()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
