#!/usr/bin/env node
/**
 * refresh.mjs — daily data refresh for BTC Bottom Monitor (local fork)
 *
 * The upstream site is a static client-side app. Everything is recomputed in the
 * browser except nine series that its private "daily task" wrote into data.json
 * and recent.json:
 *
 *   7 x LookIntoBitcoin on-chain lines (cvdd, balanced, sth, lth, sopr, reserve risk,
 *       addresses in loss)  -> recent.json (and data.json ref/raw)
 *   ETF net flow (10 day, BTC) -> data.json confirm.etf10d
 *   USDT dominance (30 day % change) -> data.json confirm.usdtd30d
 *
 * This script rebuilds exactly those, from public sources, and recomputes the
 * matching data.json day (raw/ref/score) with the site's own scoring model.
 *
 * Usage:
 *   node scripts/refresh.mjs                 # fetch and write data.json + recent.json
 *   node scripts/refresh.mjs --dry-run       # print the result, write nothing
 *   node scripts/refresh.mjs --date=2026-11-22
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");
const DATE_ARG = (process.argv.find((a) => a.startsWith("--date=")) || "").split("=")[1] || null;

// ---------------------------------------------------------------------------
// The site's own scoring model (app.js) — loaded with BVM_EXPORT so it stops
// before touching the DOM. This guarantees the score matches the site exactly.
// ---------------------------------------------------------------------------
global.window = { BVM_EXPORT: true };
eval(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"));
const BVM = global.window.BVM;
const { addDays, daysBetween, CYCLES } = BVM;
const NOWC = CYCLES[3]; // { top: "2025-10-06", ... }

const UA = "btc-bottom-monitor-refresh/1.0 (+https://github.com/pipolarbear/btc-bottom-monitor)";
const DAY_MS = 864e5;
const dnum = (s) => Date.parse(s + "T00:00:00Z");

function log(...a) { console.log(...a); }
function warn(...a) { console.warn(...a); }

async function fetchText(url, tries = 3, extraHeaders = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "*/*", ...extraHeaders },
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.text();
    } catch (e) {
      last = e;
      if (i < tries) await new Promise((res) => setTimeout(res, 1500 * i));
    }
  }
  throw last;
}
const fetchJSON = async (url, opts = {}) => JSON.parse(await fetchText(url, 3, opts.headers || {}));

function asOfCbr() {
  try {
    const d = new Date();
    const hm = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(d);
    let tz = new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Sydney", timeZoneName: "short" })
      .formatToParts(d).find((p) => p.type === "timeZoneName")?.value || "";
    if (/GMT\+11/i.test(tz)) tz = "AEDT";
    else if (/GMT\+10/i.test(tz)) tz = "AEST";
    if (!tz || /^GMT/.test(tz)) tz = "AEDT";
    return `${hm} ${tz}`;
  } catch {
    return new Date().toISOString().slice(11, 16) + " UTC";
  }
}
function todayCbr() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  } catch { return new Date().toISOString().slice(0, 10); }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

// Coin Metrics community API: daily price, MVRV, issuance (USD), hash rate.
async function fetchCM() {
  let url = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics" +
    "?assets=btc&metrics=PriceUSD,CapMVRVCur,IssTotUSD,HashRate&frequency=1d" +
    "&start_time=2013-06-01&page_size=10000";
  const rows = [];
  let guard = 0;
  while (url && guard++ < 25) {
    const j = await fetchJSON(url);
    rows.push(...(j.data || []));
    url = j.next_page_url || null;
  }
  const clean = rows.filter((x) => x.PriceUSD && x.CapMVRVCur);
  if (clean.length < 2000) throw new Error(`Coin Metrics: only ${clean.length} usable rows`);
  return clean.map((x) => ({
    d: x.time.slice(0, 10),
    price: +x.PriceUSD,
    mvrv: +x.CapMVRVCur,
    iss: x.IssTotUSD == null ? null : +x.IssTotUSD,
    hr: x.HashRate == null ? null : +x.HashRate,
  }));
}

// alternative.me Fear & Greed, full daily history.
async function fetchFng() {
  const j = await fetchJSON("https://api.alternative.me/fng/?limit=0&format=json");
  const m = {};
  (j.data || []).forEach((x) => {
    m[new Date(+x.timestamp * 1000).toISOString().slice(0, 10)] = +x.value;
  });
  if (!Object.keys(m).length) throw new Error("Fear & Greed: empty");
  return m;
}

