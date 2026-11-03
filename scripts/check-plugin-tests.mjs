#!/usr/bin/env node
/**
 * Every `plugins/<name>/test/*.test.mjs` suite in the tree must run, and must pass. A suite no
 * job invokes is a file rather than a measurement: it never reports a regression and it silently
 * rots, which is exactly what happened to the goal plugin's hook suite until this gate. The tree's
 * hooks keep their primary measurement in core (`packages/core/test/goal-hooks.test.ts` and
 * `continual-learning-hook.test.ts`, both run as subprocesses in CI's `core` shard); what this adds
 * is the in-tree supplement that nothing ran.
 *
 *   Usage: node scripts/check-plugin-tests.mjs [root]     root defaults to `plugins`
 *
 * Zero install, plain Node builtins, like the structural checks beside it in CI's `plugin-versions`
 * job: the runner has no `setup` action and no pnpm there, so this must run on whatever node the
 * runner ships.
 *
 * The gate enumerates the files itself rather than passing a glob to `node --test`, because the
 * glob form is a gate that can pass with nothing under it. On Node 18 `node --test <dir>` finds the
 * files, but from Node 22 on a bare directory argument is run as a file (and a `**` pattern is
 * expanded by Node 22's own glob, which Node 18 does not have) — so the one invocation that works
 * on both lines is `--test <file>`, once per enumerated file. And the enumerated-list form is the
 * point: with the file removed, `node --test plugins/<name>/test/*.test.mjs` — the shell expanding
 * the pattern and, when nothing matches, passing the pattern through — exits 1 on Node 18.20.4 but
 * 0 with zero tests on Node 24.18.0. This script fails on an empty enumeration instead, so the
 * green only ever means suites ran and passed.
 *
 * A plugin without a `test/` directory is not a failure — this gate runs the suites that exist and
 * invents none per plugin; only an empty *tree* is a failure.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? "plugins";

/** The `*.test.mjs` files directly inside `root/<plugin>/test/`, plugins and files both sorted. */
function enumerate(dir) {
  const files = [];
  for (const plugin of readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    const testDir = path.join(dir, plugin, "test");
    let entries;
    try {
      entries = readdirSync(testDir, { withFileTypes: true });
    } catch {
      // No `test/` directory: a plugin with nothing to run, which is not a failure.
      continue;
    }
    for (const entry of entries
      .filter((item) => item.isFile() && item.name.endsWith(".test.mjs"))
      .map((item) => item.name)
      .sort()) {
      files.push(path.join(testDir, entry));
    }
  }
  return files;
}

let files;
try {
  files = enumerate(root);
} catch (error) {
  console.error(`plugin tests: cannot read the plugin root ${root} — ${error.message}`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(
    `plugin tests: no plugin test file was found under ${root}/<plugin>/test/*.test.mjs. ` +
      "This gate fails rather than passes on an empty enumeration: a green over no suite is not a " +
      "measurement. If the last suite really is gone, remove this step with it.",
  );
  process.exit(1);
}

console.log(`plugin tests: ${files.length} suite(s) found — ${files.join(", ")}`);

let failed = 0;
for (const file of files) {
  // The file form, one subprocess per suite, so one suite's crash does not hide another's result.
  const result = spawnSync(process.execPath, ["--test", file], { encoding: "utf8" });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  const passed = result.status === 0 && !result.error;
  if (result.error) {
    console.error(`plugin tests: ${file} could not be run — ${result.error.message}`);
  } else if (result.signal) {
    console.error(`plugin tests: ${file} was killed by ${result.signal}`);
  } else {
    console.log(passed ? `plugin tests: ${file} passed` : `plugin tests: ${file} FAILED`);
  }
  if (!passed) failed += 1;
}

if (failed > 0) {
  console.error(`plugin tests: ${failed} of ${files.length} suite(s) failed`);
  process.exit(1);
}
console.log(`plugin tests: ${files.length} suite(s) passed`);
