/* BTC Value Monitor: "Check our homework". Every number here is worked out in the browser from history.json
   with the monitor's own model code (app.js loaded with BVM_EXPORT). */
(function () {
  "use strict";
  var M = window.BVM, $ = function (id) { return document.getElementById(id); };
  if (!M) { $("status").textContent = "Could not load the model code (app.js). Reload the page."; return; }
  var esc = M.esc, usd = M.usd, fd = M.fd, fdy = M.fdy, addDays = M.addDays, DB = M.daysBetween;
  var ROWS = null, COLS = null, H = null, PAST = M.CYCLES.slice(0, 3), NOW = M.CYCLES[3];
  var MODES = { adj: "Small-cycle", classic: "Classic" };
  // the field each signal reads, and its zero and full-score levels (checked against app.js below)
  var FIELD = { cvdd: ["cvdd", "cvdd"], mvrv: ["mvrv", "mvrv"], lth: ["lth", "lth"], sopr: ["sopr7d", "sopr"], w200: ["w200", "w200"], loss: ["addrLoss", "loss"], bal: ["balanced", "bal"], pi: ["pi", "pi"], puell: ["puell", "puell"], sth: ["sth", "sth"], fg: ["fg7d", "fg"], rr: ["reserveRisk", "rr"], mayer: ["mayer", "mayer"] };
  var ZF = { cvdd: [1.6, 1.0], sopr: [0.01, -0.02], w200: [1.3, 0.85], pi: [1.3, 0.95], puell: [1.0, 0.45], fg: [50, 10], rr: [0.004, 0.001] };
  var LVK = { mvrv: "mvrv", lth: "lth", bal: "balanced", mayer: "mayer", loss: "addrLoss", sth: "sth" };
  // most extreme DAILY reading within 60 days of each low (2015, 2018, 2022): the points the small-cycle lines were fitted on
  var EXT = { mvrv: [0.5636, 0.6905, 0.754], lth: [0.5822, 0.7181, 0.7477], bal: [0.7468, 0.9035, 0.9863], mayer: [0.4038, 0.5072, 0.6537], loss: [0.6161, 0.562, 0.4978], sth: [0.521, 0.626, 0.7788] };
  // lowest daily close of each bear market, used for "near the low" in the band statistics (as in the first backtest)
  var LOWC = { c14: 175.64, c18: 3185.07, c22: 15758.29 };
  var COLDOC = {
    d: ["Date of the reading (a Monday, UTC)", "—"], p: ["BTC daily close, USD", "Coin Metrics (PriceUSD)"],
    cvdd: ["Price ÷ CVDD", "LookIntoBitcoin"], mvrv: ["Market value ÷ realized value", "Coin Metrics (CapMVRVCur)"],
    lth: ["Price ÷ long-term holder cost", "LookIntoBitcoin"], bal: ["Price ÷ balanced price", "LookIntoBitcoin"],
    w200: ["Price ÷ 200-week (1,400-day) average", "From Coin Metrics prices"], pi: ["150-day EMA ÷ (0.745 × 471-day average)", "From Coin Metrics prices"],
    dsp: ["Days since the all-time high close", "From Coin Metrics prices"], mayer: ["Price ÷ 200-day average", "From Coin Metrics prices"],
    sopr: ["SOPR minus 1, 7-day average", "LookIntoBitcoin"], loss: ["Share of addresses in loss", "LookIntoBitcoin"],
    puell: ["Miner income ÷ its 365-day average", "Coin Metrics (IssTotUSD)"], sth: ["Price ÷ short-term holder cost", "LookIntoBitcoin"],
    fg: ["Fear & Greed, 7-day average", "alternative.me"], hcap: ["1 = miners capitulating (30-day hash rate below 60-day)", "Coin Metrics (HashRate)"],
    dsr: ["Days since the last hash-ribbon recovery", "Coin Metrics (HashRate)"], rr: ["Reserve risk", "LookIntoBitcoin"],
    low: ["Lowest intraday price since the cycle top", "Bitstamp BTC/USD"], dsl: ["Days since that low", "Bitstamp BTC/USD"],
    ath: ["All-time high close so far", "Coin Metrics"], sthP: ["Short-term holder cost, USD", "LookIntoBitcoin"], lo: ["Lowest intraday price in the 7 days to the date", "Bitstamp BTC/USD"]
  };
  function f(v, d) { return v == null || isNaN(v) ? "—" : (+v).toFixed(d == null ? 2 : d); }
  function pct(v, d) { return v == null || isNaN(v) ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d == null ? 0 : d) + "%"; }
  function epochAt(d) { return M.epochOf(d); }
  function val(o, mode) { o._v = o._v || {}; if (!(mode in o._v)) o._v[mode] = M.parts({ date: o.d, raw: M.rowRaw(o) }, null, mode).total; return o._v[mode]; }
  function inCyc(c, o, endDays) { return o.d >= c.top && o.d <= (c.low ? addDays(c.low, endDays == null ? 365 : endDays) : "9999"); }
  function near(d, list, tol) { var b = null, bd = 1e9; list.forEach(function (o) { var x = Math.abs(DB(o.d, d)); if (x < bd) { bd = x; b = o; } }); return bd <= (tol || 4) ? b : null; }
  function tbl(head, rows, cls) { return '<div class="tscroll"><table class="t ' + (cls || "") + '"><thead><tr>' + head.map(function (h) { return "<th" + (h.r ? ' class="r"' : "") + ">" + (h.t || h) + "</th>"; }).join("") + "</tr></thead><tbody>" + rows.map(function (r) { return "<tr>" + r.map(function (c, i) { return "<td" + (head[i] && head[i].r ? ' class="r"' : "") + ">" + c + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>"; }
  function seg(id, opts, cur) { return '<div class="seg seg-sm" role="group" id="' + id + '">' + opts.map(function (o) { return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (o[0] === cur ? "true" : "false") + '">' + o[1] + "</button>"; }).join("") + "</div>"; }

  // ---------- 1. data ----------
  function sData() {
    var h = '<p>history.json holds <b>' + ROWS.length + "</b> weekly readings, " + fdy(ROWS[0].d) + " to " + fdy(ROWS[ROWS.length - 1].d) + ". Built " + esc(String(H.built || "").slice(0, 10)) + ". " + esc(H.note || "") + "</p>";
    var rows = COLS.map(function (c) {
      var n = 0, first = null; ROWS.forEach(function (o) { if (o[c] != null) { n++; if (!first) first = o.d; } });
      var doc = COLDOC[c] || ["", ""];
      return ["<code>" + esc(c) + "</code>", esc(doc[0]), esc(doc[1]), first ? fd(first) + " " + first.slice(0, 4) : "—", { v: n }];
    }).map(function (r) { r[4] = String(r[4].v); return r; });
    h += tbl(["Column", "What it is", "Source", "First reading", { t: "Readings", r: 1 }], rows);
    $("b-data").innerHTML = h;
  }

  // ---------- 2. model ----------
  function zfOf(d) {
    if (LVK[d.k]) { var x = M.LV[LVK[d.k]]; return [x[0], x[1], x[2]]; }
    var z = ZF[d.k]; return z ? [z[0], z[1], 0] : null;
  }
  function selfCheck() {
    var ok = 0, bad = [];
    M.IND.forEach(function (d) {
      var zf = zfOf(d), fl = FIELD[d.k]; if (!zf || !fl) return;
      var r0 = {}, r1 = {}; r0[fl[0]] = zf[0]; r1[fl[0]] = zf[1];
      var s0 = d.score(r0, "2022-06-01", "classic"), s1 = d.score(r1, "2022-06-01", "classic");
      if (Math.abs(s0) < 1e-9 && Math.abs(s1 - 100) < 1e-9) ok++; else bad.push(d.name);
    });
    return { ok: ok, bad: bad };
  }
  function sModel() {
    var ck = selfCheck(), dates = PAST.map(function (c) { return c.low; }).concat([NOW.top]);
    var rows = M.IND.map(function (d) {
      var zf = zfOf(d), lv = LVK[d.k];
      var levels = dates.map(function (dt) { return lv ? f(M.fAt(lv, dt, "adj"), 3) : zf ? f(zf[1], zf[1] < 0.01 ? 4 : 2) : esc(d.full); });
      return [esc(d.name), { s: String(d.w) }, zf ? f(zf[0], zf[0] < 0.01 ? 4 : 2) : "—", zf ? f(zf[1], zf[1] < 0.01 ? 4 : 2) : esc(d.full), lv ? (zf[2] >= 0 ? "+" : "−") + Math.abs(zf[2]).toFixed(4) : "—"].concat(levels);
    }).map(function (r) { r[1] = r[1].s; return r; });
    var h = '<div class="formula"><p><b>Mark</b> for one signal = (reading − zero) ÷ (full − zero), kept between 0 and 1, × 100.</p>' +
      "<p><b>Value score</b> = Σ (weight × mark) ÷ Σ weight, over the signals that have a reading. A missing reading's weight goes to the others.</p>" +
      "<p><b>Small-cycle full level</b> in cycle <i>n</i> (2015 = 1, 2018 = 2, 2022 = 3, now = 4) = classic full + shift × (<i>n</i> − 3), moved by no more than half the gap between full and zero.</p></div>";
    h += tbl(["Signal", { t: "Weight", r: 1 }, { t: "Zero", r: 1 }, { t: "Full (classic)", r: 1 }, { t: "Shift / cycle", r: 1 }, { t: "Full 2015", r: 1 }, { t: "Full 2018", r: 1 }, { t: "Full 2022", r: 1 }, { t: "Full now", r: 1 }], rows, "sm");
    h += '<p class="note">Self-check: for ' + ck.ok + " of the 13 straight-line signals, the zero and full levels in this table give marks of exactly 0 and 100 in app.js" + (ck.bad.length ? ". Mismatch: " + esc(ck.bad.join(", ")) : ". All match") + ". Time since peak, hash ribbons and leverage use rules, not straight lines (see the method page). Leverage has no data before 2023, so it is blank in the backtest.</p>";
    h += "<h3>Bottom in?</h3>" + tbl(["Sign", { t: "Weight", r: 1 }, "How it scores"], M.BI.map(function (b) { return [esc(b.name), String(b.w), esc(b.tip)]; }), "sm");
    h += '<p class="note">Bottom in = Σ (weight × mark) ÷ Σ weight, then × the deep-value check: 0.4 while the highest small-cycle value score so far in the bear market is below 60, 0.5 while it is 60–74, and 1 once it has reached 75.</p>';
    $("b-model").innerHTML = h;
  }

  // ---------- 3. worked example ----------
  var EX = { d: null, mode: "adj" };
  function sExample() {
    var opts = [[ROWS[ROWS.length - 1].d, "Latest week"]];
    PAST.forEach(function (c) { var o = near(c.low, ROWS, 4); if (o) opts.push([o.d, c.name + " low week"]); });
    PAST.concat([NOW]).forEach(function (c) { var o = near(c.top, ROWS, 4); if (o) opts.push([o.d, c.name + " top week"]); });
    if (!EX.d) EX.d = opts[0][0];
    var sel = '<label class="ctl">Week <select id="ex-d" class="sel-sm">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === EX.d ? " selected" : "") + ">" + esc(o[1]) + " (" + fd(o[0]) + " " + o[0].slice(0, 4) + ")</option>"; }).join("") + '</select></label><label class="ctl">or any date <input type="date" id="ex-in" class="sel-sm" min="' + ROWS[0].d + '" max="' + ROWS[ROWS.length - 1].d + '"></label>' + seg("ex-m", [["adj", "Small-cycle"], ["classic", "Classic"]], EX.mode);
    var o = near(EX.d, ROWS, 6) || ROWS[ROWS.length - 1], raw = M.rowRaw(o), pa = M.parts({ date: o.d, raw: raw }, null, EX.mode), sw = pa.sw;
    var rows = M.IND.map(function (d) {
      var m = pa.p[d.k], zf = zfOf(d), full = LVK[d.k] ? M.fAt(LVK[d.k], o.d, EX.mode) : zf ? zf[1] : null;
      return [esc(d.name), esc(d.read(raw)), zf ? f(zf[0], zf[0] < 0.01 ? 4 : 2) : "rule", full != null ? f(full, full < 0.01 ? 4 : 3) : "rule", m == null ? "—" : m.toFixed(1), String(d.w), m == null ? "—" : (m * d.w / sw).toFixed(2)];
    });
    rows.push(["<b>Value score</b>", "", "", "", "", "<b>" + sw + "</b>", "<b>" + pa.total.toFixed(2) + "</b>"]);
    $("b-ex").innerHTML = '<div class="ctls">' + sel + "</div><p>Week of <b>" + fdy(o.d) + "</b>, BTC " + usd(o.p) + ". Points = mark × weight ÷ " + sw + " (the weights of the signals with a reading)." + (sw < 100 ? " " + (100 - sw) + " weight points have no reading this week, so the others are scaled up." : "") + "</p>" +
      tbl(["Signal", { t: "Reading", r: 1 }, { t: "Zero", r: 1 }, { t: "Full", r: 1 }, { t: "Mark", r: 1 }, { t: "Weight", r: 1 }, { t: "Points", r: 1 }], rows, "sm") +
      '<p class="note">Value ' + Math.round(pa.total) + " · " + esc(M.bandName(pa.total)) + ". Bottom in? that week: " + (o.bi == null ? "outside a bear-market window" : Math.round(o.bi) + " (raw " + o.biraw.toFixed(1) + " × " + o.gate + ")") + ".</p>";
  }

  // ---------- 4. readings at past lows ----------
  function extreme(k, c) {
    var fl = FIELD[k], lv = LVK[k], zf = lv ? M.LV[lv] : ZF[k]; if (!fl || !zf) return null;
    var lower = zf[1] < zf[0], best = null;
    ROWS.forEach(function (o) { if (Math.abs(DB(o.d, c.low)) > 60) return; var v = o[fl[1]]; if (v == null) return; if (best == null || (lower ? v < best : v > best)) best = v; });
    return best;
  }
  function sLows() {
    var rows = M.IND.filter(function (d) { return FIELD[d.k]; }).map(function (d) {
      var zf = zfOf(d), ex = PAST.map(function (c) { return extreme(d.k, c); }), lv = LVK[d.k], dp = zf[1] < 0.01 ? 4 : 2;
      var lower = zf[1] < zf[0], reached = ex.filter(function (v) { return v != null && (lower ? v <= zf[1] : v >= zf[1]); }).length;
      return [esc(d.name)].concat(ex.map(function (v) { return f(v, dp); })).concat([f(zf[1], dp), lv ? PAST.map(function (c) { return f(M.fAt(lv, c.low, "adj"), dp); }).join(" · ") : "—", reached + " of " + ex.filter(function (v) { return v != null; }).length]);
    });
    var h = tbl(["Signal", { t: "2015 low", r: 1 }, { t: "2018 low", r: 1 }, { t: "2022 low", r: 1 }, { t: "Full (classic)", r: 1 }, { t: "Small-cycle full ’15 · ’18 · ’22", r: 1 }, { t: "Lows that reached classic full", r: 1 }], rows, "sm");
    h += '<p class="note">Most extreme weekly reading within 60 days of each low. The levels were set with these readings in view, so they fit the past by design. Section 8 tests how much that matters.</p>';
    var fit = Object.keys(EXT).map(function (k) {
      var e = EXT[k], sh = (e[2] - e[0]) / 2, lv = LVK[k], st = M.LV[lv][2];
      return ["<code>" + k + "</code>", f(e[0], 4), f(e[1], 4), f(e[2], 4), (sh >= 0 ? "+" : "−") + Math.abs(sh).toFixed(4), (st >= 0 ? "+" : "−") + Math.abs(st).toFixed(4), Math.abs(sh - st) < 0.0001 ? "✓" : "✗"];
    });
    h += "<h3>Where the small-cycle shifts come from</h3><p>For six signals the reading at each low was less extreme than at the one before. The shift per cycle is the change from the 2015 low to the 2022 low, divided by two. These use the most extreme <b>daily</b> reading within 60 days of each low (the weekly readings above miss some daily extremes).</p>" +
      tbl(["Signal", { t: "2015", r: 1 }, { t: "2018", r: 1 }, { t: "2022", r: 1 }, { t: "(2022 − 2015) ÷ 2", r: 1 }, { t: "Shift in app.js", r: 1 }, { t: "Match", r: 1 }], fit, "sm");
    $("b-lows").innerHTML = h;
  }

  // ---------- 5. band statistics ----------
  function nath(c) {
    var w = ROWS.filter(function (o) { return Math.abs(DB(o.d, c.top)) <= 7; }), mx = Math.max.apply(null, w.map(function (o) { return o.p; }));
    var n = ROWS.filter(function (o) { return o.d > c.top && o.p > mx; })[0]; return n ? n.d : "2100-01-01";
  }
  function bandStats(mode) {
    var cy = M.CYCLES.map(function (c) { return { c: c, nath: nath(c), lowP: LOWC[c.id] || null }; });
    var byD = {}; ROWS.forEach(function (o) { byD[o.d] = o; });
    var sub = ROWS.filter(function (o) { return o.d >= "2013-06-01" && o.d <= "2025-11-17"; }), B = [19.5, 39.5, 59.5, 74.5, 89.5, 101], out = B.map(function () { return { n: 0, near: 0, fwd: [] }; });
    sub.forEach(function (o) {
      var s = val(o, mode); if (s == null) return;
      var i = 0; while (s >= B[i]) i++;
      var c = null; cy.forEach(function (x) { if (o.d >= x.c.top && o.d < x.nath) c = x; });
      var nr = !!(c && c.lowP && o.p <= 1.3 * c.lowP), f1 = byD[addDays(o.d, 364)];
      out[i].n++; if (nr) out[i].near++; if (f1) out[i].fwd.push(f1.p / o.p - 1);
    });
    function med(a) { if (!a.length) return null; a = a.slice().sort(function (x, y) { return x - y; }); var m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
    return out.map(function (b) { return { n: b.n, share: b.n / sub.length * 100, near: b.n ? b.near / b.n * 100 : null, med: med(b.fwd) == null ? null : med(b.fwd) * 100, up: b.fwd.length ? b.fwd.filter(function (x) { return x > 0; }).length / b.fwd.length * 100 : null }; });
  }
  var BM = "adj";
  function sBands() {
    var st = bandStats(BM), ref = M.BSTATS[BM];
    var rows = M.BANDS.map(function (b, i) {
      var s = st[i], r = ref[i];
      return ['<span class="sw" style="background:var(--b' + i + ')"></span> ' + b.lo + "–" + b.hi + " " + esc(b.name), String(s.n), s.share.toFixed(1) + '<span class="ref">' + r[0] + "</span>", (s.near == null ? "—" : Math.round(s.near) + "%") + '<span class="ref">' + r[1] + "%</span>", (s.med == null ? "—" : pct(s.med)) + '<span class="ref">+' + r[2] + "%</span>", (s.up == null ? "—" : Math.round(s.up) + "%") + '<span class="ref">' + r[3] + "%</span>"];
    });
    $("b-bands").innerHTML = '<div class="ctls">' + seg("bm", [["adj", "Small-cycle"], ["classic", "Classic"]], BM) + "</div>" +
      tbl(["Band", { t: "Weeks", r: 1 }, { t: "Share %", r: 1 }, { t: "Near the low", r: 1 }, { t: "Median 1-year return", r: 1 }, { t: "Higher 1 year later", r: 1 }], rows) +
      '<p class="note">Large figures: worked out now. Small figures: the values stored in the monitor (shown in the band tips). Weeks from June 2013 to 17 November 2025 (the last week with a full year after it). <b>Near the low</b>: price within 30% of the lowest daily close of that cycle\'s bear market (a cycle runs from its top to the next all-time high). <b>1-year return</b>: price 364 days later. The stored values were made from the first version of history.json; small gaps come from the later rebuild with intraday lows and from rounding.</p>';
  }

  // ---------- 6. Bottom in? ----------
  function biSeries() {
    M.CYCLES.forEach(function (c) {
      var end = addDays(c.top, 900), vm = null;
      ROWS.forEach(function (o) {
        if (o.d < c.top || o.d > end) return;
        var v = val(o, "adj"); if (v != null) vm = vm == null ? v : Math.max(vm, v);
        var bc = M.biComps({ p: o.p, low: o.low, dsl: o.dsl, sth: o.sth, mayer: o.mayer, sopr: o.sopr, hcap: o.hcap === 1, recAfterLow: o.hcap === 1 ? null : o.dsr == null ? null : o.dsr <= o.dsl + 30, flows: null });
        o.gate = M.gateOf(vm); o.biraw = bc.raw; o.bi = bc.raw == null ? null : bc.raw * o.gate; o.vmax = vm; o.cyc = c.id;
      });
    });
  }
  function sBI() {
    var cal = []; PAST.forEach(function (c) { ROWS.forEach(function (o) { if (inCyc(c, o) && o.bi != null) cal.push({ o: o, c: c, lowIn: o.d >= c.low }); }); });
    var B = [[0, 25], [25, 50], [50, 75], [75, 101]];
    var rows = M.BIB.map(function (b, i) {
      var m = cal.filter(function (x) { return x.o.bi >= B[i][0] && x.o.bi < B[i][1]; }), li = m.filter(function (x) { return x.lowIn; }).length;
      return [b.lo + "–" + b.hi + " " + esc(b.name), String(m.length) + '<span class="ref">' + b.weeks + "</span>", (m.length ? Math.round(li / m.length * 100) + "%" : "—") + '<span class="ref">' + b.lowIn + "%</span>"];
    });
    var per = PAST.map(function (c) {
      var m = cal.filter(function (x) { return x.c === c; }), after = m.filter(function (x) { return x.lowIn; }), pre = m.filter(function (x) { return !x.lowIn; });
      var f50 = after.filter(function (x) { return x.o.bi >= 50; })[0], f75 = after.filter(function (x) { return x.o.bi >= 75; })[0];
      var mx = pre.reduce(function (a, x) { return Math.max(a, x.o.bi); }, 0);
      return [esc(c.name), fdy(c.low), f50 ? DB(c.low, f50.o.d) + " days (" + pct((f50.o.p / c.lowP - 1) * 100) + " above the low)" : "—", f75 ? DB(c.low, f75.o.d) + " days" : "—", mx.toFixed(0)];
    });
    $("b-bi").innerHTML = tbl(["Band", { t: "Weekly readings", r: 1 }, { t: "Low already passed", r: 1 }], rows) +
      '<p class="note">Weeks from each past top to one year after its low (' + cal.length + ' readings). Small figures: stored in the monitor. The low is the lowest intraday price (Bitstamp).</p>' +
      tbl(["Bear market", "Low", "First reached 50", "First reached 75", { t: "Highest before the low", r: 1 }], per, "sm");
  }

  // ---------- 7. cheap windows ----------
  var CWT = 60, CWG = 12;
  function windowsFor(c, thr, gap, mode, rowsIn) {
    var rs = rowsIn || ROWS.filter(function (o) { return inCyc(c, o); });
    rs.forEach(function (o) { o.v = o.v || {}; });
    var ws = M.cwFind(rs, mode || "adj", thr, gap * 7);
    if (!c.low) return ws.map(function (w) { w.cells = M.cwCells(w, rs, mode || "adj", w.last); return w; });
    var w = ws.filter(function (x) { return x.start <= c.low && addDays(x.last, 7) >= c.low; })[0] || ws.filter(function (x) { return x.start <= c.low; }).pop() || ws[0];
    if (!w) return [];
    w.cells = M.cwCells(w, rs, mode || "adj", w.last); return [w];
  }
  function sCW() {
    var rows = [];
    M.CYCLES.forEach(function (c) {
      var ws = windowsFor(c, CWT, CWG);
      if (!ws.length) { rows.push([esc(c.name), "No week at " + CWT + "+", "", "", "", "", ""]); return; }
      ws.forEach(function (w) {
        var n = w.cells.filter(function (v) { return v != null && v >= CWT; }).length, lowFirst = c.low && c.low < w.start;
        rows.push([esc(c.name), fdy(w.start) + " – " + fdy(w.last), String(w.cells.length), String(n), usd(w.p0), c.low ? (lowFirst ? "low came first" : pct((c.lowP / w.p0 - 1) * 100) + " to " + usd(c.lowP)) : "—", c.low && !lowFirst ? "week " + (Math.floor(DB(w.start, c.low) / 7) + 1) : "—"]);
      });
    });
    $("b-cw").innerHTML = '<div class="ctls"><label class="ctl">Value at least <select id="cw-t" class="sel-sm">' + [40, 50, 60, 70, 75, 80, 90].map(function (t) { return '<option value="' + t + '"' + (t === CWT ? " selected" : "") + ">" + t + "</option>"; }).join("") + '</select></label><label class="ctl">Ends after <select id="cw-g" class="sel-sm">' + [1, 2, 4, 8, 12, 16, 20, 26].map(function (t) { return '<option value="' + t + '"' + (t === CWG ? " selected" : "") + ">" + t + " weeks below</option>"; }).join("") + "</select></label></div>" +
      tbl(["Bear market", "Window", { t: "Weeks", r: 1 }, { t: "Weeks at the line", r: 1 }, { t: "First close", r: 1 }, { t: "Fell after", r: 1 }, { t: "Low came", r: 1 }], rows, "sm") +
      '<p class="note">Weekly readings, small-cycle levels. The monitor rebuilds past cycles day by day for its cheap-window card, so its weeks and prices can differ a little from this table.</p>';
  }

  // ---------- 8. leave one cycle out ----------
  function looLevels(h) {
    // the small-cycle lines without cycle h: the line through the other two lows, at cycle h; same margin as the model
    var out = {};
    Object.keys(EXT).forEach(function (k) {
      var e = EXT[k], idx = [0, 1, 2].filter(function (i) { return i !== h; }), a = idx[0], b = idx[1];
      var pred = e[a] + (e[b] - e[a]) * (h - a) / (b - a), lv = LVK[k], z = M.LV[lv][0], fc = M.LV[lv][1];
      var ins = M.fAt(lv, PAST[h].low, "adj"), oos = ins + (pred - e[h]), cap = 0.5 * Math.abs(z - fc);
      oos = fc + Math.max(-cap, Math.min(cap, oos - fc));
      out[k] = { ins: ins, oos: oos, pred: pred, act: e[h] };
    });
    return out;
  }
  function scoreWith(levels, o) {
    var keep = {};
    Object.keys(levels).forEach(function (k) { var lv = LVK[k]; keep[lv] = M.LV[lv]; M.LV[lv] = [keep[lv][0], levels[k].oos, 0]; });
    try { return M.parts({ date: o.d, raw: M.rowRaw(o) }, null, "adj").total; }
    finally { Object.keys(keep).forEach(function (lv) { M.LV[lv] = keep[lv]; }); }
  }
  function cycStats(c, fn) {
    var rs = ROWS.filter(function (o) { return inCyc(c, o); }), lowRow = null, peak = 0, first60 = null, first75 = null, n60 = 0, n60pre = 0;
    rs.forEach(function (o) {
      var s = fn(o); if (s == null) return;
      if (Math.abs(DB(o.d, c.low)) <= 3 && (!lowRow || o.p < lowRow.o.p)) lowRow = { o: o, s: s };
      if (o.d <= c.low) peak = Math.max(peak, s);
      if (s >= 60) { n60++; if (o.d < c.low) n60pre++; if (!first60) first60 = o; }
      if (s >= 75 && !first75) first75 = o;
    });
    return { low: lowRow ? lowRow.s : null, peak: peak, f60: first60, f75: first75, n60: n60, n60pre: n60pre };
  }
  function sLOO() {
    var lvRows = [], res = [];
    PAST.forEach(function (c, h) {
      var L = looLevels(h);
      Object.keys(L).forEach(function (k) { lvRows.push([esc(c.name), "<code>" + k + "</code>", f(L[k].act, 3), f(L[k].pred, 3), f(L[k].ins, 3), f(L[k].oos, 3)]); });
      var a = cycStats(c, function (o) { return val(o, "adj"); }), b = cycStats(c, function (o) { return scoreWith(L, o); }), k = cycStats(c, function (o) { return val(o, "classic"); });
      res.push({ c: c, a: a, b: b, k: k });
    });
    function fall(o, c) { return o ? fdy(o.d) + ", " + usd(o.p) + " (" + (o.d <= c.low ? pct((c.lowP / o.p - 1) * 100) + " to the low" : "after the low") + ")" : "never"; }
    var head = ["", { t: "With all three lows", r: 0 }, { t: "Without this cycle's low", r: 0 }, { t: "Classic (no trend)", r: 0 }];
    var h = '<div class="sum"><p><b>In short.</b> ' + res.map(function (x) {
      var same60 = (x.a.f60 && x.b.f60 && x.a.f60.d === x.b.f60.d) || (!x.a.f60 && !x.b.f60);
      return esc(x.c.name) + ": score at the low " + (x.a.low == null ? "—" : x.a.low.toFixed(0)) + " with all three lows, " + (x.b.low == null ? "—" : x.b.low.toFixed(0)) + " without this one" + (same60 ? "; first week at 60+ the same" : "; first week at 60+ " + (x.a.f60 ? fd(x.a.f60.d) + " " + x.a.f60.d.slice(0, 4) : "never") + " against " + (x.b.f60 ? fd(x.b.f60.d) + " " + x.b.f60.d.slice(0, 4) : "never")) + ".";
    }).join(" ") + "</p></div>";
    res.forEach(function (x) {
      h += "<h3>" + esc(x.c.name) + " held out</h3>" + tbl(head, [
        ["Score at the low", x.a.low == null ? "—" : x.a.low.toFixed(0), x.b.low == null ? "—" : x.b.low.toFixed(0), x.k.low == null ? "—" : x.k.low.toFixed(0)],
        ["Highest score up to the low", x.a.peak.toFixed(0), x.b.peak.toFixed(0), x.k.peak.toFixed(0)],
        ["First week at 60+", fall(x.a.f60, x.c), fall(x.b.f60, x.c), fall(x.k.f60, x.c)],
        ["First week at 75+", fall(x.a.f75, x.c), fall(x.b.f75, x.c), fall(x.k.f75, x.c)],
        ["Weeks at 60+ (before the low)", x.a.n60 + " (" + x.a.n60pre + ")", x.b.n60 + " (" + x.b.n60pre + ")", x.k.n60 + " (" + x.k.n60pre + ")"]
      ], "sm loo");
    });
    h += "<h3>The six levels, with and without each low</h3>" + tbl(["Held out", "Signal", { t: "Reading at that low", r: 1 }, { t: "Line from the other two", r: 1 }, { t: "Full level used", r: 1 }, { t: "Full level without it", r: 1 }], lvRows, "sm");
    $("b-loo").innerHTML = h;
    S.loo = res;
  }

  // ---------- 9. each cycle ----------
  function sChart() {
    var W = 900, Hh = 300, pl = 36, pr = 12, pt = 12, pb = 28, X = function (d) { return pl + d / 1100 * (W - pl - pr); }, Y = function (v) { return pt + (100 - v) / 100 * (Hh - pt - pb); };
    var cols = ["var(--muted)", "var(--b1)", "var(--b4)", "var(--accent)"], g = "";
    [0, 20, 40, 60, 75, 90, 100].forEach(function (v) { g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="var(--line)" stroke-width="1"' + (v === 60 || v === 75 ? ' stroke-dasharray="4 4"' : "") + '/><text x="' + (pl - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v + "</text>"; });
    for (var d = 0; d <= 1100; d += 100) g += '<text x="' + X(d) + '" y="' + (Hh - 8) + '" text-anchor="middle">' + d + "</text>";
    var leg = "";
    M.CYCLES.forEach(function (c, i) {
      var pts = ROWS.filter(function (o) { return o.d >= c.top && DB(c.top, o.d) <= 1100; }).map(function (o) { var v = val(o, "adj"); return v == null ? null : X(DB(c.top, o.d)).toFixed(1) + "," + Y(v).toFixed(1); }).filter(Boolean);
      g += '<polyline fill="none" stroke="' + cols[i] + '" stroke-width="' + (i === 3 ? 2.5 : 1.8) + '" points="' + pts.join(" ") + '"/>';
      if (c.low) { var o = near(c.low, ROWS, 4); if (o) g += '<circle cx="' + X(DB(c.top, o.d)) + '" cy="' + Y(val(o, "adj")) + '" r="5" fill="' + cols[i] + '" stroke="var(--surf)" stroke-width="2"/>'; }
      leg += '<span><i style="background:' + cols[i] + '"></i>' + esc(c.name) + (c.low ? " (dot: the low)" : "") + "</span>";
    });
    $("b-chart").innerHTML = '<svg viewBox="0 0 ' + W + " " + Hh + '" role="img" aria-label="Value score by days since each cycle top">' + g + '</svg><div class="leg">' + leg + '</div><p class="note">Small-cycle value score, weekly, by days since each cycle\'s top (x axis). Dashed lines: 60 (Cheap) and 75 (Very cheap).</p>';
  }

  // ---------- 11. every week ----------
  var TC = "all";
  var TCOLS = ["d", "p", "va", "vc", "bi", "cvdd", "mvrv", "lth", "bal", "w200", "pi", "mayer", "sth", "loss", "sopr", "puell", "rr", "fg", "dsp", "low", "dsl"];
  function cell(o, k) {
    if (k === "va") return val(o, "adj"); if (k === "vc") return val(o, "classic"); return o[k];
  }
  function fmt(k, v) { if (v == null) return "—"; if (k === "d") return v; if (k === "p" || k === "low") return usd(v); if (k === "va" || k === "vc" || k === "bi") return v.toFixed(1); if (k === "dsp" || k === "dsl" || k === "fg") return Math.round(v); if (k === "rr") return v.toFixed(5); if (k === "sopr") return v.toFixed(4); return v.toFixed(3); }
  function sTable() {
    var rs = ROWS.filter(function (o) { if (TC === "all") return true; var c = M.CYCLES.filter(function (x) { return x.id === TC; })[0]; return inCyc(c, o); });
    var head = TCOLS.map(function (k) { return { t: k === "va" ? "Value (small-cycle)" : k === "vc" ? "Value (classic)" : k === "bi" ? "Bottom in?" : k, r: k !== "d" }; });
    $("b-tab").innerHTML = '<div class="ctls">' + seg("tc", [["all", "All weeks"]].concat(M.CYCLES.map(function (c) { return [c.id, c.name]; })), TC) + '<span class="note">' + rs.length + " weeks</span></div>" +
      '<div class="big">' + tbl(head, rs.slice().reverse().map(function (o) { return TCOLS.map(function (k) { return fmt(k, cell(o, k)); }); }), "sm wk") + "</div>";
  }
  function csv() {
    var keys = COLS.concat(["value_small_cycle", "value_classic", "bottom_in"]).concat(M.IND.map(function (d) { return "mark_" + d.k; }));
    var lines = [keys.join(",")];
    ROWS.forEach(function (o) {
      var pa = M.parts({ date: o.d, raw: M.rowRaw(o) }, null, "adj");
      var r = COLS.map(function (c) { return o[c] == null ? "" : o[c]; }).concat([val(o, "adj"), val(o, "classic"), o.bi]).concat(M.IND.map(function (d) { return pa.p[d.k]; }));
      lines.push(r.map(function (v) { return v == null || (typeof v === "number" && isNaN(v)) ? "" : typeof v === "number" ? +v.toFixed(6) : String(v); }).join(","));
    });
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = "btc-value-monitor-backtest.csv"; document.body.appendChild(a); a.click(); a.remove();
  }

  var S = {};
  function all() { sData(); sModel(); sExample(); sLows(); sBands(); sBI(); sCW(); sLOO(); sChart(); sTable(); }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var g = b.parentNode && b.parentNode.id;
    if (g === "ex-m") { EX.mode = b.getAttribute("data-v"); sExample(); }
    else if (g === "bm") { BM = b.getAttribute("data-v"); sBands(); }
    else if (g === "tc") { TC = b.getAttribute("data-v"); sTable(); }
    else if (b.id === "csv") csv();
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.id === "ex-d") { EX.d = t.value; sExample(); }
    else if (t.id === "ex-in" && t.value) { EX.d = t.value; sExample(); }
    else if (t.id === "cw-t") { CWT = +t.value; sCW(); }
    else if (t.id === "cw-g") { CWG = +t.value; sCW(); }
  });
  fetch("history.json?v=4", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (h) {
    H = h; COLS = h.cols;
    ROWS = h.rows.map(function (a) { var o = {}; COLS.forEach(function (c, i) { o[c] = a[i]; }); o.v = {}; return o; });
    biSeries(); all();
    $("status").textContent = "Worked out in your browser just now, from history.json (" + ROWS.length + " weeks) and app.js.";
    window.__bt = { ROWS: ROWS, S: S, bandStats: bandStats, looLevels: looLevels };
  }).catch(function (e) { $("status").textContent = "Could not load history.json: " + e.message; });
})();
