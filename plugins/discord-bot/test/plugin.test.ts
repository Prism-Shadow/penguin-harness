/**
 * The plugin on its own: the manifest and the code half agree, and the environment seed is
 * read exactly as documented — enabled only with all three variables set.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import plugin, { DISCORD_BOT_ID, DiscordBot, envDefaults } from "../src/index.js";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("the discord-bot plugin", () => {
  it("binds the contribution its generated manifest declares", () => {
    // The table the package's `test` script regenerates before vitest runs.
    const table = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "ifaces.json"), "utf8")) as {
      modules: Record<string, { name: string; contributes: Record<string, Array<{ id: string }>> }>;
      plugin: { modules: string[] };
    };
    const manifest = table.modules.DiscordBot;
    expect(manifest?.name).toBe("DiscordBot");
    expect(manifest?.contributes["ChatBotsModule.bots"]?.[0]?.id).toBe(DISCORD_BOT_ID);
    expect(table.plugin.modules).toEqual(["DiscordBot"]);
    expect(plugin.modules).toEqual([DiscordBot]);
    const instance = new DiscordBot();
    instance.setup();
    expect(instance.bot.defaults).toEqual(envDefaults());
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
