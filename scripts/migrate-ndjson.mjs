#!/usr/bin/env node
/**
 * One-time migration: data.json + recent.json -> daily.ndjson + lib.ndjson.
 *
 * Run this BEFORE removing data.json/recent.json from main:
 *   node scripts/migrate-ndjson.mjs --out ./tmp/data-ndjson
 *
 * Then create the orphan `data` branch from the output and commit it there.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const OUT = path.resolve(arg("out", path.join(ROOT, "tmp", "data-ndjson")));

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data.json"), "utf8"));
const recent = JSON.parse(fs.readFileSync(path.join(ROOT, "recent.json"), "utf8"));

const daily = [...data.days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const lib = [...recent.rows].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "daily.ndjson"), daily.map((x) => JSON.stringify(x)).join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "lib.ndjson"), lib.map((x) => JSON.stringify(x)).join("\n") + "\n");

console.log(`Wrote ${daily.length} daily lines and ${lib.length} lib lines to ${OUT}`);
