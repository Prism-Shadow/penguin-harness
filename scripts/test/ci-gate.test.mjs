/**
 * Given a CI plan, when the required gate evaluates its jobs:
 * - selected successful jobs and explicitly unselected skipped jobs pass;
 * - a failed/cancelled/missing planner or job, or an unexpected skip, fails;
 * - missing/malformed selections cannot turn an untested commit green.
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { checkCIGate } from "../ci-gate.mjs";

function run(selected = true) {
  const flags = [
    "plugins",
    "packaging",
    "typecheck",
    "tests",
    "macos_tests",
    "windows_tests",
    "installer",
    "runtime",
    "e2e",
  ];
  const jobs = [
    "plugin-versions",
    "npm-packaging",
    "typecheck",
    "test",
    "test-macos",
    "test-windows",
    "installer-e2e",
    "installer-windows",
    "runtime",
    "browser-smoke",
  ];
  return {
    plan: {
      result: "success",
      outputs: Object.fromEntries(flags.map((flag) => [flag, String(selected)])),
    },
    style: { result: "success" },
    ...Object.fromEntries(jobs.map((job) => [job, { result: selected ? "success" : "skipped" }])),
  };
}

it("passes successful selected work and only the skips authorized by the plan", () => {
  assert.doesNotThrow(() => checkCIGate(run()));
  assert.doesNotThrow(() => checkCIGate(run(false)));
});

it("fails when planning failed, was cancelled/skipped, or is absent", () => {
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    const needs = run(false);
    needs.plan.result = result;
    assert.throws(() => checkCIGate(needs), /planning did not succeed/);
  }
  assert.throws(() => checkCIGate({}), /planning did not succeed/);
});

it("fails any required job that failed, was cancelled/skipped, or is missing", () => {
  for (const job of Object.keys(run()).filter((name) => name !== "plan")) {
    for (const result of ["failure", "cancelled", "skipped", undefined]) {
      const needs = run();
      if (result) needs[job].result = result;
      else delete needs[job];
      assert.throws(() => checkCIGate(needs), new RegExp(job));
    }
  }
});

it("does not accept a missing selection or treat malformed selections as false", () => {
  for (const flag of Object.keys(run(false).plan.outputs)) {
    for (const value of [undefined, "", "yes", true]) {
      const needs = run(false);
      needs.plan.outputs[flag] = value;
      assert.throws(() => checkCIGate(needs), /Missing or invalid/);
    }
  }
});

it("fails an unselected job that ran, failed, or disappeared unexpectedly", () => {
  for (const result of ["success", "failure", "cancelled", undefined]) {
    const needs = run(false);
    needs.runtime.result = result;
    assert.throws(() => checkCIGate(needs), /runtime/);
  }
});
