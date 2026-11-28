/**
 * How a plugin's server module reads where it does not run (library/plugin/src/web/plugin-status.ts):
 * the mark on an Agent's plugin row with the action the viewer can take, and the Plugins page
 * card's status while an ask for it stands.
 *
 * - Given a module that runs, or a server that says nothing about it, there is no mark.
 * - Given a module that is off on this server, a member can enable a built-in one and ask the
 *   administrator for any other; the administrator can enable any.
 * - Given a module a member's request waits on, or one the administrator stopped, a member can do
 *   nothing more and the administrator can enable it right there.
 * - Given a module that failed or waits for a restart, it is listed already: the mark says so and
 *   offers nothing.
 * - Given an Agent on a machine, only a module the machine's build ships can be enabled from its
 *   row; any other is installed for that machine on the Plugins page.
 * - Given a hybrid plugin's card, a waiting ask reads as awaiting and a standing "no" as stopped,
 *   but only while the module does not run; otherwise the card reads what it always read.
 */
import { describe, expect, it } from "vitest";
import type { PluginModuleStatus } from "@prismshadow/penguin-server/api";
import {
  agentModuleMark,
  pluginStatus,
  type ModuleViewer,
} from "@prismshadow/penguin-library-plugin/web/plugin-status";

const mod = (over: Partial<PluginModuleStatus> = {}): PluginModuleStatus => ({
  plugin: "charts",
  package: "@acme/charts",
  builtin: false,
  state: "off",
  listed: false,
  ...over,
});

const pending = { status: "pending", mine: true, requestedAt: "2026-11-19T08:00:00Z" } as const;
const declined = { status: "declined", mine: false, requestedAt: "2026-11-19T08:00:00Z" } as const;

const member: ModuleViewer = { isAdmin: false, onMachine: false };
const admin: ModuleViewer = { isAdmin: true, onMachine: false };
const onMachine: ModuleViewer = { isAdmin: true, onMachine: true };

describe("the mark of an Agent plugin's server module", () => {
  it("is not there while the module runs, or when the server says nothing", () => {
    expect(agentModuleMark(mod({ state: "running", listed: true }), member)).toBeNull();
    expect(agentModuleMark(undefined, admin)).toBeNull();
  });

  it.each([
    ["a member, built in", mod({ builtin: true }), member, "enable"],
    ["a member, not built in", mod(), member, "request"],
    ["the administrator, not built in", mod(), admin, "enable"],
  ] as const)("offers %s an off module's action", (_who, status, viewer, action) => {
    expect(agentModuleMark(status, viewer)).toEqual({ kind: "off", action });
  });

  it.each([
    ["awaiting", pending],
    ["stopped", declined],
  ] as const)(
    "leaves a %s module to the administrator, who can enable it there",
    (kind, request) => {
      expect(agentModuleMark(mod({ request }), member)).toEqual({ kind, action: null });
      expect(agentModuleMark(mod({ request }), admin)).toEqual({ kind, action: "enable" });
    },
  );

  it("says why a listed module does not run, and offers nothing", () => {
    expect(agentModuleMark(mod({ state: "failed", reason: "boom", listed: true }), admin)).toEqual({
      kind: "failed",
      action: null,
      reason: "boom",
    });
    expect(agentModuleMark(mod({ state: "unsatisfied", reason: "no slot" }), member)).toEqual({
      kind: "failed",
      action: null,
      reason: "no slot",
    });
    expect(agentModuleMark(mod({ state: "restart", listed: true }), admin)).toEqual({
      kind: "restart",
      action: null,
    });
  });

  it("lets a machine's Agent enable only a module the machine ships", () => {
    expect(agentModuleMark(mod({ builtin: true }), onMachine)).toEqual({
      kind: "off",
      action: "enable",
    });
    expect(agentModuleMark(mod(), onMachine)).toEqual({ kind: "off", action: null });
    expect(agentModuleMark(mod({ builtin: true, request: declined }), onMachine)).toEqual({
      kind: "stopped",
      action: "enable",
    });
  });
});

describe("a hybrid plugin's card status while an ask for its module stands", () => {
  const used = { usedBy: ["helper"], behind: [] };

  it("reads awaiting or stopped while the module does not run", () => {
    expect(pluginStatus({}, used, mod({ request: pending }))).toBe("awaiting");
    expect(pluginStatus({}, used, mod({ request: declined }))).toBe("stopped");
  });

  it("reads what it always read once the module runs, or without an ask", () => {
    expect(pluginStatus({}, used, mod({ state: "running", request: declined }))).toBe("installed");
    expect(pluginStatus({}, used, mod())).toBe("installed");
    expect(pluginStatus({ module: { state: "active" } }, used, mod({ state: "running" }))).toBe(
      "installed",
    );
  });
});
