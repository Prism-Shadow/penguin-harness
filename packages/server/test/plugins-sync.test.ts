/**
 * Handing a Project's plugin list to its machines, strict parity.
 *
 * The rule the operator chose: the Project's list is the truth, so a machine ends with
 * exactly it — extras removed. The cost is the point of the "removes what the machine has
 * beyond the list" case: a platform-specific sandbox backend is not in the other platform's
 * list, so keeping one means listing it fleet-wide.
 */
import { describe, expect, it } from "vitest";
import type { MachineApi } from "../src/machines/machine-api.js";
import type { InstalledPluginsResponse } from "../src/api/types.js";
import { syncPluginsToMachine } from "../src/machines/plugins-sync.js";

/** A machine whose list is whatever was last written to it. */
function fakeMachine(initial: Record<string, string[]>, opts: { restartPending?: boolean } = {}) {
  const state = new Map(Object.entries(initial));
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const body = (list: string[]): InstalledPluginsResponse => ({
    plugins: list.map((specifier) => ({
      specifier,
      // "unresolvable there" is spelled the way the far side spells it: a row with a reason.
      active: !specifier.includes("not-there"),
      builtin: true,
      modules: [],
      replaces: [],
      ...(specifier.includes("not-there") ? { error: "not installed on this machine" } : {}),
    })),
    shipped: [],
    file: ".project_config.toml",
    restartPending: opts.restartPending === true,
  });
  const api: MachineApi = {
    request: async (method, path, payload) => {
      calls.push({ method, path, ...(payload === undefined ? {} : { body: payload }) });
      const projectId = decodeURIComponent(path.split("/")[3] ?? "");
      const has = state.get(projectId);
      if (has === undefined) return { status: 404, text: "no such Project" };
      if (method === "PUT") {
        state.set(projectId, [...((payload as { plugins: string[] }).plugins ?? [])]);
      }
      return { status: 200, text: JSON.stringify(body(state.get(projectId) ?? [])) };
    },
    postBytes: async () => ({ status: 500, text: "unused" }),
  } as unknown as MachineApi;
  return { api, calls, state };
}

const local = (lists: Record<string, string[]>) => (projectId: string) =>
  Promise.resolve(lists[projectId] ?? []);

describe("syncPluginsToMachine", () => {
  it("writes what the Project asks for, and removes what the machine has beyond it", async () => {
    const m = fakeMachine({ p1: ["@acme/keep", "@acme/theirs"] });
    const out = await syncPluginsToMachine({
      api: m.api,
      loadLocal: local({ p1: ["@acme/keep", "@acme/ours"] }),
      projects: ["p1"],
    });
    expect(out).toMatchObject({ kind: "synced", projects: ["p1"] });
    if (out.kind !== "synced") throw new Error("unreachable");
    expect(out.added).toEqual(["@acme/ours"]);
    // Strict parity: what the machine had and this Project does not ask for is taken away.
    expect(out.removed).toEqual(["@acme/theirs"]);
    expect(m.state.get("p1")).toEqual(["@acme/keep", "@acme/ours"]);
  });

  it("writes nothing when the machine is already in parity", async () => {
    const m = fakeMachine({ p1: ["@acme/same"] });
    const out = await syncPluginsToMachine({
      api: m.api,
      loadLocal: local({ p1: ["@acme/same"] }),
      projects: ["p1"],
    });
    expect(out.kind === "synced" && out.projects).toEqual([]);
    // A connect must not rewrite a machine that already agrees.
    expect(m.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("reports a specifier the machine cannot resolve instead of dropping it", async () => {
    // Most often a machine still on a build that does not ship the plugin: the operator's
    // choice is not taking effect there, and silence would read as success.
    const m = fakeMachine({ p1: [] });
    const out = await syncPluginsToMachine({
      api: m.api,
      loadLocal: local({ p1: ["@acme/not-there"] }),
      projects: ["p1"],
    });
    expect(out.kind === "synced" && out.unresolved).toEqual(["@acme/not-there"]);
    expect(m.state.get("p1")).toEqual(["@acme/not-there"]);
  });

  it("reports a machine that still has to restart to finish loading", async () => {
    const m = fakeMachine({ p1: [] }, { restartPending: true });
    const out = await syncPluginsToMachine({
      api: m.api,
      loadLocal: local({ p1: ["@acme/one"] }),
      projects: ["p1"],
    });
    expect(out.kind === "synced" && out.restartPending).toBe(true);
  });

  it("refuses a Project the machine does not have, rather than creating one", async () => {
    // A Project exists to hold work; creating one over there to carry a plugin list would
    // invent a workspace nobody asked for.
    const m = fakeMachine({});
    const out = await syncPluginsToMachine({
      api: m.api,
      loadLocal: local({ p1: ["@acme/one"] }),
      projects: ["p1"],
    });
    expect(out.kind === "synced" && out.refused).toEqual([
      { projectId: "p1", detail: "that machine has no such Project" },
    ]);
    expect(m.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("carries on to the next Project when one is refused", async () => {
    const m = fakeMachine({ p2: [] });
    const out = await syncPluginsToMachine({
      api: m.api,
      loadLocal: local({ p1: ["@acme/one"], p2: ["@acme/two"] }),
      projects: ["p1", "p2"],
    });
    expect(out.kind === "synced" && out.projects).toEqual(["p2"]);
    expect(out.kind === "synced" && out.refused.map((r) => r.projectId)).toEqual(["p1"]);
    expect(m.state.get("p2")).toEqual(["@acme/two"]);
  });
});
