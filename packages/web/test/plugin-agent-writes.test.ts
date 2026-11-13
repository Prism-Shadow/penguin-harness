/**
 * Installing and uninstalling a library plugin on one Agent, as the Plugins page and the Agent's
 * own settings both do it (features/plugins/agent-plugin-writes.ts): the request on the server
 * the Agent lives on, and what its answer leaves in the shared installs store.
 *
 * - Given an Agent on a machine, an install goes to that machine, and what the machine answers
 *   is what the store holds for that Agent there — and nothing for this server's Agent of the
 *   same id.
 * - Given an uninstall the server could not finish, the outcome names the part it left and why;
 *   the store drops the plugin's parts at once, and the Agent is read again behind them.
 * - Given an uninstall answered "nothing of it is installed", it counts as done: nothing is
 *   thrown, and the Agent is read again.
 * - Given a plugin gone from the library, the uninstall still goes out as one request, and the
 *   store keeps what it held until the Agent's new answer replaces it — nothing is guessed.
 * - Given a machine older than the route (a plain 404), the uninstall throws and the toast says
 *   the machine needs an update; the same 404 from this server, or a "nothing installed" from
 *   the machine, is no outdated machine.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentPluginsInstallResponse,
  PluginItem,
  PluginUninstallResponse,
} from "@prismshadow/penguin-server/api";
import { toastStore } from "@prismshadow/penguin-ui";
import { ApiError } from "../src/api/client";
import { agentInstalls, installsKey } from "../src/features/plugins/agent-installs";
import {
  installOnAgent,
  isOutdatedMachine,
  toastWriteError,
  uninstallFromAgent,
} from "../src/features/plugins/agent-plugin-writes";
import { resetReadStores } from "../src/lib/read-store";
import { S } from "../src/lib/strings";
import { apiError, json, stubFetch, type FetchRequest } from "./helpers/fetch";
import { stubLocalStorage } from "./helpers/storage";

const PROJECT = "P";
const AGENT = "helper";

const CHARTS = {
  name: "charts",
  description: "Draw charts",
  version: "1.0.0",
  skills: [{ name: "chart", description: "Draw a chart", version: "2026.10.01.1" }],
  hooks: [],
  mcpServers: [],
} as unknown as PluginItem;

/** An Agent's lists: the named Skills, no hook package, no server, no workbench. */
const lists = (...skills: string[]): AgentPluginsInstallResponse => ({
  skills: skills.map((name) => ({ name, description: "", version: "2026.10.01.1" })),
  hooks: [],
  mcpServers: [],
  workbenches: [],
});

const REMOVED: PluginUninstallResponse = {
  removed: { skills: ["chart"], hooks: [], mcpServers: [], workbenches: [] },
};

const skillsIn = (key: string) => agentInstalls.get(key).value?.skills.map((s) => s.name) ?? null;

/** Waits for the read in flight on `key` (a second reader joins the first). */
const settled = (key: string) =>
  agentInstalls.read(key, () => Promise.reject(new Error("no read was in flight")));

/** A GET of the Agent's lists that answers only when the test says so. */
function heldRead() {
  let release: (res: Response) => void = () => undefined;
  const answer = new Promise<Response>((resolve) => (release = resolve));
  return { answer, release };
}

const isListsRead = (r: FetchRequest) =>
  r.method === "GET" && r.path === `/api/projects/${PROJECT}/agents/${AGENT}/plugins`;
const isDelete = (r: FetchRequest) =>
  r.method === "DELETE" && r.path === `/api/projects/${PROJECT}/agents/${AGENT}/plugins/charts`;

beforeEach(() => {
  stubLocalStorage();
  toastStore.setState({ items: [] });
});
afterEach(() => {
  resetReadStores();
});

describe("installing on an Agent", () => {
  it("goes to the Agent's machine and leaves that machine's answer in the store", async () => {
    const fake = stubFetch((r) =>
      r.method === "POST" ? json(lists("chart"), 201) : apiError(404, "not_found"),
    );
    await installOnAgent({ projectId: PROJECT, agentId: AGENT, machineId: "gpu1" }, ["charts"]);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      method: "POST",
      machine: "gpu1",
      path: `/api/projects/${PROJECT}/agents/${AGENT}/plugins`,
      body: { names: ["charts"] },
    });
    expect(skillsIn(installsKey(PROJECT, "gpu1", AGENT))).toEqual(["chart"]);
    expect(skillsIn(installsKey(PROJECT, null, AGENT))).toBeNull();
  });
});

