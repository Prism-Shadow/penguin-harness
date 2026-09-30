/**
 * The Plugins page's machine picker: all machines show every table with where each plugin
 * runs; a machine's view shows what that machine is asked for, in the state that machine
 * reports, and edits only its own table.
 */
import { describe, expect, it } from "vitest";
import type { InstalledPluginsResponse } from "@prismshadow/penguin-server/api";
import {
  availablePluginRows,
  installedPluginRows,
  type PluginView,
} from "../src/features/plugins/plugins-page";

const SELF = "Self000000000000";
const GPU = "Gpu0000000000000";

const row = (
  specifier: string,
  where: { everywhere: boolean; machines: string[]; here: boolean },
  active = where.here,
): InstalledPluginsResponse["plugins"][number] => ({
  specifier,
  active,
  builtin: false,
  modules: [],
  replaces: [],
  ...where,
});

const deployment: InstalledPluginsResponse = {
  plugins: [
    row("@acme/shared", { everywhere: true, machines: [], here: true }),
    row("@acme/gpu-only", { everywhere: false, machines: [GPU], here: false }),
  ],
  shipped: [],
  file: ".project_config.toml",
  machineId: SELF,
  restartPending: false,
};

const nameOf = (id: string) => (id === GPU ? "gpu-box" : "this server");
const modules = (rows: ReturnType<typeof installedPluginRows>) =>
  rows.flatMap((r) => (r.kind === "module" ? [r] : []));

describe("plugin rows per machine", () => {
  it("all machines: every plugin, and a machine-only one says where it runs", () => {
    const view: PluginView = { machineId: null, remote: null, nameOf };
    const rows = modules(installedPluginRows([], "en", deployment, [], view));
    expect(rows.map((r) => [r.specifier, r.state, r.onlyOn])).toEqual([
      ["@acme/shared", "active", undefined],
      ["@acme/gpu-only", "elsewhere", ["gpu-box"]],
    ]);
    // Offered for all machines, since the shared table does not list it.
    expect(availablePluginRows(deployment, [], view)).toEqual([]);
  });

  it("this server: what it is asked for, and a shared plugin cannot be removed from its table", () => {
    const view: PluginView = { machineId: SELF, remote: null, nameOf };
    const rows = modules(installedPluginRows([], "en", deployment, [], view));
    expect(rows.map((r) => r.specifier)).toEqual(["@acme/shared"]);
    expect(rows[0]!.removeBlocked).toBeDefined();
  });

  it("another machine: the state it reports, and what it has not received yet", () => {
    const remote: InstalledPluginsResponse = {
      ...deployment,
      machineId: GPU,
      plugins: [row("@acme/gpu-only", { everywhere: true, machines: [], here: true }, false)],
    };
    remote.plugins[0]!.error = "npm: 404";
    const view: PluginView = { machineId: GPU, remote, nameOf };
    const rows = modules(installedPluginRows([], "en", deployment, [], view));
    expect(rows.map((r) => [r.specifier, r.state, r.removeBlocked === undefined])).toEqual([
      ["@acme/shared", "unsynced", false],
      ["@acme/gpu-only", "failed", true],
    ]);
  });
});
