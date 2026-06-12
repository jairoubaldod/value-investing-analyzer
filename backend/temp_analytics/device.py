"""User-agent and client metadata helpers."""

from __future__ import annotations

import re
from typing import Any


def client_ip(forwarded_for: str | None, direct: str | None) -> str:
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return (direct or "unknown").strip()


def parse_user_agent(ua: str) -> dict[str, str]:
    raw = ua or ""
    low = raw.lower()
    device = "desktop"
    os = "unknown"
    browser = "unknown"

    if "iphone" in low:
        device, os = "mobile", "iOS"
    elif "ipad" in low:
        device, os = "tablet", "iOS"
    elif "android" in low:
        device = "mobile" if "mobile" in low else "tablet"
        os = "Android"
    elif "mobile" in low:
        device = "mobile"
    elif "mac os" in low or "macintosh" in low:
        os = "macOS"
    elif "windows" in low:
        os = "Windows"
    elif "linux" in low:
        os = "Linux"

    if "edg/" in low or "edga/" in low:
        browser = "Edge"
    elif "chrome/" in low and "chromium" not in low:
        browser = "Chrome"
    elif "firefox/" in low:
        browser = "Firefox"
    elif "safari/" in low and "chrome" not in low:
        browser = "Safari"

    return {
        "device": device,
        "os": os,
        "browser": browser,
        "ua": raw[:512],
    }


def lookup_geo(ip: str) -> dict[str, Any]:
    import requests

    if not ip or ip == "unknown":
        return {}
    if ip.startswith("127.") or ip.startswith("192.168.") or ip.startswith("10.") or ip == "::1":
        return {"country": "Local", "region": "", "city": "Local", "isp": "LAN"}

    try:
        resp = requests.get(
            f"http://ip-api.com/json/{ip}",
            params={"fields": "status,country,regionName,city,lat,lon,isp,query"},
            timeout=2.5,
        )
        if resp.status_code != 200:
            return {}
        data = resp.json()
        if data.get("status") != "success":
            return {}
        return {
            "country": data.get("country") or "",
            "region": data.get("regionName") or "",
            "city": data.get("city") or "",
            "lat": data.get("lat"),
            "lon": data.get("lon"),
            "isp": data.get("isp") or "",
        }
    except Exception:
        return {}