// Bybit perpetual: funding history and daily open interest, back to 100 days before the top.
async function fetchLevBybit() {
  const since = dnum(addDays(NOWC.top, -100));
  const fund = [];
  const oi = [];

  async function fstep(end, n) {
    const j = await fetchJSON(
      `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=200` +
      (end ? `&endTime=${end}` : "")
    );
    const l = j.result?.list || [];
    if (!l.length) return;
    l.forEach((x) => fund.push([+x.fundingRateTimestamp, +x.fundingRate]));
    const oldest = Math.min(...l.map((x) => +x.fundingRateTimestamp));
    if (oldest > since && n < 12) return fstep(oldest - 1, n + 1);
  }
  async function ostep(cur, n) {
    const j = await fetchJSON(
      `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT` +
      `&intervalTime=1d&limit=200` + (cur ? `&cursor=${encodeURIComponent(cur)}` : "")
    );
    const l = j.result?.list || [];
    if (!l.length) return;
    l.forEach((x) => oi.push([+x.timestamp, +x.openInterest]));
    const oldest = Math.min(...l.map((x) => +x.timestamp));
    if (oldest > since && j.result?.nextPageCursor && n < 8) return ostep(j.result.nextPageCursor, n + 1);
  }

  await Promise.all([fstep(null, 0), ostep(null, 0)]);
  const uniq = (a) => {
    const seen = new Set();
    return a.filter((x) => (seen.has(x[0]) ? false : (seen.add(x[0]), true))).sort((x, y) => x[0] - y[0]);
  };
  if (!fund.length && !oi.length) throw new Error("Bybit leverage: empty");
  return { fund: uniq(fund), oi: uniq(oi) };
}

// US-accessible fallback: Kraken Futures hourly funding (Kraken has no public
// historical open interest). Hourly rates are scaled to 8-hour equivalents so the
// existing annualisation (3 x 365) stays correct; oiDrawdown is left missing and
// the site scores the leverage signal on funding alone.
async function fetchLevKraken() {
  const j = await fetchJSON("https://futures.kraken.com/derivatives/api/v3/historical-funding-rates?symbol=PF_XBTUSD");
  const rates = j.rates || [];
  if (!rates.length) throw new Error("Kraken funding: empty");
  const fund = rates
    .map((r) => [Date.parse(r.timestamp), +r.relativeFundingRate * 8])
    .filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]));
  return { fund, oi: [] };
}

async function fetchLev() {
  try {
    return await fetchLevBybit();
  } catch (e) {
    warn("Bybit funding/OI failed:", e.message);
  }
  try {
    const k = await fetchLevKraken();
    warn("Using Kraken Futures funding (no open-interest history).");
    return k;
  } catch (e) {
    warn("Kraken funding failed:", e.message);
  }
  return { fund: [], oi: [] };
}

// Daily candles (UTC): close and intraday low. Bybit spot, Coinbase as fallback.
async function fetchOhlc() {
  try {
    const j = await fetchJSON("https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=D&limit=1000");
    const o = {};
    (j.result?.list || []).forEach((k) => {
      o[new Date(+k[0]).toISOString().slice(0, 10)] = { h: +k[2], l: +k[3], c: +k[4] };
    });
    if (Object.keys(o).length) return o;
  } catch (e) {
    warn("Bybit daily candles failed, trying Coinbase:", e.message);
  }
  const a = await fetchJSON("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400");
  const o = {};
  a.forEach((k) => {
    o[new Date(k[0] * 1000).toISOString().slice(0, 10)] = { h: +k[2], l: +k[1], c: +k[4] };
  });
  return o;
}

// DefiLlama: total stablecoin circulating supply by day.
async function fetchStable() {
  const a = await fetchJSON("https://stablecoins.llama.fi/stablecoincharts/all");
  const m = {};
  a.forEach((r) => {
    const v = r.totalCirculatingUSD?.peggedUSD;
    if (v) m[new Date(+r.date * 1000).toISOString().slice(0, 10)] = v;
  });
  if (Object.keys(m).length < 40) throw new Error("DefiLlama stablecoins: short history");
  return m;
}

