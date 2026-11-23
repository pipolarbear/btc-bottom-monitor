# BTC Value Monitor — local fork

A live BTC dashboard: is BTC cheap against past cycle lows, has the fall stopped, and
where are we in the cycle. It is a **static, client-side app** (HTML + CSS + JS) cloned
from [pixelmango47/btc-bottom-monitor](https://github.com/pixelmango47/btc-bottom-monitor)
(MIT). Everything is scored in the browser.

This fork adds:

- `scripts/refresh.mjs` — a daily job that rebuilds the data the upstream private
  "daily task" used to produce (`data.json` + `recent.json`).
- `.github/workflows/refresh.yml` — runs that job once a day on GitHub Actions.
- This README, listing every source, how often it is called, what it returns, and in
  what format, with request/response examples.

> Information only. Not financial advice. Past lows do not promise future lows.

---

## Run locally

The app uses `fetch()`, so it must be served over HTTP (not opened as `file://`):

```bash
cd btc-bottom-monitor
python3 -m http.server 8000
# open http://localhost:8000
```

No build step and no dependencies are required for the site itself. The refresh
script runs on Node 20+ (uses built-in `fetch`).

---

## How the data works

There are two layers:

1. **Live, in the browser.** Price, on-chain metrics, funding, fear & greed,
   stablecoins and the Coinbase premium are fetched from public APIs each time the
   page opens, then on timers. The site recomputes the scores in your browser.

2. **Daily job.** Nine series cannot be fetched from a browser (CORS/anti-bot) and
   are written into the repo by the daily job:
   - 7 LookIntoBitcoin on-chain lines,
   - US spot Bitcoin ETF net flows (10-day),
   - USDT dominance (30-day change).

   The job writes `recent.json` (the LookIntoBitcoin lines) and `data.json`
   (daily readings + the two flow series), then commits them. GitHub Pages redeploys
   automatically.

---

## Data sources

### A. Live in the browser

| Source | Request | Frequency | Retrieved | Format |
|---|---|---|---|---|
| Bybit (spot) | `GET api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT` | every **15 s** (price); 5 min (hourly spark) | last price, 24h change/high/low | JSON |
| Coinbase Exchange | `GET api.exchange.coinbase.com/products/BTC-USD/ticker` / `.../stats` | 15 s fallback; 5 min | spot price, 24h stats | JSON |
| Kraken | `GET api.kraken.com/0/public/Ticker?pair=XBTUSD` | 15 s fallback | last price | JSON |
| OKX | `GET www.okx.com/api/v5/market/ticker?instId=BTC-USDT` | 15 s fallback | last price | JSON |
| Binance | `GET api.binance.com/api/v3/ticker/price?symbol=BTCUSDT` | 5 min (premium) | USDT price | JSON |
| Coin Metrics | `GET community-api.coinmetrics.io/v4/timeseries/asset-metrics?...` | on load, then **every 60 min** | daily PriceUSD, CapMVRVCur, IssTotUSD, HashRate (2013→now) | JSON |
| alternative.me | `GET api.alternative.me/fng/?limit=0&format=json` | on load, then **every 60 min** | full daily Crypto Fear & Greed history | JSON |
| DefiLlama | `GET stablecoins.llama.fi/stablecoincharts/all` | on load, then **every 60 min** | total stablecoin circulating supply by day | JSON |
| Bybit (derivatives) | `GET api.bybit.com/v5/market/funding/history` + `.../open-interest` | on load, then **every 30 min** | BTCUSDT perpetual funding + daily open interest | JSON |
| Bybit / Coinbase (candles) | `GET api.bybit.com/v5/market/kline?interval=D&limit=1000` | on load, then **every 10 min** | daily UTC OHLC (close + intraday low) | JSON |
| Colin Talks Crypto | `GET colintalkscrypto.com/cbbi/data/latest.json` | on load, then **every 6 h** | CBBI index and its nine components | JSON (~2.9 MB) |
| Local files | `GET data.json`, `recent.json`, `history.json` | on load; `data.json` every 10 min | daily readings, LookIntoBitcoin lines, weekly backtest history | JSON |

The browser also loads Google Fonts and, only when you click "Save image",
`html-to-image` from jsDelivr.

#### Examples

**Coin Metrics** (first page; follow `next_page_url` for the rest):

```http
GET https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=PriceUSD,CapMVRVCur,IssTotUSD,HashRate&frequency=1d&start_time=2013-06-01&page_size=10000
```

```json
{
  "data": [
    {
      "asset": "btc",
      "time": "2026-11-21T00:00:00.000000000Z",
      "CapMVRVCur": "1.129929114670857201",
      "HashRate": "1099149207.230298802946790277256069019798",
      "IssTotUSD": "30812838.20861198875",
      "PriceUSD": "60122.6111387551"
    }
  ],
  "next_page_token": "…",
  "next_page_url": "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?…"
}
```

**alternative.me**:

```json
{ "name": "Fear and Greed Index", "data": [
  { "value": "11", "value_classification": "Extreme Fear", "timestamp": "1795392000" }
] }
```

**DefiLlama**:

```json
[
  { "date": "1795392000", "totalCirculatingUSD": { "peggedUSD": 282756445288.91 } }
]
```

**Bybit funding**:

```json
{ "retCode": 0, "result": { "list": [
  { "symbol": "BTCUSDT", "fundingRate": "0.00002046", "fundingRateTimestamp": "1795420800000" }
] } }
```

**Bybit open interest**:

```json
{ "retCode": 0, "result": {
  "list": [{ "openInterest": "67983.69300000", "timestamp": "1795392000000" }],
  "nextPageCursor": "lastid%3D22986009%26lasttime%3D1795305600"
} }
```

**Bybit daily candle** (`[start, open, high, low, close, volume, turnover]`):

```json
{ "retCode": 0, "result": { "list": [
  ["1795392000000", "61273.7", "64593", "60383.9", "62822.7", "14265.465894", "887523441.16948997"]
] } }
```

**Coinbase ticker**:

```json
{ "price": "62743.54", "bid": "62742.3", "ask": "62742.88", "time": "2026-11-23T15:57:35.520258465Z" }
```

**Binance ticker**:

```json
{ "symbol": "BTCUSDT", "price": "62830.26000000" }
```

**CBBI** (object keyed by Unix timestamps; truncated):

```json
{
  "Price": { "1795392000": 61154 },
  "Confidence": { "1795392000": 0.12 },
  "PiCycle": { "…": "…" },
  "RUPL": { "…": "…" },
  "RHODL": { "…": "…" },
  "Puell": { "…": "…" },
  "2YMA": { "…": "…" }
}
```

---

### B. Daily refresh job

Run by `.github/workflows/refresh.yml` at **20:00 UTC ≈ 07:00 AEDT** (the upstream
task's time), or manually via `workflow_dispatch`.

| # | Source | Request | Frequency | Retrieved | Format |
|---|---|---|---|---|---|
| 1 | **LookIntoBitcoin** | `GET frontend.api.lookintobitcoin.com/api/v2/charts/<slug>/` × 7 | daily | CVDD, balanced price, STH cost, LTH cost, SOPR-1 (7d mean), reserve risk, addresses in loss | JSON (Plotly traces) |
| 2 | **Farside** | `GET farside.co.uk/bitcoin-etf-flow-all/` | daily | US spot BTC ETF net flows, USD millions per fund/day | HTML table |
| 3 | **CoinMarketCap** | `GET api.coinmarketcap.com/data-api/v3/global-metrics/quotes/historical` + `…/cryptocurrency/detail/chart?id=825&range=1M` | daily | total crypto market cap + USDT market cap history | JSON |
| 4 | **Coin Metrics** | as above | daily | daily closes, MVRV, issuance, hash rate (for `ref`/`raw`) | JSON |
| 5 | **Bybit / Coinbase / Binance / DefiLlama / alternative.me** | as above | daily | funding/OI, OHLC, premium, stablecoins, F&G | JSON |

**LookIntoBitcoin slugs used:**

| Series | Slug | Trace to read |
|---|---|---|
| CVDD (USD) | `cvdd` | `CVDD` |
| Balanced price (USD) | `balanced-price` | `Balanced Price` |
| STH realized price (USD) | `short-term-holder-realized-price` | `Short-Term Holder Realized Price` |
| LTH realized price (USD) | `long-term-holder-realized-price` | `Long-Term Holder Realized Price` |
| SOPR−1 (7-day mean) | `sopr-spent-output-profit-ratio` | the `SOPR` trace that reaches the latest date |
| Reserve risk | `reserve-risk` | `Reserve Risk` |
| Addresses in loss (fraction) | `percent-addresses-in-loss` | `Addresses in Loss` |

#### Examples

**LookIntoBitcoin CVDD**:

```http
GET https://frontend.api.lookintobitcoin.com/api/v2/charts/cvdd/
```

```json
{
  "id": "cvdd",
  "title": "Bitcoin: CVDD",
  "tier_required": 1,
  "csv_download": true,
  "data": [
    { "name": "BTC Price", "x": ["2010-07-18T00:00:00", "…"], "y": [0.07, "…"] },
    { "name": "CVDD",      "x": ["2010-07-18T00:00:00", "…"], "y": [0.068, "…"] }
  ]
}
```

Extraction rules:

- Read the named metric trace, not necessarily the last trace (`reserve-risk` ends
  with four 2-point `lower_bound_*` lines).
- `x` is padded ~100 days into the future; index by `y.length`, not `x.length`.
- SOPR values are already `SOPR − 1`; `sopr7d` is the plain 7-value mean.
- Addresses-in-loss is already a fraction (`0.378` = 37.8%).
- `recent.json` stores the row under **chart date − 1** (last complete UTC day),
  matching the upstream note.

**Farside** (rows are USD millions; parentheses = outflow):

```http
GET https://farside.co.uk/bitcoin-etf-flow-all/
```

```text
Date           IBIT     FBTC     ...  Total
20 Nov 2026   (544.7)  (72.4)    ...  (669.2)
23 Nov 2026   -        -         ...  0.0
```

The job parses the last **10 reported** rows, converts each day's USD flow to BTC
using that day's BTC close, and sums them (`etf10d`). Farside may rate-limit
datacenter IPs; the job sends a browser User-Agent + `Referer` and retries. If it
still fails, the previous `etf10d` is carried forward (this series is **display-only**
and is not part of either score).

**CoinMarketCap — total market cap history**:

```http
GET https://api.coinmarketcap.com/data-api/v3/global-metrics/quotes/historical?format=chart&interval=1d&timeEnd=1795449455&timeStart=1792857455
```

```json
{ "data": { "quotes": [ {
  "timestamp": "2026-10-23T15:40:00.000Z",
  "btcDominance": 59.9738,
  "quote": [{ "name": "USD", "totalMarketCap": 2729846168020.74 }]
} ] } }
```

**CoinMarketCap — USDT market cap** (`id=825` is Tether; `v[2]` is market cap):

```http
GET https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail/chart?id=825&range=1M
```

```json
{ "data": { "points": {
  "1792854000": { "v": [0.9986256462, 50749105029.42, 182387191454.9985] }
} } }
```

`usdtd30d = (domNow / dom30dAgo − 1) × 100`, where
`dom = USDT market cap / total crypto market cap`. This matched the upstream stored
value to ~0.2 points (25.72% vs 25.52%).

**CoinGlass — optional exact ETF source** (needs an API key; not used by default):

```http
GET https://open-api-v4.coinglass.com/api/etf/bitcoin/flow-history
CG-API-KEY: <your key>
```

Returns daily net flows in USD, the BTC price, and a per-ETF breakdown (updated once
a day). If you add a free key as the `COINGLASS_API_KEY` secret, you can extend
`scripts/refresh.mjs` to prefer it over Farside for exact BTC-denominated flows.

> The CoinGlass **internal** endpoint used by its website
> (`capi.coinglass.com/api/etf/flow`) is signature-gated with deliberate obfuscation
> and is intentionally not used here.

---

### C. Generated / static files

| File | Producer | Contents | Format |
|---|---|---|---|
| `data.json` | `scripts/refresh.mjs` + upstream | `{v, updated, days:[{date, asOf, price, score, raw, ref, confirm}], weekly, weeklyNote}`; rolling 60 days | JSON |
| `recent.json` | `scripts/refresh.mjs` + upstream | `{v, built, note, cols, rows}`; one row per UTC day: `[date, sthP, lthP, cvddP, balP, loss, sopr, rr, pL]` | JSON |
| `history.json` | upstream | weekly backtest history since 2013 for the backtest page | JSON (static) |

`data.json` is labelled with the **Canberra date** of the run (like the upstream
07:00 task), while `recent.json` uses the last complete UTC day (`chart date − 1`).
The app maps `data.json` back with `date − 2`, so the two line up.

`history.json` is a historical backtest dataset and is **not** refreshed by this job.

---

## The refresh job

```bash
node scripts/refresh.mjs            # fetch and write data.json + recent.json
node scripts/refresh.mjs --dry-run  # print the reading, write nothing
node scripts/refresh.mjs --date=2026-11-22
```

What it does:

1. Fetches the sources above.
2. Computes the latest daily reading with the site's **own** scoring model: it loads
   `app.js` with `window.BVM_EXPORT = true` and calls `BVM.parts(...)`, so the score
   matches the site exactly.
3. Appends the day to `data.json` (rolling 60 days) and the LookIntoBitcoin row to
   `recent.json`.
4. The workflow commits `data.json` + `recent.json`; GitHub Pages redeploys.

Failure behaviour:

- Required sources (Coin Metrics, LookIntoBitcoin, F&G, Bybit, DefiLlama, premium)
  failing makes the job fail, and nothing is committed.
- Farside ETF and CoinMarketCap USDT dominance are optional: on failure the previous
  `etf10d` / `usdtd30d` is carried forward and a warning is logged.

Live run:

- Workflow: `.github/workflows/refresh.yml`
- Cron: `0 20 * * *` (20:00 UTC ≈ 07:00 AEDT)
- Manual: Actions → **Refresh data** → **Run workflow**

---

## Known differences from upstream

- **ETF flows** use Farside (USD → BTC) instead of the upstream CoinGlass feed.
  For the same window this was ~30% lower in magnitude (≈ −40.1k BTC vs −30.8k BTC),
  because CoinGlass reports BTC-denominated flows directly. ETF flows are
  **display-only** — they are not part of the Value or Bottom-in scores.
- **USDT dominance** uses CoinMarketCap's public web data API; it matched the upstream
  stored value closely but is an undocumented endpoint and may change.
- **`history.json`** stays static; only `data.json` and `recent.json` refresh.
- The daily reading is computed from the **last complete UTC day** (consistent
  timestamps), whereas the upstream task mixed a live 07:00 price with older
  on-chain lines.

---

## Licence

MIT, as the upstream project. See [LICENSE](LICENSE).
