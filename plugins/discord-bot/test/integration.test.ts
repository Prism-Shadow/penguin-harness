/**
 * The plugin on the real server: installed through a Project's config, loaded by the real
 * loader, its requirements resolved from the tree, its status route mounted behind the
 * cookie gate — and its options declared to the harness, listed on the admin plugin-config
 * API with the token masked, saved there, and read back by the bot. Nothing here connects
 * to Discord: the bot is saved switched off, and then with a token the plugin refuses.
 *
 * Needs the server and this package built (see README).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultServerEntry,
  startHarness,
  type Harness,
  type HarnessApi,
  type HarnessApiError,
} from "@prismshadow/penguin-plugin-test";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "@prismshadow/penguin-plugin-discord-bot";
/** A token whose first segment decodes to a numeric bot id, as the developer portal issues them. */
const TOKEN = `${Buffer.from("123456789012345678").toString("base64")}.GaBcDe.test-secret-AAAA`;

interface ConfigResponse {
  plugins: Array<{
    name: string;
    configuration: { properties: Record<string, { type: string }> };
    values: Record<string, unknown>;
  }>;
}
interface Status {
  bot: { projectId: string; agentId: string; botTokenMasked: string; enabled: boolean } | null;
  error: string | null;
  configured: boolean;
}

describe("the discord-bot plugin on a real server", () => {
  let harness: Harness;
  let api: HarnessApi;

  beforeAll(async () => {
    await fs.access(defaultServerEntry());
    harness = await startHarness({ plugins: [PLUGIN_DIR] });
    api = await harness.login();
  }, 90_000);
  afterAll(async () => {
    await harness?.stop();
  });

  it("is loaded, declares its options to the harness, and has no bot until they are filled in", async () => {
    const [row] = await harness.installedPlugins();
    expect(row).toMatchObject({ active: true, modules: ["DiscordBot"], replaces: [] });
    const { plugins } = await api.get<ConfigResponse>("/api/admin/plugin-config");
    const mine = plugins.find((p) => p.name === NAME);
    expect(Object.keys(mine?.configuration.properties ?? {})).toEqual([
      "bot_token",
      "project",
      "agent",
      "enabled",
    ]);
    // Defaults arrive as values; nothing secret is stored yet.
    expect(mine?.values).toEqual({ agent: "default_agent", enabled: true });
    expect(await api.get<Status>("/api/discord-bot")).toEqual({
      bot: null,
      error: null,
      configured: false,
    });
  });

  it("takes its values from the admin plugin-config API, masked on the way back, and refuses a bad token", async () => {
    const saved = await api.put<ConfigResponse>("/api/admin/plugin-config", {
      name: NAME,
      values: { bot_token: TOKEN, project: "default_project", enabled: false },
    });
    const mine = saved.plugins.find((p) => p.name === NAME)!;
    expect(mine.values.bot_token).toBe(`${TOKEN.slice(0, 4)}…${TOKEN.slice(-4)}`);
    expect(JSON.stringify(saved)).not.toContain(TOKEN);
    const off = await api.get<Status>("/api/discord-bot");
    expect(off.bot).toMatchObject({
      projectId: "default_project",
      agentId: "default_agent",
      botTokenMasked: `${TOKEN.slice(0, 4)}…${TOKEN.slice(-4)}`,
      enabled: false,
    });

    // The masked value sent back keeps the stored token; the bot is unchanged.
    await api.put<ConfigResponse>("/api/admin/plugin-config", {
      name: NAME,
      values: { bot_token: mine.values.bot_token, agent: "ghost" },
    });
    const ghost = await api.get<Status>("/api/discord-bot");
    expect(ghost.bot).toBeNull();
    expect(ghost.error).toContain('"ghost"');

    await api.put<ConfigResponse>("/api/admin/plugin-config", {
      name: NAME,
      values: { bot_token: "not-a-token", agent: null },
    });
    const bad = await api.get<Status>("/api/discord-bot");
    expect(bad.bot).toBeNull();
    expect(bad.error).toContain("not a Discord bot token");

    // The harness's own validation: a field the schema has not got, and a required one emptied.
    const unknown = await api
      .put("/api/admin/plugin-config", { name: NAME, values: { colour: "red" } })
      .then(
        () => null,
        (e: HarnessApiError) => e,
      );
    expect(unknown?.status).toBe(400);
    const emptied = await api
      .put("/api/admin/plugin-config", { name: NAME, values: { project: null } })
      .then(
        () => null,
        (e: HarnessApiError) => e,
      );
    expect(emptied?.status).toBe(400);
  });
});
