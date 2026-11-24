# BTC Value Monitor — local fork

A live BTC dashboard: is BTC cheap against past cycle lows, has the fall stopped, and
where are we in the cycle. It is a **static, client-side app** (HTML + CSS + JS) cloned
from [pixelmango47/btc-bottom-monitor](https://github.com/pixelmango47/btc-bottom-monitor)
(MIT). Everything is scored in the browser.

This fork adds:

- `scripts/refresh.mjs` — a daily job that rebuilds the data the upstream private
  "daily task" used to produce.
- An orphan **`data` branch** holding append-only NDJSON snapshots
  (`daily.ndjson`, `lib.ndjson`). `main` stays code-only.
- `scripts/build.mjs` — derives `data.json` / `recent.json` from the snapshots into
  `_site` at publish time.
- `.github/workflows/publish.yml` — refreshes the snapshots, builds, and deploys
  GitHub Pages once a day.
- This README, listing every source, how often it is called, what it returns, and in
  what format, with request/response examples.

> Information only. Not financial advice. Past lows do not promise future lows.

---

## Run locally

`main` has no data files; fetch the `data` branch and build `_site`:

```bash
git worktree add ../bb-data data        # or: git clone -b data . ../bb-data
node scripts/build.mjs --data-dir ../bb-data --out _site
python3 -m http.server --directory _site 8000
# open http://localhost:8000
```

To refresh the local snapshots first:

```bash
node scripts/refresh.mjs --data-dir ../bb-data
node scripts/build.mjs --data-dir ../bb-data --out _site
```

No dependencies are required: the scripts use Node 20+ built-in `fetch`.

---

## How the data works

There are two layers:

1. **Live, in the browser.** Price, on-chain metrics, funding, fear & greed,
   stablecoins and the Coinbase premium are fetched from public APIs each time the
   page opens, then on timers. The site recomputes the scores in your browser.

2. **Daily snapshots.** Nine series cannot be fetched from a browser (CORS/anti-bot):
   - 7 LookIntoBitcoin on-chain lines,
   - US spot Bitcoin ETF net flows (10-day),
   - USDT dominance (30-day change).

   The daily job appends one date-tagged line per day to the orphan `data` branch:
   - `daily.ndjson` — the daily reading (`date`, `asOf`, `price`, `score`, `raw`,
     `ref`, `confirm`).
   - `lib.ndjson` — the LookIntoBitcoin row
     (`[date, sthP, lthP, cvddP, balP, loss, sopr, rr, pL]`).

   At publish time, `scripts/build.mjs` reads the last 60 daily lines and the last
   420 lib lines and writes derived `data.json` / `recent.json` into `_site`. The app
   is unchanged: it fetches those two relative files.

> **The `data` branch is orphan and append-only. Never merge it into `main`, and never
> merge upstream's data commits. Cherry-pick upstream code changes only.**

---

## Repository layout

```
main                          data (orphan, never merged)
├── index.html …              ├── daily.ndjson
├── app.js, *.css             └── lib.ndjson
├── scripts/refresh.mjs
├── scripts/build.mjs
├── scripts/migrate-ndjson.mjs (one-off)
├── meta.json
├── history.json
└── .github/workflows/publish.yml
```

The published `_site/` contains the app plus derived `data.json` / `recent.json`.

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

Run by `.github/workflows/publish.yml` at **20:00 UTC ≈ 07:00 AEDT** (the upstream
task's time), or manually via `workflow_dispatch`. It appends to the orphan `data`
branch, then builds and deploys.

| # | Source | Request | Frequency | Retrieved | Format |
|---|---|---|---|---|---|
| 1 | **LookIntoBitcoin** | `GET frontend.api.lookintobitcoin.com/api/v2/charts/<slug>/` × 7 | daily | CVDD, balanced price, STH cost, LTH cost, SOPR-1 (7d mean), reserve risk, addresses in loss | JSON (Plotly traces) |
| 2 | **CoinGlass** (if key) / **Farside** | `GET open-api-v4.coinglass.com/api/etf/bitcoin/flow-history` (header `CG-API-KEY`) / `GET farside.co.uk/bitcoin-etf-flow-all/` | daily | US spot BTC ETF net flows: USD flow + daily BTC price (CoinGlass), or USD millions per fund/day (Farside) | JSON / HTML |
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

**CoinGlass — exact ETF source (preferred when configured)**:

```http
GET https://open-api-v4.coinglass.com/api/etf/bitcoin/flow-history
CG-API-KEY: <your key>
```

```json
{ "code": "0", "data": [
  { "timestamp": 1704931200000, "flow_usd": 655300000, "price_usd": 46663,
    "etf_flows": [{ "etf_ticker": "GBTC", "flow_usd": -95100000 }] }
] }
```

The job uses this automatically when `COINGLASS_API_KEY` is set:
`etf10d = Σ(flow_usd / price_usd)` over the last 10 days, which is exact BTC.
Add the secret in **Settings → Secrets and variables → Actions**, or:

```bash
gh secret set COINGLASS_API_KEY --repo pipolarbear/btc-bottom-monitor
```

Without it, the job falls back to Farside and carries the previous value forward if
Farside blocks the runner.

> The CoinGlass **internal** endpoint used by its website
> (`capi.coinglass.com/api/etf/flow`) is signature-gated with deliberate obfuscation
> and is intentionally not used here.

---

### C. Generated / static files

| File | Where | Producer | Contents | Format |
|---|---|---|---|---|
| `daily.ndjson` | `data` branch | `scripts/refresh.mjs` | one line per daily reading: `{date, asOf, price, score, raw, ref, confirm}` | NDJSON |
| `lib.ndjson` | `data` branch | `scripts/refresh.mjs` | one line per UTC day: `[date, sthP, lthP, cvddP, balP, loss, sopr, rr, pL]` | NDJSON |
| `meta.json` | `main` | static | `{v, weekly, weeklyNote, recent:{v, note, cols}}` | JSON |
| `data.json` | `_site` | `scripts/build.mjs` | `{v, updated, days:[…last 60…], weekly, weeklyNote}` | JSON (derived) |
| `recent.json` | `_site` | `scripts/build.mjs` | `{v, built, note, cols, rows:[…last 420…]}` | JSON (derived) |
| `history.json` | `main` | upstream snapshot | weekly backtest history since 2013 | JSON (static) |

`daily.ndjson` is labelled with the **Canberra date** of the run (like the upstream
07:00 task), while `lib.ndjson` uses the last complete UTC day (`chart date − 1`).
The app maps `data.json` back with `date − 2`, so the two line up.

`history.json` is a historical backtest dataset and is **not** refreshed by this job.

---

## The refresh + build jobs

```bash
# Refresh: append one snapshot line to the data branch checkout
node scripts/refresh.mjs --data-dir ../bb-data
node scripts/refresh.mjs --dry-run --data-dir ../bb-data
node scripts/refresh.mjs --date=2026-11-22 --data-dir ../bb-data

# Build: derive data.json + recent.json into _site
node scripts/build.mjs --data-dir ../bb-data --out _site
```

Refresh:

1. Fetches the sources above.
2. Computes the latest daily reading with the site's **own** scoring model: it loads
   `app.js` with `window.BVM_EXPORT = true` and calls `BVM.parts(...)`, so the score
   matches the site exactly.
3. Upserts one date-tagged line in `daily.ndjson` and `lib.ndjson` (it never reads the
   full history; only the last daily line for carry-forward).

Build:

1. Reads the last 60 daily lines and last 420 lib lines.
2. Writes `data.json` + `recent.json` into `_site` and copies the app files.

Publish (`publish.yml`):

- Checks out `main` + the `data` branch.
- Runs refresh (skipped on a `main` push), commits the new snapshots, builds `_site`,
  and deploys via `actions/deploy-pages`.

Failure behaviour:

- **Coin Metrics** and **LookIntoBitcoin** are required. If either fails, the job
  fails and nothing is committed.
- Everything else is optional and degrades gracefully:
  - Fear & Greed, stablecoins and daily candles (Coinbase fallback) are used when
    available; missing readings are simply skipped by the weighted average.
  - **Funding** falls back from Bybit to **Kraken Futures** (hourly rates). Kraken has
    no public historical open interest, so `oiDrawdown` is left empty and the
    leverage signal uses funding alone. If both fail, the signal is skipped.
  - **Coinbase premium** falls back from Binance/Bybit to a **Kraken** reference price.
  - **ETF flows**: CoinGlass is used when `COINGLASS_API_KEY` is set, otherwise
    Farside. If both fail, the previous `etf10d` is carried forward (display-only).
  - **USDT dominance** carries forward the previous `usdtd30d` on failure
    (display-only).

Live run:

- Workflow: `.github/workflows/publish.yml`
- Cron: `0 20 * * *` (20:00 UTC ≈ 07:00 AEDT)
- Manual: Actions → **Publish** → **Run workflow**

---

## Known differences from upstream

- **GitHub runners are in the US**, where Bybit and Binance block requests (403).
  The browser app is unaffected (it runs on your own connection), but the daily job
  uses fallbacks:
  - funding: Kraken Futures (no historical OI, so the leverage signal is funding-only);
  - premium: Coinbase vs Kraken instead of Coinbase vs an offshore venue.
- **ETF flows**: when `COINGLASS_API_KEY` is set, the job uses CoinGlass's exact
  BTC-denominated flows. Otherwise it uses Farside (USD → BTC). For the same window
  Farside was ~30% lower in magnitude (≈ −40.1k BTC vs −30.8k BTC), because CoinGlass
  reports BTC-denominated flows directly. ETF flows are **display-only** — they are
  not part of the Value or Bottom-in scores. Farside also blocks many datacenter IPs,
  including GitHub runners, so without a key the job carries the previous `etf10d`
  forward (see above).
- **USDT dominance** uses CoinMarketCap's public web data API; it matched the upstream
  stored value closely but is an undocumented endpoint and may change.
- **`history.json`** stays static; only the `data` branch snapshots refresh.
- The daily reading is computed from the **last complete UTC day** (consistent
  timestamps), whereas the upstream task mixed a live 07:00 price with older
  on-chain lines.

---

## Licence

MIT, as the upstream project. See [LICENSE](LICENSE).
