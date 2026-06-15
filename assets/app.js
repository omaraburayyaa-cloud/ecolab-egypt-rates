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

  /* ---------- historical detail table (with same-month-last-year) -------- */
  function prevYearKey(month) {
    var p = String(month).split("-");
    return (Number(p[0]) - 1) + "-" + p[1];
  }
  function monthKeyLabel(key) {
    var p = String(key).split("-");
    return MONTHS[Number(p[1]) - 1] + " " + p[0];
  }
  function changeCell(selV, prevV, dp, suffix, isFx) {
    if (selV == null || prevV == null) return '<span class="trend flat">n/a</span>';
    var d = +(selV - prevV).toFixed(dp + 1);
    if (Math.abs(d) < Math.pow(10, -(dp + 1))) d = 0;
    var cls = d > 0 ? "up" : (d < 0 ? "down" : "flat");
    var arrow = d > 0 ? "&#9650;" : (d < 0 ? "&#9660;" : "&#8211;");
    var sign = d > 0 ? "+" : (d < 0 ? "&minus;" : "");
    var pct = (isFx && prevV) ? " (" + (d >= 0 ? "+" : "&minus;") +
      fmtNum(Math.abs(100 * d / prevV), 1) + "%)" : "";
    return '<span class="trend ' + cls + '">' + arrow + " " + sign +
      fmtNum(Math.abs(d), dp) + (suffix || "") + pct + "</span>";
  }

  var HIST_METRICS = [
    { label: "USD / EGP", dp: 2, suffix: "", fx: "USD_EGP", isFx: true },
    { label: "EUR / EGP", dp: 2, suffix: "", fx: "EUR_EGP", isFx: true },
    { label: "Headline inflation", dp: 1, suffix: "%", path: ["inflation", "headline"] },
    { label: "Core inflation", dp: 1, suffix: "%", path: ["inflation", "core"] },
    { label: "Policy rate", dp: 2, suffix: "%", path: ["rates", "policy"] },
    { label: "Overnight deposit rate", dp: 2, suffix: "%", path: ["rates", "overnight_deposit"] },
    { label: "Overnight lending rate", dp: 2, suffix: "%", path: ["rates", "overnight_lending"] }
  ];
  function metricFrom(snap, def) {
    if (!snap) return null;
    if (def.fx) { var p = fxParts(snap.fx[def.fx]); return p ? p.headline : null; }
    var n = snap;
    for (var i = 0; i < def.path.length; i++) { n = n && n[def.path[i]]; }
    return n || null;
  }

  function histTable(snap) {
    if (!snap) return "";
    var prevKey = prevYearKey(snap.month);
    var prev = state.history.filter(function (s) { return s.month === prevKey; })[0] || null;
    var prevLabel = monthKeyLabel(prevKey);

    var rows = HIST_METRICS.map(function (def) {
      var m = metricFrom(snap, def), pm = metricFrom(prev, def);
      var selCell = (m && m.value != null)
        ? fmtNum(m.value, def.dp) + def.suffix + " " + pill(m.status)
        : "&mdash;";
      var prevCell = (pm && pm.value != null)
        ? fmtNum(pm.value, def.dp) + def.suffix
        : '<span class="src">n/a</span>';
      var chg = changeCell(m && m.value, pm && pm.value, def.dp, def.suffix, def.isFx);
      var src;
      if (!m) {
        src = '<span class="src">not available</span>';
      } else {
        var dateText = isInflation(m)
          ? infRefLabel(m.as_of) + " figure, released " + fmtDate(m.as_of)
          : fmtDate(m.as_of);
        src = '<span class="src">' + (m.source_name || "") + " &middot; " +
          dateText + " " + srcLink(m) + "</span>";
      }
      return "<tr><td>" + def.label + '</td><td class="num">' + selCell +
        '</td><td class="num">' + prevCell + "</td><td>" + chg +
        '</td><td>' + src + "</td></tr>";
    });

    return '<div style="overflow-x:auto"><table class="detail"><thead><tr>' +
      "<th>Metric</th><th>" + snap.label + "</th><th>" + prevLabel +
      "</th><th>YoY change</th><th>Source &amp; date</th></tr></thead><tbody>" +
      rows.join("") + "</tbody></table></div>";
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

  /* ---------- boot ------------------------------------------------------- */
  function showError(msg) {
    $("error-slot").innerHTML = '<div class="error">' + msg + "</div>";
  }

  function init() {
    var L = state.latest, H = state.history;
    $("last-updated").innerHTML = fmtDate(L.meta.last_updated);
    $("last-checked").innerHTML = fmtStamp(L.meta.last_checked);

    var sel = $("month-select");
    sel.innerHTML = H.map(function (s) {
      return '<option value="' + s.month + '">' + s.label + "</option>";
    }).join("");
    state.month = H.length ? H[0].month : null;
    sel.value = state.month;
    sel.addEventListener("change", function () { state.month = sel.value; renderMonth(); });

    renderCurrent();
    renderMonth();
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
