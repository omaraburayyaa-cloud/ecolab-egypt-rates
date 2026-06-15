"""
import_usd_csv.py
-----------------
One-time / repeatable importer for an authoritative daily USD/EGP CSV
(Date, Price, Open, High, Low, Vol., Change %). It computes the month-end
close for each month and writes those values into data/seed_history.csv under
the `usd_market` column, so backfill.py uses them instead of the live API for
USD/EGP history. Nothing is invented; only months present in the CSV are filled.

Usage:
  python scripts/import_usd_csv.py "C:/path/to/USD_EGP Historical Data.csv"
  (defaults to the Downloads file if no path is given)
"""

import csv
import sys
from datetime import datetime
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
DEFAULT_CSV = Path.home() / "Downloads" / "USD_EGP Historical Data.csv"

FIELDS = ["month", "usd_official", "eur_official", "usd_market", "eur_market",
          "headline", "core", "policy", "deposit", "lending"]


def month_end_prices(csv_path):
    """Return {YYYY-MM: (price, date)} using the latest trading day per month."""
    best = {}
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            raw_date = (row.get("Date") or "").strip().strip('"')
            raw_price = (row.get("Price") or "").strip().strip('"').replace(",", "")
            if not raw_date or not raw_price:
                continue
            try:
                d = datetime.strptime(raw_date, "%m/%d/%Y").date()
                price = float(raw_price)
            except ValueError:
                continue
            ym = d.strftime("%Y-%m")
            if ym not in best or d > best[ym][1]:
                best[ym] = (round(price, 4), d)
    return best


def load_seed():
    p = DATA / "seed_history.csv"
    rows = {}
    if p.exists():
        with p.open(encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                m = (r.get("month") or "").strip()
                if m:
                    rows[m] = r
    return rows


def main():
    csv_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CSV
    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")

    me = month_end_prices(csv_path)
    seed = load_seed()

    # ensure every seed month gets its usd_market filled where available
    for ym, row in seed.items():
        if ym in me:
            row["usd_market"] = me[ym][0]

    # write back, preserving all columns and adding usd_market/eur_market
    out = DATA / "seed_history.csv"
    months = sorted(seed.keys())
    with out.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for m in months:
            row = {k: seed[m].get(k, "") for k in FIELDS}
            row["month"] = m
            w.writerow(row)

    filled = sum(1 for m in seed if seed[m].get("usd_market"))
    print(f"Filled usd_market for {filled}/{len(seed)} months.")
    for m in months:
        print(f"  {m}: usd_market={seed[m].get('usd_market','')}")


if __name__ == "__main__":
    main()
