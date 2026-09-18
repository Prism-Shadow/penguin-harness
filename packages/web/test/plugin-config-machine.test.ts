/**
 * Plugin settings are kept by each server in its own database, so the Settings dialog's
 * Plugins page reads and writes a picked machine's settings through that machine's proxy
 * prefix, and this server's own when none is picked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api/endpoints";

const ID = "noeSE0FFHhNXl2J5";

describe("plugin config endpoints", () => {
  const calls: { url: string; method: string }[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("WebSocket", undefined);
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method ?? "GET" });
      return new Response(JSON.stringify({ plugins: [], ok: true, message: "" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("goes to the picked machine, and stays here otherwise", async () => {
    await api.adminGetPluginConfig();
    await api.adminGetPluginConfig(ID);
    await api.adminPutPluginConfig({ name: "sandbox", values: {} }, ID);
    await api.adminRunPluginConfigAction({ name: "sandbox", action: "setup" }, ID);
    // The client may probe the session first; only the plugin-config calls are in question.
    expect(calls.filter((c) => c.url.includes("plugin-config"))).toEqual([
      { url: "/api/admin/plugin-config", method: "GET" },
      { url: `/server/${ID}/api/admin/plugin-config`, method: "GET" },
      { url: `/server/${ID}/api/admin/plugin-config`, method: "PUT" },
      { url: `/server/${ID}/api/admin/plugin-config/action`, method: "POST" },
    ]);
  });
});
