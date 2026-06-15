"""
backfill.py
-----------
One-time (or occasional) historical loader. Builds 24 month-end snapshots of
the MARKET reference FX rate from the free dated endpoints, and optionally
merges known inflation / interest / official-FX history from a CSV you fill in.

Official CBE FX, inflation, and interest history are NOT freely scrapable, so
they come from data/seed_history.csv if you provide it. Any month/metric you
do not supply is left as it was (or "unavailable"). Nothing is invented.

CSV format (header required, all columns optional except month):
  month,usd_official,eur_official,headline,core,policy,deposit,lending
  2025-05,49.45,55.10,16.8,15.4,25.00,24.50,25.50

Run:  python scripts/backfill.py
"""

import calendar
import csv
import json
from datetime import date
from pathlib import Path

import sources as S

DATA = Path(__file__).resolve().parent.parent / "data"
MONTHS_BACK = 24


def last_business_dates(yy, mm):
    """Month-end date, then a few prior days, to dodge weekends/holidays."""
    last = calendar.monthrange(yy, mm)[1]
    return [date(yy, mm, last - k).isoformat() for k in range(0, 5)]


SRC_PROVIDED = {"source_name": "USD/EGP daily series (provided)", "source_url": ""}


def market_from_csv(row, csv_key, unit, as_of):
    """Use an authoritative month-end value supplied in the CSV, if present."""
    if not row:
        return None
    v = (row.get(csv_key) or "").strip()
    if v == "":
        return None
    try:
        return S.metric(round(float(v), 4), unit, as_of, SRC_PROVIDED, "fresh", kind="market")
    except ValueError:
        return None


def fetch_month_end_fx(yy, mm, pair, base):
    unit = "EGP per USD" if pair == "USD_EGP" else "EGP per EUR"
    for day in last_business_dates(yy, mm):
        rate, as_of = S.fetch_fx(base, "egp", day)
        if rate is not None and S.in_bounds(pair, rate):
            return S.metric(round(rate, 4), unit, as_of, S.SRC_MARKET,
                            "fresh", kind="market")
    return S.metric(None, unit, None, S.SRC_MARKET, "unavailable", kind="market")


def load_seed_csv():
    p = DATA / "seed_history.csv"
    rows = {}
    if not p.exists():
        return rows
    with p.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            m = (r.get("month") or "").strip()
            if m:
                rows[m] = r
    return rows


def num(row, key):
    if not row:
        return None
    v = (row.get(key) or "").strip()
    try:
        return float(v) if v != "" else None
    except ValueError:
        return None


def target_months():
    out = []
    y, m = date.today().year, date.today().month
    # start from last completed month, go back MONTHS_BACK
    m -= 1
    if m == 0:
        m, y = 12, y - 1
    for _ in range(MONTHS_BACK):
        out.append((y, m))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return out


def main():
    existing = {s["month"]: s for s in json.loads(
        (DATA / "history.json").read_text(encoding="utf-8"))} \
        if (DATA / "history.json").exists() else {}
    seed = load_seed_csv()
    history = []

    for yy, mm in target_months():
        key = f"{yy}-{mm:02d}"
        as_of_me = date(yy, mm, calendar.monthrange(yy, mm)[1]).isoformat()
        rel = date(yy + (mm == 12), (mm % 12) + 1, 10).isoformat()
        prev = existing.get(key, {})
        row = seed.get(key)
        print(f"  {key}: building FX ...")

        usd_m = market_from_csv(row, "usd_market", "EGP per USD", as_of_me) \
            or fetch_month_end_fx(yy, mm, "USD_EGP", "usd")
        eur_m = market_from_csv(row, "eur_market", "EGP per EUR", as_of_me) \
            or fetch_month_end_fx(yy, mm, "EUR_EGP", "eur")

        def official(pair, csv_key, unit):
            v = num(row, csv_key)
            if v is not None:
                return S.metric(round(v, 4), unit, as_of_me, S.SRC_CBE,
                                "fresh", kind="official")
            return (prev.get("fx", {}).get(pair, {}) or {}).get("official")

        def monthly(group, key2, csv_key, unit, src):
            v = num(row, csv_key)
            if v is not None:
                return S.metric(round(v, 2), unit, rel if group == "inflation" else as_of_me,
                                src, "fresh")
            return (prev.get(group, {}) or {}).get(key2) or \
                S.metric(None, unit, None, src, "unavailable")

        history.append({
            "month": key,
            "label": date(yy, mm, 1).strftime("%B %Y"),
            "fx": {
                "USD_EGP": {"official": official("USD_EGP", "usd_official", "EGP per USD"),
                            "market": usd_m},
                "EUR_EGP": {"official": official("EUR_EGP", "eur_official", "EGP per EUR"),
                            "market": eur_m},
            },
            "inflation": {
                "headline": monthly("inflation", "headline", "headline", "% YoY", S.SRC_CAPMAS),
                "core": monthly("inflation", "core", "core", "% YoY", S.SRC_CBE),
            },
            "rates": {
                "policy": monthly("rates", "policy", "policy", "%", S.SRC_CBE),
                "overnight_deposit": monthly("rates", "overnight_deposit", "deposit", "%", S.SRC_CBE),
                "overnight_lending": monthly("rates", "overnight_lending", "lending", "%", S.SRC_CBE),
            },
        })

    history.sort(key=lambda s: s["month"], reverse=True)
    (DATA / "history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
    print(f"backfill.py: wrote {len(history)} month-end snapshots to history.json")


if __name__ == "__main__":
    main()
