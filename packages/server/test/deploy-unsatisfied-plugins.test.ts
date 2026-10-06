/**
 * How scripts/deploy.mjs reads a push refused for plugins the build cannot run
 * (scripts/deploy-unsatisfied-plugins.mjs), against the answer the server really gives
 * (hmr/push-plugins.ts) — the script restates the header and the code, and this is what keeps
 * the two from drifting.
 */
import { describe, expect, it } from "vitest";
import {
  LEAVE_OUT as SCRIPT_LEAVE_OUT,
  UNSATISFIED_PLUGINS_HEADER as SCRIPT_HEADER,
  leftOutPlugins,
  pluginLines,
  refusalStep,
  refusedPlugins,
  saidYes,
} from "../../../scripts/deploy-unsatisfied-plugins.mjs";
import {
  LEAVE_OUT,
  UNSATISFIED_PLUGINS_HEADER,
  answerPush,
  openPushSlip,
} from "../src/hmr/push-plugins.js";
import { HotResources } from "@prismshadow/penguin-hmr";
import type { UnsatisfiedPlugin } from "../src/api/types.js";

const PLUGINS: UnsatisfiedPlugin[] = [
  { specifier: "@acme/partial", disabled: false, reason: "contributes to 'nowhere.slot'" },
  { specifier: "@acme/unmet", disabled: true, reason: "names interface 'Nope'" },
];

describe("deploy.mjs and a push refused for unsatisfied plugins", () => {
  it("sends the header the server reads", () => {
    expect(SCRIPT_HEADER).toBe(UNSATISFIED_PLUGINS_HEADER);
    expect(SCRIPT_LEAVE_OUT).toBe(LEAVE_OUT);
  });

  it("reads the plugins out of the server's refusal", async () => {
    const { slip } = openPushSlip(new HotResources(), false);
    slip.refused = true;
    slip.unsatisfied = PLUGINS;
    const res = await answerPush(slip, new Response("{}", { status: 400 }));
    expect(refusedPlugins(res.status, await res.text())).toEqual(PLUGINS);
  });

  it("takes no other answer for that refusal", () => {
    expect(refusedPlugins(200, JSON.stringify({ status: "ok" }))).toBeNull();
    expect(
      refusedPlugins(400, JSON.stringify({ error: { code: "bad_request", message: "boom" } })),
    ).toBeNull();
    expect(
      refusedPlugins(409, JSON.stringify({ error: { code: "conflict", message: "busy" } })),
    ).toBeNull();
    expect(refusedPlugins(409, "not json")).toBeNull();
  });

  it("reads what an accepted push ran without out of its outcome", async () => {
    const { slip } = openPushSlip(new HotResources(), true);
    slip.unsatisfied = PLUGINS;
    const res = await answerPush(slip, Response.json({ status: "ok", impl: "x" }));
    expect(leftOutPlugins(await res.json())).toEqual(PLUGINS);
    expect(leftOutPlugins({ status: "ok" })).toEqual([]);
  });

  it("words each plugin as what would happen, then as what happened", () => {
    expect(pluginLines(PLUGINS)).toEqual([
      "  - @acme/partial: would run without part of itself — contributes to 'nowhere.slot'",
      "  - @acme/unmet: would be disabled — names interface 'Nope'",
    ]);
    expect(pluginLines(PLUGINS, true)).toEqual([
      "  - @acme/partial: runs without part of itself — contributes to 'nowhere.slot'",
      "  - @acme/unmet: disabled — names interface 'Nope'",
    ]);
  });

  it("asks only where someone can answer, and takes only a yes for a yes", () => {
    expect(refusalStep(true)).toBe("ask");
    expect(refusalStep(false)).toBe("needs-force");
    expect(["y", "Y", "yes", " YES "].map(saidYes)).toEqual([true, true, true, true]);
    expect(["", "n", "no", "yep", undefined].map(saidYes)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
