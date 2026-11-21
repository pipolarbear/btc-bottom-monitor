/* BTC Bottom Monitor v3 */
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
  // Value score: "Is BTC cheap?". Each signal scores 0-100 on a straight line from z (no signal) to f (full score = the level seen at past lows).
  // Small-cycle levels: for six signals whose reading at the low got less extreme at each of the 2015, 2018 and 2022 lows,
  // the full-score level moves by the per-cycle trend (fitted on those three lows). 2022-cycle levels = classic levels.
  // LV[k] = [z, f (classic), per-cycle shift]
  var LV = { mvrv: [1.5, 0.8, 0.0952], lth: [1.6, 0.8, 0.0827], balanced: [2.0, 1.0, 0.1197], mayer: [1.0, 0.6, 0.1249], addrLoss: [0.20, 0.55, -0.0591], sth: [1.1, 0.75, 0.1289] };
  var HALV = ["2012-11-28", "2016-07-09", "2020-05-11", "2024-04-20"];
  function epochOf(d) { var e = 0; for (var i = 0; i < HALV.length; i++) if (!d || d >= HALV[i]) e++; return e; }
  function fAt(k, date, mode) {
    var x = LV[k]; if (!x) return null;
    if ((mode || S.lv) !== "adj") return x[1];
    var sh = x[2] * (epochOf(date) - 3), cap = 0.5 * Math.abs(x[0] - x[1]);
    return x[1] + Math.max(-cap, Math.min(cap, sh));
  }
  function L2(r, k, date, mode) { return lin(r[k], LV[k][0], fAt(k, date, mode)); }
  function fmtLv(k, v) { return k === "addrLoss" ? Math.round(v * 100) + "%" : v.toFixed(2) + (k === "mvrv" || k === "mayer" ? "" : "×"); }
  // hits = past lows (2015, 2018, 2022) where the signal scored 70+ within 90 days; prec = share of its firing days within 30% of a two-year low (a random day: 6%); up = share of firing days with BTC higher one year later. Classic levels.
  var IND = [
    { k: "cvdd", w: 12, name: "Price vs CVDD", hits: "3 of 3", prec: 99, up: 100, full: "1.00×", what: "Price divided by CVDD, a floor price built from coin-days destroyed (how long coins sat before they moved).", why: "Price has touched this floor at every cycle low and rarely anywhere else.",
      score: function (r) { return lin(r.cvdd, 1.6, 1.0); }, read: function (r) { return f2(r.cvdd) + "×"; } },
    { k: "mvrv", w: 11, name: "MVRV", lv: "mvrv", hits: "3 of 3", prec: 47, up: 99, full: "0.80", what: "Market value divided by realized value: price against the average price at which all coins last moved.", why: "Below 1, the average holder is at a loss. Deep readings have only come near cycle lows.",
      score: function (r, d, m) { return L2(r, "mvrv", d, m); }, read: function (r) { return f2(r.mvrv); } },
    { k: "lth", w: 9, name: "Long-term holder cost", lv: "lth", hits: "3 of 3", prec: 47, up: 100, full: "0.80×", what: "Price divided by the average cost of coins held more than 155 days.", why: "When even patient holders are under water, the sellers who are left are few.",
      score: function (r, d, m) { return L2(r, "lth", d, m); }, read: function (r) { return f2(r.lth) + "×"; } },
    { k: "sopr", w: 8, name: "SOPR, 7-day (loss-taking)", hits: "2 of 2", prec: 51, up: 86, full: "−0.020", what: "Spent Output Profit Ratio minus 1, as a 7-day average: profit or loss on coins that moved.", why: "Below zero, holders sell at a loss. Deep, lasting loss-taking is what capitulation looks like.",
      score: function (r) { return lin(r.sopr7d, 0.01, -0.02); }, read: function (r) { return r.sopr7d == null ? "—" : (r.sopr7d >= 0 ? "+" : "−") + Math.abs(r.sopr7d).toFixed(3); } },
    { k: "w200", w: 8, name: "200-week average", hits: "2 of 3", prec: 49, up: 100, full: "0.85×", what: "Price divided by the 200-week moving average, the long-run trend line.", why: "Price has rarely stayed below this line for long. Time below it has been among the best times to buy.",
      score: function (r) { return lin(r.w200, 1.3, 0.85); }, read: function (r) { return f2(r.w200) + "×"; } },
    { k: "loss", w: 7, name: "Addresses in loss", lv: "addrLoss", hits: "3 of 3", prec: 31, up: 91, full: "55%", what: "Share of addresses that hold coins worth less than they paid.", why: "Shows how wide the pain is. Lows came when about half of all addresses were at a loss.",
      score: function (r, d, m) { return L2(r, "addrLoss", d, m); }, read: function (r) { return r.addrLoss == null ? "—" : (r.addrLoss * 100).toFixed(1) + "%"; } },
    { k: "bal", w: 6, name: "Balanced price", lv: "balanced", hits: "3 of 3", prec: 52, up: 99, full: "1.00×", what: "Price divided by the balanced price, a fair-value line made from realized price minus transfer price.", why: "Price has met this line at the deepest point of past bears.",
      score: function (r, d, m) { return L2(r, "balanced", d, m); }, read: function (r) { return f2(r.balanced) + "×"; } },
    { k: "lev", w: 6, name: "Leverage flush", hits: "no data", prec: null, up: null, full: "funding −5%/yr, OI −30%", what: "Futures funding rate (7-day) and how far open interest is below its 90-day high.", why: "Negative funding and a big fall in open interest show forced sellers are gone.",
      score: function (r) { var a = lin(r.funding7d, 10, -5), b = lin(r.oiDrawdown, 0, 30); if (a == null && b == null) return null; return ((a == null ? b : a) + (b == null ? a : b)) / 2; }, read: function (r) { return r.oiDrawdown == null ? "—" : "OI −" + r.oiDrawdown.toFixed(1) + "%"; } },
    { k: "pi", w: 6, name: "Pi Cycle bottom", hits: "3 of 3", prec: 42, up: 100, full: "0.95", what: "The 150-day exponential average against 0.745 × the 471-day average.", why: "A cross below has lined up with past lows within weeks.",
      score: function (r) { return lin(r.pi, 1.3, 0.95); }, read: function (r) { return f2(r.pi); } },
    { k: "time", w: 6, name: "Time since peak", hits: "3 of 3", prec: 36, up: 96, full: "365–420 days", what: "Days since the cycle's all-time high.", why: "Past lows came 364–406 days after the top. It is the only signal that does not use price.",
      score: function (r) { var d = r.daysSincePeak; if (d == null) return null; return d < 240 ? 0 : d < 365 ? (d - 240) / 125 * 100 : d <= 420 ? 100 : d < 600 ? 100 - (d - 420) / 180 * 70 : 30; }, read: function (r) { return r.daysSincePeak == null ? "—" : r.daysSincePeak + " d"; } },
    { k: "puell", w: 5, name: "Puell multiple", hits: "3 of 3", prec: 39, up: 91, full: "0.45", what: "Daily miner income against its 1-year average.", why: "Low values put miners under stress. When weak miners have sold, a big source of supply is gone.",
      score: function (r) { return lin(r.puell, 1.0, 0.45); }, read: function (r) { return f2(r.puell); } },
    { k: "sth", w: 5, name: "Short-term holder cost", lv: "sth", hits: "3 of 3", prec: 21, up: 56, full: "0.75×", what: "Price divided by the average cost of coins moved in the last 155 days.", why: "Below 1, recent buyers are under water. It also fires in normal corrections, so its weight is low.",
      score: function (r, d, m) { return L2(r, "sth", d, m); }, read: function (r) { return f2(r.sth) + "×"; } },
    { k: "fg", w: 3, name: "Fear & Greed, 7-day", hits: "2 of 2", prec: 19, up: 61, full: "10", what: "The Crypto Fear & Greed Index, 7-day average.", why: "Extreme fear comes at lows, but also in many corrections, so its weight is low.",
      score: function (r) { return lin(r.fg7d, 50, 10); }, read: function (r) { return r.fg7d == null ? "—" : r.fg7d.toFixed(0); } },
    { k: "hash", w: 3, name: "Hash ribbons", hits: "3 of 3", prec: 14, up: 86, full: "0–30 days after a recovery", what: "30-day against 60-day average hash rate. A recovery after miner capitulation is the buy signal.", why: "Recoveries came after past lows, but also many other times, so its weight is low.",
      score: function (r, date) { if (r.hashCapitulating === true) return 50; if (!r.hashLastRecovery) return r.hashCapitulating === false ? 0 : null; var d = daysBetween(r.hashLastRecovery, date); return d <= 30 ? 100 : d <= 60 ? 100 - (d - 30) / 30 * 100 : 0; }, read: function (r) { return r.hashCapitulating ? "capitulating" : (r.hashLastRecovery ? "rec. " + fd(r.hashLastRecovery) : "—"); } },
    { k: "mayer", w: 3, name: "Mayer multiple", lv: "mayer", hits: "3 of 3", prec: 39, up: 81, full: "0.60", what: "Price divided by the 200-day moving average.", why: "Deep readings mark oversold markets. It overlaps with the 200-week line, so its weight is low.",
      score: function (r, d, m) { return L2(r, "mayer", d, m); }, read: function (r) { return f2(r.mayer); } },
    { k: "rr", w: 2, name: "Reserve risk", hits: "3 of 3", prec: 21, up: 98, full: "0.0010", what: "Price against the confidence of long-term holders (how little they spend).", why: "Low values have meant good long-term value. It overlaps with MVRV, so its weight is low.",
      score: function (r) { return lin(r.reserveRisk, 0.004, 0.001); }, read: function (r) { return r.reserveRisk == null ? "—" : r.reserveRisk.toFixed(4); } }
  ];
  var CONF = [
    { k: "etf", name: "ETF net flow, 10 days", tip: "Net BTC bought by US spot ETFs over 10 days. Steady buying came back after past lows.", score: function (c) { return lin(c.etf10d, -20000, 20000); }, read: function (c) { return c.etf10d == null ? "—" : (c.etf10d >= 0 ? "+" : "−") + Math.abs(Math.round(c.etf10d)).toLocaleString("en-US") + " BTC"; } },
    { k: "cb", name: "Coinbase premium", tip: "The price gap between Coinbase (US buyers) and offshore exchanges. A positive premium shows US demand coming back.", score: function (c) { return lin(c.cbPremium, -0.2, 0.1); }, read: function (c) { return c.cbPremium == null ? "—" : (c.cbPremium >= 0 ? "+" : "−") + Math.abs(c.cbPremium).toFixed(2) + "%"; } },
    { k: "stable", name: "Stablecoin supply, 30 days", tip: "Change in total stablecoin supply over 30 days. Growth means new cash coming into crypto.", score: function (c) { return lin(c.stable30d, -5, 3); }, read: function (c) { return c.stable30d == null ? "—" : (c.stable30d >= 0 ? "+" : "−") + Math.abs(c.stable30d).toFixed(1) + "%"; } },
    { k: "usdtd", name: "USDT dominance, 30 days", tip: "Change in Tether's share of all crypto value over 30 days. A fall means money is moving from cash back into coins.", score: function (c) { return lin(c.usdtd30d, 8, -5); }, read: function (c) { return c.usdtd30d == null ? "—" : (c.usdtd30d >= 0 ? "+" : "−") + Math.abs(c.usdtd30d).toFixed(1) + "%"; } }
  ];
  // Value bands. Stats from the weekly backtest (mid-2013 to Nov 2025): share of weeks, % of weeks within 30% of that cycle's final low, median 1-year return, % higher 1 year later.
  var BANDS = [
    { lo: 0, hi: 19, name: "Not cheap" }, { lo: 20, hi: 39, name: "Fair value" }, { lo: 40, hi: 59, name: "Getting cheap" },
    { lo: 60, hi: 74, name: "Cheap" }, { lo: 75, hi: 89, name: "Very cheap" }, { lo: 90, hi: 100, name: "Extreme value" }
  ];
  var BSTATS = {
    classic: [[69.7, 0, 44, 59], [12.4, 0, 74, 77], [6.1, 2, 65, 82], [6.0, 36, 68, 100], [5.1, 82, 105, 100], [0.6, 100, 134, 100]],
    adj: [[71.7, 0, 43, 59], [12.1, 0, 64, 77], [5.8, 5, 80, 97], [6.6, 47, 83, 100], [3.4, 100, 121, 100], [0.3, 100, 134, 100]]
  };
  function bandIdx(s) { return s == null ? -1 : s < 20 ? 0 : s < 40 ? 1 : s < 60 ? 2 : s < 75 ? 3 : s < 90 ? 4 : 5; }
  function bandName(s) { var i = bandIdx(s); return i < 0 ? "—" : BANDS[i].name; }
  var CUTS = [0, 20, 40, 60, 75, 90, 101];

  // Bottom in?: signs that only show after a low. Weighted average x deep-value gate.
  // Gate: highest small-cycle value score since this cycle's top: below 60 -> x0.4, 60-74 -> x0.5, 75+ -> x1.
  var BI = [
    { k: "nolow", w: 25, name: "No new low", tip: "Days since the lowest daily close of this bear market. Zero on the day of a new low. Full score at 120 days." },
    { k: "rise", w: 10, name: "Bounce from the low", tip: "Price against the lowest close of this bear market. Full score at 1.5× (50% above the low)." },
    { k: "sth", w: 20, name: "Above recent buyers' cost", tip: "Price against the short-term holder cost (coins moved in the last 155 days). Zero at 0.85×, full at 1.05×: recent buyers back in profit." },
    { k: "mayer", w: 15, name: "Above the 200-day average", tip: "Price against its 200-day average. Zero at 0.80×, full at 1.10×." },
    { k: "sopr", w: 10, name: "Selling at a profit", tip: "SOPR, 7-day. Zero at −0.005, full at +0.004: coins that move are sold at a profit again." },
    { k: "hash", w: 5, name: "Miners recovered", tip: "Hash ribbons. Full when hash rate recovered after the low (or within 30 days before it). Zero while miners capitulate. Half otherwise." },
    { k: "flows", w: 15, name: "Money coming back", tip: "The four flow signs: ETF net flow, Coinbase premium, stablecoin supply and USDT dominance. Live data only, so it is not in the backtest." }
  ];
  var BIB = [
    { lo: 0, hi: 24, name: "Not yet", lowIn: 13, weeks: 153, col: 1 }, { lo: 25, hi: 49, name: "Early signs", lowIn: 38, weeks: 48, col: 2 },
    { lo: 50, hi: 74, name: "Likely in", lowIn: 100, weeks: 27, col: 3 }, { lo: 75, hi: 100, name: "Confirmed", lowIn: 100, weeks: 91, col: 5 }
  ];
  function biIdx(s) { return s == null ? -1 : s < 25 ? 0 : s < 50 ? 1 : s < 75 ? 2 : 3; }
  function biName(s) { var i = biIdx(s); return i < 0 ? "—" : BIB[i].name; }
  function biCol(s) { var i = biIdx(s); return i < 0 ? css("--surf2") : css("--b" + BIB[i].col); }
  function gateOf(vmax) { return vmax == null ? 1 : vmax < 60 ? 0.4 : vmax < 75 ? 0.5 : 1; }
  function biComps(x) {
    // x: {p, low, dsl, sth, mayer, sopr, hcap, recAfterLow, flows}
    var c = {};
    c.nolow = lin(x.dsl, 0, 120);
    c.rise = x.low ? lin(x.p / x.low, 1.0, 1.5) : null;
    c.sth = lin(x.sth, 0.85, 1.05);
    c.mayer = lin(x.mayer, 0.8, 1.1);
    c.sopr = lin(x.sopr, -0.005, 0.004);
    c.hash = x.hcap === true ? 0 : x.recAfterLow == null ? null : x.recAfterLow ? 100 : 50;
    c.flows = x.flows == null ? null : x.flows;
    var sw = 0, ss = 0;
    BI.forEach(function (b) { var v = c[b.k]; if (v != null) { sw += b.w; ss += b.w * v; } });
    return { c: c, raw: sw ? ss / sw : null };
  }
  // Cycle tops and final lows (Coin Metrics daily closes)
  var CYCLES = [
    { id: "c14", name: "2014–15", short: "’15", top: "2013-12-04", low: "2015-01-14", topP: 1134.9, lowP: 175.64 },
    { id: "c18", name: "2017–18", short: "’18", top: "2017-12-16", low: "2018-12-15", topP: 19640.5, lowP: 3185.07 },
    { id: "c22", name: "2021–22", short: "’22", top: "2021-11-08", low: "2022-11-09", topP: 67541.8, lowP: 15758.29 },
    { id: "now", name: "Now", short: "Now", top: "2025-10-06", low: null, topP: 124824.45, lowP: null }
  ];
  var NOWC = CYCLES[3];

  function parts(doc, raw, mode) {
    var r = raw || (doc && doc.raw) || {}, date = doc && doc.date, p = {}, sw = 0, ss = 0;
    IND.forEach(function (d) { var s = null; try { s = d.score(r, date, mode); } catch (e) { s = null; } p[d.k] = s; if (s != null) { sw += d.w; ss += d.w * s; } });
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
    score: "<span class='tt-h'>Value: is BTC cheap?</span>16 signals, each scored 0–100 by how close it is to the reading seen at past cycle lows, then averaged by weight. It says how cheap BTC is. It does not say the low is in. Hover the coloured arcs to see what each band has meant in the past.",
    bi: "<span class='tt-h'>Bottom in? Has the low passed?</span>Seven signs that only show after a low: no new low, a bounce, price back above recent buyers' cost and the 200-day average, selling at a profit, miners and money coming back. In past cycles it passed 50 two to three months after the low. It is held down until the value score has reached 75 in this bear market.",
    clocks: "<span class='tt-h'>Cycle clock</span>Where this cycle is in time and depth, against the 2015, 2018 and 2022 lows. Time clocks say when a low has come before. Depth clocks say how deep past lows went.",
    "lv-adj": "<span class='tt-h'>Small-cycle levels</span>Each past low was less deep than the one before. For MVRV, long-term holder cost, balanced price, Mayer multiple, addresses in loss and short-term holder cost, the full-score level moves one step along the trend of the 2015, 2018 and 2022 lows. See the method page for the numbers.",
    "lv-classic": "<span class='tt-h'>Classic levels</span>Fixed full-score levels: the readings that all three past lows reached. Use this view to compare with older screenshots.",
    moved: "<span class='tt-h'>What moved</span>The signals that changed the value score most, in points of the 0–100 score. The top part is the effect of the live price. The lower part is the change between the last two daily readings.",
    gate: "<span class='tt-h'>Deep-value check</span>No past low came before the value score (small-cycle levels) had reached 75. Until it has done so in this bear market, Bottom in is held at 40% (value peak below 60) or 50% (value peak 60–74) of its raw reading. This stopped a false start in September–October 2026.",
    chg24: "<span class='tt-h'>24-hour change</span>Change in price over the last 24 hours on the exchange shown.",
    live: "<span class='tt-h'>Live price</span>The page asks Bybit for the price every 15 seconds (Coinbase, Kraken or OKX if Bybit fails). Price-based signals are worked out again each time.",
    cbbi: "<span class='tt-h'>CBBI: Colin's Bitcoin Bull Run Index</span>A separate index by Colin Talks Crypto that blends nine cycle signals into one 0–100 number. Low numbers have come near cycle lows; 90+ near cycle tops. Shown here as a cross-check. It is not part of the scores on this page.",
    "chip-live": "<span class='tt-h'>Live vs daily</span>How much the live price moves the value score compared with the last daily reading.",
    "chip-prev": "<span class='tt-h'>Since the last reading</span>Change in the daily value score between the last two daily readings.",
    "chip-7": "<span class='tt-h'>7 days</span>Change in the daily value score over the last 7 days.",
    "chip-30": "<span class='tt-h'>30 days</span>Change in the daily value score over the last 30 days (weekly history before 8 Nov 2026).",
    next: "<span class='tt-h'>Next band</span>The BTC price at which the live value score reaches the next band, if the on-chain lines stay as they are today. When price falls, loss-taking and fear usually rise too, so the real score is likely to get there sooner."
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
    TIPS["ind-" + d.k] = function () {
      var lvTxt = d.lv ? (S.lv === "adj" ? "Full score at " + fmtLv(d.lv, fAt(d.lv, null, "adj")) + " with small-cycle levels (classic " + esc(d.full) + ")." : "Full score at " + esc(d.full) + " (classic). Small-cycle level: " + fmtLv(d.lv, fAt(d.lv, null, "adj")) + ".") : "Full score at " + esc(d.full) + ".";
      return "<span class='tt-h'>" + esc(d.name) + " · weight " + d.w + "</span>" + esc(d.what) + " " + esc(d.why) +
        "<span class='tt-m'>" + lvTxt + " Record: " + (d.prec == null ? "data only from 2023, so weight set by judgment." : "fired at " + d.hits + " past lows; " + d.prec + "% of its signal days were within 30% of a cycle low (a random day: 6%).") + "</span>";
    };
  });
  BANDS.forEach(function (b, i) {
    TIPS["band-" + i] = function () {
      var st = BSTATS[S.lv === "adj" ? "adj" : "classic"][i];
      return "<span class='tt-h'>" + b.lo + "–" + b.hi + " · " + b.name + "</span>" +
        "In " + st[0] + "% of weeks since mid-2013. Price was within 30% of that cycle's final low in " + st[1] + "% of these weeks. One year later, BTC was higher " + st[3] + "% of the time, with a median return of +" + st[2] + "%." +
        "<span class='tt-m'>Weekly backtest, mid-2013 to Nov 2025, " + (S.lv === "adj" ? "small-cycle" : "classic") + " levels. Past results do not promise future results.</span>";
    };
  });
  BIB.forEach(function (b, i) {
    TIPS["bib-" + i] = "<span class='tt-h'>" + b.lo + "–" + b.hi + " · " + b.name + "</span>In the 2014–15, 2018 and 2022 bear markets (top to one year after the low), the low had already passed in " + b.lowIn + "% of the " + b.weeks + " weeks in this band." +
      "<span class='tt-m'>Weekly backtest without the money-flow sign (no data before 2024). Small sample: three cycles.</span>";
  });
  BI.forEach(function (b) { TIPS["bic-" + b.k] = "<span class='tt-h'>" + esc(b.name) + " · weight " + b.w + "</span>" + esc(b.tip); });
  CONF.forEach(function (c) { TIPS["conf-" + c.k] = "<span class='tt-h'>" + esc(c.name) + "</span>" + esc(c.tip); });
  Object.keys(CBBI_TIPS).forEach(function (k) { TIPS["cb-" + k] = esc(CBBI_TIPS[k]); });

  var tt = document.createElement("div"); tt.id = "tt"; tt.setAttribute("role", "tooltip"); document.body.appendChild(tt);
  var ttEl = null;
  function tipFor(el) { var k = el.getAttribute("data-tipk"); if (!k) return el.getAttribute("data-tip"); var t = TIPS[k]; return typeof t === "function" ? t() : t; }
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
  S.lv = sget("bbm.levels") === "classic" ? "classic" : "adj";
  S.tab = sget("bbm.tab") === "cyc" ? "cyc" : "d14";
  S.cycM = sget("bbm.cycm") || "fall"; if (["fall", "value", "bi"].indexOf(S.cycM) < 0) S.cycM = "fall";
  S.c14 = sget("bbm.c14") === "1";

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
    // Bottom in? dial
    var bh = "", bhits = "", bcuts = [[0, 24.6], [25.4, 49.6], [50.4, 74.6], [75.4, 100]], bcut = [0, 25, 50, 75, 101];
    bcuts.forEach(function (c, i) {
      bh += '<path d="' + arc(c[0], c[1], RO) + '" fill="none" stroke="var(--b' + BIB[i].col + ')" stroke-width="8"/>';
      bhits += '<path class="g-hit" tabindex="0" role="img" aria-label="' + BIB[i].lo + " to " + BIB[i].hi + ", " + BIB[i].name + '" data-tipk="bib-' + i + '" d="' + arc(bcut[i] + 0.2, Math.min(100, bcut[i + 1]) - 0.2, 161) + '" fill="none" stroke="transparent" stroke-width="58" pointer-events="stroke"/>';
    });
    $("bi-bands").innerHTML = bh; $("bi-hits").innerHTML = bhits;
    $("bi-track").setAttribute("d", arc(0, 100, R)); $("bi-prog").setAttribute("d", arc(0, 100, R));
    var bt = "";
    [25, 50, 75].forEach(function (v, i) { var p = pt(v, RL); bt += '<text class="g-hit" data-tipk="bib-' + (i + 1) + '" x="' + p[0].toFixed(1) + '" y="' + p[1].toFixed(1) + '" fill="var(--muted)" font-size="12" text-anchor="middle" dominant-baseline="middle" font-family="IBM Plex Mono, monospace">' + v + "</text>"; });
    $("bi-ticks").innerHTML = bt;
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
    renderHeader(); renderLive(); renderSpark(); renderHistory(); renderSignals(); renderP2S(); renderTabs();
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
    renderBI(); renderClocks(); renderVerdict();
    if (S.tab === "cyc") renderCyc();
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
    var w = weeklyScores(), best = null;
    for (var i = 0; i < w.length; i++) if (w[i][0] <= date && w[i][1] != null) best = w[i];
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
    } else h += '<span><strong style="font-weight:650">Top band:</strong> Extreme value.</span>';
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
  function weeklyScores() {
    if (S.hist) return S.hist.rows.filter(function (o) { return o.d >= "2025-09-29"; }).map(function (o) { return [o.d, histVal(o)]; });
    return S.lv === "classic" ? (S.data.weekly || []) : [];
  }
  function series() {
    var ds = S.data.days, first = ds[0].date, out = [];
    weeklyScores().forEach(function (w) { if (w[0] < first && w[1] != null) out.push({ d: w[0], s: w[1], wk: true }); });
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
    var g = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Value score and BTC price over time">';
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
    tip.innerHTML = '<span class="muted">' + (best.wk ? "Week of " : "") + fdy(best.d) + "</span><span>Value <b class=\"mono\">" + Math.round(best.s) + "</b> · " + bandName(best.s) + "</span>" + (price ? '<span>BTC <b class="mono">' + usd(price) + "</b></span>" : "");
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
    var rows = [{ k: "tot", name: "Value score", w: "", read: String(Math.round(parts(d).total)), vals: pc.map(function (p) { return p ? p.total : null; }), tot: true }];
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
    var filled = S.data.days.filter(function (x) { return x.filled && D.cols.indexOf(x.date) >= 0; }).map(function (x) { return fd(x.date); });
    $("sig-note").textContent = (D.miss.length ? "No reading on " + D.miss.map(fd).join(", ") + ": the heat map and line blend across the gap. " : "") + (filled.length ? "Readings for " + filled.join(" and ") + " were filled in later from source history (no ETF, Coinbase premium or USDT dominance for those days). " : "") + "Live column: price-based signals worked out again at the live price. Scores use " + (S.lv === "adj" ? "small-cycle" : "classic") + " levels.";
    $("bands").innerHTML = BANDS.map(function (b, i) { return '<span class="tip" tabindex="0" data-tipk="band-' + i + '"><span class="sw" style="background:var(--b' + i + ')"></span>' + (i === 5 ? "90+" : b.lo + "–" + b.hi) + " " + b.name + "</span>"; }).join("");
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
      renderP2S(); if (S.latest) { renderBI(); renderClocks(); renderVerdict(); if (S.tab === "cyc") renderCyc(); }
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
  TIPS["p2s-score"] = "<span class='tt-h'>Projected value score</span>The value score at that price if the on-chain lines stay as they are today. Likely too low for falls, because loss-taking and fear usually rise as price falls.";
  TIPS["p2s-chance"] = "<span class='tt-h'>Chance</span>The chance that BTC trades at that price at least once in the window, in UK intelligence yardstick words. Average of a volatility model and a cycle model. Hover a row for both results.";
  TIPS["p2s-conf"] = "<span class='tt-h'>Confidence</span>The lower of the score confidence and the chance confidence. See 'How we got these numbers' below the table.";
  function confScore(c) {
    c = c || {}; var n = 0, t = 0;
    CONF.forEach(function (k) { var v = k.score(c); if (v != null) { n++; t += v; } });
    return n ? t / n : null;
  }
  // ---------- weekly history since 2013 (history.json) ----------
  function loadHist() {
    return J("history.json?v=3").then(function (h) {
      var cols = h.cols, rows = h.rows.map(function (a) { var o = {}; cols.forEach(function (c, i) { o[c] = a[i]; }); return o; });
      rows.forEach(function (o) { o.v = {}; });
      S.hist = { rows: rows, idx: {} };
      rows.forEach(function (o, i) { S.hist.idx[o.d] = i; });
      // Bottom in for each past cycle window (top to top + 900 days), with the running value peak as the gate
      CYCLES.forEach(function (c) {
        var end = addDays(c.top, 900), vm = null;
        rows.forEach(function (o) {
          if (o.d < c.top || o.d > end) return;
          var v = histVal(o, "adj"); if (v != null) vm = vm == null ? v : Math.max(vm, v);
          var bc = biComps({ p: o.p, low: o.low, dsl: o.dsl, sth: o.sth, mayer: o.mayer, sopr: o.sopr, hcap: o.hcap === 1, recAfterLow: o.hcap === 1 ? null : o.dsr == null ? null : o.dsr <= o.dsl + 30, flows: null });
          o.bi = bc.raw == null ? null : bc.raw * gateOf(vm); o.vmax = vm;
        });
      });
      if (S.latest) { renderAll(); }
    }).catch(function () { S.hist = null; });
  }
  function rowRaw(o) {
    return { cvdd: o.cvdd, mvrv: o.mvrv, lth: o.lth, balanced: o.bal, w200: o.w200, pi: o.pi, daysSincePeak: o.dsp, mayer: o.mayer, sopr7d: o.sopr, addrLoss: o.loss, puell: o.puell, sth: o.sth, fg7d: o.fg,
      hashCapitulating: o.hcap == null ? null : o.hcap === 1, hashLastRecovery: o.dsr == null ? null : addDays(o.d, -o.dsr), reserveRisk: o.rr };
  }
  function histParts(o, mode) { return parts({ date: o.d, raw: rowRaw(o) }, null, mode || S.lv); }
  function histVal(o, mode) { mode = mode || S.lv; if (!(mode in o.v)) o.v[mode] = histParts(o, mode).total; return o.v[mode]; }
  function histLowRow(date) {
    if (!S.hist) return null; var best = null;
    S.hist.rows.forEach(function (o) { if (Math.abs(daysBetween(o.d, date)) <= 10 && (!best || o.p < best.p)) best = o; });
    return best;
  }
  function histNear(date, tol) {
    if (!S.hist) return null; var best = null, bd = 1e9;
    S.hist.rows.forEach(function (o) { var dd = Math.abs(daysBetween(o.d, date)); if (dd < bd) { bd = dd; best = o; } });
    return bd <= (tol == null ? 4 : tol) ? best : null;
  }

  // ---------- Bottom in? (live) ----------
  function vmaxNow() {
    var m = null;
    function up(v) { if (v != null && (m == null || v > m)) m = v; }
    if (S.hist) S.hist.rows.forEach(function (o) { if (o.d >= NOWC.top) up(histVal(o, "adj")); });
    if (S.data) S.data.days.forEach(function (d) { if (d.date >= NOWC.top) up(parts(d, null, "adj").total); });
    var P = liveP(); if (P && S.latest) up(parts(S.latest, liveRaw(S.latest, P), "adj").total);
    return m;
  }
  function cycleLowNow(P) {
    var lo = null, ld = null;
    if (S.cm) { var i0 = S.cmIdx[NOWC.top]; if (i0 != null) for (var i = i0; i < S.cm.length; i++) if (lo == null || S.cm[i][1] < lo) { lo = S.cm[i][1]; ld = S.cm[i][0]; } }
    if (lo == null && S.hist) S.hist.rows.forEach(function (o) { if (o.d >= NOWC.top && (lo == null || o.low < lo)) { lo = o.low; ld = addDays(o.d, -o.dsl); } });
    if (P && (lo == null || P < lo)) { lo = P; ld = todayCbr(); }
    return { lo: lo, ld: ld };
  }
  function biLive() {
    var d = S.latest; if (!d) return null;
    var P = liveP() || d.price, raw = liveRaw(d, P), r = d.raw || {}, cl = cycleLowNow(P), today = todayCbr();
    var rec = r.hashLastRecovery && cl.ld ? r.hashLastRecovery >= addDays(cl.ld, -30) : null;
    var x = { p: P, low: cl.lo, dsl: cl.ld ? Math.max(0, daysBetween(cl.ld, today)) : null, sth: raw.sth, mayer: raw.mayer, sopr: r.sopr7d, hcap: r.hashCapitulating === true, recAfterLow: rec, flows: confScore(d.confirm) };
    var bc = biComps(x), vmax = vmaxNow(), g = gateOf(vmax);
    return { s: bc.raw == null ? null : bc.raw * g, raw: bc.raw, c: bc.c, x: x, vmax: vmax, gate: g, ld: cl.ld };
  }
  var shownBI = null;
  function renderBI() {
    var b = biLive(); S.biNow = b; if (!b || b.s == null) return;
    var v = Math.max(0, Math.min(100, b.s));
    $("bi-prog").setAttribute("stroke-dashoffset", (100 - v).toFixed(2));
    $("bi-prog").setAttribute("stroke", "var(--b" + BIB[Math.max(0, biIdx(v))].col + ")");
    $("bi-live").style.transform = "rotate(" + (v * 1.8).toFixed(2) + "deg)";
    animateNum($("bi-num"), shownBI, v); shownBI = v;
    $("bi-band").textContent = biName(v) + (liveP() ? " · live" : "");
    $("bi-svg").setAttribute("aria-label", "Bottom in score " + Math.round(v) + " of 100, " + biName(v) + ".");
    var x = b.x, rd = {
      nolow: x.dsl == null ? "—" : x.dsl === 0 ? "new low today" : x.dsl + " d since " + fd(b.ld),
      rise: x.low ? (x.p / x.low).toFixed(2) + "× low" : "—",
      sth: x.sth == null ? "—" : x.sth.toFixed(2) + "×",
      mayer: x.mayer == null ? "—" : x.mayer.toFixed(2) + "×",
      sopr: x.sopr == null ? "—" : (x.sopr >= 0 ? "+" : "−") + Math.abs(x.sopr).toFixed(3),
      hash: x.hcap ? "capitulating" : x.recAfterLow == null ? "—" : x.recAfterLow ? "recovered" : "not since low",
      flows: b.c.flows == null ? "—" : Math.round(b.c.flows) + "/100"
    };
    var h = BI.map(function (bi) {
      var val = b.c[bi.k], w = val == null ? 0 : val;
      return '<div class="bi-r"><span class="n"><span class="tip" tabindex="0" data-tipk="bic-' + bi.k + '">' + esc(bi.name) + '</span></span><span class="rd mono">' + esc(rd[bi.k]) + '</span><span class="bar"><i style="width:' + w.toFixed(0) + "%;background:" + (val == null ? "var(--surf2)" : smoothCol(val)) + '"></i></span><span class="v">' + (val == null ? "—" : Math.round(val)) + "</span></div>";
    }).join("");
    var c = (S.latest && S.latest.confirm) || {};
    h += '<div class="sub bi-flows">Flows: ' + CONF.map(function (k) { return '<span class="tip" tabindex="0" data-tipk="conf-' + k.k + '">' + esc(k.name.replace(/, 30 days|, 10 days/, "")) + "</span> " + '<b class="mono">' + esc(k.read(c)) + "</b>"; }).join(" · ") + "</div>";
    $("bi-comp").innerHTML = h;
    var g = b.gate, vm = b.vmax;
    $("bi-gate").innerHTML = '<span class="tip" tabindex="0" data-tipk="gate">Deep-value check</span>: ' + (g >= 1 ? "passed. The value score reached " + Math.round(vm) + " in this bear market." : "value peak this bear market " + (vm == null ? "—" : Math.round(vm)) + " (" + bandName(vm) + "), below 75. Raw reading " + Math.round(b.raw) + ", held at " + Math.round(g * 100) + "%.");
  }
  CONF.forEach(function (c) { TIPS["conf-" + c.k] = "<span class='tt-h'>" + esc(c.name) + "</span>" + esc(c.tip); });

  // ---------- cycle clock ----------
  var CLK = {
    dTop: { label: "Days since the top", past: [406, 364, 366], min: 0, max: 600, fmt: function (v) { return Math.round(v) + " d"; } },
    dHalv: { label: "Days since the halving", past: [777, 889, 912], min: 0, max: 1460, fmt: function (v) { return Math.round(v) + " d"; } },
    fall: { label: "Fall from the top", past: [-84.5, -83.8, -76.7], trend: -72.8, min: 0, max: -90, fmt: function (v) { return "−" + Math.abs(v).toFixed(1) + "%"; } },
    mvrv: { label: "MVRV", past: [0.56, 0.69, 0.75], trend: 0.85, min: 2.0, max: 0.5, fmt: function (v) { return v.toFixed(2); } },
    below: { label: "Days below realized price", past: [304, 134, 179], min: 0, max: 365, fmt: function (v) { return Math.round(v) + " d"; } }
  };
  var CLK_ORDER = ["dTop", "dHalv", "fall", "mvrv", "below"];
  TIPS["clk-dTop"] = "<span class='tt-h'>Days since the top</span>Days since the all-time high close (6 Oct 2025). Past lows came 406 (2015), 364 (2018) and 366 (2022) days after the top.";
  TIPS["clk-dHalv"] = "<span class='tt-h'>Days since the halving</span>Days since the April 2024 halving. Past lows came 777 (2015), 889 (2018) and 912 (2022) days after the halving before them. The gap has grown each cycle.";
  TIPS["clk-fall"] = "<span class='tt-h'>Fall from the top</span>Live price against the all-time high close ($124,824). Past lows: −84.5% (2015), −83.8% (2018), −76.7% (2022). The trend of past lows points to about −73% this cycle (about $34k). Treat the trend as a rough guide: three points only.";
  TIPS["clk-mvrv"] = "<span class='tt-h'>MVRV</span>Live price against the realized price (what all holders paid on average). Past lows: 0.56 (2015), 0.69 (2018), 0.75 (2022). The trend of past lows points to about 0.85 this cycle.";
  TIPS["clk-below"] = "<span class='tt-h'>Days below realized price</span>Days in this bear market with price below the realized price (MVRV under 1). Past bear markets: 304 (2015), 134 (2018) and 179 (2022) days. No past low came without a long stay below it.";
  function clockNow() {
    var P = liveP() || (S.latest && S.latest.price), today = todayCbr(), o = {};
    o.dTop = daysBetween(NOWC.top, today);
    o.dHalv = daysBetween(HALV[3], today);
    o.fall = P ? (P / NOWC.topP - 1) * 100 : null;
    var rp = S.latest && S.latest.ref && S.latest.ref.realizedPrice;
    o.mvrv = P && rp ? P / rp : null;
    var n = null;
    if (S.cm) { n = 0; var i0 = S.cmIdx[NOWC.top]; if (i0 != null) for (var i = i0; i < S.cm.length; i++) if (S.cm[i][2] < 1) n++; if (o.mvrv != null && o.mvrv < 1 && S.cm[S.cm.length - 1][0] < addDays(today, -1)) n++; }
    o.below = n;
    return o;
  }
  function clockStatus(k, v) {
    var c = CLK[k], lo = Math.min.apply(null, c.past), hi = Math.max.apply(null, c.past);
    if (v == null) return "—";
    if (k === "dTop" || k === "dHalv") return v < lo ? "Before the past lows" : v <= hi ? "In the window of past lows" : "Past all three lows";
    if (k === "fall") return v > hi ? "Not as deep as past lows" : v >= lo ? "As deep as past lows" : "Deeper than past lows";
    if (k === "mvrv") return v > hi ? "Above all three lows" : v >= lo ? "In the range of past lows" : "Below all three lows";
    if (k === "below") return v === 0 ? "None yet" : v < lo ? "Shorter than past bears" : "As long as past bears";
    return "";
  }
  function clockPast(k) {
    var c = CLK[k], yr = ["’15", "’18", "’22"];
    return c.past.map(function (pv, i) { return yr[i] + " " + c.fmt(pv).replace(" d", ""); }).join(" · ") + (k === "dTop" || k === "dHalv" || k === "below" ? " d" : "") + (c.trend != null ? " · trend " + c.fmt(c.trend) : "");
  }
  function clockSvg(k, v) {
    var c = CLK[k], cx = 100, cy = 100, r = 74;
    function t(x) { return Math.max(0, Math.min(100, (x - c.min) / (c.max - c.min) * 100)); }
    var ts = c.past.map(t), a = Math.min.apply(null, ts), b = Math.max.apply(null, ts);
    var g = '<svg viewBox="0 0 200 118" role="img" aria-label="' + esc(c.label + ": " + (v == null ? "no data" : c.fmt(v)) + ". " + clockStatus(k, v)) + '">';
    g += '<path d="' + arc(0, 100, r, cx, cy) + '" fill="none" stroke="var(--surf2)" stroke-width="12" stroke-linecap="round"/>';
    g += '<path d="' + arc(a, Math.max(b, a + 0.8), r, cx, cy) + '" fill="none" stroke="var(--b3)" stroke-width="12" opacity=".55"/>';
    c.past.forEach(function (pv) {
      var p1 = pt(t(pv), r - 9, cx, cy), p2 = pt(t(pv), r + 9, cx, cy);
      g += '<line x1="' + p1[0].toFixed(1) + '" y1="' + p1[1].toFixed(1) + '" x2="' + p2[0].toFixed(1) + '" y2="' + p2[1].toFixed(1) + '" stroke="var(--ink)" stroke-width="1.5" opacity=".8"/>';
    });
    if (c.trend != null) { var tp = pt(t(c.trend), r, cx, cy); g += '<rect x="' + (tp[0] - 4.5).toFixed(1) + '" y="' + (tp[1] - 4.5).toFixed(1) + '" width="9" height="9" transform="rotate(45 ' + tp[0].toFixed(1) + " " + tp[1].toFixed(1) + ')" fill="var(--surf)" stroke="var(--accent)" stroke-width="2"/>'; }
    if (v != null) {
      var tv = t(v), e1 = pt(tv, r - 16, cx, cy), e2 = pt(tv, r - 7, cx, cy), d = pt(tv, r, cx, cy);
      g += '<path d="' + arc(0, Math.max(0.5, tv), r, cx, cy) + '" fill="none" stroke="var(--accent)" stroke-width="3" opacity=".55" stroke-linecap="round"/>';
      g += '<line x1="' + e1[0].toFixed(1) + '" y1="' + e1[1].toFixed(1) + '" x2="' + e2[0].toFixed(1) + '" y2="' + e2[1].toFixed(1) + '" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>';
      g += '<circle cx="' + d[0].toFixed(1) + '" cy="' + d[1].toFixed(1) + '" r="6.5" fill="var(--accent)" stroke="var(--surf)" stroke-width="2.5"/>';
    }
    return g + "</svg>";
  }
  function renderClocks() {
    var now = clockNow(), h = "";
    CLK_ORDER.forEach(function (k) {
      var c = CLK[k], v = now[k];
      h += '<div class="clk"><div class="clk-d">' + clockSvg(k, v) + '<b class="clk-v mono">' + (v == null ? "—" : c.fmt(v)) + '</b></div><span class="clk-l"><span class="tip" tabindex="0" data-tipk="clk-' + k + '">' + esc(c.label) + '</span></span><span class="clk-s">' + esc(clockStatus(k, v)) + '</span><span class="clk-p mono">' + esc(clockPast(k)) + "</span></div>";
    });
    $("clocks").innerHTML = h;
    S.clk = now;
  }

  // ---------- verdict line ----------
  function renderVerdict() {
    if (!S.latest) return;
    var P = liveP(), v = P ? scoreAt(P) : parts(S.latest).total, b = S.biNow, c = S.clk || clockNow();
    var yes = v >= 60 ? "Yes" : v >= 40 ? "Getting there" : "No";
    $("vd-value-a").innerHTML = '<span class="pip" style="background:' + bandCol(v) + '"></span>' + esc(yes) + " · " + esc(bandName(v)) + ' <span class="mono">' + Math.round(v) + "</span>";
    $("vd-bi-a").innerHTML = b && b.s != null ? '<span class="pip" style="background:' + biCol(b.s) + '"></span>' + esc(biName(b.s)) + ' <span class="mono">' + Math.round(b.s) + "</span>" : "—";
    $("vd-clock-a").innerHTML = "Day " + c.dTop + " since the top · past lows came on days 364–406";
  }

  // ---------- signals tabs ----------
  function renderTabs() {
    ["d14", "cyc"].forEach(function (t) {
      var on = S.tab === t; $("tab-" + t).hidden = !on;
      var b = $("tab-btn-" + t); b.setAttribute("aria-selected", on ? "true" : "false"); b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (S.tab === "cyc") renderCyc();
  }
  $("sig-tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    S.tab = b.getAttribute("data-t"); sset("bbm.tab", S.tab); renderTabs();
  });

  // ---------- versus past cycles ----------
  var CYC_STYLE = { c14: { col: "var(--muted)", dash: "2 4", w: 1.75 }, c18: { col: "var(--muted)", dash: "7 5", w: 2 }, c22: { col: "var(--ink)", dash: "", w: 2, op: 0.7 }, now: { col: "var(--accent)", dash: "", w: 3.25 } };
  var CYC_M = { fall: "Fall from the top", value: "Value score", bi: "Bottom in" };
  function cycVal(o, c, m) {
    if (m === "fall") return (o.p / c.topP - 1) * 100;
    if (m === "value") return histVal(o);
    return o.bi;
  }
  function cycLive(m) {
    var P = liveP() || (S.latest && S.latest.price);
    if (m === "fall") return P ? (P / NOWC.topP - 1) * 100 : null;
    if (m === "value") return P ? scoreAt(P) : null;
    return S.biNow ? S.biNow.s : null;
  }
  function cycSeries(c, m) {
    var out = [], end = addDays(c.top, 820);
    if (!S.hist) return out;
    S.hist.rows.forEach(function (o) { if (o.d >= c.top && o.d <= end) { var v = cycVal(o, c, m); if (v != null) out.push({ x: daysBetween(c.top, o.d), y: v, d: o.d }); } });
    if (c.id === "now") { var lv = cycLive(m); if (lv != null) out.push({ x: daysBetween(c.top, todayCbr()), y: lv, d: todayCbr(), live: true }); }
    return out;
  }
  function renderCyc() {
    Array.prototype.forEach.call(document.querySelectorAll("#cyc-metric button"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-m") === S.cycM ? "true" : "false"); });
    $("cyc-2014").checked = S.c14;
    if (!S.hist) { $("cyc-note").textContent = "Loading the weekly history…"; return; }
    renderCycChart(); renderCycTable();
  }
  function renderCycChart() {
    var m = S.cycM, box = $("cyc-chart"), W = Math.max(300, box.clientWidth || 800), H = W >= 900 ? 330 : W >= 600 ? 280 : 240;
    var ml = 40, mr = 16, mt = 14, mb = 28, iw = W - ml - mr, ih = H - mt - mb, X0 = 0, X1 = 800;
    var ylo = m === "fall" ? -90 : 0, yhi = m === "fall" ? 0 : 100;
    function X(x) { return ml + (x - X0) / (X1 - X0) * iw; }
    function Y(y) { return mt + (1 - (y - ylo) / (yhi - ylo)) * ih; }
    var g = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(CYC_M[m]) + ' by days since each cycle top">';
    var ticks = m === "fall" ? [0, -20, -40, -60, -80] : [0, 25, 50, 75, 100];
    if (m === "value") [[90, 100, 5, .12], [75, 90, 4, .09], [60, 75, 3, .07]].forEach(function (z) { g += '<rect x="' + ml + '" y="' + Y(z[1]).toFixed(1) + '" width="' + iw + '" height="' + (Y(z[0]) - Y(z[1])).toFixed(1) + '" fill="var(--b' + z[2] + ')" opacity="' + z[3] + '"/>'; });
    if (m === "bi") [[75, 100, 5, .1], [50, 75, 3, .08]].forEach(function (z) { g += '<rect x="' + ml + '" y="' + Y(z[1]).toFixed(1) + '" width="' + iw + '" height="' + (Y(z[0]) - Y(z[1])).toFixed(1) + '" fill="var(--b' + z[2] + ')" opacity="' + z[3] + '"/>'; });
    ticks.forEach(function (t) { g += '<line x1="' + ml + '" x2="' + (ml + iw) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '" stroke="var(--line)" stroke-dasharray="' + (t === (m === "fall" ? 0 : 0) ? "0" : "3 4") + '"/><text x="' + (ml - 6) + '" y="' + Y(t).toFixed(1) + '" text-anchor="end" dominant-baseline="middle">' + (m === "fall" ? (t === 0 ? "0" : "−" + Math.abs(t) + "%") : t) + "</text>"; });
    for (var x = 0; x <= 800; x += 100) g += '<text x="' + X(x).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + (x === 0 ? "top" : x) + "</text>";
    var dNow = daysBetween(NOWC.top, todayCbr());
    g += '<line x1="' + X(dNow).toFixed(1) + '" x2="' + X(dNow).toFixed(1) + '" y1="' + mt + '" y2="' + (mt + ih) + '" stroke="var(--accent)" stroke-dasharray="2 3" opacity=".7"/>';
    g += '<text x="' + (X(dNow) + 5).toFixed(1) + '" y="' + (mt + 10) + '" style="fill:var(--accent)">day ' + dNow + "</text>";
    var lines = CYCLES.filter(function (c) { return c.id !== "c14" || S.c14; }), all = [], labs = [];
    lines.forEach(function (c) {
      var sr = cycSeries(c, m), st = CYC_STYLE[c.id]; if (sr.length < 2) return;
      all.push({ c: c, sr: sr });
      g += '<polyline fill="none" stroke="' + st.col + '" stroke-width="' + st.w + '"' + (st.dash ? ' stroke-dasharray="' + st.dash + '"' : "") + (st.op ? ' opacity="' + st.op + '"' : "") + ' stroke-linejoin="round" stroke-linecap="round" points="' + sr.map(function (p) { return X(p.x).toFixed(1) + "," + Y(p.y).toFixed(1); }).join(" ") + '"/>';
      if (c.low) {
        var lx = daysBetween(c.top, c.low), near = sr.reduce(function (a, p) { return Math.abs(p.x - lx) < Math.abs(a.x - lx) ? p : a; }, sr[0]);
        g += '<circle cx="' + X(lx).toFixed(1) + '" cy="' + Y(near.y).toFixed(1) + '" r="4.5" fill="var(--surf)" stroke="' + st.col + '" stroke-width="2"/>';
        g += '<text x="' + X(lx).toFixed(1) + '" y="' + (Y(near.y) + (m === "fall" ? 15 : -9)).toFixed(1) + '" text-anchor="middle" style="font-size:10px">' + esc(c.short) + " low</text>";
      }
      var last = sr[sr.length - 1];
      if (c.id === "now") g += '<circle cx="' + X(last.x).toFixed(1) + '" cy="' + Y(last.y).toFixed(1) + '" r="6" fill="var(--accent)" stroke="var(--surf)" stroke-width="2.5"/>';
      var anc = X(last.x) + 6 > ml + iw - 40 ? "end" : "start";
      labs.push({ x: anc === "end" ? X(last.x) - 8 : X(last.x) + 6, y: Y(last.y) + (c.id === "now" ? -10 : 4), anc: anc, col: st.col, t: c.id === "now" ? "Now" : c.name });
    });
    labs.sort(function (a, b) { return a.y - b.y; });
    for (var li = 1; li < labs.length; li++) if (labs[li].anc === labs[li - 1].anc && Math.abs(labs[li].x - labs[li - 1].x) < 60 && labs[li].y - labs[li - 1].y < 13) labs[li].y = labs[li - 1].y + 13;
    labs.forEach(function (l) { g += '<text x="' + l.x.toFixed(1) + '" y="' + Math.min(mt + ih - 2, Math.max(mt + 10, l.y)).toFixed(1) + '" text-anchor="' + l.anc + '" style="fill:' + l.col + ';font-weight:600">' + esc(l.t) + "</text>"; });
    g += '<line id="cxh" x1="0" x2="0" y1="' + mt + '" y2="' + (mt + ih) + '" stroke="var(--muted)" stroke-dasharray="3 3" style="display:none"/></svg>';
    var tip = $("cyc-tip"); box.innerHTML = g; box.appendChild(tip);
    S.cgeo = { X: X, ml: ml, iw: iw, W: W, all: all, m: m };
  }
  function cycPointer(e) {
    var G = S.cgeo; if (!G) return;
    var r = $("cyc-chart").getBoundingClientRect(), px = e.clientX - r.left;
    if (px < G.ml - 6 || px > G.ml + G.iw + 6) { cycHide(); return; }
    var day = (px - G.ml) / G.iw * 800, h = '<span class="muted">Day ' + Math.round(day) + " after the top</span>";
    G.all.forEach(function (L) {
      var best = null, bd = 1e9; L.sr.forEach(function (p) { var dd = Math.abs(p.x - day); if (dd < bd) { bd = dd; best = p; } });
      if (best && bd <= 10) h += "<span>" + esc(L.c.id === "now" ? "Now" : L.c.name) + ' <b class="mono">' + (G.m === "fall" ? "−" + Math.abs(best.y).toFixed(1) + "%" : Math.round(best.y)) + "</b>" + (best.live ? " (live)" : "") + "</span>";
    });
    var tip = $("cyc-tip"); tip.innerHTML = h; tip.style.display = "flex";
    var xh = document.getElementById("cxh"); if (xh) { xh.setAttribute("x1", px); xh.setAttribute("x2", px); xh.style.display = ""; }
    var tw = tip.offsetWidth, left = px + 12; if (left + tw > G.W) left = px - tw - 12;
    tip.style.left = Math.max(0, left) + "px"; tip.style.top = "8px";
  }
  function cycHide() { $("cyc-tip").style.display = "none"; var xh = document.getElementById("cxh"); if (xh) xh.style.display = "none"; }
  $("cyc-chart").addEventListener("pointermove", cycPointer);
  $("cyc-chart").addEventListener("pointerdown", cycPointer);
  $("cyc-chart").addEventListener("pointerleave", cycHide);
  $("cyc-metric").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; S.cycM = b.getAttribute("data-m"); sset("bbm.cycm", S.cycM); renderCyc(); });
  $("cyc-2014").addEventListener("change", function () { S.c14 = this.checked; sset("bbm.c14", S.c14 ? "1" : "0"); renderCyc(); });

  function renderCycTable() {
    var dNow = daysBetween(NOWC.top, todayCbr()), c18 = CYCLES[1], c22 = CYCLES[2];
    var cols = [
      { h: "Now", hs: "Now", sub: "day " + dNow, kind: "live" },
      { h: "2017–18", hs: "’18", sub: "day " + dNow, row: histNear(addDays(c18.top, dNow)), c: c18 },
      { h: "2021–22", hs: "’22", sub: "day " + dNow, row: histNear(addDays(c22.top, dNow)), c: c22 },
      { h: "2018 low", hs: "’18 low", sub: fd(c18.low), row: histLowRow(c18.low), c: c18, low: true },
      { h: "2022 low", hs: "’22 low", sub: fd(c22.low), row: histLowRow(c22.low), c: c22, low: true }
    ];
    var P = liveP() || S.latest.price, lp = parts(S.latest, liveRaw(S.latest, P)), lraw = liveRaw(S.latest, P);
    function cell(v, col, txt, tip) {
      if (v == null) return '<td class="cc na">—</td>';
      return '<td class="cc"><span class="cv tip" tabindex="0" data-tip="' + esc(tip) + '" style="background:' + col + ";color:" + txtOn(/^#/.test(col) ? col : "#888888") + '">' + esc(txt) + "</span></td>";
    }
    var h = "<thead><tr><th>Measure</th>" + cols.map(function (c) { return '<th class="r"><span class="hs">' + esc(c.h) + '</span><span class="ss">' + esc(c.hs) + '</span><span class="th-sub">' + esc(c.sub) + "</span></th>"; }).join("") + "</tr></thead><tbody>";
    // fall
    h += '<tr class="hd"><td>Fall from the top</td>' + cols.map(function (c) {
      var v = c.kind === "live" ? (P / NOWC.topP - 1) * 100 : c.low ? (c.c.lowP / c.c.topP - 1) * 100 : c.row ? (c.row.p / c.c.topP - 1) * 100 : null;
      return v == null ? '<td class="cc na">—</td>' : '<td class="cc mono r">' + "−" + Math.abs(v).toFixed(1) + "%</td>";
    }).join("") + "</tr>";
    // value
    h += '<tr class="hd"><td><span class="tip" tabindex="0" data-tipk="score">Value score</span></td>' + cols.map(function (c) {
      var v = c.kind === "live" ? lp.total : c.row ? histVal(c.row) : null;
      return cell(v, bandCol(v), v == null ? "" : String(Math.round(v)), (c.kind === "live" ? "Live" : "Week of " + fdy(c.row ? c.row.d : "")) + ": value " + (v == null ? "—" : Math.round(v) + " · " + bandName(v)));
    }).join("") + "</tr>";
    // bottom in
    h += '<tr class="hd"><td><span class="tip" tabindex="0" data-tipk="bi">Bottom in</span></td>' + cols.map(function (c) {
      var v = c.kind === "live" ? (S.biNow ? S.biNow.s : null) : c.row ? c.row.bi : null;
      return cell(v, biCol(v), v == null ? "" : String(Math.round(v)), (c.kind === "live" ? "Live" : "Week of " + fdy(c.row ? c.row.d : "")) + ": bottom in " + (v == null ? "—" : Math.round(v) + " · " + biName(v)));
    }).join("") + "</tr>";
    h += '<tr class="sepr"><td colspan="6"></td></tr>';
    IND.forEach(function (ind) {
      h += '<tr><td><span class="tip" tabindex="0" data-tipk="ind-' + ind.k + '">' + esc(ind.name) + "</span></td>" + cols.map(function (c) {
        var v, rd, when;
        if (c.kind === "live") { v = lp.p[ind.k]; rd = ind.read(lraw); when = "Live"; }
        else if (c.row) { var hp = histParts(c.row); v = hp.p[ind.k]; rd = ind.read(rowRaw(c.row)); when = "Week of " + fdy(c.row.d); }
        else { v = null; }
        return cell(v, bandCol(v), v == null ? "" : String(Math.round(v)), (when || "") + ": " + ind.name + " " + (rd || "—") + " → score " + (v == null ? "—" : Math.round(v)));
      }).join("") + "</tr>";
    });
    $("cyc-t").innerHTML = h + "</tbody>";
    $("cyc-note").textContent = "Scores use " + (S.lv === "adj" ? "small-cycle" : "classic") + " levels. Past columns use the weekly reading nearest that day. Leverage data starts in 2023, so it is blank for past cycles. Hover a cell for the reading.";
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
  function applyLv() {
    Array.prototype.forEach.call(document.querySelectorAll("#lv button"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-l") === S.lv ? "true" : "false"); });
    $("hl-score").textContent = "Value score, " + (S.lv === "adj" ? "small-cycle" : "classic") + " levels (weekly, then daily from 8 Nov 2026)";
  }
  $("lv").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    S.lv = b.getAttribute("data-l") === "classic" ? "classic" : "adj"; sset("bbm.levels", S.lv); applyLv();
    shownScore = null; if (S.latest) renderAll();
  });
  applyLv();
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
  var rz; window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { renderHistory(); if (S.tab === "cyc" && S.hist) renderCycChart(); }, 150); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { fetchPrice(); if (Date.now() - (S.dataAt || 0) > 5 * 60e3) { S.dataAt = Date.now(); loadData(); } } });

  // ---------- start ----------
  applySkin();
  S.dataAt = Date.now();
  loadData().then(function () { fetchPrice(); fetchHourly(); fetchDaily(); });
  fetchCbbi();
  fetchCM();
  loadHist();
  if (qs.get("debug") === "1") window.__bbm = { S: S, histVal: histVal, parts: parts, biLive: biLive, clockNow: clockNow, histNear: histNear };
  setInterval(function () { if (!document.hidden) fetchPrice(); }, 15000);
  setInterval(renderLiveAge, 1000);
  setInterval(function () { if (!document.hidden) { fetchHourly(); if (S.latest) renderHistory(); } }, 5 * 60e3);
  setInterval(function () { S.dataAt = Date.now(); loadData(); }, 10 * 60e3);
  setInterval(fetchDaily, 60 * 60e3);
  setInterval(fetchCbbi, 6 * 60 * 60e3);
  setInterval(fetchCM, 6 * 60 * 60e3);
})();
