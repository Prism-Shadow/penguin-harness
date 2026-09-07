/**
 * The plugin on its own: the manifest and the code half agree, and the environment seed is
 * read exactly as documented — enabled only with all three variables set.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import plugin, { DISCORD_BOT_ID, envDefaults } from "../src/index.js";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("the discord-bot plugin", () => {
  it("binds the contribution its manifest declares", async () => {
    const pkg = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "package.json"), "utf8")) as {
      penguin: {
        modules: Array<{ name: string; contributes: Record<string, Array<{ id: string }>> }>;
      };
    };
    const [manifest] = pkg.penguin.modules;
    expect(manifest?.name).toBe("DiscordBot");
    expect(manifest?.contributes["ChatBotsModule.bots"]?.[0]?.id).toBe(DISCORD_BOT_ID);
    const module = plugin.modules?.DiscordBot;
    expect(module).toBeDefined();
    const instance = await module!.create({} as never, null);
    expect(Object.keys(instance.bind ?? {})).toEqual([DISCORD_BOT_ID]);
  });

  it("seeds the bot from the environment, enabled only when the seed is complete", () => {
    expect(envDefaults({})).toEqual({});
    expect(envDefaults({ PENGUIN_DISCORD_BOT_TOKEN: " tok " })).toEqual({
      config: { botToken: "tok" },
    });
    expect(
      envDefaults({
        PENGUIN_DISCORD_BOT_TOKEN: "tok",
        PENGUIN_DISCORD_PROJECT: "p",
        PENGUIN_DISCORD_AGENT: "a",
      }),
    ).toEqual({ config: { botToken: "tok" }, projectId: "p", agentId: "a", enabled: true });
    // A blank variable is an unset one.
    expect(envDefaults({ PENGUIN_DISCORD_PROJECT: "", PENGUIN_DISCORD_AGENT: "a" })).toEqual({
      agentId: "a",
    });
  });
});
