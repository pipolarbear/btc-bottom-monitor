# data branch

Generated snapshots for BTC Value Monitor. **Do not merge into `main`.**

- `daily.ndjson` — one line per daily reading: `{date, asOf, price, score, raw, ref, confirm}`
- `lib.ndjson` — one line per UTC day: `[date, sthP, lthP, cvddP, balP, loss, sopr, rr, pL]`

Written by `scripts/refresh.mjs` on `main`; read by `scripts/build.mjs`.
