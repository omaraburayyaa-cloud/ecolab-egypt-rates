# Ecolab Egypt Finance Market Dashboard

An internal dashboard showing the latest USD/EGP and EUR/EGP exchange rates,
Egypt headline & core inflation, and CBE interest rates, with a month-end
reporting view and 24 months of history. Every figure shows its **source**,
its **date**, and a **freshness** status. Nothing is ever invented: if a number
cannot be sourced it shows **Unavailable / needs manual verification**.

It is a static website (HTML/CSS/JS) plus a small daily Python collector run by
GitHub Actions. No server, no paid APIs.

---

## How it works

```
GitHub Action (daily)  ->  scripts/collect.py  ->  data/latest.json + data/history.json
                                                          |
                                          index.html (the dashboard) reads them
```

- **Market FX** (USD/EGP, EUR/EGP) is fetched automatically every day from a
  free open exchange-rate dataset. This is the *market reference* rate.
- **Official CBE FX, inflation, and interest rates** are entered by you in
  `data/manual.json`. Manual values always win and become the headline number.
  (The CBE website blocks automated scraping and has no free API, so these are
  human-entered. This is deliberate, and it is what makes the numbers trustworthy.)
- The dashboard reads the two JSON files and renders everything.

---

## Files

| Path | What it is |
|------|------------|
| `index.html` | The dashboard page |
| `assets/style.css`, `assets/app.js` | Styling and logic |
| `assets/logo-placeholder.svg` | Swap for the real Ecolab logo |
| `data/latest.json` | Current live values (auto-written) |
| `data/history.json` | 24+ month-end snapshots (auto-written) |
| `data/manual.json` | **Your monthly inputs and overrides** |
| `data/seed_history.csv` | Optional: known history to backfill once |
| `scripts/collect.py` | Daily collector |
| `scripts/backfill.py` | One-time historical loader |
| `scripts/sources.py` | Sources, fetching, validation, freshness |
| `scripts/seed_sample.py` | Regenerates demo sample data |
| `.github/workflows/daily.yml` | The daily schedule |

> The dashboard currently contains **sample data** so you can see it working.
> Real data replaces it the first time the collector and backfill run.

---

## One-time setup

### 1. Preview it locally first
Browsers block loading local data files when you double-click `index.html`.
Run a tiny local server instead:

```
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

### 2. Put it on GitHub Pages (free hosting + automation)
1. Create a new repository on GitHub (e.g. `ecolab-egypt-dashboard`). Private is fine.
2. Upload this whole folder to it (drag-and-drop in the GitHub web UI works, or
   `git push` if you prefer).
3. In the repo: **Settings -> Pages -> Build and deployment -> Source = "Deploy
   from a branch"**, pick branch `main`, folder `/ (root)`, Save. After a minute
   your dashboard is live at `https://<your-username>.github.io/<repo>/`.
4. In the repo: **Settings -> Actions -> General -> Workflow permissions ->
   "Read and write permissions"**, Save. (This lets the daily job commit refreshed data.)
5. Open the **Actions** tab, choose **Daily data collection**, click **Run
   workflow** once to confirm it works. After that it runs every morning on its own.

### 3. Load real history (optional but recommended)
- For FX: just run `python scripts/backfill.py` once. It pulls 24 months of
  month-end market rates automatically.
- For inflation / interest / official-FX history: open `data/seed_history.csv`,
  paste the known monthly figures (one row per month), save, then run
  `python scripts/backfill.py` again. Any month you leave blank stays "unavailable".

---

## Your monthly routine (5 minutes at month-end)

When CBE / CAPMAS publish the new figures, open `data/manual.json` and fill the
`overrides` block, for example:

```json
{
  "overrides": {
    "fx": {
      "USD_EGP": { "official": { "value": 50.95, "as_of": "2026-06-30",
                                 "source_name": "Central Bank of Egypt",
                                 "source_url": "https://www.cbe.org.eg" } },
      "EUR_EGP": { "official": { "value": 59.40, "as_of": "2026-06-30" } }
    },
    "inflation": {
      "headline": { "value": 12.8, "as_of": "2026-07-10",
                    "source_name": "CAPMAS", "source_url": "https://www.capmas.gov.eg" },
      "core":     { "value": 11.2, "as_of": "2026-07-10" }
    },
    "rates": {
      "policy":            { "value": 24.00, "as_of": "2026-06-26" },
      "overnight_deposit": { "value": 23.50, "as_of": "2026-06-26" },
      "overnight_lending": { "value": 24.50, "as_of": "2026-06-26" }
    }
  }
}
```

Save and push (or edit directly in the GitHub web UI). The next collector run
picks it up. You only need to change values that actually changed; interest
rates, for instance, only move at MPC meetings.

---

## How freshness is decided

| Metric | Fresh | Check | Stale |
|--------|-------|-------|-------|
| FX | <= 4 days old | <= 10 days | older |
| Inflation | <= 40 days | <= 75 days | older |
| Interest rates | <= 120 days | <= 220 days | older |

Official vs market FX that differ by more than 5% are flagged **Check**.
Out-of-range FX (sanity bounds) is rejected and shown **Unavailable**.

---

## Important for reporting

- This is an **internal aid**, not an official Ecolab or government publication.
  Always confirm against the cited source before publishing a figure.
- Inflation **lags**: at month-end you have the *previous* month's CPI. The
  dashboard labels the date so this is clear.
- For dates before the dashboard started collecting, the **official** CBE FX
  rate may be absent; the **market reference** is shown and labelled instead.
