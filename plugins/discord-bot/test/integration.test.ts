/**
 * The plugin on the real server: installed through a Project's config, loaded by the real
 * loader, its requirements resolved from the tree, its routes mounted behind the cookie
 * gate — configured, probed with a malformed token, refused an enable without a target.
 * Nothing here connects to Discord: the bot is never enabled with a credential the platform
 * would be asked about.
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
/** A token whose first segment decodes to a numeric bot id, as the developer portal issues them. */
const TOKEN = `${Buffer.from("123456789012345678").toString("base64")}.GaBcDe.test-secret-AAAA`;

interface BotInfo {
  configured: boolean;
  botTokenMasked?: string;
  projectId: string | null;
  agentId: string | null;
  enabled: boolean;
  status: { state: string };
  chats: number;
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

  it("is loaded, and answers on its own route with nothing configured", async () => {
    const [row] = await harness.installedPlugins();
    expect(row).toMatchObject({ active: true, modules: ["DiscordBot"], replaces: [] });
    const info = await api.get<BotInfo>("/api/discord-bot");
    expect(info).toMatchObject({
      configured: false,
      projectId: null,
      agentId: null,
      enabled: false,
      status: { state: "disconnected" },
      chats: 0,
    });
    expect("botTokenMasked" in info).toBe(false);
  });

  it("saves a masked token and a target, refuses a malformed token, and needs both to enable", async () => {
    const saved = await api.put<BotInfo>("/api/discord-bot", {
      botToken: TOKEN,
      projectId: "default_project",
      agentId: "default_agent",
    });
    expect(saved.configured).toBe(true);
    expect(saved.botTokenMasked).toBe(`${TOKEN.slice(0, 4)}…${TOKEN.slice(-4)}`);
    expect(saved.projectId).toBe("default_project");
    expect(saved.enabled).toBe(false);

    const bad = await api.put<BotInfo>("/api/discord-bot", { botToken: "not-a-token" }).then(
      () => null,
      (e: HarnessApiError) => e,
    );
    expect(bad?.status).toBe(400);
    expect((await api.get<BotInfo>("/api/discord-bot")).configured).toBe(true);

    const missing = await api
      .put<BotInfo>("/api/discord-bot", { projectId: "default_project", agentId: "nope" })
      .then(
        () => null,
        (e: HarnessApiError) => e,
      );
    expect(missing?.status).toBe(404);
  });
});
