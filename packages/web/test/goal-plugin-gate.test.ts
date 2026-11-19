// @vitest-environment jsdom
/**
 * Goal mode's plugin check (features/chat/goal-plugin-gate.ts): the composer's side of the gate,
 * through the real plugin wrappers against the fetch fake.
 *
 * - Given an Agent without the goal hook package, engaging goal mode asks that Agent's plugin
 *   list, finds it missing and holds Send; with goal mode off nothing is asked or held.
 * - Given the user installs, the goal plugin is posted to the Agent on the machine that holds
 *   it, and once its hook is listed Send is released.
 * - Given the install is refused, the reason is toasted and the plugin stays missing.
 * - Given the list cannot be read, nothing is held: the server still refuses a goal it cannot
 *   start.
 * - Given the chip is dropped while the check is on its way, the late answer changes nothing.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toastStore } from "@prismshadow/penguin-ui";
import { goalPluginGate, useGoalPluginGate } from "../src/features/chat/goal-plugin-gate";
import type { GoalPluginGate } from "../src/features/chat/goal-plugin-gate";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FakeFetch, FetchRequest } from "./helpers/fetch";
import { mount, run, settle, unmountAll } from "./helpers/dom";

const PLUGINS = "/api/projects/p/agents/a1/plugins";

/** The Agent's installed lists, as both plugin routes answer them. */
const installedLists = (hooks: string[]) => ({
  skills: [],
  hooks: hooks.map((name) => ({ name, description: "", version: "", events: ["stop"] })),
  mcpServers: [],
  workbenches: [],
});

let fetch: FakeFetch;
/** The hook packages the fake server's Agent has. */
let hooks: string[];
const pluginRequests = (): FetchRequest[] => fetch.requests.filter((r) => r.path === PLUGINS);

beforeEach(() => {
  hooks = ["continual-learning"];
  toastStore.setState({ items: [] });
  fetch = stubFetch((request) => {
    if (request.path !== PLUGINS) return apiError(404, "not_found");
    if (request.method === "POST") {
      hooks = [...hooks, ...(request.body as { names: string[] }).names];
      return json(installedLists(hooks), 201);
    }
    return json(installedLists(hooks));
  });
});
afterEach(unmountAll);

/** What the composer reads off the hook, from the latest render. */
let gateView: ReturnType<typeof useGoalPluginGate>;
function Composer({ gate, goalOn }: { gate: GoalPluginGate | null; goalOn: boolean }) {
  gateView = useGoalPluginGate(gate, goalOn);
  return null;
}
const composer = (gate: GoalPluginGate | null, goalOn: boolean) => h(Composer, { gate, goalOn });

describe("the goal plugin check", () => {
  it("finds the plugin missing when goal mode is engaged, and holds Send; off, it asks nothing", async () => {
    const gate = goalPluginGate("p", "a1", null);
    const page = await mount(composer(gate, false));
    await settle();
    expect(pluginRequests()).toEqual([]);
    expect(gateView.holdsSend).toBe(false);

    await page.rerender(composer(gate, true));
    await settle();
    expect(pluginRequests().map((r) => r.method)).toEqual(["GET"]);
    expect(gateView.status).toBe("missing");
    expect(gateView.holdsSend).toBe(true);

    await page.rerender(composer(gate, false));
    expect(gateView.holdsSend).toBe(false);
  });

  it("installs the goal plugin on the Agent's own machine, and releases Send once it is there", async () => {
    const gate = goalPluginGate("p", "a1", "m1");
    await mount(composer(gate, true));
    await settle();
    expect(gateView.status).toBe("missing");

    await run(() => gateView.install());
    const [check, install] = pluginRequests();
    expect([check!.machine, install!.machine]).toEqual(["m1", "m1"]);
    expect(install!.method).toBe("POST");
    expect(install!.body).toEqual({ names: ["goal"] });
    expect(gateView.status).toBe("installed");
    expect(gateView.holdsSend).toBe(false);
  });

  it("toasts why an install was refused, and the plugin stays missing", async () => {
    const gate = goalPluginGate("p", "a1", null);
    await mount(composer(gate, true));
    await settle();
    fetch.answer((request) =>
      request.method === "POST"
        ? apiError(409, "plugin_install_refused_for_test", "The library is being updated.")
        : json(installedLists(hooks)),
    );

    await run(() => gateView.install());
    expect(toastStore.getState().items.map((t) => t.text)).toEqual([
      "The library is being updated.",
    ]);
    expect(gateView.status).toBe("missing");
    expect(gateView.holdsSend).toBe(true);
  });

  it("holds nothing when the plugin list cannot be read", async () => {
    fetch.answer(() => {
      throw new TypeError("fetch failed");
    });
    await mount(composer(goalPluginGate("p", "a1", null), true));
    await settle();
    expect(gateView.status).toBe("unknown");
    expect(gateView.holdsSend).toBe(false);
  });

  it("ignores a check that answers after the chip was dropped", async () => {
    let answer: (res: Response) => void = () => {};
    fetch.answer(() => new Promise<Response>((resolve) => (answer = resolve)));
    const gate = goalPluginGate("p", "a1", null);
    const page = await mount(composer(gate, true));
    expect(gateView.status).toBe("checking");

    await page.rerender(composer(gate, false));
    await run(() => answer(json(installedLists([]))));
    expect(gateView.status).toBe("unknown");
    expect(gateView.holdsSend).toBe(false);
  });
});