// Coinbase premium: Coinbase BTC/USD vs Binance BTC/USDT (Bybit fallback), in %.
async function fetchPremium() {
  const other = fetchJSON("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")
    .then((j) => +j.price)
    .catch(() => fetchJSON("https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT")
      .then((j) => +j.result.list[0].lastPrice))
    .catch(() => fetchJSON("https://api.kraken.com/0/public/Ticker?pair=XBTUSD").then((j) => {
      const t = j.result[Object.keys(j.result)[0]];
      return +t.c[0];
    }));
  const [cb, off] = await Promise.all([
    fetchJSON("https://api.exchange.coinbase.com/products/BTC-USD/ticker").then((j) => +j.price),
    other,
  ]);
  if (!(cb > 0 && off > 0)) throw new Error("Coinbase premium: bad prices");
  return (cb / off - 1) * 100;
}

// ---------------------------------------------------------------------------
// LookIntoBitcoin: public v2 chart API (the site's own source)
//   https://frontend.api.lookintobitcoin.com/api/v2/charts/<slug>/
// ---------------------------------------------------------------------------
const LIB_CHARTS = [
  { key: "cvdd",     slug: "cvdd",                             trace: "CVDD" },
  { key: "balanced", slug: "balanced-price",                   trace: "Balanced Price" },
  { key: "sth",      slug: "short-term-holder-realized-price", trace: "Short-Term Holder Realized Price" },
  { key: "lth",      slug: "long-term-holder-realized-price",  trace: "Long-Term Holder Realized Price" },
  { key: "sopr",     slug: "sopr-spent-output-profit-ratio",   trace: "SOPR" },
  { key: "rr",       slug: "reserve-risk",                     trace: "Reserve Risk" },
  { key: "loss",     slug: "percent-addresses-in-loss",        trace: "Addresses in Loss" },
];

function lastValid(t) {
  const x = t?.x || [];
  const y = t?.y || [];
  const n = Math.min(x.length, y.length);
  for (let i = n - 1; i >= 0; i--) {
    if (y[i] != null && Number.isFinite(+y[i])) {
      return { date: String(x[i]).slice(0, 10), value: +y[i], index: i };
    }
  }
  return null;
}
function tailValid(t, k) {
  const x = t?.x || [];
  const y = t?.y || [];
  const n = Math.min(x.length, y.length);
  const out = [];
  for (let i = n - 1; i >= 0 && out.length < k; i--) {
    if (y[i] != null && Number.isFinite(+y[i])) out.push(+y[i]);
  }
  return out.reverse();
}

async function fetchLib() {
  const out = {};
  let chartDate = null;

  for (const c of LIB_CHARTS) {
    const j = await fetchJSON(`https://frontend.api.lookintobitcoin.com/api/v2/charts/${c.slug}/`);
    const traces = j.data || [];
    let trace;
    if (c.key === "sopr") {
      // Two traces are named "SOPR" (raw and a lagging variant). Use the one
      // that reaches the latest date; its values are already SOPR - 1.
      trace = traces
        .filter((t) => t.name === c.trace)
        .map((t) => ({ t, lv: lastValid(t) }))
        .filter((x) => x.lv)
        .sort((a, b) => (a.lv.date < b.lv.date ? 1 : -1))[0]?.t;
    } else {
      trace = traces.find((t) => t.name === c.trace);
    }
    if (!trace) throw new Error(`LookIntoBitcoin ${c.slug}: trace "${c.trace}" not found`);
    const lv = lastValid(trace);
    if (!lv) throw new Error(`LookIntoBitcoin ${c.slug}: no values`);
    out[c.key] = { ...lv, trace };
    if (!chartDate || lv.date > chartDate) chartDate = lv.date;

    if (c.key === "rr") {
      const pt = traces.find((t) => t.name === "BTC Price");
      out._rrPrice = pt?.y?.[lv.index] != null ? +pt.y[lv.index] : null;
      if (out._rrPrice == null && pt) {
        const lp = lastValid(pt);
        out._rrPrice = lp ? lp.value : null;
      }
    }
    if (c.key === "sopr") {
      const t7 = tailValid(trace, 7);
      out._sopr7d = t7.length ? t7.reduce((a, b) => a + b, 0) / t7.length : null;
    }
  }

  if (!chartDate) throw new Error("LookIntoBitcoin: no chart dates");
  out._chartDate = chartDate;
  return out;
}

