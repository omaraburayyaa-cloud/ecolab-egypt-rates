"""
seed_sample.py
--------------
Generates illustrative SAMPLE data so the dashboard renders before any real
collector run. The numbers are plausible but NOT real figures. Replace them by
running collect.py / backfill.py (real sources) or by editing data/manual.json.

It writes:
  data/latest.json   - the current live snapshot the dashboard shows on top
  data/history.json  - 24 month-end snapshots (newest first) for the
                       month-end view, historical lookup, and YoY comparison

This file also documents the JSON SCHEMA every other script must follow.
Run:  python scripts/seed_sample.py
"""

import calendar
import json
from datetime import date
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Source descriptors reused across metrics ----------------------------------
SRC_MARKET = {
    "source_name": "Exchange API (open data)",
    "source_url": "https://github.com/fawazahmed0/exchange-api",
}
SRC_CBE = {"source_name": "Central Bank of Egypt", "source_url": "https://www.cbe.org.eg"}
SRC_CAPMAS = {"source_name": "CAPMAS", "source_url": "https://www.capmas.gov.eg"}


def metric(value, unit, as_of, src, status, kind=None, previous_value=None):
    """One self-describing figure. This is THE schema for a single number."""
    m = {
        "value": value,
        "unit": unit,
        "as_of": as_of,                 # date the figure itself refers to
        "source_name": src["source_name"],
        "source_url": src["source_url"],
        "status": status,               # fresh | check | stale | unavailable
    }
    if kind:
        m["kind"] = kind                # official | market (FX only)
    if previous_value is not None:
        m["previous_value"] = previous_value
    return m


def month_end(y, m):
    return date(y, m, calendar.monthrange(y, m)[1]).isoformat()


def month_label(y, m):
    return f"{calendar.month_name[m]} {y}"


# 24 month-end periods ending May 2026 (today is mid-June 2026) --------------
PERIODS = []
y, m = 2024, 6
for _ in range(24):
    PERIODS.append((y, m))
    m += 1
    if m == 13:
        m, y = 1, y + 1


def usd_egp(i):
    # plausible market-reference path, EGP per USD, settling post-float
    base = 47.8 + (51.7 - 47.8) * (i / 23)
    wiggle = ((i * 7) % 5 - 2) * 0.05
    return round(base + wiggle, 2)


def usd_per_eur(i):
    return 0.92 - (0.92 - 0.86) * (i / 23)


def eur_egp(i):
    return round(usd_egp(i) / usd_per_eur(i), 2)


def headline_infl(i):
    return round(27.5 - (27.5 - 13.1) * (i / 23), 1)


def core_infl(i):
    return round(headline_infl(i) - 1.6, 1)


def rate_set(i):
    # illustrative CBE corridor step-down over the period
    if i < 9:
        return 27.75, 27.25, 28.25
    if i < 12:
        return 25.50, 25.00, 26.00
    if i < 15:
        return 24.50, 24.00, 25.00
    return 24.00, 23.50, 24.50


