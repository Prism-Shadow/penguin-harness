/**
 * A plugin's one button and the pages its install steps take (features/plugins/plugin-action.ts,
 * plugin-install-flow.tsx `installPages`): pure decisions.
 *
 * - Given an admin's install of a plugin with Agent content, the button reads Install, then each
 *   step the server reports — looking up, downloading with its percent, starting — never Install
 *   again while it runs, and once the server has the plugin it reads Install again, which now
 *   opens choosing Agents; added to one, it reads the Agents' count. A plugin of server modules
 *   alone resolves to "Installed on server".
 * - Given a failed install, the button reads Retry; given a member and a plugin of server modules
 *   alone, Install is held with why.
 * - The install steps have a server page only while the server part is the reader's to decide,
 *   to watch, or to undo; an Agents page only for a plugin with something for Agents and a reader
 *   who can add it; and Ready only where the run ends in something ready. A member asking an admin
 *   has one page.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { pluginAction, type PluginActionInputs } from "../src/features/plugins/plugin-action";
import { installPages } from "../src/features/plugins/plugin-install-flow";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

beforeEach(() => setActiveStrings(en));

const base: PluginActionInputs = {
  pending: false,
  run: null,
  blocked: false,
  isAdmin: true,
  server: "install",
  agentContent: true,
  onServer: false,
  shippedHybrid: false,
  agents: 0,
  behind: 0,
  packageUpdate: null,
  canOpen: false,
  module: "none",
  status: "available",
};
const running = (over: Partial<NonNullable<PluginActionInputs["run"]>>) =>
  ({ ...base, run: { phase: "running", stage: null, progress: null, ...over } }) as const;

describe("the button through an install", () => {
  it("names each step the server reports, never Install while it runs, and resolves to the next action", () => {
    const states: PluginActionInputs[] = [
      base,
      running({ stage: { stage: "checking" } }),
      running({
        stage: { stage: "installing", source: "channel" },
        progress: { received: 3, total: 10 },
      }),
      running({
        stage: { stage: "installing", source: "channel" },
        progress: { received: 8, total: 10 },
      }),
      running({ stage: { stage: "loading" } }),
      // The server has it: its library plugin is listed, on no Agent yet.
      { ...base, server: "done", onServer: true, module: "active", status: "available" },
      { ...base, server: "done", onServer: true, module: "active", agents: 1, status: "installed" },
    ];
    const actions = states.map(pluginAction);
    expect(actions.map((a) => a.label)).toEqual([
      en.skills.install,
      en.plugins.installModel.stepShort.checking,
      en.plugins.downloading(30),
      en.plugins.downloading(80),
      en.plugins.installModel.stepShort.loading,
      en.skills.install,
      en.plugins.marketAgentInstalls(1),
    ]);
    expect(actions.map((a) => a.kind)).toEqual([
      "install",
      "running",
      "running",
      "running",
      "running",
      "install",
      "agents",
    ]);
    // Under way the button stays pressable: it brings back the install's steps.
    expect(actions.slice(1, 5).every((a) => !a.disabled)).toBe(true);
  });

  it("resolves a plugin of server modules alone to its place on the server, and opens a workbench it can", () => {
    expect(
      pluginAction({ ...base, agentContent: false, server: "done", module: "active" }).label,
    ).toBe(en.plugins.marketServerInstalled);
    expect(
      pluginAction({ ...base, server: "done", onServer: true, agents: 2, canOpen: true }).kind,
    ).toBe("open");
  });

  it("reads Retry after a failure, and holds a member's Install of a server-only plugin", () => {
    expect(
      pluginAction({ ...base, run: { phase: "failed", stage: null, progress: null } }).label,
    ).toBe(en.common.retry);
    const held = pluginAction({ ...base, isAdmin: false, agentContent: false, server: "held" });
    expect([held.kind, held.disabled, held.hint]).toEqual([
      "held",
      true,
      en.plugins.installModel.adminOnly,
    ]);
  });

  it("holds Install until this server has said what it holds, and while another change runs", () => {
    expect(pluginAction({ ...base, pending: true })).toMatchObject({
      label: en.skills.install,
      disabled: true,
    });
    expect(pluginAction({ ...base, blocked: true }).disabled).toBe(true);
  });
});

describe("the pages an install's steps take", () => {
  it("are the server's, the Agents' and Ready for an admin's install of a plugin with Agent content", () => {
    expect(installPages({ server: "install", steps: 2, serverRun: false })).toEqual([
      "server",
      "agents",
      "done",
    ]);
  });
  it("skip the server where the server has it and nothing there is the reader's to undo", () => {
    expect(installPages({ server: "done", steps: 2, serverRun: false })).toEqual([
      "agents",
      "done",
    ]);
    expect(installPages({ server: "done", steps: 2, serverRun: false, removable: true })).toEqual([
      "server",
      "agents",
      "done",
    ]);
  });
  it("keep the server's page while its install runs or failed", () => {
    expect(installPages({ server: "done", steps: 2, serverRun: true })[0]).toBe("server");
  });
  it("are one page for a member asking an admin, and for a server module already in place", () => {
    expect(installPages({ server: "ask", steps: 2, serverRun: false })).toEqual(["server"]);
    expect(installPages({ server: "done", steps: 1, serverRun: false })).toEqual(["server"]);
  });
  it("end in Ready after a server module's own install", () => {
    expect(installPages({ server: "install", steps: 1, serverRun: false })).toEqual([
      "server",
      "done",
    ]);
  });
});
