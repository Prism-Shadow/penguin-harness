#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Required branch-protection check: accept only the skips explicitly selected by
// the planner. A planner failure or an unexpectedly skipped job must never go green.
export function checkCIGate(needs) {
  if (needs.plan?.result !== "success") throw new Error("CI planning did not succeed");
  const flags = needs.plan.outputs;
  const gates = {
    style: null,
    readme: "readme",
    "plugin-versions": "plugins",
    "npm-packaging": "packaging",
    typecheck: "typecheck",
    test: "tests",
    "test-macos": "macos_tests",
    "test-windows": "windows_tests",
    "installer-e2e": "installer",
    "installer-windows": "installer",
    runtime: "runtime",
    "browser-smoke": "e2e",
  };
  for (const [job, flag] of Object.entries(gates)) {
    if (flag && !["true", "false"].includes(flags?.[flag])) {
      throw new Error(`Missing or invalid CI selection: ${flag}`);
    }
    const expected = !flag || flags[flag] === "true" ? "success" : "skipped";
    if (needs[job]?.result !== expected) {
      throw new Error(`${job}: expected ${expected}, got ${needs[job]?.result ?? "missing"}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkCIGate(JSON.parse(process.env.CI_NEEDS));
  console.log("Every selected CI gate passed.");
}
