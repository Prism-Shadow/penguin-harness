/**
 * The plugin on the real server: installed through a Project's config, loaded by the real
 * loader, its bot offered on the chat-bot settings API — configured, probed for a malformed
 * token, refused an enable without a target. Nothing here connects to Discord: the bot is
 * never enabled with a credential the platform would be asked about.
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
  id: string;
  channel: string;
  label: string;
  projectId: string | null;
  agentId: string | null;
  config: Record<string, string>;
  configured: boolean;
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

  it("is loaded, and its bot is what the settings API lists", async () => {
    const [row] = await harness.installedPlugins();
    expect(row).toMatchObject({ active: true, modules: ["DiscordBot"], replaces: [] });
    const { bots } = await api.get<{ bots: BotInfo[] }>("/api/chat-bots");
    expect(bots).toEqual([
      {
        id: "discord",
        channel: "discord",
        label: "Discord",
        labelZh: "Discord",
        projectId: null,
        agentId: null,
        config: {},
        configured: false,
        enabled: false,
        status: { state: "disconnected", changedAt: expect.any(String) },
        chats: 0,
      },
    ]);
  });

  it("saves a masked credential and a target, and refuses a malformed token", async () => {
    const saved = await api.put<BotInfo>("/api/chat-bots/discord", {
      config: { botToken: TOKEN },
      projectId: "default_project",
      agentId: "default_agent",
    });
    expect(saved.configured).toBe(true);
    expect(saved.config.botToken).toBe(`${TOKEN.slice(0, 4)}…${TOKEN.slice(-4)}`);
    expect(saved.projectId).toBe("default_project");
    expect(saved.enabled).toBe(false);

    const err = await api.put<BotInfo>("/api/chat-bots/discord", { config: { botToken: "" } }).then(
      () => null,
      (e: HarnessApiError) => e,
    );
    // An empty string drops the field, which leaves the document without its credential.
    expect(err?.status).toBe(400);
    const again = await api.get<BotInfo>("/api/chat-bots/discord");
    expect(again.configured).toBe(true);
  });

  it("will not enable a bot whose target Agent does not exist", async () => {
    const err = await api
      .put<BotInfo>("/api/chat-bots/discord", { projectId: "default_project", agentId: "nope" })
      .then(
        () => null,
        (e: HarnessApiError) => e,
      );
    expect(err?.status).toBe(404);
  });
});