describe("uninstalling from an Agent", () => {
  const here = { projectId: PROJECT, agentId: AGENT, machineId: null };
  const key = installsKey(PROJECT, null, AGENT);

  it("names a part the server could not remove, drops the plugin's parts, and reads the Agent again", async () => {
    agentInstalls.accept(key, lists("chart", "notes"));
    const read = heldRead();
    const fake = stubFetch((r) =>
      isDelete(r)
        ? json({ ...REMOVED, failed: [{ kind: "skill", name: "chart", error: "EBUSY" }] })
        : isListsRead(r)
          ? read.answer
          : apiError(404, "not_found"),
    );
    const outcome = await uninstallFromAgent(here, "charts", CHARTS);
    expect(outcome).toEqual({
      kind: "removed",
      failed: [{ kind: "skill", name: "chart", error: "EBUSY" }],
    });
    // One request for the whole plugin, none for its parts, then the re-read.
    expect(fake.requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
    expect(fake.requests.some(isListsRead)).toBe(true);
    expect(skillsIn(key)).toEqual(["notes"]);

    read.release(json(lists("chart", "notes")));
    await settled(key);
    expect(skillsIn(key)).toEqual(["chart", "notes"]);
  });

  it("counts 'nothing of it is installed' as done, and reads the Agent again", async () => {
    agentInstalls.accept(key, lists("chart"));
    const fake = stubFetch((r) =>
      isDelete(r)
        ? apiError(404, "plugin_not_installed")
        : isListsRead(r)
          ? json(lists())
          : apiError(404, "not_found"),
    );
    await expect(uninstallFromAgent(here, "charts", CHARTS)).resolves.toEqual({
      kind: "nothing-left",
    });
    await settled(key);
    expect(fake.requests.some(isListsRead)).toBe(true);
    expect(skillsIn(key)).toEqual([]);
  });

  it("keeps what the store held for a plugin gone from the library, until the Agent answers", async () => {
    agentInstalls.accept(key, lists("chart"));
    const read = heldRead();
    const fake = stubFetch((r) =>
      isDelete(r) ? json(REMOVED) : isListsRead(r) ? read.answer : apiError(404, "not_found"),
    );
    await expect(uninstallFromAgent(here, "charts", null)).resolves.toEqual({
      kind: "removed",
      failed: [],
    });
    expect(fake.requests.filter(isDelete)).toHaveLength(1);
    expect(skillsIn(key)).toEqual(["chart"]);

    read.release(json(lists()));
    await settled(key);
    expect(skillsIn(key)).toEqual([]);
  });
});

describe("a machine older than the request", () => {
  it("throws on uninstall, and the toast says the machine needs an update", async () => {
    stubFetch(() => apiError(404, "not_found"));
    const failure = await uninstallFromAgent(
      { projectId: PROJECT, agentId: AGENT, machineId: "gpu1" },
      "charts",
      CHARTS,
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect(isOutdatedMachine(failure, "gpu1")).toBe(true);
    toastWriteError(failure, "gpu1");
    expect(toastStore.getState().items.map((t) => [t.kind, t.text])).toEqual([
      ["error", S.errors.byCode.machine_outdated],
    ]);
  });

  it("is not this server's 404, nor a machine saying nothing of the plugin is installed", () => {
    const missingRoute = new ApiError(404, "not_found", "Not found");
    expect(isOutdatedMachine(missingRoute, null)).toBe(false);
    const nothingThere = new ApiError(404, "plugin_not_installed", "Not installed");
    expect(isOutdatedMachine(nothingThere, "gpu1")).toBe(false);
    toastWriteError(missingRoute, null);
    expect(toastStore.getState().items.map((t) => t.text)).not.toContain(
      S.errors.byCode.machine_outdated,
    );
  });
});
