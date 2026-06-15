/* Ecolab Egypt Finance Market Dashboard
   Reads data/latest.json + data/history.json and renders everything.
   No build step, no framework. Pure data-in, DOM-out. */

(function () {
  "use strict";

  var state = { latest: null, history: [], month: null };

  var MONTHS = ["January","February","March","April","May","June","July",
                "August","September","October","November","December"];

  /* ---------- helpers ---------------------------------------------------- */
  function $(id) { return document.getElementById(id); }

  function fmtNum(v, dp) {
    if (v === null || v === undefined || isNaN(v)) return "&mdash;";
    return Number(v).toLocaleString("en-US",
      { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }

  function fmtDate(iso) {
    if (!iso) return "&mdash;";
    var p = String(iso).slice(0, 10).split("-");
    if (p.length < 3) return iso;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3) + " " + d.getFullYear();
  }

  function fmtStamp(iso) {
    if (!iso) return "&mdash;";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return fmtDate(iso);
    var hh = ("0" + d.getHours()).slice(-2), mm = ("0" + d.getMinutes()).slice(-2);
    return fmtDate(iso) + ", " + hh + ":" + mm;
  }

  function pill(status) {
    var s = (status || "unavailable").toLowerCase();
    var label = { fresh: "Fresh", check: "Check", stale: "Stale",
                  unavailable: "Unavailable" }[s] || "Unavailable";
    return '<span class="pill ' + s + '">&#9679; ' + label + "</span>";
  }

  // lower-is-better convention: a rise shows red, a fall green.
  function trend(cur, prev, dp) {
    if (prev === null || prev === undefined || cur === null || cur === undefined)
      return "";
    var diff = +(cur - prev).toFixed(dp + 1);
    if (Math.abs(diff) < Math.pow(10, -(dp + 1))) diff = 0;
    if (diff === 0)
      return '<span class="trend flat">&#8211; 0.00</span>';
    var cls = diff > 0 ? "up" : "down";
    var arrow = diff > 0 ? "&#9650;" : "&#9660;";
    return '<span class="trend ' + cls + '">' + arrow + " " +
           fmtNum(Math.abs(diff), dp) + "</span>";
  }

  function dpFor(unit) { return unit && unit.indexOf("%") >= 0 ? 1 : 2; }

  function kindLabel(kind) {
    if (!kind) return "";
    return kind === "market" ? "auto reference" : kind;
  }

  // inflation: figures are released ~10th of the FOLLOWING month, so the
  // reference month is the month before the release (as_of) date.
  function isInflation(m) { return !!(m && m.unit && m.unit.indexOf("YoY") > -1); }
  function infRefLabel(iso) {
    var p = String(iso).slice(0, 10).split("-");
    if (p.length < 3) return "";
    var d = new Date(Number(p[0]), Number(p[1]) - 2, 1);
    return MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  function srcLink(m) {
    if (!m || !m.source_url) return "";
    return '<a href="' + m.source_url + '" target="_blank" rel="noopener">source &#8599;</a>';
  }

  /* ---------- FX: pick headline (official) vs reference (market) --------- */
  function fxParts(node) {
    if (!node) return null;
    if (node.official && node.official.value != null) {
      return { headline: node.official, headlineLabel: "CBE official",
               reference: node.market };
    }
    if (node.market && node.market.value != null) {
      return { headline: node.market,
               headlineLabel: "Spot rate",
               reference: null };
    }
    return { headline: null, headlineLabel: "", reference: null };
  }

  /* ---------- renderers -------------------------------------------------- */
  function fxCard(pair, label, node, yoyNode) {
    var parts = fxParts(node);
    if (!parts || !parts.headline) {
      return card(label, '<div class="value">&mdash;</div>', pill("unavailable"),
                  "Needs manual verification", "", "");
    }
    var h = parts.headline, dp = dpFor(h.unit);
    var valueHtml = '<div class="value">' + fmtNum(h.value, dp) +
      trend(h.value, h.previous_value, dp) + "</div>";

    var secondary = "";

    var inverse = "";
    if (h.value) {
      var code = pair === "USD_EGP" ? "USD" : "EUR";
      inverse = '<div class="secondary">Inverse: 1 EGP = ' +
        fmtNum(1 / h.value, 4) + " " + code + "</div>";
    }

    var yoy = "";
    if (yoyNode) {
      var yp = fxParts(yoyNode);
      if (yp && yp.headline && yp.headline.value != null) {
        var d = +(h.value - yp.headline.value).toFixed(dp);
        var sign = d > 0 ? "+" : "";
        yoy = '<div class="yoy">YoY vs same month last year: ' +
              sign + fmtNum(d, dp) + "</div>";
      }
    }
    return card(label, valueHtml + secondary + inverse + yoy, pill(h.status),
                parts.headlineLabel, fmtDate(h.as_of), srcLink(h));
  }

  function metricCard(label, m) {
    if (!m || m.value == null)
      return card(label, '<div class="value">&mdash;</div>', pill("unavailable"),
                  "Needs manual verification", "", "");
    var dp = dpFor(m.unit);
    var unitSuffix = m.unit && m.unit.indexOf("%") >= 0 ? "%" : "";
    var val = '<div class="value">' + fmtNum(m.value, dp) + unitSuffix +
      trend(m.value, m.previous_value, dp) + "</div>";
    var sub = m.as_of ? '<div class="secondary">' + infRefLabel(m.as_of) +
      " figure</div>" : "";
    return card(label, val + sub, pill(m.status),
                m.source_name || "", fmtDate(m.as_of), srcLink(m), "released");
  }

  function statCard(label, m) {
    if (!m || m.value == null)
      return '<div class="card stat"><div class="name">' + label +
        '</div><div class="value">&mdash;</div><div class="asof">' +
        pill("unavailable") + "</div></div>";
    return '<div class="card stat"><div class="name">' + label +
      '</div><div class="value">' + fmtNum(m.value, 2) + "%" +
      '</div><div class="asof" style="margin-top:6px">' + pill(m.status) +
      " &middot; " + fmtDate(m.as_of) + "</div></div>";
  }

  function card(name, body, pillHtml, badge, asof, src, asofLabel) {
    return '<div class="card"><div class="top"><span class="name">' + name +
      "</span>" + pillHtml + "</div>" + body +
      '<div class="foot"><span class="badge">' + badge +
      '</span><span class="asof">' +
      (asof ? (asofLabel || "as of") + " " + asof + " " : "") +
      src + "</span></div></div>";
  }

  /* ---------- month-end reporting block --------------------------------- */
  function reportBlock(snap) {
    if (!snap) return "";
    var usd = fxParts(snap.fx.USD_EGP), eur = fxParts(snap.fx.EUR_EGP);
    function item(l, m, dp, suffix) {
      var v = (m && m.value != null) ? fmtNum(m.value, dp) + (suffix || "") : "&mdash;";
      var meta;
      if (!m) meta = "not available";
      else if (isInflation(m)) meta = "released " + fmtDate(m.as_of);
      else meta = fmtDate(m.as_of) + (m.kind ? " &middot; " + kindLabel(m.kind) : "");
      return '<div class="ritem"><div class="l">' + l + '</div><div class="v">' +
        v + '</div><div class="m">' + meta + "</div></div>";
    }
    return (
      '<div class="rhead"><span class="t">&#128196; Month-end reporting view &mdash; ' +
      snap.label + '</span><span class="s">latest available value per metric</span></div>' +
      '<div class="rgrid">' +
        item("USD / EGP", usd && usd.headline, 2) +
        item("EUR / EGP", eur && eur.headline, 2) +
        item("Headline inflation", snap.inflation.headline, 1, "%") +
        item("Core inflation", snap.inflation.core, 1, "%") +
        item("Policy rate", snap.rates.policy, 2, "%") +
        item("O/N deposit", snap.rates.overnight_deposit, 2, "%") +
        item("O/N lending", snap.rates.overnight_lending, 2, "%") +
      "</div>"
    );
  }

  /* ---------- historical detail table ----------------------------------- */
  function histTable(snap) {
    if (!snap) return "";
    var rows = [];
    function row(label, m, dp, suffix) {
      if (!m || m.value == null) {
        rows.push("<tr><td>" + label + '</td><td class="num">&mdash;</td><td>' +
          pill("unavailable") + '</td><td class="src">not available</td></tr>');
        return;
      }
      var dateText = isInflation(m)
        ? infRefLabel(m.as_of) + " figure, released " + fmtDate(m.as_of)
        : fmtDate(m.as_of);
      rows.push("<tr><td>" + label + '</td><td class="num">' +
        fmtNum(m.value, dp) + (suffix || "") + "</td><td>" + pill(m.status) +
        '</td><td class="src">' + (m.source_name || "") + " &middot; " +
        dateText + " " + srcLink(m) + "</td></tr>");
    }
    var usd = fxParts(snap.fx.USD_EGP), eur = fxParts(snap.fx.EUR_EGP);
    row("USD / EGP (" + (usd ? usd.headlineLabel : "") + ")", usd && usd.headline, 2);
    row("EUR / EGP (" + (eur ? eur.headlineLabel : "") + ")", eur && eur.headline, 2);
    row("Headline inflation", snap.inflation.headline, 1, "%");
    row("Core inflation", snap.inflation.core, 1, "%");
    row("Policy rate", snap.rates.policy, 2, "%");
    row("Overnight deposit rate", snap.rates.overnight_deposit, 2, "%");
    row("Overnight lending rate", snap.rates.overnight_lending, 2, "%");
    return '<table class="detail"><thead><tr><th>Metric</th><th>Value</th>' +
      "<th>Status</th><th>Source &amp; date</th></tr></thead><tbody>" +
      rows.join("") + "</tbody></table>";
  }

  /* ---------- top "current" sections ------------------------------------ */
  function renderCurrent() {
    var L = state.latest;
    // YoY: find same calendar month one year before the latest data month.
    var curMonth = (L.meta.last_updated || "").slice(0, 7);
    var yoyKey = null;
    if (curMonth) {
      var y = Number(curMonth.slice(0, 4)) - 1, mm = curMonth.slice(5, 7);
      yoyKey = y + "-" + mm;
    }
    var yoySnap = state.history.filter(function (s) { return s.month === yoyKey; })[0];

    $("fx-grid").innerHTML =
      fxCard("USD_EGP", "USD / EGP", L.fx.USD_EGP, yoySnap && yoySnap.fx.USD_EGP) +
      fxCard("EUR_EGP", "EUR / EGP", L.fx.EUR_EGP, yoySnap && yoySnap.fx.EUR_EGP);

    $("inflation-grid").innerHTML =
      metricCard("Headline (YoY)", L.inflation.headline) +
      metricCard("Core (YoY)", L.inflation.core);

    $("rates-grid").innerHTML =
      statCard("Policy rate", L.rates.policy) +
      statCard("Overnight deposit", L.rates.overnight_deposit) +
      statCard("Overnight lending", L.rates.overnight_lending);
  }

  function renderMonth() {
    var snap = state.history.filter(function (s) { return s.month === state.month; })[0];
    $("report").innerHTML = reportBlock(snap);
    $("hist-title").innerHTML = "Historical lookup &mdash; " + (snap ? snap.label : "");
    $("hist-table").innerHTML = histTable(snap);
  }

  /* ---------- copy / export --------------------------------------------- */
  function summaryText() {
    var snap = state.history.filter(function (s) { return s.month === state.month; })[0];
    if (!snap) return "";
    var usd = fxParts(snap.fx.USD_EGP), eur = fxParts(snap.fx.EUR_EGP);
    function line(label, m, dp, suffix) {
      if (!m || m.value == null) return label + ": Not available";
      return label + ": " + Number(m.value).toFixed(dp) + (suffix || "") +
        "  (" + (m.source_name || "") +
        (m.kind ? ", " + kindLabel(m.kind) : "") + ", as of " + fmtDateAscii(m.as_of) + ")";
    }
    function invLine(label, m) {
      if (!m || m.value == null) return label + ": Not available";
      return label + ": " + (1 / m.value).toFixed(4);
    }
    var lines = [
      "Ecolab Egypt Finance Market Dashboard - Reporting summary (" + snap.label + ")",
      "",
      line("USD/EGP", usd && usd.headline, 2),
      line("EUR/EGP", eur && eur.headline, 2),
      invLine("EGP/USD", usd && usd.headline),
      invLine("EGP/EUR", eur && eur.headline),
      line("Headline inflation", snap.inflation.headline, 1, "% YoY"),
      line("Core inflation", snap.inflation.core, 1, "% YoY"),
      line("Policy rate", snap.rates.policy, 2, "%"),
      line("Overnight deposit rate", snap.rates.overnight_deposit, 2, "%"),
      line("Overnight lending rate", snap.rates.overnight_lending, 2, "%"),
      "",
      "Internal reference. Verify against source before publishing."
    ];
    return lines.join("\n");
  }

  function fmtDateAscii(iso) {
    if (!iso) return "n/a";
    var p = String(iso).slice(0, 10).split("-");
    if (p.length < 3) return iso;
    return Number(p[2]) + " " + MONTHS[Number(p[1]) - 1].slice(0, 3) + " " + p[0];
  }

  function copySummary() {
    var text = summaryText(), btn = $("btn-copy");
    function done() { var o = btn.innerHTML; btn.innerHTML = "&#10003; Copied";
      setTimeout(function () { btn.innerHTML = o; }, 1600); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else { fallbackCopy(text, done); }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { window.prompt("Copy:", text); }
    document.body.removeChild(ta);
  }

  function download(name, content, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function exportCsv() {
    var head = ["month", "metric", "value", "unit", "as_of", "source", "status"];
    var rows = [head.join(",")];
    function push(month, metric, m) {
      if (!m) return;
      rows.push([month, metric, m.value, '"' + (m.unit || "") + '"', m.as_of,
        '"' + (m.source_name || "") + '"', m.status].join(","));
    }
    state.history.forEach(function (s) {
      push(s.month, "USD_EGP_official", s.fx.USD_EGP.official);
      push(s.month, "USD_EGP_market", s.fx.USD_EGP.market);
      push(s.month, "EUR_EGP_official", s.fx.EUR_EGP.official);
      push(s.month, "EUR_EGP_market", s.fx.EUR_EGP.market);
      push(s.month, "inflation_headline", s.inflation.headline);
      push(s.month, "inflation_core", s.inflation.core);
      push(s.month, "rate_policy", s.rates.policy);
      push(s.month, "rate_overnight_deposit", s.rates.overnight_deposit);
      push(s.month, "rate_overnight_lending", s.rates.overnight_lending);
    });
    download("ecolab-egypt-finance-history.csv", rows.join("\n"), "text/csv");
  }

  function exportJson() {
    download("ecolab-egypt-finance-history.json",
      JSON.stringify({ latest: state.latest, history: state.history }, null, 2),
      "application/json");
  }

  /* ---------- boot ------------------------------------------------------- */
  function showError(msg) {
    $("error-slot").innerHTML = '<div class="error">' + msg + "</div>";
  }

  function init() {
    var L = state.latest, H = state.history;
    $("last-updated").innerHTML = fmtDate(L.meta.last_updated);
    $("last-checked").innerHTML = fmtStamp(L.meta.last_checked);
    if (L.meta.disclaimer) $("disclaimer").textContent = L.meta.disclaimer;

    var sel = $("month-select");
    sel.innerHTML = H.map(function (s) {
      return '<option value="' + s.month + '">' + s.label + "</option>";
    }).join("");
    state.month = H.length ? H[0].month : null;
    sel.value = state.month;
    sel.addEventListener("change", function () { state.month = sel.value; renderMonth(); });

    $("btn-copy").addEventListener("click", copySummary);
    $("btn-csv").addEventListener("click", exportCsv);
    $("btn-json").addEventListener("click", exportJson);

    renderCurrent();
    renderMonth();

    $("footer").innerHTML = "Generated by <code>" +
      (L.meta.generated_by || "collector") + "</code>. " +
      "Figures are shown with their original source and date. This dashboard is an " +
      "internal aid and is not an official Ecolab or government publication.";
  }

  Promise.all([
    fetch("data/latest.json").then(function (r) { if (!r.ok) throw 0; return r.json(); }),
    fetch("data/history.json").then(function (r) { if (!r.ok) throw 0; return r.json(); })
  ]).then(function (res) {
    state.latest = res[0]; state.history = res[1] || [];
    init();
  }).catch(function () {
    showError("Could not load data files. If you opened this file directly " +
      "(file://), browsers block local data loading. Run a local server from the " +
      "project folder: <code>python -m http.server</code> then open " +
      "<code>http://localhost:8000</code>. On GitHub Pages it works automatically.");
  });
})();