// ---------------------------------------------------------------------------
// Farside: US spot Bitcoin ETF daily net flows (USD millions) -> BTC
//   https://farside.co.uk/bitcoin-etf-flow-all/
// ---------------------------------------------------------------------------
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function parseFd(s) {
  const [dd, mon, yyyy] = s.split(" ");
  return `${yyyy}-${String(MONTHS[mon]).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}
function nearestPrice(map, date) {
  const keys = Object.keys(map).filter((k) => map[k] > 0).sort();
  if (!keys.length) return null;
  let best = keys[0];
  for (const k of keys) if (Math.abs(dnum(k) - dnum(date)) < Math.abs(dnum(best) - dnum(date))) best = k;
  return map[best];
}

async function fetchEtfFarside(cmByDate) {
  // Farside rejects requests without a browser UA/Referer from datacenter IPs.
  const html = await fetchText("https://farside.co.uk/bitcoin-etf-flow-all/", 3, {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
    Referer: "https://farside.co.uk/",
    "Accept-Language": "en-GB,en;q=0.9",
  });
  const rows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
    .map((m) => [...m[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((c) => c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()))
    .filter((r) => r.length > 3 && /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(r[0]));

  const flow = (s) => (!s || s === "-" ? null : s.startsWith("(") ? -parseFloat(s.replace(/[()]/g, "")) : parseFloat(s));

  const parsed = rows.map((r) => {
    const funds = r.slice(1, -1).map(flow);
    const total = flow(r[r.length - 1]);
    return { date: parseFd(r[0]), total, hasFundData: funds.some((v) => v != null) };
  }).filter((r) => r.hasFundData && r.total != null);

  const last10 = parsed.slice(-10);
  if (last10.length < 10) throw new Error(`Farside: only ${last10.length} reported rows`);

  let sum = 0;
  const used = [];
  for (const r of last10) {
    const p = cmByDate[r.date] ?? nearestPrice(cmByDate, r.date);
    if (!p) throw new Error(`Farside: no BTC price for ${r.date}`);
    sum += (r.total * 1e6) / p;
    used.push(r.date);
  }
  return { etf10d: sum, days: used };
}

// CoinGlass v4 (exact, BTC-denominated): preferred when COINGLASS_API_KEY is set.
// Response: { code:"0", data:[{ timestamp, flow_usd, price_usd, etf_flows:[...] }] }
async function fetchEtfCoinGlass(key) {
  const j = await fetchJSON("https://open-api-v4.coinglass.com/api/etf/bitcoin/flow-history", {
    headers: { "CG-API-KEY": key, Accept: "application/json" },
  });
  if (String(j.code) !== "0") throw new Error(`CoinGlass: ${j.msg || "code " + j.code}`);
  const rows = (j.data || []).slice().sort((a, b) => a.timestamp - b.timestamp).slice(-10);
  if (rows.length < 10) throw new Error(`CoinGlass: only ${rows.length} rows`);
  const sum = rows.reduce((a, r) => a + (+r.flow_usd / +r.price_usd), 0);
  return { etf10d: sum, days: rows.map((r) => new Date(r.timestamp).toISOString().slice(0, 10)) };
}

async function fetchEtf(cmByDate) {
  const key = process.env.COINGLASS_API_KEY;
  if (key) {
    try {
      return await fetchEtfCoinGlass(key);
    } catch (e) {
      warn("CoinGlass ETF failed, falling back to Farside:", e.message);
    }
  }
  return fetchEtfFarside(cmByDate);
}

// ---------------------------------------------------------------------------
// CoinMarketCap (public web data API): USDT dominance, 30-day relative change
//   dominance = USDT market cap / total crypto market cap
// ---------------------------------------------------------------------------
async function fetchUsdtDominance() {
  const now = Math.floor(Date.now() / 1000);
  const past = now - 31 * 86400;
  const gh = await fetchJSON(
    `https://api.coinmarketcap.com/data-api/v3/global-metrics/quotes/historical` +
    `?format=chart&interval=1d&timeEnd=${now}&timeStart=${past}`
  );
  const quotes = gh.data?.quotes || [];
  if (quotes.length < 20) throw new Error("CMC global metrics: short history");
  const qA = quotes[0];
  const qB = quotes[quotes.length - 1];
  const totalMc = (q) => q.quote?.find((x) => x.name === "USD")?.totalMarketCap;

  const uc = await fetchJSON("https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail/chart?id=825&range=1M");
  const pts = Object.entries(uc.data?.points || {})
    .map(([t, v]) => ({ t: +t, mcap: v.v?.[2] }))
    .filter((x) => x.mcap > 0)
    .sort((a, b) => a.t - b.t);
  if (pts.length < 20) throw new Error("CMC USDT chart: short history");

  const near = (ts) => pts.reduce((b, p) => (Math.abs(p.t - ts) < Math.abs(b.t - ts) ? p : b), pts[0]);
  const uA = near(Date.parse(qA.timestamp) / 1000);
  const uB = near(Date.parse(qB.timestamp) / 1000);
  const domA = uA.mcap / totalMc(qA);
  const domB = uB.mcap / totalMc(qB);
  if (!(domA > 0 && domB > 0)) throw new Error("CMC dominance: bad values");
  return { usdtd30d: (domB / domA - 1) * 100, domNow: domB * 100, domAgo: domA * 100 };
}

