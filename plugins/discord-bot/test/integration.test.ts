/**
 * The plugin on the real server: installed through a Project's config, loaded by the real
 * loader, its requirements resolved from the tree, its status route mounted behind the
 * cookie gate — and its bot read off the Project's own `.project_config.toml`, a table
 * edited on disk showing up on the next read. Nothing here connects to Discord: the table
 * is written with the bot switched off, and then with a token the plugin refuses.
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
} from "@prismshadow/penguin-plugin-test";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** A token whose first segment decodes to a numeric bot id, as the developer portal issues them. */
const TOKEN = `${Buffer.from("123456789012345678").toString("base64")}.GaBcDe.test-secret-AAAA`;

interface Status {
  bots: Array<{
    projectId: string;
    agentId: string;
    botTokenMasked: string;
    enabled: boolean;
    status: { state: string };
    chats: number;
  }>;
  broken: Array<{ projectId: string; error: string }>;
}

describe("the discord-bot plugin on a real server", () => {
  let harness: Harness;
  let api: HarnessApi;
  let configFile: string;

  beforeAll(async () => {
    await fs.access(defaultServerEntry());
    harness = await startHarness({ plugins: [PLUGIN_DIR] });
    api = await harness.login();
    configFile = path.join(harness.root, "default_project", ".project_config.toml");
  }, 90_000);
  afterAll(async () => {
    await harness?.stop();
  });

  /** Appends a `[discord_bot]` table to the Project's config, replacing an earlier one. */
  const configure = async (table: string) => {
    const raw = await fs.readFile(configFile, "utf8");
    const base = raw.split("\n[discord_bot]")[0]!;
    await fs.writeFile(configFile, `${base.trimEnd()}\n\n[discord_bot]\n${table}\n`, "utf8");
  };

  it("is loaded, and lists no bot while no Project configures one", async () => {
    const [row] = await harness.installedPlugins();
    expect(row).toMatchObject({ active: true, modules: ["DiscordBot"], replaces: [] });
    expect(await api.get<Status>("/api/discord-bot")).toEqual({ bots: [], broken: [] });
  });

  it("reads the bot off the Project's config file, masked, and refuses a token it cannot read", async () => {
    await configure(`bot_token = "${TOKEN}"\nenabled = false`);
    const off = await api.get<Status>("/api/discord-bot");
    expect(off.bots).toEqual([
      {
        projectId: "default_project",
        agentId: "default_agent",
        botTokenMasked: `${TOKEN.slice(0, 4)}…${TOKEN.slice(-4)}`,
        enabled: false,
        status: { state: "disconnected", changedAt: expect.any(String) },
        chats: 0,
      },
    ]);
    expect(JSON.stringify(off)).not.toContain(TOKEN);

    await configure(`bot_token = "not-a-token"`);
    const broken = await api.get<Status>("/api/discord-bot");
    expect(broken.bots).toEqual([]);
    expect(broken.broken).toEqual([
      { projectId: "default_project", error: expect.stringContaining("not a Discord bot token") },
    ]);

    await configure(`bot_token = "${TOKEN}"\nagent = "ghost"\nenabled = false`);
    const ghost = await api.get<Status>("/api/discord-bot");
    expect(ghost.broken[0]?.error).toContain('"ghost"');
  });
});
