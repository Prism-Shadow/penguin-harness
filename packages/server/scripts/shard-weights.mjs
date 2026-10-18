#!/usr/bin/env node
/**
 * Rewrites test/shard-weights.json, the Windows durations the server suite's shards are dealt by
 * (test/setup/weighted-shards.ts), from the logs of a CI run whose `test-windows (server-N)` jobs
 * all passed:
 *
 *   gh run view <run id> --log > run.log
 *   node packages/server/scripts/shard-weights.mjs run.log [more.log …]
 *
 * Every line of `gh run view --log` starts with its job's name; only the Windows server shards'
 * lines count. A file is weighed by vitest's own report of it (`✓ test/x.test.ts (12 tests)
 * 3456ms`), in seconds; a file reported twice (the job's whole-command retry) keeps the last.
 */
import { readFileSync, writeFileSync } from "node:fs";

const logs = process.argv.slice(2);
if (logs.length === 0) {
  console.error("usage: shard-weights.mjs <gh run view --log output>...");
  process.exit(2);
}
// Colour codes: the escape byte, or the caret form ("^[") GitHub's log download writes it as.
const ansi = /(?:\x1b|\^\[)\[[0-9;]*m/g;
const fileLine = /^test-windows \(server-\d+\)\t.*\s✓\s(test\/\S+\.test\.ts)\s.*?\s(\d+)ms\s*$/;
const seconds = new Map();
for (const log of logs) {
  for (const raw of readFileSync(log, "utf8").split("\n")) {
    const match = fileLine.exec(raw.replace(ansi, ""));
    if (match) seconds.set(match[1], Math.round(Number(match[2]) / 100) / 10);
  }
}
if (seconds.size === 0) {
  console.error("No Windows server shard file results in the given logs.");
  process.exit(1);
}
const table = Object.fromEntries([...seconds].sort(([a], [b]) => (a < b ? -1 : 1)));
const out = new URL("../test/shard-weights.json", import.meta.url);
writeFileSync(out, `${JSON.stringify(table, null, 2)}\n`);
console.log(`Wrote ${seconds.size} files to ${out.pathname}`);