def build_history():
    hist = []
    for i, (yy, mm) in enumerate(PERIODS):
        as_of_fx = month_end(yy, mm)
        # inflation for month M is released ~10th of M+1
        rel_y, rel_m = (yy, mm + 1) if mm < 12 else (yy + 1, 1)
        as_of_infl = date(rel_y, rel_m, 10).isoformat()
        policy, deposit, lending = rate_set(i)

        # official FX only exists for the most recent month in the sample
        # (simulating "the dashboard started collecting it"); older months
        # only have the market reference, exactly as agreed.
        usd_official = None
        eur_official = None
        if i == len(PERIODS) - 1:
            usd_official = metric(round(usd_egp(i) - 0.30, 2), "EGP per USD",
                                  as_of_fx, SRC_CBE, "fresh", kind="official")
            eur_official = metric(round(eur_egp(i) - 0.35, 2), "EGP per EUR",
                                  as_of_fx, SRC_CBE, "fresh", kind="official")

        hist.append({
            "month": f"{yy}-{mm:02d}",
            "label": month_label(yy, mm),
            "fx": {
                "USD_EGP": {
                    "official": usd_official,
                    "market": metric(usd_egp(i), "EGP per USD", as_of_fx,
                                     SRC_MARKET, "fresh", kind="market"),
                },
                "EUR_EGP": {
                    "official": eur_official,
                    "market": metric(eur_egp(i), "EGP per EUR", as_of_fx,
                                     SRC_MARKET, "fresh", kind="market"),
                },
            },
            "inflation": {
                "headline": metric(headline_infl(i), "% YoY", as_of_infl,
                                   SRC_CAPMAS, "fresh"),
                "core": metric(core_infl(i), "% YoY", as_of_infl, SRC_CBE, "fresh"),
            },
            "rates": {
                "policy": metric(policy, "%", as_of_fx, SRC_CBE, "fresh"),
                "overnight_deposit": metric(deposit, "%", as_of_fx, SRC_CBE, "fresh"),
                "overnight_lending": metric(lending, "%", as_of_fx, SRC_CBE, "fresh"),
            },
        })
    hist.reverse()  # newest first
    return hist


def build_latest(hist):
    cur = hist[0]          # most recent month-end (May 2026)
    prev = hist[1]         # April 2026, for trend arrows
    # The live "current" snapshot: market FX is fresh from today; inflation and
    # rates carry the latest released values (which lag).
    today = date(2026, 6, 14)
    i_last = len(PERIODS) - 1

    def with_prev(node, prev_node):
        node = dict(node)
        if prev_node:
            node["previous_value"] = prev_node["value"]
        return node

    usd_market = metric(51.89, "EGP per USD", today.isoformat(), SRC_MARKET,
                        "fresh", kind="market",
                        previous_value=cur["fx"]["USD_EGP"]["market"]["value"])
    eur_market = metric(60.34, "EGP per EUR", today.isoformat(), SRC_MARKET,
                        "fresh", kind="market",
                        previous_value=cur["fx"]["EUR_EGP"]["market"]["value"])
    usd_official = with_prev(cur["fx"]["USD_EGP"]["official"],
                             prev["fx"]["USD_EGP"]["official"]) \
        if cur["fx"]["USD_EGP"]["official"] else None
    eur_official = with_prev(cur["fx"]["EUR_EGP"]["official"],
                             prev["fx"]["EUR_EGP"]["official"]) \
        if cur["fx"]["EUR_EGP"]["official"] else None

    return {
        "meta": {
            "schema_version": 1,
            "last_updated": today.isoformat(),
            "last_checked": "2026-06-15T06:00:00Z",
            "generated_by": "seed_sample.py (SAMPLE DATA - not real figures)",
            "disclaimer": "Internal reference only. Verify against the cited "
                          "source before publishing.",
        },
        "fx": {
            "USD_EGP": {"official": usd_official, "market": usd_market},
            "EUR_EGP": {"official": eur_official, "market": eur_market},
        },
        "inflation": {
            "headline": with_prev(cur["inflation"]["headline"],
                                  prev["inflation"]["headline"]) |
                        {"status": "check"},
            "core": with_prev(cur["inflation"]["core"],
                              prev["inflation"]["core"]) | {"status": "check"},
        },
        "rates": {
            "policy": with_prev(cur["rates"]["policy"], prev["rates"]["policy"]),
            "overnight_deposit": with_prev(cur["rates"]["overnight_deposit"],
                                           prev["rates"]["overnight_deposit"]),
            "overnight_lending": with_prev(cur["rates"]["overnight_lending"],
                                           prev["rates"]["overnight_lending"]),
        },
    }


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    hist = build_history()
    latest = build_latest(hist)
    (DATA_DIR / "history.json").write_text(json.dumps(hist, indent=2), encoding="utf-8")
    (DATA_DIR / "latest.json").write_text(json.dumps(latest, indent=2), encoding="utf-8")
    print(f"Wrote {len(hist)} history months and latest.json to {DATA_DIR}")


if __name__ == "__main__":
    main()
