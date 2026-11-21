/* BTC Bottom Monitor v2 */
(function () {
  "use strict";
  // ---------- helpers ----------
  var $ = function (id) { return document.getElementById(id); };
  function lin(v, z, f) { if (v == null || typeof v !== "number" || isNaN(v)) return null; return Math.max(0, Math.min(1, (v - z) / (f - z))) * 100; }
  function f2(v) { return v == null ? "—" : v.toFixed(2); }
  function usd(v) { return v == null ? "—" : "$" + Math.round(v).toLocaleString("en-US"); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fd(s) { return +s.slice(8, 10) + " " + MON[+s.slice(5, 7) - 1]; }
  function fdy(s) { return fd(s) + " " + s.slice(0, 4); }
  function dnum(s) { return Date.parse(s + "T00:00:00Z"); }
  function addDays(s, n) { return new Date(dnum(s) + n * 864e5).toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((dnum(b) - dnum(a)) / 864e5); }
  function todayCbr() { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } }
  function sget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function sgn(v, d) { return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d == null ? 0 : d); }

  // ---------- model ----------
  // hits = past lows (2015, 2018, 2022) where the signal scored 70+ within 90 days; prec = share of its firing days within 30% of a two-year low (a random day: 6%); up = share of firing days with BTC higher one year later.
  var IND = [
    { k: "cvdd", w: 12, name: "Price vs CVDD", hits: "3 of 3", prec: 99, up: 100, full: "1.00×", what: "Price divided by CVDD, a floor price built from coin-days destroyed (how long coins sat before they moved).", why: "Price has touched this floor at every cycle low and rarely anywhere else.",
      score: function (r) { return lin(r.cvdd, 1.6, 1.0); }, read: function (r) { return f2(r.cvdd) + "×"; } },
    { k: "mvrv", w: 11, name: "MVRV", hits: "3 of 3", prec: 47, up: 99, full: "0.80", what: "Market value divided by realized value: price against the average price at which all coins last moved.", why: "Below 1, the average holder is at a loss. Deep readings have only come near cycle lows.",
      score: function (r) { return lin(r.mvrv, 1.5, 0.8); }, read: function (r) { return f2(r.mvrv); } },
    { k: "lth", w: 9, name: "Long-term holder cost", hits: "3 of 3", prec: 47, up: 100, full: "0.80×", what: "Price divided by the average cost of coins held more than 155 days.", why: "When even patient holders are under water, the sellers who are left are few.",
      score: function (r) { return lin(r.lth, 1.6, 0.8); }, read: function (r) { return f2(r.lth) + "×"; } },
    { k: "sopr", w: 8, name: "SOPR, 7-day (loss-taking)", hits: "2 of 2", prec: 51, up: 86, full: "−0.020", what: "Spent Output Profit Ratio minus 1, as a 7-day average: profit or loss on coins that moved.", why: "Below zero, holders sell at a loss. Deep, lasting loss-taking is what capitulation looks like.",
      score: function (r) { return lin(r.sopr7d, 0.01, -0.02); }, read: function (r) { return r.sopr7d == null ? "—" : (r.sopr7d >= 0 ? "+" : "−") + Math.abs(r.sopr7d).toFixed(3); } },
    { k: "w200", w: 8, name: "200-week average", hits: "2 of 3", prec: 49, up: 100, full: "0.85×", what: "Price divided by the 200-week moving average, the long-run trend line.", why: "Price has rarely stayed below this line for long. Time below it has been among the best times to buy.",
      score: function (r) { return lin(r.w200, 1.3, 0.85); }, read: function (r) { return f2(r.w200) + "×"; } },
    { k: "loss", w: 7, name: "Addresses in loss", hits: "3 of 3", prec: 31, up: 91, full: "55%", what: "Share of addresses that hold coins worth less than they paid.", why: "Shows how wide the pain is. Lows came when about half of all addresses were at a loss.",
      score: function (r) { return lin(r.addrLoss, 0.20, 0.55); }, read: function (r) { return r.addrLoss == null ? "—" : (r.addrLoss * 100).toFixed(1) + "%"; } },
    { k: "bal", w: 6, name: "Balanced price", hits: "3 of 3", prec: 52, up: 99, full: "1.00×", what: "Price divided by the balanced price, a fair-value line made from realized price minus transfer price.", why: "Price has met this line at the deepest point of past bears.",
      score: function (r) { return lin(r.balanced, 2.0, 1.0); }, read: function (r) { return f2(r.balanced) + "×"; } },
    { k: "lev", w: 6, name: "Leverage flush", hits: "no data", prec: null, up: null, full: "funding −5%/yr, OI −30%", what: "Futures funding rate (7-day) and how far open interest is below its 90-day high.", why: "Negative funding and a big fall in open interest show forced sellers are gone.",
      score: function (r) { var a = lin(r.funding7d, 10, -5), b = lin(r.oiDrawdown, 0, 30); if (a == null && b == null) return null; return ((a == null ? b : a) + (b == null ? a : b)) / 2; }, read: function (r) { return r.oiDrawdown == null ? "—" : "OI −" + r.oiDrawdown.toFixed(1) + "%"; } },
    { k: "pi", w: 6, name: "Pi Cycle bottom", hits: "3 of 3", prec: 42, up: 100, full: "0.95", what: "The 150-day exponential average against 0.745 × the 471-day average.", why: "A cross below has lined up with past lows within weeks.",
      score: function (r) { return lin(r.pi, 1.3, 0.95); }, read: function (r) { return f2(r.pi); } },
    { k: "time", w: 6, name: "Time since peak", hits: "3 of 3", prec: 36, up: 96, full: "365–420 days", what: "Days since the cycle's all-time high.", why: "Past lows came 365–420 days after the top. It is the only signal that does not use price.",
      score: function (r) { var d = r.daysSincePeak; if (d == null) return null; return d < 240 ? 0 : d < 365 ? (d - 240) / 125 * 100 : d <= 420 ? 100 : d < 600 ? 100 - (d - 420) / 180 * 70 : 30; }, read: function (r) { return r.daysSincePeak == null ? "—" : r.daysSincePeak + " d"; } },
    { k: "puell", w: 5, name: "Puell multiple", hits: "3 of 3", prec: 39, up: 91, full: "0.45", what: "Daily miner income against its 1-year average.", why: "Low values put miners under stress. When weak miners have sold, a big source of supply is gone.",
      score: function (r) { return lin(r.puell, 1.0, 0.45); }, read: function (r) { return f2(r.puell); } },
    { k: "sth", w: 5, name: "Short-term holder cost", hits: "3 of 3", prec: 21, up: 56, full: "0.75×", what: "Price divided by the average cost of coins moved in the last 155 days.", why: "Below 1, recent buyers are under water. It also fires in normal corrections, so its weight is low.",
      score: function (r) { return lin(r.sth, 1.1, 0.75); }, read: function (r) { return f2(r.sth) + "×"; } },
    { k: "fg", w: 3, name: "Fear & Greed, 7-day", hits: "2 of 2", prec: 19, up: 61, full: "10", what: "The Crypto Fear & Greed Index, 7-day average.", why: "Extreme fear comes at lows, but also in many corrections, so its weight is low.",
      score: function (r) { return lin(r.fg7d, 50, 10); }, read: function (r) { return r.fg7d == null ? "—" : r.fg7d.toFixed(0); } },
    { k: "hash", w: 3, name: "Hash ribbons", hits: "3 of 3", prec: 14, up: 86, full: "0–30 days after a recovery", what: "30-day against 60-day average hash rate. A recovery after miner capitulation is the buy signal.", why: "Recoveries came after past lows, but also many other times, so its weight is low.",
      score: function (r, date) { if (r.hashCapitulating === true) return 50; if (!r.hashLastRecovery) return r.hashCapitulating === false ? 0 : null; var d = daysBetween(r.hashLastRecovery, date); return d <= 30 ? 100 : d <= 60 ? 100 - (d - 30) / 30 * 100 : 0; }, read: function (r) { return r.hashCapitulating ? "capitulating" : (r.hashLastRecovery ? "rec. " + fd(r.hashLastRecovery) : "—"); } },
    { k: "mayer", w: 3, name: "Mayer multiple", hits: "3 of 3", prec: 39, up: 81, full: "0.60", what: "Price divided by the 200-day moving average.", why: "Deep readings mark oversold markets. It overlaps with the 200-week line, so its weight is low.",
      score: function (r) { return lin(r.mayer, 1.0, 0.6); }, read: function (r) { return f2(r.mayer); } },
    { k: "rr", w: 2, name: "Reserve risk", hits: "3 of 3", prec: 21, up: 98, full: "0.0010", what: "Price against the confidence of long-term holders (how little they spend).", why: "Low values have meant good long-term value. It overlaps with MVRV, so its weight is low.",
      score: function (r) { return lin(r.reserveRisk, 0.004, 0.001); }, read: function (r) { return r.reserveRisk == null ? "—" : r.reserveRisk.toFixed(4); } }
  ];
  var CONF = [
    { k: "etf", name: "ETF net flow, 10 days", tip: "Net BTC bought by US spot ETFs over 10 days. Steady buying came back after past lows.", score: function (c) { return lin(c.etf10d, -20000, 20000); }, read: function (c) { return c.etf10d == null ? "—" : (c.etf10d >= 0 ? "+" : "−") + Math.abs(Math.round(c.etf10d)).toLocaleString("en-US") + " BTC"; } },
    { k: "cb", name: "Coinbase premium", tip: "The price gap between Coinbase (US buyers) and offshore exchanges. A positive premium shows US demand coming back.", score: function (c) { return lin(c.cbPremium, -0.2, 0.1); }, read: function (c) { return c.cbPremium == null ? "—" : (c.cbPremium >= 0 ? "+" : "−") + Math.abs(c.cbPremium).toFixed(2) + "%"; } },
    { k: "stable", name: "Stablecoin supply, 30 days", tip: "Change in total stablecoin supply over 30 days. Growth means new cash coming into crypto.", score: function (c) { return lin(c.stable30d, -5, 3); }, read: function (c) { return c.stable30d == null ? "—" : (c.stable30d >= 0 ? "+" : "−") + Math.abs(c.stable30d).toFixed(1) + "%"; } },
    { k: "usdtd", name: "USDT dominance, 30 days", tip: "Change in Tether's share of all crypto value over 30 days. A fall means money is moving from cash back into coins.", score: function (c) { return lin(c.usdtd30d, 8, -5); }, read: function (c) { return c.usdtd30d == null ? "—" : (c.usdtd30d >= 0 ? "+" : "−") + Math.abs(c.usdtd30d).toFixed(1) + "%"; } }
  ];
  var BANDS = [
    { lo: 0, hi: 19, name: "Very weak", weeks: 70.1, near: 0, fwd: 47, up: 60 },
    { lo: 20, hi: 39, name: "Weak", weeks: 12.5, near: 0, fwd: 72, up: 75 },
    { lo: 40, hi: 59, name: "Building", weeks: 5.5, near: 3, fwd: 69, up: 83 },
    { lo: 60, hi: 74, name: "Strong", weeks: 6.2, near: 33, fwd: 75, up: 100 },
    { lo: 75, hi: 89, name: "Very strong", weeks: 5.4, near: 89, fwd: 107, up: 100 },
    { lo: 90, hi: 100, name: "Capitulation", weeks: 0.3, near: 100, fwd: 128, up: 100 }
  ];
  function bandIdx(s) { return s == null ? -1 : s < 20 ? 0 : s < 40 ? 1 : s < 60 ? 2 : s < 75 ? 3 : s < 90 ? 4 : 5; }
  function bandName(s) { var i = bandIdx(s); return i < 0 ? "—" : BANDS[i].name; }
  var CUTS = [0, 20, 40, 60, 75, 90, 101];

  function parts(doc, raw) {
    var r = raw || (doc && doc.raw) || {}, date = doc && doc.date, p = {}, sw = 0, ss = 0;
    IND.forEach(function (d) { var s = null; try { s = d.score(r, date); } catch (e) { s = null; } p[d.k] = s; if (s != null) { sw += d.w; ss += d.w * s; } });
    return { total: sw ? ss / sw : null, p: p, sw: sw };
  }
  function liveRaw(doc, P) {
    var r = doc.raw || {}, x = doc.ref || {}, o = {};
    for (var k in r) o[k] = r[k];
    if (!P) return o;
    if (x.cvddPrice) o.cvdd = P / x.cvddPrice;
    if (x.lthPrice) o.lth = P / x.lthPrice;
    if (x.balancedPrice) o.balanced = P / x.balancedPrice;
    if (x.sthPrice) o.sth = P / x.sthPrice;
    if (x.realizedPrice) o.mvrv = P / x.realizedPrice;
    if (x.sma1400) o.w200 = P / x.sma1400;
    if (x.sma200) o.mayer = P / x.sma200;
    var cmBase = r.mvrv && x.realizedPrice ? r.mvrv * x.realizedPrice : null;
    var livBase = r.cvdd && x.cvddPrice ? r.cvdd * x.cvddPrice : null;
    if (r.puell != null && cmBase) o.puell = r.puell * P / cmBase;
    if (r.reserveRisk != null && livBase) o.reserveRisk = r.reserveRisk * P / livBase;
    return o;
  }

  // ---------- hover explainers ----------
  var TIPS = {
    score: "<span class='tt-h'>Bottom score</span>16 signals, each scored 0–100 by how close it is to the reading seen at past cycle lows, then averaged by weight. Hover the coloured arcs to see what each band has meant in the past.",
    moved: "<span class='tt-h'>What moved</span>The signals that changed the score most, in points of the 0–100 score. The top part is the effect of the live price. The lower part is the change between the last two daily readings.",
    confirm: "<span class='tt-h'>Confirmation</span>Four signs of money coming back into Bitcoin. They tend to turn up after the low, so they confirm a recovery. They are not part of the bottom score.",
    chg24: "<span class='tt-h'>24-hour change</span>Change in price over the last 24 hours on the exchange shown.",
    live: "<span class='tt-h'>Live price</span>The page asks Bybit for the price every 15 seconds (Coinbase, Kraken or OKX if Bybit fails). Nine price-based signals are worked out again each time.",
    cbbi: "<span class='tt-h'>CBBI: Colin's Bitcoin Bull Run Index</span>A separate index by Colin Talks Crypto that blends nine cycle signals into one 0–100 number. Low numbers have come near cycle lows; 90+ near cycle tops. Shown here as a cross-check. It is not part of the bottom score.",
    "chip-live": "<span class='tt-h'>Live vs daily</span>How much the live price moves the score compared with the last daily reading.",
    "chip-prev": "<span class='tt-h'>Since the last reading</span>Change in the daily score between the last two daily readings.",
    "chip-7": "<span class='tt-h'>7 days</span>Change in the daily score over the last 7 days.",
    "chip-30": "<span class='tt-h'>30 days</span>Change in the daily score over the last 30 days (weekly history before 8 Nov 2026).",
    next: "<span class='tt-h'>Next band</span>The BTC price at which the live score reaches the next band, if the on-chain lines stay as they are today. When price falls, loss-taking and fear usually rise too, so the real score is likely to get there sooner."
  };
  var CBBI_TIPS = {
    PiCycle: "Pi Cycle Top: distance between the 111-day average and 2 × the 350-day average. Near 100 at past tops.",
    RUPL: "Relative unrealized profit/loss (NUPL): how much of the market cap is paper profit.",
    RHODL: "RHODL ratio: value held by new coins against old coins. High when new buyers hold most of the value.",
    Puell: "Puell multiple: miner income against its 1-year average.",
    "2YMA": "2-year moving average multiplier: price against its 2-year average and 5 × that average.",
    Trolololo: "Trolololo (log trend): price against a long-run logarithmic trend line.",
    MVRV: "MVRV Z-score: market value against realized value, scaled by volatility.",
    ReserveRisk: "Reserve risk: price against the confidence of long-term holders.",
    Woobull: "Woobull top cap: price against a top model built from realized price."
  };
  IND.forEach(function (d) {
    TIPS["ind-" + d.k] = "<span class='tt-h'>" + esc(d.name) + " · weight " + d.w + "</span>" + esc(d.what) + " " + esc(d.why) +
      "<span class='tt-m'>Full score at " + esc(d.full) + ". Record: " + (d.prec == null ? "data only from 2023, so weight set by judgment." : "fired at " + d.hits + " past lows; " + d.prec + "% of its signal days were within 30% of a cycle low (a random day: 6%).") + "</span>";
  });
  BANDS.forEach(function (b, i) {
    TIPS["band-" + i] = "<span class='tt-h'>" + b.lo + "–" + b.hi + " · " + b.name + "</span>" +
      "In " + b.weeks + "% of weeks since mid-2013. Price was within 30% of the cycle low in " + b.near + "% of these weeks. One year later, BTC was higher " + b.up + "% of the time, with a median return of +" + b.fwd + "%." +
      "<span class='tt-m'>Weekly backtest, mid-2013 to Nov 2025. Past results do not promise future results.</span>";
  });
  CONF.forEach(function (c) { TIPS["conf-" + c.k] = "<span class='tt-h'>" + esc(c.name) + "</span>" + esc(c.tip); });
  Object.keys(CBBI_TIPS).forEach(function (k) { TIPS["cb-" + k] = esc(CBBI_TIPS[k]); });

  var tt = document.createElement("div"); tt.id = "tt"; tt.setAttribute("role", "tooltip"); document.body.appendChild(tt);
  var ttEl = null;
  function tipFor(el) { var k = el.getAttribute("data-tipk"); return k ? TIPS[k] : el.getAttribute("data-tip"); }
  function showTip(el) {
    var h = tipFor(el); if (!h) return;
    ttEl = el; tt.innerHTML = h; tt.classList.add("on");
    var r = el.getBoundingClientRect(), tw = tt.offsetWidth, th = tt.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    var x = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), vw - tw - 8);
    var y = r.top - th - 8; if (y < 8) y = Math.min(r.bottom + 8, vh - th - 8);
    tt.style.left = x + "px"; tt.style.top = y + "px";
  }
  function hideTip() { ttEl = null; tt.classList.remove("on"); }
  var hoverable = window.matchMedia && window.matchMedia("(hover: hover)").matches;
  document.addEventListener("mouseover", function (e) { var el = e.target.closest && e.target.closest("[data-tip],[data-tipk]"); if (el && el !== ttEl) showTip(el); });
  document.addEventListener("mouseout", function (e) { var el = e.target.closest && e.target.closest("[data-tip],[data-tipk]"); if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) hideTip(); });
  document.addEventListener("focusin", function (e) { var el = e.target.closest && e.target.closest("[data-tip],[data-tipk]"); if (el) showTip(el); });
  document.addEventListener("focusout", hideTip);
  document.addEventListener("click", function (e) {
    if (hoverable) return;
    var el = e.target.closest && e.target.closest("[data-tip],[data-tipk]");
    if (el && el !== ttEl) showTip(el); else hideTip();
  });
  window.addEventListener("scroll", hideTip, { passive: true });

  // ---------- state ----------
  var S = { data: null, latest: null, prev: null, live: null, liveAt: 0, lastOk: 0, hourly: null, daily: null, range: 0, cbbi: null };

  // ---------- skins ----------
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  var LIGHT = { daylight: 1, paper: 1 };
  function applySkin() {
    var sel = S.skinSel || "auto";
    var sk = sel === "auto" ? (mq && mq.matches ? "daylight" : "midnight") : sel;
    var root = document.documentElement;
    root.setAttribute("data-skin", sk);
    root.setAttribute("data-light", LIGHT[sk] ? "1" : "0");
    root.setAttribute("data-cb", S.cb ? "1" : "0");
    $("cb").setAttribute("aria-pressed", S.cb ? "true" : "false");
    var tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.setAttribute("content", css("--bg"));
    if (S.latest) renderAll();
    renderCbbi();
  }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function bandCol(s) { var i = bandIdx(s); return i < 0 ? css("--surf2") : css("--b" + i); }
  function hexRgb(h) { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join(""); return [0, 2, 4].map(function (p) { return parseInt(h.substr(p, 2), 16); }); }
  function lum(h) { var c = hexRgb(h).map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function txtOn(h) { try { var L = lum(h); return (L + 0.05) / 0.0548 > 1.05 / (L + 0.05) ? "#0B0F14" : "#FFFFFF"; } catch (e) { return "inherit"; } }
  // smooth colour scale for the heat strips (band colours at band centres)
  function smoothCol(v) {
    var st = [[10, 0], [30, 1], [50, 2], [67.5, 3], [82.5, 4], [95, 5]];
    v = Math.max(0, Math.min(100, v));
    if (v <= st[0][0]) return css("--b0");
    for (var i = 1; i < st.length; i++) {
      if (v <= st[i][0]) {
        var a = hexRgb(css("--b" + st[i - 1][1])), b = hexRgb(css("--b" + st[i][1])), t = (v - st[i - 1][0]) / (st[i][0] - st[i - 1][0]);
        return "rgb(" + a.map(function (x, j) { return Math.round(x + (b[j] - x) * t); }).join(",") + ")";
      }
    }
    return css("--b5");
  }

  // ---------- gauge geometry ----------
  var CX = 200, CY = 210, R = 146, RO = 176, RL = 198;
  function pt(v, r, cx, cy) { cx = cx == null ? CX : cx; cy = cy == null ? CY : cy; var a = Math.PI * (1 - v / 100); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; }
  function arc(a, b, r, cx, cy) { var p = pt(a, r, cx, cy), q = pt(b, r, cx, cy); return "M" + p[0].toFixed(1) + " " + p[1].toFixed(1) + " A" + r + " " + r + " 0 0 1 " + q[0].toFixed(1) + " " + q[1].toFixed(1); }
  (function buildGauge() {
    var cuts = [[0, 19.6], [20.4, 39.6], [40.4, 59.6], [60.4, 74.6], [75.4, 89.6], [90.4, 100]], h = "", hits = "";
    cuts.forEach(function (c, i) {
      h += '<path d="' + arc(c[0], c[1], RO) + '" fill="none" stroke="var(--b' + i + ')" stroke-width="8"/>';
      hits += '<path class="g-hit" tabindex="0" role="img" aria-label="' + BANDS[i].lo + " to " + BANDS[i].hi + ", " + BANDS[i].name + '" data-tipk="band-' + i + '" d="' + arc(CUTS[i] + 0.2, Math.min(100, CUTS[i + 1]) - 0.2, 161) + '" fill="none" stroke="transparent" stroke-width="58" pointer-events="stroke"/>';
    });
    $("g-bands").innerHTML = h;
    $("g-hits").innerHTML = hits;
    $("g-track").setAttribute("d", arc(0, 100, R));
    $("g-prog").setAttribute("d", arc(0, 100, R));
    var t = "";
    [20, 40, 60, 75, 90].forEach(function (v, i) { var p = pt(v, RL); t += '<text class="g-hit" data-tipk="band-' + (i + 1) + '" x="' + p[0].toFixed(1) + '" y="' + p[1].toFixed(1) + '" fill="var(--muted)" font-size="12" text-anchor="middle" dominant-baseline="middle" font-family="IBM Plex Mono, monospace">' + v + "</text>"; });
    $("g-ticks").innerHTML = t;
    // CBBI dial: 0 = bottom zone (green) .. 100 = top zone (grey)
    var cb = "", ccuts = [[0, 19.4], [20.6, 39.4], [40.6, 59.4], [60.6, 79.4], [80.6, 100]], cbCol = [5, 4, 2, 1, 0];
    ccuts.forEach(function (c, i) { cb += '<path d="' + arc(c[0], c[1], 106, 120, 122) + '" fill="none" stroke="var(--b' + cbCol[i] + ')" stroke-width="5"/>'; });
    $("cbbi-bands").innerHTML = cb;
    $("cbbi-track").setAttribute("d", arc(0, 100, 88, 120, 122));
    $("cbbi-arc").setAttribute("d", arc(0, 100, 88, 120, 122));
  })();

  // ---------- data ----------
  function loadData() {
    return fetch("data.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("data " + r.status); return r.json(); }).then(function (d) {
      if (!d || !Array.isArray(d.days) || !d.days.length) throw new Error("empty");
      d.days.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      S.data = d; S.latest = d.days[d.days.length - 1]; S.prev = d.days.length > 1 ? d.days[d.days.length - 2] : null;
      renderAll();
    }).catch(function () { if (!S.data) { $("hdr-sub").textContent = "Could not load the daily readings. Retrying…"; } });
  }
  function J(u) { return fetch(u, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  var FEEDS = [
    { n: "Bybit", f: function () { return J("https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT").then(function (j) { var t = j.result.list[0]; return { p: +t.lastPrice, chg: +t.price24hPcnt * 100, hi: +t.highPrice24h, lo: +t.lowPrice24h, pair: "BTC / USDT" }; }); } },
    { n: "Coinbase", f: function () { return J("https://api.exchange.coinbase.com/products/BTC-USD/stats").then(function (t) { return { p: +t.last, chg: (t.last / t.open - 1) * 100, hi: +t.high, lo: +t.low, pair: "BTC / USD" }; }); } },
    { n: "Kraken", f: function () { return J("https://api.kraken.com/0/public/Ticker?pair=XBTUSD").then(function (j) { var t = j.result[Object.keys(j.result)[0]]; return { p: +t.c[0], chg: null, hi: +t.h[1], lo: +t.l[1], pair: "BTC / USD" }; }); } },
    { n: "OKX", f: function () { return J("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT").then(function (j) { var t = j.data[0]; return { p: +t.last, chg: (t.last / t.open24h - 1) * 100, hi: +t.high24h, lo: +t.low24h, pair: "BTC / USDT" }; }); } }
  ];
  var feedIdx = 0;
  function fetchPrice() {
    var tries = 0;
    function attempt() {
      var feed = FEEDS[feedIdx];
      return feed.f().then(function (q) {
        if (!(q.p > 0)) throw new Error("bad");
        q.src = feed.n; S.live = q; S.liveAt = Date.now(); S.lastOk = Date.now();
        renderLive();
      }).catch(function () {
        tries++; feedIdx = (feedIdx + 1) % FEEDS.length;
        if (tries < FEEDS.length) return attempt();
        renderLiveAge();
      });
    }
    return attempt();
  }
  function fetchHourly() {
    return J("https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=60&limit=25").then(function (j) {
      S.hourly = j.result.list.map(function (k) { return +k[4]; }).reverse();
    }).catch(function () {
      return J("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600").then(function (a) { S.hourly = a.slice(0, 25).map(function (k) { return +k[4]; }).reverse(); });
    }).catch(function () {}).then(renderSpark);
  }
  function fetchDaily() {
    return J("https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=D&limit=1000").then(function (j) {
      var m = {}; j.result.list.forEach(function (k) { m[new Date(+k[0]).toISOString().slice(0, 10)] = +k[4]; }); S.daily = m;
    }).catch(function () {
      return J("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400").then(function (a) { var m = {}; a.forEach(function (k) { m[new Date(k[0] * 1000).toISOString().slice(0, 10)] = +k[4]; }); S.daily = m; });
    }).catch(function () {}).then(function () { if (S.latest) { renderHistory(); renderP2S(); } });
  }
  function fetchCbbi() {
    return J("https://colintalkscrypto.com/cbbi/data/latest.json").then(function (j) {
      var ts = Object.keys(j.Confidence).map(Number).sort(function (a, b) { return a - b; });
      var t = ts[ts.length - 1], comp = {};
      ["PiCycle", "RUPL", "RHODL", "Puell", "2YMA", "Trolololo", "MVRV", "ReserveRisk", "Woobull"].forEach(function (k) { if (j[k] && j[k][t] != null) comp[k] = +j[k][t]; });
      var t30 = ts.filter(function (x) { return x <= t - 30 * 86400; }).pop();
      S.cbbi = { v: +j.Confidence[t] * 100, asOf: new Date(t * 1000).toISOString().slice(0, 10), comp: comp, v30: t30 != null ? +j.Confidence[t30] * 100 : null };
      renderCbbi();
    }).catch(function () {
      if (!S.cbbi) { $("cbbi-comp").innerHTML = '<span class="sub">CBBI data not available right now.</span>'; }
    });
  }

  // ---------- render ----------
  function liveP() { return S.live && Date.now() - S.liveAt < 5 * 60e3 ? S.live.p : null; }
  function scoreAt(P) { return parts(S.latest, liveRaw(S.latest, P)).total; }

  function renderAll() {
    if (!S.latest) return;
    renderHeader(); renderLive(); renderSpark(); renderHistory(); renderSignals(); renderP2S(); renderConf();
  }
  function renderHeader() {
    var d = S.latest;
    $("hdr-sub").textContent = "Public view · indicators only · daily readings from " + fd(d.date) + (d.asOf ? ", " + d.asOf : "");
    var age = daysBetween(d.date, todayCbr());
    var dot = $("fresh-dot"), t = $("fresh-t");
    if (age <= 1) { dot.style.background = "var(--up)"; t.textContent = "Daily data up to date"; }
    else { dot.style.background = "var(--down)"; t.textContent = "Daily data " + age + " days old"; }
  }
  var shownScore = null;
  function animateNum(el, from, to) {
    if (from == null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = Math.round(to); return; }
    var t0 = performance.now(), dur = 700;
    function step(t) { var k = Math.min(1, (t - t0) / dur); k = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(from + (to - from) * k); if (k < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }
  function renderLive() {
    renderPriceBar();
    if (!S.latest) return;
    var d = S.latest, P = liveP();
    var daily = parts(d).total, liveS = P ? scoreAt(P) : daily, isLive = !!P;
    var v = Math.max(0, Math.min(100, liveS));
    $("g-prog").setAttribute("stroke-dashoffset", (100 - v).toFixed(2));
    $("g-prog").setAttribute("stroke", "var(--b" + Math.max(0, bandIdx(liveS)) + ")");
    $("g-live").style.transform = "rotate(" + (v * 1.8).toFixed(2) + "deg)";
    $("g-daily").style.transform = "rotate(" + (Math.max(0, Math.min(100, daily)) * 1.8).toFixed(2) + "deg)";
    animateNum($("g-num"), shownScore, liveS); shownScore = liveS;
    $("g-band").textContent = bandName(liveS) + (isLive ? " · live" : " · daily reading");
    $("g-svg").setAttribute("aria-label", "Live score " + Math.round(liveS) + " of 100, " + bandName(liveS) + ". Daily reading " + Math.round(daily) + ", " + bandName(daily) + ".");
    $("lg-live").textContent = isLive ? "Live " + Math.round(liveS) + " · price now" : "Live price not available";
    $("lg-daily").textContent = "Daily reading " + Math.round(daily) + " · " + bandName(daily);
    renderChips(liveS, daily, isLive);
    renderNext(liveS, P || d.price);
    renderMoved(P);
    renderTitle(liveS, P);
    renderSigLive(P);
    renderP2S();
  }
  function renderPriceBar() {
    var q = S.live; if (!q) return;
    $("p").textContent = usd(q.p);
    $("p-src").textContent = q.pair + " · " + q.src + " · live";
    var c = $("p-chg");
    if (q.chg != null && isFinite(q.chg)) {
      var up = q.chg >= 0;
      c.textContent = (up ? "▲ " : "▼ ") + Math.abs(q.chg).toFixed(1) + "% in 24h";
      c.style.color = up ? "var(--up)" : "var(--down)";
      c.style.background = "color-mix(in srgb, " + (up ? "var(--up)" : "var(--down)") + " 15%, transparent)";
    } else c.textContent = "";
    $("p-lo").textContent = "24h low " + usd(q.lo); $("p-hi").textContent = "high " + usd(q.hi);
    var dot = $("live-dot"); dot.classList.remove("beat"); void dot.offsetWidth; dot.classList.add("beat");
    renderLiveAge(); renderSpark();
  }
  function renderLiveAge() {
    var el = $("live"), t = $("live-t");
    if (!S.lastOk) { t.textContent = "Connecting to price feeds…"; return; }
    var s = Math.round((Date.now() - S.lastOk) / 1000), stale = s > 120;
    el.classList.toggle("stale", stale);
    t.textContent = (stale ? "Price feed lost · last " : "Live · updated ") + (s < 60 ? s + " s ago" : Math.round(s / 60) + " min ago");
  }
  function renderSpark() {
    var a = (S.hourly || []).slice(); if (S.live) a.push(S.live.p);
    if (a.length < 2) return;
    var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a), span = mx - mn || 1;
    var pts = a.map(function (v, i) { return (i / (a.length - 1) * 200).toFixed(1) + "," + (38 - (v - mn) / span * 36).toFixed(1); }).join(" ");
    var el = $("spark"); el.setAttribute("points", pts);
    el.setAttribute("stroke", a[a.length - 1] >= a[0] ? "var(--up)" : "var(--down)");
    $("spark-svg").setAttribute("aria-label", "Price over the last 24 hours, from " + usd(a[0]) + " to " + usd(a[a.length - 1]));
  }
  function docOnOrBefore(date) { var ds = S.data.days, best = null; for (var i = 0; i < ds.length; i++) if (ds[i].date <= date) best = ds[i]; return best; }
  function scoreOnOrBefore(date) {
    var d = docOnOrBefore(date);
    if (d && daysBetween(d.date, date) <= 3) return { s: parts(d).total, date: d.date };
    var w = S.data.weekly || [], best = null;
    for (var i = 0; i < w.length; i++) if (w[i][0] <= date) best = w[i];
    return best ? { s: best[1], date: best[0] } : null;
  }
  function chip(k, v, tk) { return '<span class="chip tip" tabindex="0" data-tipk="' + tk + '"><span class="k">' + esc(k) + '</span><span class="v" style="color:' + (v >= 0 ? "var(--up)" : "var(--down)") + '">' + sgn(v) + "</span></span>"; }
  function renderChips(liveS, daily, isLive) {
    var h = "", d = S.latest;
    if (isLive) h += chip("Live vs daily", Math.round(liveS) - Math.round(daily), "chip-live");
    if (S.prev) h += chip("Since " + fd(S.prev.date), Math.round(daily) - Math.round(parts(S.prev).total), "chip-prev");
    var w7 = scoreOnOrBefore(addDays(d.date, -7)); if (w7) h += chip("7 days", Math.round(daily) - Math.round(w7.s), "chip-7");
    var w30 = scoreOnOrBefore(addDays(d.date, -30)); if (w30) h += chip("30 days", Math.round(daily) - Math.round(w30.s), "chip-30");
    $("chips").innerHTML = h;
  }
  function findPrice(P0, target, dir) {
    for (var i = 1; i <= 240; i++) {
      var P = P0 * (1 + dir * i * 0.0025), s = scoreAt(P);
      if (dir < 0 && s >= target) return P;
      if (dir > 0 && s < target) return P;
    }
    return null;
  }
  function renderNext(liveS, P0) {
    var i = bandIdx(liveS), h = "";
    if (i < 5) {
      var target = CUTS[i + 1], P = findPrice(P0, target, -1);
      if (P) h += '<span><strong class="tip" tabindex="0" data-tipk="next" style="font-weight:650">Next band:</strong> ' + bandName(target) + " (" + target + ') at about <span class="mono" style="font-weight:600">' + usd(Math.round(P / 50) * 50) + '</span> <span class="muted">(' + Math.abs((P / P0 - 1) * 100).toFixed(1) + "% lower)</span></span>";
      else h += '<span><strong class="tip" tabindex="0" data-tipk="next" style="font-weight:650">Next band:</strong> ' + bandName(target) + " (" + target + ") needs more than a lower price. Loss-taking and leverage signals must rise too.</span>";
    } else h += '<span><strong style="font-weight:650">Top band:</strong> Capitulation.</span>';
    if (i > 0) {
      var lo = CUTS[i], Pu = findPrice(P0, lo, 1);
      if (Pu) h += '<span class="s">Back to ' + bandName(lo - 1) + " (below " + lo + ") above about " + usd(Math.round(Pu / 50) * 50) + ". Assumes the on-chain lines stay as they are today.</span>";
    }
    $("next").innerHTML = h;
  }
  function moveRows(pa, pb, sw) {
    var rows = IND.map(function (d) { var a = pa.p[d.k], b = pb.p[d.k]; return { k: d.k, n: d.name, v: (a == null || b == null) ? 0 : (b - a) * d.w / sw }; })
      .filter(function (r) { return Math.abs(r.v) >= 0.05; }).sort(function (x, y) { return Math.abs(y.v) - Math.abs(x.v); }).slice(0, 5);
    var mx = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.v); }).concat([0.5]));
    return rows.map(function (r) {
      var w = Math.abs(r.v) / mx * 100, col = r.v >= 0 ? "var(--accent)" : "var(--down)";
      return '<div class="mv-r"><span class="n"><span class="tip" tabindex="0" data-tipk="ind-' + r.k + '">' + esc(r.n) + '</span></span><span class="bar"><i style="width:' + w.toFixed(0) + "%;background:" + col + '"></i></span><span class="v">' + sgn(r.v, 1) + "</span></div>";
    }).join("") || '<div class="muted" style="font-size:14px">No change worth showing.</div>';
  }
  function mvHead(label, v) { return '<div class="mv-h"><span class="eyebrow">' + esc(label) + '</span><span class="mono" style="font-weight:600;color:' + (v >= 0 ? "var(--up)" : "var(--down)") + '">' + sgn(v) + "</span></div>"; }
  function renderMoved(P) {
    var d = S.latest, pd = parts(d);
    if (P) {
      var pl = parts(d, liveRaw(d, P));
      $("mv-live").innerHTML = mvHead("Live price vs daily reading", Math.round(pl.total) - Math.round(pd.total)) + moveRows(pd, pl, pl.sw);
      $("mv-live").style.display = "";
    } else $("mv-live").style.display = "none";
    if (S.prev) {
      var pp = parts(S.prev);
      $("mv-day").innerHTML = mvHead("Since " + fd(S.prev.date) + " (" + Math.round(pp.total) + " to " + Math.round(pd.total) + ")", Math.round(pd.total) - Math.round(pp.total)) + moveRows(pp, pd, pd.sw);
    } else $("mv-day").innerHTML = "";
  }
  var lastIcon = "";
  function renderTitle(s, P) {
    document.title = Math.round(s) + " " + bandName(s) + (P ? " · " + usd(P) : "") + " | BTC Bottom Monitor";
    var col = css("--b" + Math.max(0, bandIdx(s))), key = Math.round(s) + col;
    if (key === lastIcon) return; lastIcon = key;
    try {
      var c = document.createElement("canvas"); c.width = c.height = 64; var x = c.getContext("2d");
      x.fillStyle = col; x.beginPath(); x.arc(32, 32, 31, 0, Math.PI * 2); x.fill();
      x.fillStyle = txtOn(col); x.font = "bold 34px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(String(Math.round(s)), 32, 34);
      $("favicon").href = c.toDataURL("image/png");
    } catch (e) {}
  }

  // CBBI
  function cbbiZone(v) { return v < 20 ? "Bottom zone" : v < 40 ? "Low" : v < 60 ? "Middle" : v < 80 ? "High" : "Top zone"; }
  function cbbiColIdx(v) { return v < 20 ? 5 : v < 40 ? 4 : v < 60 ? 2 : v < 80 ? 1 : 0; }
  function renderCbbi() {
    var c = S.cbbi; if (!c) return;
    var v = Math.max(0, Math.min(100, c.v));
    $("cbbi-arc").setAttribute("stroke-dashoffset", (100 - v).toFixed(2));
    $("cbbi-arc").setAttribute("stroke", "var(--b" + cbbiColIdx(v) + ")");
    $("cbbi-num").textContent = Math.round(v);
    $("cbbi-zone").textContent = cbbiZone(v) + " · " + fd(c.asOf);
    $("cbbi-svg").setAttribute("aria-label", "CBBI " + Math.round(v) + " of 100, " + cbbiZone(v) + ", as of " + fd(c.asOf));
    var names = { PiCycle: "Pi Cycle", RUPL: "RUPL / NUPL", RHODL: "RHODL", Puell: "Puell", "2YMA": "2-year MA", Trolololo: "Log trend", MVRV: "MVRV Z", ReserveRisk: "Reserve risk", Woobull: "Woobull" };
    var h = Object.keys(c.comp).map(function (k) {
      var x = Math.max(0, Math.min(100, c.comp[k] * 100));
      return '<div class="cbbi-r"><span class="n"><span class="tip" tabindex="0" data-tipk="cb-' + k + '">' + esc(names[k] || k) + '</span></span><span class="bar"><i style="width:' + x.toFixed(0) + "%;background:var(--b" + cbbiColIdx(x) + ')"></i></span><span class="v">' + Math.round(x) + "</span></div>";
    }).join("");
    if (c.v30 != null) h += '<div class="sub" style="margin-top:2px">30 days ago: <b class="mono" style="color:var(--ink)">' + Math.round(c.v30) + "</b> (" + sgn(v - c.v30) + ")</div>";
    $("cbbi-comp").innerHTML = h;
  }

  // history
  function series() {
    var ds = S.data.days, first = ds[0].date, out = [];
    (S.data.weekly || []).forEach(function (w) { if (w[0] < first) out.push({ d: w[0], s: w[1], wk: true }); });
    ds.forEach(function (d) { var s = parts(d).total; if (s != null) out.push({ d: d.date, s: s }); });
    return out;
  }
  function niceStep(span) { var c = [1000, 2000, 5000, 10000, 20000, 25000, 50000]; for (var i = 0; i < c.length; i++) if (span / c[i] <= 5) return c[i]; return 100000; }
  function addMonths(s, n) { var y = +s.slice(0, 4), mo = +s.slice(5, 7) - 1 + n; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; return y + "-" + String(mo + 1).padStart(2, "0") + "-01"; }
  function renderHistory() {
    if (!S.latest) return;
    var box = $("hist"), W = Math.max(300, box.clientWidth || 800), H = W >= 900 ? 320 : W >= 600 ? 270 : 230;
    var ml = 34, mr = 60, mt = 12, mb = 26, iw = W - ml - mr, ih = H - mt - mb;
    var all = series(), today = todayCbr(), end = today > S.latest.date ? today : S.latest.date;
    var start = S.range ? addDays(end, -S.range) : all[0].d;
    var pts = all.filter(function (p) { return p.d >= start; });
    var t0 = dnum(start), t1 = dnum(end);
    function X(d) { return ml + (dnum(d) - t0) / (t1 - t0 || 1) * iw; }
    function Y(s) { return mt + (1 - s / 100) * ih; }
    var prices = [];
    if (S.daily) Object.keys(S.daily).sort().forEach(function (k) { if (k >= start && k <= end) prices.push([k, S.daily[k]]); });
    var pmin = 0, pmax = 1, step = 10000;
    if (prices.length > 1) {
      var vs = prices.map(function (p) { return p[1]; }); pmin = Math.min.apply(null, vs); pmax = Math.max.apply(null, vs);
      step = niceStep(pmax - pmin); pmin = Math.floor(pmin * 0.97 / step) * step; pmax = Math.ceil(pmax * 1.03 / step) * step;
    }
    function PY(p) { return mt + (1 - (p - pmin) / (pmax - pmin)) * ih; }
    var g = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Bottom score and BTC price over time">';
    [[90, 100, 5, .12], [75, 90, 4, .09], [60, 75, 3, .07]].forEach(function (z) { g += '<rect x="' + ml + '" y="' + Y(z[1]).toFixed(1) + '" width="' + iw + '" height="' + (Y(z[0]) - Y(z[1])).toFixed(1) + '" fill="var(--b' + z[2] + ')" opacity="' + z[3] + '"/>'; });
    [0, 40, 60, 75, 90, 100].forEach(function (s) { g += '<line x1="' + ml + '" x2="' + (ml + iw) + '" y1="' + Y(s).toFixed(1) + '" y2="' + Y(s).toFixed(1) + '" stroke="var(--line)" stroke-dasharray="' + (s === 0 ? "0" : "3 4") + '"/><text x="' + (ml - 6) + '" y="' + Y(s).toFixed(1) + '" text-anchor="end" dominant-baseline="middle">' + s + "</text>"; });
    if (prices.length > 1) {
      for (var p = pmin; p <= pmax + 1; p += step) g += '<text x="' + (ml + iw + 6) + '" y="' + PY(p).toFixed(1) + '" dominant-baseline="middle">$' + (p / 1000) + "k</text>";
      g += '<polyline fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 4" stroke-linejoin="round" points="' + prices.map(function (q) { return X(q[0]).toFixed(1) + "," + PY(q[1]).toFixed(1); }).join(" ") + '"/>';
    }
    var spanD = daysBetween(start, end), stepM = spanD > 400 ? 3 : spanD > 200 ? 2 : 1, lastX = -99;
    var m = start.slice(0, 7) + "-01"; if (m < start) m = addMonths(m, 1);
    while (m <= end) {
      var mi = +m.slice(5, 7) - 1;
      if (mi % stepM === 0) { var x = X(m); if (x - lastX > 44) { g += '<text x="' + x.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + MON[mi] + (mi === 0 || lastX < 0 ? " " + m.slice(2, 4) : "") + "</text>"; lastX = x; } }
      m = addMonths(m, 1);
    }
    if (pts.length > 1) g += '<polyline fill="none" stroke="var(--accent)" stroke-width="2.75" stroke-linejoin="round" stroke-linecap="round" points="' + pts.map(function (q) { return X(q.d).toFixed(1) + "," + Y(q.s).toFixed(1); }).join(" ") + '"/>';
    var P = liveP();
    if (P) { var ls = scoreAt(P); g += '<circle cx="' + X(end).toFixed(1) + '" cy="' + Y(ls).toFixed(1) + '" r="6" fill="var(--ink)" stroke="var(--surf)" stroke-width="3"/><text x="' + (X(end) - 10).toFixed(1) + '" y="' + (Y(ls) - 14).toFixed(1) + '" text-anchor="end" style="fill:var(--ink);font-weight:600">' + Math.round(ls) + " live</text>"; }
    g += '<line id="xh" x1="0" x2="0" y1="' + mt + '" y2="' + (mt + ih) + '" stroke="var(--muted)" stroke-dasharray="3 3" style="display:none"/><circle id="xd" r="5" fill="var(--accent)" stroke="var(--surf)" stroke-width="2" style="display:none"/></svg>';
    var tip = $("tip"); box.innerHTML = g; box.appendChild(tip);
    S.hgeo = { X: X, Y: Y, pts: pts, ml: ml, iw: iw, W: W };
  }
  function histPointer(e) {
    var G = S.hgeo; if (!G || !G.pts.length) return;
    var r = $("hist").getBoundingClientRect(), x = e.clientX - r.left;
    if (x < G.ml - 10 || x > G.ml + G.iw + 10) { hideHistTip(); return; }
    var best = null, bd = 1e9;
    G.pts.forEach(function (p) { var dx = Math.abs(G.X(p.d) - x); if (dx < bd) { bd = dx; best = p; } });
    if (!best) return;
    var px = G.X(best.d), py = G.Y(best.s), xh = document.getElementById("xh"), xd = document.getElementById("xd");
    xh.setAttribute("x1", px); xh.setAttribute("x2", px); xh.style.display = ""; xd.setAttribute("cx", px); xd.setAttribute("cy", py); xd.style.display = "";
    var price = S.daily ? S.daily[best.d] : null;
    if (!price && S.daily) { for (var i = 1; i < 4 && !price; i++) price = S.daily[addDays(best.d, i)] || S.daily[addDays(best.d, -i)]; }
    var tip = $("tip");
    tip.innerHTML = '<span class="muted">' + (best.wk ? "Week of " : "") + fdy(best.d) + "</span><span>Score <b class=\"mono\">" + Math.round(best.s) + "</b> · " + bandName(best.s) + "</span>" + (price ? '<span>BTC <b class="mono">' + usd(price) + "</b></span>" : "");
    tip.style.display = "flex";
    var tw = tip.offsetWidth, left = px + 12; if (left + tw > G.W) left = px - tw - 12;
    tip.style.left = Math.max(0, left) + "px"; tip.style.top = "8px";
  }
  function hideHistTip() { $("tip").style.display = "none"; var xh = document.getElementById("xh"), xd = document.getElementById("xd"); if (xh) xh.style.display = "none"; if (xd) xd.style.display = "none"; }

  // ---------- signals: heat / numbers / line ----------
  var VIEWS = ["heat", "num", "line"], VNAME = { heat: "heat map", num: "numbers", line: "line" };
  var VICON = {
    heat: '<svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><defs><linearGradient id="vg" x1="0" x2="1"><stop offset="0" stop-color="var(--b0)"/><stop offset=".5" stop-color="var(--b2)"/><stop offset="1" stop-color="var(--b4)"/></linearGradient></defs><rect x="0" y="2" width="16" height="8" rx="2" fill="url(#vg)"/></svg>',
    num: '<svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><rect x="0" y="2" width="4.5" height="8" rx="1" fill="currentColor" opacity=".5"/><rect x="5.75" y="2" width="4.5" height="8" rx="1" fill="currentColor" opacity=".75"/><rect x="11.5" y="2" width="4.5" height="8" rx="1" fill="currentColor"/></svg>',
    line: '<svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><polyline points="1,10 5,7 9,8 15,2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  S.sigAll = sget("bbm.sigview") || "heat"; if (VIEWS.indexOf(S.sigAll) < 0) S.sigAll = "heat";
  try { S.sigRows = JSON.parse(sget("bbm.sigrows") || "{}") || {}; } catch (e) { S.sigRows = {}; }
  function viewOf(k) { return S.sigRows[k] || S.sigAll; }
  function sigRowsData() {
    var d = S.latest, end = d.date, cols = [];
    for (var i = 13; i >= 0; i--) cols.push(addDays(end, -i));
    var byDate = {}; S.data.days.forEach(function (x) { byDate[x.date] = x; });
    var pc = cols.map(function (c) { return byDate[c] ? parts(byDate[c]) : null; });
    var rows = [{ k: "tot", name: "Bottom score", w: "", read: String(Math.round(parts(d).total)), vals: pc.map(function (p) { return p ? p.total : null; }), tot: true }];
    IND.forEach(function (ind) { rows.push({ k: ind.k, name: ind.name, w: String(ind.w), read: ind.read(d.raw || {}), vals: pc.map(function (p) { return p ? p.p[ind.k] : null; }) }); });
    return { cols: cols, rows: rows, miss: cols.filter(function (c) { return !byDate[c]; }) };
  }
  function fillGaps(vals) {
    var out = vals.slice();
    for (var i = 0; i < out.length; i++) {
      if (out[i] != null) continue;
      var a = i - 1; while (a >= 0 && vals[a] == null) a--;
      var b = i + 1; while (b < vals.length && vals[b] == null) b++;
      if (a >= 0 && b < vals.length) out[i] = vals[a] + (vals[b] - vals[a]) * (i - a) / (b - a);
      else if (a >= 0) out[i] = vals[a]; else if (b < vals.length) out[i] = vals[b];
    }
    return out;
  }
  function vizHtml(row, mode, live) {
    var all = row.vals.concat([live]), n = all.length;
    if (mode === "num") {
      return all.map(function (v, i) {
        var lv = i === n - 1 ? " lv" : "";
        if (v == null) return '<div class="c na' + lv + '"' + (lv ? ' data-live="' + row.k + '"' : "") + "></div>";
        var bg = bandCol(v); return '<div class="c' + lv + '"' + (lv ? ' data-live="' + row.k + '"' : "") + ' style="background:' + bg + ";color:" + txtOn(bg) + '">' + Math.round(v) + "</div>";
      }).join("");
    }
    var f = fillGaps(all);
    if (mode === "heat") {
      var stops = f.map(function (v, i) { return (v == null ? css("--surf2") : smoothCol(v)) + " " + ((i + 0.5) / n * 100).toFixed(2) + "%"; });
      var lvv = f[n - 1], lbg = lvv == null ? css("--surf2") : smoothCol(lvv);
      return '<div class="viz heat" data-k="' + row.k + '"><div class="grad" style="background:linear-gradient(to right,' + stops.join(",") + ')"></div><div class="lvmark" data-live="' + row.k + '" style="background:' + lbg + ";color:" + txtOn(lvv == null ? css("--surf2") : bandCol(lvv)) + '">' + (lvv == null ? "" : Math.round(lvv)) + "</div></div>";
    }
    // line: each row scaled to its own 14-day range so the shape is easy to read
    var idx = [], present = [];
    all.forEach(function (v, i) { if (v != null) { idx.push(i); present.push(v); } });
    if (!present.length) return '<div class="viz line" data-k="' + row.k + '"><span class="lval">—</span></div>';
    var mn = Math.min.apply(null, present), mx = Math.max.apply(null, present), pad = Math.max(3, (mx - mn) * 0.15);
    var lo = Math.max(0, mn - pad), hi = Math.min(100, mx + pad);
    if (hi - lo < 12) { var mid = (hi + lo) / 2; lo = Math.max(0, mid - 6); hi = Math.min(100, lo + 12); lo = Math.max(0, hi - 12); }
    function LY(v) { return 26 - (v - lo) / (hi - lo) * 22; }
    var xy = idx.map(function (i, j) { return [(i + 0.5) / n * 100, LY(present[j])]; });
    var line = xy.map(function (p) { return p[0].toFixed(2) + "," + p[1].toFixed(2); }).join(" ");
    var area = xy[0][0].toFixed(2) + ",30 " + line + " " + xy[xy.length - 1][0].toFixed(2) + ",30";
    var lastV = present[present.length - 1], lc = bandCol(lastV);
    var svg = '<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">';
    if (60 > lo && 60 < hi) svg += '<line x1="0" x2="100" y1="' + LY(60).toFixed(2) + '" y2="' + LY(60).toFixed(2) + '" stroke="var(--b3)" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>';
    svg += '<polygon points="' + area + '" fill="' + lc + '" opacity=".22"/>';
    svg += '<polyline points="' + line + '" fill="none" stroke="' + lc + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
    var lastI = idx[idx.length - 1];
    var dot = '<span class="ldot" data-live="' + row.k + '" style="left:' + ((lastI + 0.5) / n * 100).toFixed(2) + "%;top:" + (LY(lastV) / 30 * 100).toFixed(1) + "%;background:" + lc + '"></span>';
    return '<div class="viz line" data-k="' + row.k + '" data-lo="' + Math.round(lo) + '" data-hi="' + Math.round(hi) + '">' + svg + dot + '<span class="lval">' + Math.round(lastV) + "</span></div>";
  }
  function liveVals(P) {
    var d = S.latest, pl = parts(d, P ? liveRaw(d, P) : null), o = { tot: pl.total };
    IND.forEach(function (ind) { o[ind.k] = pl.p[ind.k]; });
    return o;
  }
  function renderSignals() {
    if (!S.latest) return;
    var D = sigRowsData(), lv = liveVals(liveP()), end = S.latest.date;
    S.sigD = D;
    var h = '<div class="h l">Signal · ' + MON[+end.slice(5, 7) - 1] + '</div><div class="h">wt</div><div class="h" style="text-align:right">reading</div>';
    D.cols.forEach(function (c, i) { h += '<div class="h' + (i === 13 ? " now" : "") + '">' + (+c.slice(8, 10)) + "</div>"; });
    h += '<div class="h now">Live</div>';
    D.rows.forEach(function (row, ri) {
      var mode = viewOf(row.k), ovr = !!S.sigRows[row.k];
      var nx = VIEWS[(VIEWS.indexOf(mode) + 1) % 3];
      h += '<div class="nm' + (row.tot ? " tot" : "") + '"><span class="t"><span class="tip" tabindex="0" data-tipk="' + (row.tot ? "score" : "ind-" + row.k) + '">' + esc(row.name) + '</span></span><button type="button" class="vbtn' + (ovr ? " ovr" : "") + '" data-row="' + row.k + '" data-nocap aria-label="' + esc(row.name) + ": showing " + VNAME[mode] + ". Change to " + VNAME[nx] + '" title="Showing ' + VNAME[mode] + ". Click for " + VNAME[nx] + '">' + VICON[mode] + "</button></div>";
      h += '<div class="w">' + esc(row.w) + '</div><div class="rd"' + (row.tot ? ' style="font-weight:700"' : "") + ">" + esc(row.read) + "</div>";
      h += vizHtml(row, mode, lv[row.k]);
      if (row.tot) h += '<div class="sep"></div>';
    });
    $("sig").innerHTML = h;
    Array.prototype.forEach.call(document.querySelectorAll("#sig-all button"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-v") === S.sigAll ? "true" : "false"); });
    $("sig-note").textContent = (D.miss.length ? "No reading on " + D.miss.map(fd).join(", ") + ": the heat map and line blend across the gap. " : "") + "Live column: price-based signals worked out again at the live price.";
    $("bands").innerHTML = ["0–19 Very weak", "20–39 Weak", "40–59 Building", "60–74 Strong", "75–89 Very strong", "90+ Capitulation"].map(function (n, i) { return '<span class="tip" tabindex="0" data-tipk="band-' + i + '"><span class="sw" style="background:var(--b' + i + ')"></span>' + n + "</span>"; }).join("");
    var sc = document.querySelector(".sig-scroll"); if (sc && window.innerWidth < 700) sc.scrollLeft = sc.scrollWidth;
  }
  function renderSigLive(P) {
    if (!S.sigD) return;
    var lv = liveVals(P);
    S.sigD.rows.forEach(function (row) {
      var mode = viewOf(row.k);
      if (mode === "num") {
        var el = document.querySelector('#sig [data-live="' + row.k + '"]'); if (!el) return;
        var v = lv[row.k]; if (v == null) { el.textContent = ""; return; }
        var bg = bandCol(v); el.className = "c lv"; el.style.background = bg; el.style.color = txtOn(bg); el.textContent = Math.round(v);
      } else {
        var box = document.querySelector('#sig .viz[data-k="' + row.k + '"]'); if (!box) return;
        var tmp = document.createElement("div"); tmp.innerHTML = vizHtml(row, mode, lv[row.k]);
        box.replaceWith(tmp.firstChild);
      }
    });
  }
  $("sig").addEventListener("click", function (e) {
    var b = e.target.closest(".vbtn"); if (!b) return;
    var k = b.getAttribute("data-row"), cur = viewOf(k), nx = VIEWS[(VIEWS.indexOf(cur) + 1) % 3];
    if (nx === S.sigAll) delete S.sigRows[k]; else S.sigRows[k] = nx;
    sset("bbm.sigrows", JSON.stringify(S.sigRows));
    renderSignals();
    var nb = document.querySelector('#sig .vbtn[data-row="' + k + '"]'); if (nb) nb.focus();
  });
  $("sig").addEventListener("mousemove", function (e) {
    var v = e.target.closest && e.target.closest(".viz"); if (!v || !S.sigD) return;
    var r = v.getBoundingClientRect(), i = Math.min(14, Math.max(0, Math.floor((e.clientX - r.left) / r.width * 15)));
    var row = S.sigD.rows.filter(function (x) { return x.k === v.getAttribute("data-k"); })[0]; if (!row) return;
    var val = i === 14 ? liveVals(liveP())[row.k] : row.vals[i];
    v.setAttribute("data-tip", "<span class='tt-h'>" + esc(row.name) + "</span>" + (i === 14 ? "Live" : fd(S.sigD.cols[i])) + ": <b>" + (val == null ? "no reading" : Math.round(val) + " · " + bandName(val)) + "</b>" + (v.getAttribute("data-lo") ? "<span class='tt-m'>Line scaled to this signal's 14-day range: " + v.getAttribute("data-lo") + "–" + v.getAttribute("data-hi") + ".</span>" : ""));
    showTip(v);
  });
  $("sig-all").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    S.sigAll = b.getAttribute("data-v"); S.sigRows = {};
    sset("bbm.sigview", S.sigAll); sset("bbm.sigrows", "{}");
    renderSignals();
  });

  // ---------- price to score, with chances ----------
  // Chance that BTC trades at a price at least once in the window. Two models, averaged:
  // 1) volatility model: driftless random walk with BTC's own realised volatility (barrier-touch formula);
  // 2) cycle model: days in the 2014-15, 2018 and 2022 bears (peak to 180 days after the low) when MVRV was within 0.06 of today's.
  var CYC = [["2013-12-04", "2015-01-14", "2014–15"], ["2017-12-17", "2018-12-15", "2018"], ["2021-11-10", "2022-11-21", "2022"]];
  var OFFS = [-30, -20, -15, -10, -5, 0, 5, 10];
  S.win = +(sget("bbm.win") || 30); if (S.win !== 30 && S.win !== 90) S.win = 30;
  function fetchCM() {
    var url = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=PriceUSD,CapMVRVCur&frequency=1d&start_time=2013-06-01&page_size=10000", rows = [];
    function step(u) {
      return J(u).then(function (j) { rows = rows.concat(j.data || []); return j.next_page_url ? step(j.next_page_url) : null; });
    }
    return step(url).then(function () {
      S.cm = rows.filter(function (x) { return x.PriceUSD && x.CapMVRVCur; }).map(function (x) { return [x.time.slice(0, 10), +x.PriceUSD, +x.CapMVRVCur]; });
      S.cmIdx = {}; S.cm.forEach(function (x, i) { S.cmIdx[x[0]] = i; });
      S.cycCache = {};
      renderP2S();
    }).catch(function () { S.cm = S.cm || null; renderP2S(); });
  }
  function normCdf(x) { var t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
  function volSigma() {
    var c = [];
    if (S.daily) c = Object.keys(S.daily).sort().map(function (k) { return S.daily[k]; });
    else if (S.cm) c = S.cm.slice(-400).map(function (x) { return x[1]; });
    if (c.length < 40) return null;
    var lr = []; for (var i = 1; i < c.length; i++) lr.push(Math.log(c[i] / c[i - 1]));
    function v(n) { var a = lr.slice(-n); if (a.length < 20) return null; var m = a.reduce(function (x, y) { return x + y; }, 0) / a.length; return Math.sqrt(a.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / (a.length - 1)) * Math.sqrt(365); }
    var s = [v(30), v(90), v(365)].filter(function (x) { return x != null; });
    return s.reduce(function (x, y) { return x + y; }, 0) / s.length;
  }
  function volProb(o, W, sig) {
    if (o === 0 || !sig) return null;
    var k = Math.log(1 + o / 100), sv = sig * Math.sqrt(W / 365);
    return Math.max(0, Math.min(100, (o < 0 ? 2 * normCdf(k / sv) : 2 * (1 - normCdf(k / sv))) * 100));
  }
  function cycleModel(m, W) {
    if (!S.cm || m == null) return null;
    var key = m.toFixed(2) + "|" + W;
    if (S.cycCache[key]) return S.cycCache[key];
    var r = S.cm, per = [];
    CYC.forEach(function (c) {
      var a = S.cmIdx[c[0]], lo = S.cmIdx[c[1]];
      if (a == null || lo == null) return;
      var b = Math.min(r.length - 1 - W, lo + 180), days = [];
      for (var i = a; i <= b; i++) if (Math.abs(r[i][2] - m) <= 0.06) {
        var mn = Infinity, mx = -Infinity;
        for (var j = i + 1; j <= i + W; j++) { if (r[j][1] < mn) mn = r[j][1]; if (r[j][1] > mx) mx = r[j][1]; }
        days.push([mn / r[i][1], mx / r[i][1]]);
      }
      per.push({ name: c[2], days: days });
    });
    var tot = per.reduce(function (x, c) { return x + c.days.length; }, 0);
    var res = { per: per, n: tot, ok: tot >= 10 && per.filter(function (c) { return c.days.length >= 3; }).length >= 2 };
    res.prob = function (o) {
      if (!res.ok || o === 0) return null;
      var sw = 0, sp = 0, L = 1 + o / 100;
      per.forEach(function (c) {
        if (!c.days.length) return;
        var hit = c.days.filter(function (d) { return o < 0 ? d[0] <= L : d[1] >= L; }).length, w = Math.min(c.days.length, 30);
        sw += w; sp += w * hit / c.days.length;
      });
      return sw ? sp / sw * 100 : null;
    };
    S.cycCache[key] = res;
    return res;
  }
  var PHIA = [[7.5, "Remote chance"], [22.5, "Highly unlikely"], [37.5, "Unlikely"], [52.5, "Realistic possibility"], [77.5, "Likely"], [92.5, "Highly likely"], [101, "Almost certain"]];
  function phia(p) { for (var i = 0; i < PHIA.length; i++) if (p < PHIA[i][0]) return PHIA[i][1]; return PHIA[PHIA.length - 1][1]; }
  var CL = ["Low", "Medium", "High"];
  function clTag(c) { return '<span class="cf cf' + c + '">' + (c === 1 ? '<span class="hs">Medium</span><span class="ss">Med</span>' : CL[c]) + "</span>"; }
  function scoreConf(o) { var a = Math.abs(o); return a <= 5 ? 2 : a <= 15 ? 1 : 0; }
  function chanceConf(o, pv, pc, stale) {
    var a = Math.abs(o), c;
    if (pc == null) c = a <= 10 ? 1 : 0;
    else { var gap = Math.abs(pv - pc); c = gap <= 15 && a <= 10 ? 2 : gap <= 25 && a <= 20 ? 1 : 0; }
    if (stale && c > 0) c--;
    return c;
  }
  function renderP2S() {
    if (!S.latest) return;
    var P0 = liveP() || S.latest.price, W = S.win, sig = volSigma();
    var m = S.latest.ref && S.latest.ref.realizedPrice ? P0 / S.latest.ref.realizedPrice : (S.latest.raw || {}).mvrv;
    var cyc = cycleModel(m, W), stale = daysBetween(S.latest.date, todayCbr()) > 2;
    $("p2s-head").innerHTML = '<tr><th>BTC price</th><th class="r hs">Change</th><th class="r"><span class="tip" tabindex="0" data-tipk="p2s-score">Score</span></th><th class="hs">Band</th><th><span class="tip" tabindex="0" data-tipk="p2s-chance">Chance in ' + W + ' days</span></th><th><span class="tip" tabindex="0" data-tipk="p2s-conf"><span class="hs">Confidence</span><span class="ss">Conf.</span></span></th></tr>';
    var h = "";
    OFFS.forEach(function (o) {
      var P = P0 * (1 + o / 100), s = scoreAt(P);
      var pv = volProb(o, W, sig), pc = cyc ? cyc.prob(o) : null;
      var p = pv == null ? null : pc == null ? pv : (pv + pc) / 2;
      var cc = o === 0 ? null : chanceConf(o, pv, pc, stale), sc = scoreConf(o), conf = cc == null ? sc : Math.min(sc, cc);
      var tipTxt = o === 0 ? "" : "<span class='tt-h'>" + (o < 0 ? "Trades at or below " : "Trades at or above ") + usd(P) + " within " + W + " days</span>" +
        "Volatility model: <b>" + (pv == null ? "n/a" : Math.round(pv) + "%") + "</b><br>Cycle model: <b>" + (pc == null ? "n/a" : Math.round(pc) + "%") + "</b><br>Blend: <b>" + (p == null ? "n/a" : Math.round(p) + "% · " + phia(p)) + "</b>" +
        "<span class='tt-m'>Score confidence: " + CL[sc] + " (" + Math.abs(o) + "% from today's price). Chance confidence: " + CL[cc] + (pv != null && pc != null ? " (models " + Math.round(Math.abs(pv - pc)) + " points apart)" : "") + (stale ? "; daily data out of date" : "") + ". The table shows the lower of the two.</span>";
      h += '<tr class="' + (o === 0 ? "now" : "") + '"><td class="mono">' + usd(P) + '<span class="ss muted"> ' + (o === 0 ? "now" : (o > 0 ? "+" : "−") + Math.abs(o) + "%") + '</span></td><td class="r mono hs">' + (o === 0 ? "now" : (o > 0 ? "+" : "−") + Math.abs(o) + "%") + '</td><td class="r mono"><span class="ss sw" style="background:' + bandCol(s) + ';width:10px;height:10px;margin-right:6px"></span>' + Math.round(s) + '</td><td class="hs"><span style="display:inline-flex;align-items:center;gap:7px"><span class="sw" style="background:' + bandCol(s) + '"></span>' + bandName(s) + "</span></td>" +
        (o === 0 ? '<td class="muted">today’s price</td><td>' + clTag(sc) + "</td>" :
          '<td><span class="tip ch" tabindex="0" data-tip="' + tipTxt.replace(/"/g, "&quot;") + '">' + (p == null ? "—" : phia(p) + ' <span class="mono muted">' + Math.round(p) + "%</span>") + '</span></td><td>' + clTag(conf) + "</td>") + "</tr>";
    });
    $("p2s").innerHTML = h;
    // explainer
    var cn = cyc ? cyc.per.map(function (c) { return c.name + ": " + c.days.length + " days"; }).join(", ") : "";
    var x = '<details class="p2s-x" open><summary>How we got these numbers</summary>' +
      "<p><b>Score.</b> At each price, the nine price-linked signals are worked out again. The other seven stay at today's values. When price falls, loss-taking, fear and leverage signals usually rise too, so the real score is likely to be <b>higher</b> than shown. Confidence: <b>High</b> within ±5% of today's price, <b>Medium</b> to ±15%, <b>Low</b> beyond.</p>" +
      "<p><b>Chance.</b> The chance that BTC trades at that price at least once in the next " + W + " days (a touch, as a limit order would fill). It is the average of two models:</p><ul>" +
      "<li><b>Volatility model</b>: BTC's own recent swings (" + (sig ? Math.round(sig * 100) + "% a year, the average of its 30-, 90- and 365-day volatility" : "not available") + "), with no trend up or down. It treats big crashes as rare, so it can understate deep falls.</li>" +
      "<li><b>Cycle model</b>: every day in the 2014–15, 2018 and 2022 bear markets (top to 180 days after the low) when MVRV was close to today's (" + (m ? m.toFixed(2) : "—") + " ± 0.06). It counts how often price touched each level within " + W + " days. " + (cyc && cyc.ok ? "Matching days: " + cn + "." : "Not enough matching days right now, so only the volatility model is used.") + "</li></ul>" +
      "<p><b>Words.</b> We use the UK intelligence probability yardstick: Remote chance (under 5%), Highly unlikely (10–20%), Unlikely (25–35%), Realistic possibility (40–50%), Likely (55–75%), Highly likely (80–90%), Almost certain (over 95%). Values in the gaps go to the nearer word.</p>" +
      "<p><b>Confidence.</b> For the chance: <b>High</b> when the two models agree within 15 points and the level is within 10% of today's price; <b>Medium</b> when they agree within 25 points and the level is within 20%; <b>Low</b> otherwise. One step lower when the daily data is more than two days old. The table shows the lower of the score and chance confidence. Hover a chance for both model results.</p>" +
      "<p class='muted'>Only three past cycles to learn from. These are estimates, not forecasts of what will happen. Not financial advice.</p></details>";
    var px = $("p2s-x"), od = px.querySelector("details");
    if (S.p2sX !== x) { S.p2sX = x; px.innerHTML = od && !od.open ? x.replace("<details class=\"p2s-x\" open>", "<details class=\"p2s-x\">") : x; }
    Array.prototype.forEach.call(document.querySelectorAll("#win button"), function (b) { b.setAttribute("aria-pressed", +b.getAttribute("data-w") === W ? "true" : "false"); });
  }
  TIPS["p2s-score"] = "<span class='tt-h'>Projected score</span>The bottom score at that price if the on-chain lines stay as they are today. Likely too low for falls, because loss-taking and fear usually rise as price falls.";
  TIPS["p2s-chance"] = "<span class='tt-h'>Chance</span>The chance that BTC trades at that price at least once in the window, in UK intelligence yardstick words. Average of a volatility model and a cycle model. Hover a row for both results.";
  TIPS["p2s-conf"] = "<span class='tt-h'>Confidence</span>The lower of the score confidence and the chance confidence. See 'How we got these numbers' below the table.";
  function renderConf() {
    var c = S.latest.confirm || {}, n = 0, t = 0, h = "";
    CONF.forEach(function (k) {
      var s = k.score(c); if (s != null) { n++; t += s; }
      h += '<div class="conf-r"><span><span class="tip" tabindex="0" data-tipk="conf-' + k.k + '">' + esc(k.name) + '</span></span><span class="mono">' + esc(k.read(c)) + '</span><span class="bar"><i style="width:' + (s == null ? 0 : s).toFixed(0) + "%;background:" + bandCol(s) + '"></i></span><span class="mono" style="text-align:right">' + (s == null ? "—" : Math.round(s)) + "</span></div>";
    });
    $("conf").innerHTML = h; $("conf-v").textContent = n ? Math.round(t / n) + " / 100" : "—";
  }

  // ---------- controls ----------
  var qs = new URLSearchParams(location.search);
  S.skinSel = qs.get("skin") || sget("bbm.skin") || "midnight";
  S.cb = (qs.get("cb") || sget("bbm.cb")) === "1";
  $("skin").value = S.skinSel; if ($("skin").value !== S.skinSel) { S.skinSel = "midnight"; $("skin").value = "midnight"; }
  $("skin").addEventListener("change", function () { S.skinSel = this.value; sset("bbm.skin", S.skinSel); applySkin(); });
  $("cb").addEventListener("click", function () { S.cb = !S.cb; sset("bbm.cb", S.cb ? "1" : "0"); applySkin(); });
  if (mq && mq.addEventListener) mq.addEventListener("change", function () { if (S.skinSel === "auto") applySkin(); });
  $("ranges").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    S.range = +b.getAttribute("data-r");
    Array.prototype.forEach.call(this.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
    renderHistory();
  });
  $("win").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    S.win = +b.getAttribute("data-w"); sset("bbm.win", String(S.win)); renderP2S();
  });
  $("hist").addEventListener("pointermove", histPointer);
  $("hist").addEventListener("pointerdown", histPointer);
  $("hist").addEventListener("pointerleave", hideHistTip);
  function enterKiosk() {
    document.body.classList.add("kiosk");
    var el = document.documentElement; try { if (el.requestFullscreen) el.requestFullscreen().catch(function () {}); else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen(); } catch (e) {}
    setTimeout(renderHistory, 300);
  }
  function exitKiosk() {
    document.body.classList.remove("kiosk");
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (e) {}
    setTimeout(renderHistory, 300);
  }
  $("kiosk").addEventListener("click", enterKiosk);
  $("exit-kiosk").addEventListener("click", exitKiosk);
  document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement && document.body.classList.contains("kiosk")) { document.body.classList.remove("kiosk"); setTimeout(renderHistory, 300); } });
  if (qs.get("kiosk") === "1") document.body.classList.add("kiosk");
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  $("save").addEventListener("click", function () {
    var t = $("save-t"); t.textContent = "Saving…";
    var p = window.htmlToImage ? Promise.resolve() : loadScript("https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js");
    p.then(function () {
      var opts = { pixelRatio: 2, backgroundColor: css("--bg"), filter: function (n) { return !(n.hasAttribute && n.hasAttribute("data-nocap")); } };
      return window.htmlToImage.toPng($("cap"), opts).catch(function () { opts.skipFonts = true; return window.htmlToImage.toPng($("cap"), opts); });
    }).then(function (url) {
      var a = document.createElement("a"); a.href = url; a.download = "btc-bottom-monitor-" + todayCbr() + ".png"; document.body.appendChild(a); a.click(); a.remove();
      t.textContent = "Saved";
    }).catch(function () { t.textContent = "Save failed: use a screenshot"; }).then(function () { setTimeout(function () { t.textContent = "Save image"; }, 2500); });
  });
  var rz; window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(renderHistory, 150); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { fetchPrice(); if (Date.now() - (S.dataAt || 0) > 5 * 60e3) { S.dataAt = Date.now(); loadData(); } } });

  // ---------- start ----------
  applySkin();
  S.dataAt = Date.now();
  loadData().then(function () { fetchPrice(); fetchHourly(); fetchDaily(); });
  fetchCbbi();
  fetchCM();
  setInterval(function () { if (!document.hidden) fetchPrice(); }, 15000);
  setInterval(renderLiveAge, 1000);
  setInterval(function () { if (!document.hidden) { fetchHourly(); if (S.latest) renderHistory(); } }, 5 * 60e3);
  setInterval(function () { S.dataAt = Date.now(); loadData(); }, 10 * 60e3);
  setInterval(fetchDaily, 60 * 60e3);
  setInterval(fetchCbbi, 6 * 60 * 60e3);
  setInterval(fetchCM, 6 * 60 * 60e3);
})();