// ---------------------------------------------------------------------------
// Calculations (ported from app.js: cmPre, levAt, fg7, buildRows)
// ---------------------------------------------------------------------------
function cmPre(cm) {
  const P = cm.map((x) => x.price);
  const iss = cm.map((x) => x.iss);
  const hr = cm.map((x) => x.hr);
  for (let i = 1; i < cm.length; i++) {
    if (iss[i] == null) iss[i] = iss[i - 1];
    if (hr[i] == null) hr[i] = hr[i - 1];
  }
  const pref = (a) => {
    const s = [0];
    for (const v of a) s.push(s[s.length - 1] + (v || 0));
    return s;
  };
  const sp = pref(P), si = pref(iss), sh = pref(hr);
  const avg = (s, k, w) => (k - w + 1 < 0 ? null : (s[k + 1] - s[k - w + 1]) / w);

  const kf = 2 / 151;
  let e = null, e2 = null, ath = 0, athD = null, cap = 0, lastRec = null;
  const ema = [], emaAll = [], hc = [], rec = [], athA = [];
  for (let j = 0; j < cm.length; j++) {
    if (cm[j].d >= "2019-01-01") e = e == null ? P[j] : P[j] * kf + e * (1 - kf);
    ema.push(e);
    e2 = e2 == null ? P[j] : P[j] * kf + e2 * (1 - kf);
    emaAll.push(j >= 150 ? e2 : null);
    if (P[j] > ath) { ath = P[j]; athD = cm[j].d; }
    athA.push([ath, athD]);
    if (j >= 60) {
      const a30 = avg(sh, j, 30), a60 = avg(sh, j, 60);
      if (a30 < a60) cap++;
      else { if (cap >= 7) lastRec = cm[j].d; cap = 0; }
      hc.push(a30 < a60 ? 1 : 0);
    } else hc.push(null);
    rec.push(lastRec);
  }
  return { P, iss, sp, si, sh, avg, ema, athA, hc, rec };
}

function levAt(end, fund, oi) {
  const res = { f: null, o: null };
  if (fund?.length) {
    let s = 0, n = 0;
    for (let i = fund.length - 1; i >= 0; i--) {
      if (fund[i][0] > end) continue;
      if (fund[i][0] <= end - 7 * DAY_MS) break;
      s += fund[i][1]; n++;
    }
    if (n >= 12) res.f = (s / n) * 3 * 365 * 100;
  }
  if (oi?.length) {
    const b = [];
    for (let i = oi.length - 1; i >= 0 && b.length < 90; i--) if (oi[i][0] <= end) b.push(oi[i][1]);
    if (b.length >= 30) {
      const mx = Math.max(...b);
      res.o = ((mx - b[0]) / mx) * 100;
    }
  }
  return res.f == null && res.o == null ? null : res;
}

