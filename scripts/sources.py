"""
sources.py
----------
Shared helpers: trusted source descriptors, the free FX fetcher, freshness
rules, and sanity-bound validation. Standard library only (urllib) so there
is nothing to pip-install and the GitHub Action stays simple.

WHY no Central Bank of Egypt scraper here:
The CBE website blocks automated requests and offers no free JSON API, so a
scraper would break silently. The official CBE rate is therefore entered by a
human in data/manual.json and always wins over the auto market value. The free
"Exchange API" below provides the MARKET reference rate only.
"""

import json
import urllib.request
from datetime import date, datetime

# Trusted source descriptors -------------------------------------------------
SRC_MARKET = {
    "source_name": "Exchange API (open data)",
    "source_url": "https://github.com/fawazahmed0/exchange-api",
}
SRC_CBE = {"source_name": "Central Bank of Egypt", "source_url": "https://www.cbe.org.eg"}
SRC_CAPMAS = {"source_name": "CAPMAS", "source_url": "https://www.capmas.gov.eg"}

# Free, no-key, CDN-hosted FX endpoints (latest + dated historical) ----------
# Primary and a fallback mirror, both serving the same open dataset.
FX_LATEST = [
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{base}.json",
    "https://{date}.currency-api.pages.dev/v1/currencies/{base}.json",
]
FX_DATED = [
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{date}/v1/currencies/{base}.json",
    "https://{date}.currency-api.pages.dev/v1/currencies/{base}.json",
]

# Sanity bounds: reject anything outside these as bad data --------------------
BOUNDS = {
    "USD_EGP": (20.0, 120.0),
    "EUR_EGP": (25.0, 140.0),
}

# Freshness rules in days: (fresh_max, check_max). Beyond check_max = stale ---
FRESHNESS = {
    "fx": (4, 10),
    "inflation": (40, 75),
    "rates": (120, 220),
}


def _get_json(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "ecolab-egypt-dashboard"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_fx(base, target, when="latest"):
    """Return (rate, as_of_date_iso) for `target` per one `base`, or (None, None).

    base/target are lowercase ISO codes, e.g. fetch_fx('usd', 'egp').
    `when` is 'latest' or an ISO date 'YYYY-MM-DD' for historical lookups.
    """
    templates = FX_LATEST if when == "latest" else FX_DATED
    day = date.today().isoformat() if when == "latest" else when
    for tpl in templates:
        url = tpl.format(base=base, date=day)
        try:
            data = _get_json(url)
        except Exception:
            continue
        block = data.get(base) or {}
        rate = block.get(target)
        as_of = data.get("date", day)
        if isinstance(rate, (int, float)) and rate > 0:
            return round(float(rate), 4), as_of
    return None, None


def in_bounds(pair_key, value):
    if value is None:
        return False
    lo, hi = BOUNDS.get(pair_key, (0, 1e9))
    return lo <= value <= hi


def _days_old(as_of_iso, today=None):
    try:
        d = datetime.strptime(str(as_of_iso)[:10], "%Y-%m-%d").date()
    except Exception:
        return None
    return ((today or date.today()) - d).days


def freshness(kind, as_of_iso, today=None):
    """Map a metric's age to fresh / check / stale / unavailable."""
    if not as_of_iso:
        return "unavailable"
    days = _days_old(as_of_iso, today)
    if days is None:
        return "unavailable"
    fresh_max, check_max = FRESHNESS.get(kind, (7, 30))
    if days <= fresh_max:
        return "fresh"
    if days <= check_max:
        return "check"
    return "stale"


def metric(value, unit, as_of, src, status, kind=None, previous_value=None):
    """Build one self-describing figure (the canonical schema object)."""
    m = {
        "value": value, "unit": unit, "as_of": as_of,
        "source_name": src["source_name"], "source_url": src["source_url"],
        "status": status,
    }
    if kind:
        m["kind"] = kind
    if previous_value is not None:
        m["previous_value"] = previous_value
    return m
