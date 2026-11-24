#!/usr/bin/env node
/**
 * Build the static site from:
 *   - code in main (this working tree)
 *   - NDJSON snapshots from the orphan `data` branch
 *   - static metadata in meta.json
 *
 * Emits _site/ with the app files plus derived data.json and recent.json.
 *
 * Usage:
 *   node scripts/build.mjs --data-dir ../bb-data --out _site
 *   node scripts/build.mjs --data-dir data-branch --out main/_site
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const flag = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(flag));
  if (hit) return hit.slice(flag.length);
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DATA_DIR = path.resolve(arg("data-dir", ROOT));
const OUT = path.resolve(arg("out", path.join(ROOT, "_site")));

if (OUT === ROOT) throw new Error("--out must not be the repo root; use a build directory");

const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "meta.json"), "utf8"));

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const daily = readNdjson(path.join(DATA_DIR, "daily.ndjson"));
const lib = readNdjson(path.join(DATA_DIR, "lib.ndjson"));

const days = daily.slice(-60);
const rows = lib.slice(-420);

const dataOut = {
  v: meta.v,
  updated: new Date().toISOString(),
  days,
  weekly: meta.weekly,
  weeklyNote: meta.weeklyNote,
};
const recentOut = {
  v: meta.recent.v,
  built: new Date().toISOString(),
  note: meta.recent.note,
  cols: meta.recent.cols,
  rows,
};

const FILES = [
  "index.html", "thesis.html", "backtest.html", "v1.html",
  "app.js", "app.css", "skins.css", "prefs.js", "backtest.js",
  "history.json", "LICENSE",
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, "data.json"), JSON.stringify(dataOut));
fs.writeFileSync(path.join(OUT, "recent.json"), JSON.stringify(recentOut));

console.log(`Built ${OUT}: ${days.length} days, ${rows.length} rows`);