function fg7(fng, d) {
  let s = 0, n = 0;
  for (let i = 0; i < 7; i++) {
    const v = fng[addDays(d, -i)];
    if (v != null) { s += v; n++; }
  }
  return n >= 4 ? s / n : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log(`BTC Bottom Monitor refresh — ${new Date().toISOString()}`);

  const cm = await fetchCM();
  const cmByDate = Object.fromEntries(cm.map((x) => [x.d, x.price]));
  log(`Coin Metrics: ${cm.length} rows, latest ${cm[cm.length - 1].d}`);

  async function opt(name, fn, fallback = null) {
    try {
      return await fn();
    } catch (e) {
      warn(`${name} failed: ${e.message}`);
      return fallback;
    }
  }

  // Coin Metrics and LookIntoBitcoin are required. The rest are optional: US
  // datacenter IPs (GitHub runners) are blocked by some venues, and a missing
  // signal is handled by the site's weighted average. Values are carried forward
  // where the reading still needs one.
  const [fng, lev, ohlc, stable, cbPremium, lib, usdtRes, etfRes] = await Promise.all([
    opt("Fear & Greed", fetchFng),
    opt("Leverage (Bybit/Kraken)", fetchLev, { fund: [], oi: [] }),
    opt("Daily candles", fetchOhlc, {}),
    opt("DefiLlama stablecoins", fetchStable),
    opt("Coinbase premium", fetchPremium),
    fetchLib(),
    opt("USDT dominance", fetchUsdtDominance),
    opt("Farside ETF", () => fetchEtf(cmByDate)),
  ]);
  log(`Fear & Greed: ${fng ? Object.keys(fng).length + " days" : "unavailable"}`);
  log(`Leverage: ${lev.fund.length} funding points, ${lev.oi.length} OI points`);
  log(`OHLC: ${Object.keys(ohlc).length} days`);
  log(`Stablecoins: ${stable ? Object.keys(stable).length + " days" : "unavailable"}`);
  log(`Coinbase premium: ${cbPremium == null ? "unavailable" : cbPremium.toFixed(2) + "%"}`);
  log(`LookIntoBitcoin: chart date ${lib._chartDate}`);
  log(`Farside ETF: ${etfRes ? etfRes.etf10d.toFixed(0) + " BTC (10d)" : "carried forward"}`);
  log(`USDT dominance: ${usdtRes ? usdtRes.usdtd30d.toFixed(2) + "% (30d)" : "carried forward"}`);

  // The LookIntoBitcoin row is stored one day before the chart's latest date,
  // matching the upstream recent.json convention ("the chart date minus one day").
  // recent.json rows use the chart date minus one (last complete UTC day), matching
  // upstream. data.json is labelled with the Canberra date of the run (like the
  // upstream 07:00 task); the app maps that record back with date - 2.
  let rowDate = DATE_ARG || addDays(lib._chartDate, -1);
  const dayDate = DATE_ARG || todayCbr();
  let idx = cm.findIndex((x) => x.d === rowDate);
  if (idx < 0) {
    idx = cm.length - 1;
    rowDate = cm[idx].d;
    warn(`No Coin Metrics row for ${DATE_ARG || "chart date - 1"}; using ${rowDate}`);
  }
  const cmRow = cm[idx];
  const p = cmRow.price;

  const X = cmPre(cm);
  const { P, iss, sp, si, avg, ema, athA, hc, rec } = X;

  const s1400 = avg(sp, idx, 1400);
  const s200 = avg(sp, idx, 200);
  const s471 = avg(sp, idx, 471);
  const i365 = avg(si, idx, 365);

  const sthP = lib.sth.value;
  const lthP = lib.lth.value;
  const cvddP = lib.cvdd.value;
  const balP = lib.balanced.value;
  const addrLoss = lib.loss.value;
  const sopr7d = lib._sopr7d;
  const rr = lib.rr.value;
  const pL = lib._rrPrice;

  const dsp = daysBetween(athA[idx][1], rowDate);
  const dsr = rec[idx] ? daysBetween(rec[idx], rowDate) : null;

  // Running cycle low from daily candles (top to rowDate).
  let lowRun = null, lowD = null;
  for (let d = NOWC.top; d <= rowDate; d = addDays(d, 1)) {
    const o = ohlc[d];
    if (!o) continue;
    const dl = Math.min(o.l, o.c);
    if (lowRun == null || dl < lowRun) { lowRun = dl; lowD = d; }
  }
  const o = ohlc[rowDate];
  const lo = o ? Math.min(o.l, p) : p;
  if (lowRun == null || lo < lowRun) { lowRun = lo; lowD = rowDate; }
  const dsl = lowD ? daysBetween(lowD, rowDate) : null;

  const lv = levAt(dnum(addDays(rowDate, 1)), lev.fund, lev.oi);

  const r = {
    d: rowDate,
    p,
    cvdd: cvddP ? p / cvddP : null,
    mvrv: cmRow.mvrv,
    lth: lthP ? p / lthP : null,
    bal: balP ? p / balP : null,
    w200: s1400 ? p / s1400 : null,
    pi: ema[idx] && s471 ? ema[idx] / (0.745 * s471) : null,
    dsp,
    mayer: s200 ? p / s200 : null,
    sopr: sopr7d,
    loss: addrLoss,
    puell: i365 ? iss[idx] / i365 : null,
    sth: sthP ? p / sthP : null,
    fg: fg7(fng || {}, rowDate),
    hcap: hc[idx],
    dsr,
    rr: rr != null && pL ? rr * p / pL : rr,
    fund: lv ? lv.f : null,
    oidd: lv ? lv.o : null,
    lo,
    low: lowRun,
    dsl,
  };

  const raw = BVM.rowRaw(r);
  const score = BVM.parts({ date: rowDate, raw }, raw, "adj").total;

  const ref = {
    realizedPrice: raw.mvrv ? p / raw.mvrv : null,
    lthPrice: lthP,
    cvddPrice: cvddP,
    balancedPrice: balP,
    sthPrice: sthP,
    sma1400: s1400,
    sma200: s200,
  };

  // Carry forward the two display-only series when a source is flaky.
  const dataPath = path.join(ROOT, "data.json");
  const recentPath = path.join(ROOT, "recent.json");
  const prev = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const prevConfirm = prev.days?.[prev.days.length - 1]?.confirm || {};
  const stable30d = (() => {
    if (!stable) return prevConfirm.stable30d ?? null;
    const ks = Object.keys(stable).sort();
    const last = ks[ks.length - 1];
    const past = addDays(last, -30);
    return stable[past] ? (stable[last] / stable[past] - 1) * 100 : (prevConfirm.stable30d ?? null);
  })();
  const confirm = {
    etf10d: etfRes?.etf10d ?? prevConfirm.etf10d ?? null,
    cbPremium: cbPremium ?? prevConfirm.cbPremium ?? null,
    stable30d,
    usdtd30d: usdtRes?.usdtd30d ?? prevConfirm.usdtd30d ?? null,
  };

  const day = {
    date: dayDate,
    asOf: asOfCbr(),
    price: +p.toFixed(2),
    score: score == null ? null : +score.toFixed(2),
    raw: roundObj(raw, 6),
    ref: roundObj(ref, 2),
    confirm: roundObj(confirm, 6),
  };

  log(`LookIntoBitcoin pL (reserve-risk price): ${pL}`);
  log(`Dates: data.json=${dayDate}, recent.json=${rowDate}`);
  log("\nNew reading:");
  log(JSON.stringify(day, null, 2));

  if (DRY) {
    log("\n--dry-run: nothing written.");
    return;
  }

  // data.json: upsert the day, keep a rolling window (60 days).
  const days = (prev.days || []).filter((x) => x.date !== dayDate).concat([day])
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-60);
  const dataOut = { ...prev, updated: new Date().toISOString(), days };
  fs.writeFileSync(dataPath, JSON.stringify(dataOut));

  // recent.json: upsert the LookIntoBitcoin row.
  const prevRecent = JSON.parse(fs.readFileSync(recentPath, "utf8"));
  const row = [
    rowDate,
    round(sthP, 4), round(lthP, 4), round(cvddP, 4), round(balP, 4),
    round(addrLoss, 6), round(sopr7d, 6), round(rr, 9), round(pL, 2),
  ];
  const rows = (prevRecent.rows || []).filter((x) => x[0] !== rowDate).concat([row])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const recentOut = { ...prevRecent, built: new Date().toISOString(), rows };
  fs.writeFileSync(recentPath, JSON.stringify(recentOut));

  log(`\nWrote data.json (${days.length} days) and recent.json (${rows.length} rows).`);
}

function round(v, d) {
  if (v == null || !Number.isFinite(v)) return v;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
function roundObj(o, d) {
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === "number" ? round(v, d) : v;
  return out;
}

main().catch((e) => {
  console.error("refresh failed:", e);
  process.exit(1);
});
