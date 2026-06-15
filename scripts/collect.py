"""
collect.py
----------
Daily collector. Run by the GitHub Action (or by hand). It:

  1. Fetches the MARKET reference FX rate (USD/EGP, EUR/EGP) from a free source.
  2. Reads data/manual.json overrides (official CBE FX, inflation, interest
     rates). Manual values ALWAYS win and become the headline.
  3. Carries forward the last known inflation/interest values when there is no
     new manual entry, recomputing their freshness honestly.
  4. Validates FX against sanity bounds and flags official/market divergence.
  5. Computes freshness (fresh / check / stale / unavailable) per metric.
  6. NEVER invents a number: anything it cannot source becomes "unavailable".
  7. Writes data/latest.json and upserts the current month into data/history.json.

Run:  python scripts/collect.py
"""

import json
from datetime import date, datetime, timezone
from pathlib import Path

import sources as S

DATA = Path(__file__).resolve().parent.parent / "data"


def load_json(name, default):
    p = DATA / name
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(name, obj):
    (DATA / name).write_text(json.dumps(obj, indent=2), encoding="utf-8")


def get_override(manual, *path):
    node = manual.get("overrides", {})
    for key in path:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def override_metric(ov, unit, default_src, kind=None, today=None):
    """Turn a manual override dict into a full metric, computing freshness."""
    if not ov or ov.get("value") is None:
        return None
    src = {
        "source_name": ov.get("source_name", default_src["source_name"]),
        "source_url": ov.get("source_url", default_src["source_url"]),
    }
    fkind = {"%": "rates"}.get(unit) if unit == "%" else None
    status = ov.get("status") or S.freshness(
        "fx" if kind in ("official", "market") else
        ("inflation" if unit == "% YoY" else "rates"),
        ov.get("as_of"), today)
    return S.metric(round(float(ov["value"]), 4), unit, ov.get("as_of"),
                    src, status, kind=kind)


def prev_value(prev_snap, *path):
    node = prev_snap
    for key in path:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node.get("value") if isinstance(node, dict) and node else None


def build_fx(manual, prev_snap, today):
    out = {}
    for pair, base in (("USD_EGP", "usd"), ("EUR_EGP", "eur")):
        unit = "EGP per USD" if pair == "USD_EGP" else "EGP per EUR"
        # market: a manual override (e.g. an authoritative provided series)
        # WINS over the auto feed; otherwise fetch the live rate ------------
        market = override_metric(
            get_override(manual, "fx", pair, "market"), unit, S.SRC_MARKET,
            kind="market", today=today)
        if market:
            market["previous_value"] = prev_value(prev_snap, "fx", pair, "market")
        else:
            rate, as_of = S.fetch_fx(base, "egp", "latest")
            if rate is not None and S.in_bounds(pair, rate):
                market = S.metric(round(rate, 4), unit, as_of, S.SRC_MARKET,
                                  S.freshness("fx", as_of, today), kind="market",
                                  previous_value=prev_value(prev_snap, "fx", pair, "market"))
            else:
                market = S.metric(None, unit, None, S.SRC_MARKET, "unavailable",
                                  kind="market")
        # official (manual) -------------------------------------------------
        official = override_metric(
            get_override(manual, "fx", pair, "official"), unit, S.SRC_CBE,
            kind="official", today=today)
        if official:
            official["previous_value"] = prev_value(prev_snap, "fx", pair, "official")
            # divergence check vs market
            if market.get("value") and official.get("value"):
                gap = abs(official["value"] - market["value"]) / market["value"]
                if gap > 0.05 and official.get("status") == "fresh":
                    official["status"] = "check"
        out[pair] = {"official": official, "market": market}
    return out


def carry_or_override(manual, prev_snap, group, key, unit, default_src, today):
    """Use manual override if present, else carry forward last known value."""
    ov = override_metric(get_override(manual, group, key), unit, default_src,
                         today=today)
    if ov:
        ov["previous_value"] = prev_value(prev_snap, group, key)
        return ov
    last = (prev_snap or {}).get(group, {}).get(key) if prev_snap else None
    if last and last.get("value") is not None:
        kind_key = "inflation" if unit == "% YoY" else "rates"
        return S.metric(last["value"], unit, last.get("as_of"),
                        {"source_name": last.get("source_name", default_src["source_name"]),
                         "source_url": last.get("source_url", default_src["source_url"])},
                        S.freshness(kind_key, last.get("as_of"), today))
    return S.metric(None, unit, None, default_src, "unavailable")


def main():
    today = date.today()
    manual = load_json("manual.json", {"overrides": {}})
    history = load_json("history.json", [])
    cur_month = today.strftime("%Y-%m")
    prev_snaps = [s for s in history if s.get("month") != cur_month]
    prev_snap = prev_snaps[0] if prev_snaps else None

    fx = build_fx(manual, prev_snap, today)
    inflation = {
        "headline": carry_or_override(manual, prev_snap, "inflation", "headline",
                                      "% YoY", S.SRC_CAPMAS, today),
        "core": carry_or_override(manual, prev_snap, "inflation", "core",
                                  "% YoY", S.SRC_CBE, today),
    }
    rates = {
        k: carry_or_override(manual, prev_snap, "rates", k, "%", S.SRC_CBE, today)
        for k in ("policy", "overnight_deposit", "overnight_lending")
    }

    # newest data date across everything, for the "Last updated" stamp
    dates = [m.get("as_of") for grp in (fx.values()) for m in grp.values() if m]
    dates += [m.get("as_of") for m in list(inflation.values()) + list(rates.values()) if m]
    last_updated = max([d for d in dates if d], default=today.isoformat())

    latest = {
        "meta": {
            "schema_version": 1,
            "last_updated": last_updated,
            "last_checked": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "generated_by": "collect.py",
            "disclaimer": manual.get("disclaimer",
                "Internal reference only. Verify against source before publishing."),
        },
        "fx": fx, "inflation": inflation, "rates": rates,
    }
    save_json("latest.json", latest)

    # upsert current month snapshot for the month-end / history views ---------
    snap = {
        "month": cur_month,
        "label": today.strftime("%B %Y"),
        "fx": fx, "inflation": inflation, "rates": rates,
    }
    history = [s for s in history if s.get("month") != cur_month]
    history.append(snap)
    history.sort(key=lambda s: s.get("month", ""), reverse=True)
    history = history[:36]  # keep at most 36 months
    save_json("history.json", history)

    print("collect.py: wrote latest.json (last_updated %s) and %d history months"
          % (last_updated, len(history)))


if __name__ == "__main__":
    main()
