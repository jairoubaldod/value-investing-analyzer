"""Investment one-pager — profile, snapshot metrics, scorecards, valuation blend."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from services.magic_numbers import DataSheet, _safe_div, _series

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
STATIC_PROFILE_DIR = Path(__file__).resolve().parents[1] / "static" / "profile"


def enrich_payload_profile(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("company_profile") and not payload["company_profile"].get("error"):
        return payload

    out = dict(payload)
    ticker = str(out.get("ticker") or "MSFT").upper()
    sidecar = DATA_DIR / f"{ticker.lower()}_profile.json"
    if sidecar.is_file():
        try:
            side = json.loads(sidecar.read_text(encoding="utf-8"))
            if side.get("company_profile") and not side["company_profile"].get("error"):
                out["company_profile"] = side["company_profile"]
                return out
        except (json.JSONDecodeError, OSError):
            pass

    try:
        from services.fmp_provider import fetch_company_profile_bundle

        out["company_profile"] = fetch_company_profile_bundle(ticker)
    except Exception as exc:
        out["company_profile_error"] = str(exc)
        out["company_profile"] = {"error": str(exc)}
    return out


def _cagr(start: float | None, end: float | None, years: int) -> float | None:
    if start is None or end is None or start <= 0 or end <= 0 or years <= 0:
        return None
    try:
        return (end / start) ** (1 / years) - 1
    except (ValueError, ZeroDivisionError):
        return None


def _latest(vals: list[float | None]) -> float | None:
    for v in reversed(vals):
        if v is not None:
            return v
    return None


def _avg(vals: list[float | None]) -> float | None:
    clean = [v for v in vals if v is not None]
    if not clean:
        return None
    return sum(clean) / len(clean)


def _stdev(vals: list[float | None]) -> float | None:
    clean = [v for v in vals if v is not None]
    if len(clean) < 2:
        return None
    mean = sum(clean) / len(clean)
    var = sum((x - mean) ** 2 for x in clean) / len(clean)
    return math.sqrt(var)


def _span_years(data: DataSheet, max_years: int = 10) -> int:
    n = len(data.year_cols)
    return max(1, min(max_years, n - 1))


def _extract_fundamentals(data: DataSheet) -> dict[str, Any]:
    n = len(data.year_cols)
    tax_rate = data.val(11, 21) or 21.0

    revenue = _series(data, 14)
    ebit = _series(data, 26)
    net_income = _series(data, 50)
    eps = _series(data, 62)
    cfo = _series(data, 209)
    capex = _series(data, 212)
    interest_exp = _series(data, 28)
    ebitda = _series(data, 73)
    total_equity = _series(data, 172)
    total_assets = _series(data, 128)
    st_debt = _series(data, 136)
    lt_debt = _series(data, 147)
    cash = _series(data, 99)

    total_debt = [
        (st_debt[i] or 0) + (lt_debt[i] or 0)
        if st_debt[i] is not None or lt_debt[i] is not None
        else None
        for i in range(n)
    ]
    net_debt = [
        (total_debt[i] or 0) - (cash[i] or 0)
        if total_debt[i] is not None or cash[i] is not None
        else None
        for i in range(n)
    ]

    interest_tax_shield = [
        (ie * (1 - tax_rate / 100)) if ie is not None else None for ie in interest_exp
    ]
    fcff = [
        (cfo[i] or 0) + (capex[i] or 0) + (interest_tax_shield[i] or 0)
        if any(v is not None for v in (cfo[i], capex[i], interest_tax_shield[i]))
        else None
        for i in range(n)
    ]

    gross_profit = _series(data, 18)
    operating_margin = [_safe_div(ebit[i], revenue[i]) for i in range(n)]
    gross_margin = [_safe_div(gross_profit[i], revenue[i]) for i in range(n)]
    fcf_margin = [_safe_div(fcff[i], revenue[i]) for i in range(n)]
    cfo_ni = [_safe_div(cfo[i], net_income[i]) for i in range(n)]
    roe = [_safe_div(net_income[i], total_equity[i]) for i in range(n)]
    equity_assets = [_safe_div(total_equity[i], total_assets[i]) for i in range(n)]
    net_debt_ebitda = [_safe_div(net_debt[i], ebitda[i]) for i in range(n)]
    debt_ni = [_safe_div(total_debt[i], net_income[i]) for i in range(n)]
    interest_cov = [_safe_div(ebit[i], interest_exp[i]) for i in range(n)]

    invested_capital = [
        (total_equity[i] or 0) + (total_debt[i] or 0) - (cash[i] or 0)
        if any(v is not None for v in (total_equity[i], total_debt[i], cash[i]))
        else None
        for i in range(n)
    ]
    nopat = [(eb * (1 - tax_rate / 100)) if eb is not None else None for eb in ebit]
    roic = [_safe_div(nopat[i], invested_capital[i]) for i in range(n)]

    years_span = _span_years(data, 5)
    rev_start_idx = max(0, n - 1 - years_span)
    eps_start_idx = rev_start_idx

    rev_cagr = _cagr(revenue[rev_start_idx], revenue[-1], years_span)
    eps_cagr = _cagr(eps[eps_start_idx], eps[-1], years_span)

    return {
        "tax_rate": tax_rate,
        "revenue": revenue,
        "eps": eps,
        "fcff": fcff,
        "operating_margin": operating_margin,
        "gross_margin": gross_margin,
        "fcf_margin": fcf_margin,
        "cfo_ni": cfo_ni,
        "roe": roe,
        "roic": roic,
        "equity_assets": equity_assets,
        "net_debt_ebitda": net_debt_ebitda,
        "debt_ni": debt_ni,
        "interest_cov": interest_cov,
        "rev_cagr_5y": rev_cagr,
        "eps_cagr_5y": eps_cagr,
        "years_span": years_span,
    }


def _score_business_quality(f: dict[str, Any]) -> dict[str, Any]:
    """Broad quality screen: returns, margins, cash conversion, ROE."""
    gross_5y = _avg(f["gross_margin"][-5:])
    latest_gross = _latest(f["gross_margin"]) or 0
    checks = [
        ("ROIC ≥ 12%", (_latest(f["roic"]) or 0) >= 0.12),
        ("Operating margin ≥ 15%", (_latest(f["operating_margin"]) or 0) >= 0.15),
        ("Gross margin ≥ 5Y avg", gross_5y is not None and latest_gross >= gross_5y),
        ("FCF margin ≥ 15%", (_latest(f["fcf_margin"]) or 0) >= 0.15),
        ("ROE ≥ 15%", (_latest(f["roe"]) or 0) >= 0.15),
    ]
    passed = sum(1 for _, ok in checks if ok)
    return {
        "id": "business_quality",
        "label": "Business quality",
        "stars": passed,
        "max_stars": 5,
        "criteria": [{"label": label, "met": met} for label, met in checks],
        "methodology": (
            "ROIC, operating margin, gross-margin trend vs 5Y, FCF margin, ROE — "
            "one star each when threshold met."
        ),
    }


def _score_financial_strength(f: dict[str, Any]) -> dict[str, Any]:
    nd_ebitda = _latest(f["net_debt_ebitda"])
    checks = [
        ("Net debt / EBITDA ≤ 2×", nd_ebitda is not None and nd_ebitda <= 2),
        ("Net cash position", nd_ebitda is not None and nd_ebitda < 0),
        ("Current ratio ≥ 1.2", False),  # placeholder — filled below
        ("Interest coverage ≥ 8×", (_latest(f["interest_cov"]) or 0) >= 8),
        ("Equity / assets ≥ 40%", (_latest(f["equity_assets"]) or 0) >= 0.4),
        ("Debt / NI ≤ 3×", (_latest(f["debt_ni"]) or 99) <= 3),
    ]
    # Net cash OR low leverage counts for first leverage star
    leverage_ok = nd_ebitda is not None and (nd_ebitda < 0 or nd_ebitda <= 2)
    checks[0] = ("Leverage (ND/EBITDA ≤ 2× or net cash)", leverage_ok)

    passed = sum(1 for _, ok in checks[:5] if ok)  # 5 criteria
    return {
        "id": "financial_strength",
        "label": "Financial strength",
        "stars": min(5, passed),
        "max_stars": 5,
        "criteria": [{"label": label, "met": met} for label, met in checks[:5]],
        "methodology": "Balance-sheet resilience: leverage, coverage, equity buffer.",
    }


def _score_predictability(f: dict[str, Any], data: DataSheet) -> dict[str, Any]:
    n = len(data.year_cols)
    revenue = f["revenue"]
    net_margin = [_safe_div(_series(data, 50)[i], revenue[i]) for i in range(n)]
    rev_yoy = [None] + [
        _safe_div(revenue[i], revenue[i - 1]) - 1 if revenue[i] and revenue[i - 1] else None
        for i in range(1, n)
    ]
    positive_rev_years = sum(1 for v in rev_yoy[-5:] if v is not None and v > 0)

    margin_std = _stdev(net_margin[-5:])
    checks = [
        ("Revenue CAGR 5Y > 0", (f["rev_cagr_5y"] or 0) > 0),
        ("EPS CAGR 5Y > 0", (f["eps_cagr_5y"] or 0) > 0),
        ("Margin volatility low (σ < 5pp)", margin_std is not None and margin_std < 0.05),
        ("Revenue up in 4 of last 5Y", positive_rev_years >= 4),
        ("CFO / NI avg 5Y ≥ 1.0", (_avg(f["cfo_ni"][-5:]) or 0) >= 1.0),
    ]
    passed = sum(1 for _, ok in checks if ok)
    return {
        "id": "predictability",
        "label": "Predictability",
        "stars": passed,
        "max_stars": 5,
        "criteria": [{"label": label, "met": met} for label, met in checks],
        "methodology": "Growth consistency, earnings stability, cash conversion reliability.",
    }


def _score_growth(f: dict[str, Any], data: DataSheet) -> dict[str, Any]:
    n = len(data.year_cols)
    revenue = f["revenue"]
    rev_yoy_latest = None
    if n >= 2 and revenue[-1] and revenue[-2]:
        rev_yoy_latest = revenue[-1] / revenue[-2] - 1

    fcff = f["fcff"]
    years_span = min(5, _span_years(data, 5))
    fcff_cagr = _cagr(fcff[max(0, n - 1 - years_span)], fcff[-1], years_span)

    bv = _series(data, 172)
    bv_growth = None
    if n >= 2 and bv[-1] and bv[-2]:
        bv_growth = bv[-1] / bv[-2] - 1

    checks = [
        ("Revenue CAGR 5Y ≥ 8%", (f["rev_cagr_5y"] or 0) >= 0.08),
        ("EPS CAGR 5Y ≥ 10%", (f["eps_cagr_5y"] or 0) >= 0.10),
        ("FCFF CAGR 5Y > 0", (fcff_cagr or 0) > 0),
        ("Latest revenue growth ≥ 5%", (rev_yoy_latest or 0) >= 0.05),
        ("Book value growth ≥ 5%", (bv_growth or 0) >= 0.05),
    ]
    passed = sum(1 for _, ok in checks if ok)
    return {
        "id": "growth",
        "label": "Growth",
        "stars": passed,
        "max_stars": 5,
        "criteria": [{"label": label, "met": met} for label, met in checks],
        "methodology": "Top-line, per-share, and FCF compounding vs recent momentum.",
    }


def _valuation_snapshot(valuation: dict[str, Any]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []

    dcf = valuation.get("dcf") or {}
    dcf_px = (dcf.get("result") or {}).get("price_per_share")
    if dcf_px is not None and not dcf.get("error"):
        items.append({"id": "dcf", "label": "DCF", "price": round(float(dcf_px), 2)})

    pe = valuation.get("pe") or {}
    pe_px = (pe.get("result") or {}).get("price_per_share")
    pe_med = ((pe.get("engine") or {}).get("pe_bands") or {}).get("p50")
    if pe_med is not None and not pe.get("error"):
        eps = (pe.get("engine") or {}).get("eps_ttm")
        med_px = float(pe_med) * float(eps) if eps else pe_px
        if med_px is not None:
            items.append({"id": "pe", "label": "P/E median", "price": round(float(med_px), 2)})

    pbv = valuation.get("pbv") or {}
    pb_med = ((pbv.get("engine") or {}).get("pb_bands") or {}).get("p50")
    if pb_med is not None and not pbv.get("error"):
        bvps = (pbv.get("engine") or {}).get("bvps_ttm")
        if bvps:
            items.append({"id": "pbv", "label": "P/BV median", "price": round(float(pb_med) * float(bvps), 2)})

    con = valuation.get("consensus") or {}
    con_med = ((con.get("result") or {}).get("anchors") or {}).get("median")
    if con_med is None:
        con_med = ((con.get("engine") or {}).get("anchors") or {}).get("median")
    if con_med is not None and not con.get("error"):
        items.append({"id": "consensus", "label": "Analyst consensus", "price": round(float(con_med), 2)})

    prices = [it["price"] for it in items if it.get("price") is not None]
    blend = round(sum(prices) / len(prices), 2) if prices else None

    return {"methods": items, "blend_price": blend, "method_count": len(prices)}


def _format_mcap(mcap: float | None) -> str | None:
    if mcap is None:
        return None
    if mcap >= 1e12:
        return f"${mcap / 1e12:.2f}T"
    if mcap >= 1e9:
        return f"${mcap / 1e9:.1f}B"
    if mcap >= 1e6:
        return f"${mcap / 1e6:.0f}M"
    return f"${mcap:,.0f}"


def compute_one_pager(
    data: DataSheet,
    *,
    valuation: dict[str, Any],
    market_bar: dict[str, Any],
    company_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    profile = company_profile or {}
    fund = _extract_fundamentals(data)

    snapshot_metrics = [
        {
            "id": "rev_cagr_5y",
            "label": "Revenue CAGR",
            "sublabel": f"{fund['years_span']}Y",
            "value": fund["rev_cagr_5y"],
            "format": "percent",
        },
        {
            "id": "eps_cagr_5y",
            "label": "EPS CAGR",
            "sublabel": f"{fund['years_span']}Y",
            "value": fund["eps_cagr_5y"],
            "format": "percent",
        },
        {
            "id": "roic",
            "label": "ROIC",
            "sublabel": "LTM",
            "value": _latest(fund["roic"]),
            "format": "percent",
        },
        {
            "id": "operating_margin",
            "label": "Operating margin",
            "sublabel": "LTM",
            "value": _latest(fund["operating_margin"]),
            "format": "percent",
        },
        {
            "id": "net_debt_ebitda",
            "label": "Net debt / EBITDA",
            "sublabel": "LTM",
            "value": _latest(fund["net_debt_ebitda"]),
            "format": "ratio",
        },
        {
            "id": "fcf_margin",
            "label": "FCF margin",
            "sublabel": "LTM",
            "value": _latest(fund["fcf_margin"]),
            "format": "percent",
        },
    ]

    scorecards = [
        _score_business_quality(fund),
        _score_financial_strength(fund),
        _score_predictability(fund, data),
        _score_growth(fund, data),
    ]

    mkt_cap = profile.get("market_cap")
    if mkt_cap is None and market_bar.get("price"):
        shares_mln = _latest(_series(data, 177)) or _latest(_series(data, 61))
        if shares_mln:
            # shares in MLN × USD price → market cap in USD
            mkt_cap = float(market_bar["price"]) * float(shares_mln) * 1e6

    identity = {
        "name": profile.get("name") or data.company or data.ticker,
        "ticker": data.ticker,
        "price": market_bar.get("price"),
        "price_direction": market_bar.get("direction"),
        "market_cap": mkt_cap,
        "market_cap_label": profile.get("market_cap_label") or _format_mcap(mkt_cap),
        "sector": profile.get("sector"),
        "industry": profile.get("industry"),
        "country": profile.get("country"),
        "currency": data.currency or "USD",
        "description": profile.get("description"),
        "segments": profile.get("segments") or [],
    }

    val_snap = _valuation_snapshot(valuation)

    return {
        "identity": identity,
        "snapshot_metrics": snapshot_metrics,
        "scorecards": scorecards,
        "valuation_snapshot": val_snap,
    }
