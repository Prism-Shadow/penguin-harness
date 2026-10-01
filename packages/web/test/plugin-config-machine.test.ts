/**
 * Plugin settings are kept by each server in its own database, so the Settings dialog's
 * Plugins page reads and writes a picked machine's settings through that machine's proxy
 * prefix (api/endpoints.ts).
 *
 * - With a machine picked, reading, writing and running an action go to that machine; with
 *   none, they stay on this server.
 */
import { describe, expect, it, vi } from "vitest";
import * as api from "../src/api/endpoints";
import { json, stubFetch } from "./helpers/fetch";

const ID = "noeSE0FFHhNXl2J5";

describe("plugin config endpoints", () => {
  it("goes to the picked machine, and stays here otherwise", async () => {
    vi.stubGlobal("WebSocket", undefined);
    const fetch = stubFetch(() => json({ plugins: [], ok: true, message: "" }));
    await api.adminGetPluginConfig();
    await api.adminGetPluginConfig(ID);
    await api.adminPutPluginConfig({ name: "sandbox", values: {} }, ID);
    await api.adminRunPluginConfigAction({ name: "sandbox", action: "setup" }, ID);
    // The client may probe the session first; only the plugin-config calls are in question.
    expect(
      fetch.requests
        .filter((r) => r.path.includes("plugin-config"))
        .map((r) => [r.machine, r.method, r.path]),
    ).toEqual([
      [null, "GET", "/api/admin/plugin-config"],
      [ID, "GET", "/api/admin/plugin-config"],
      [ID, "PUT", "/api/admin/plugin-config"],
      [ID, "POST", "/api/admin/plugin-config/action"],
    ]);
  });
});
