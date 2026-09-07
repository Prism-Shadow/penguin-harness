/**
 * The bot's configuration: a `[discord_bot]` table in a Project's `.project_config.toml`,
 * beside the Project's models and its plugin list — the file is already where a Project
 * keeps the credentials its agents run with, and a bot answers FOR a Project, so the Project
 * is the bot's scope. One table, one bot; a deployment with several Projects may run several.
 *
 *   plugins = ["@prismshadow/penguin-plugin-discord-bot"]
 *
 *   [discord_bot]
 *   bot_token = "MTIz….GaBcDe.…"   # from the Bot page of the Discord developer portal
 *   agent = "default_agent"        # the Agent in this Project that answers (default: default_agent)
 *   enabled = true                 # default true; false keeps the token and stops the bot
 *
 * Nothing else configures it — no environment variable, no settings API. The file is
 * re-read on a short interval (and on every read of the status route), so an edit takes
 * effect without a restart; what an edit cannot do is leave a half-written table — a table
 * this cannot read is reported as the bot's error, with the file left alone.
 */
import type { AgentIndex } from "@prismshadow/penguin-server/plugin";

/** The table's key in the Project config. */
export const CONFIG_TABLE = "discord_bot";

/** The Agent a table that names none answers with: every Project has one. */
export const DEFAULT_AGENT = "default_agent";

/** One Project's bot, as its table configures it — or the reason the table is unusable. */
export type BotConfig =
  | { ok: true; projectId: string; botToken: string; agentId: string; enabled: boolean }
  | { ok: false; projectId: string; error: string };

/**
 * The bot's user id a token encodes, or null when the token is malformed: three
 * dot-separated segments, the first the id in base64 — the same rule the harness's Discord
 * connector applies to a per-Session binding. A pasted `Bot ` prefix is tolerated.
 */
export function botIdOf(botToken: string): string | null {
  const bare = botToken.trim().replace(/^Bot\s+/i, "");
  const [head, ...rest] = bare.split(".");
  if (head === undefined || head === "" || rest.length !== 2 || rest.some((s) => s === ""))
    return null;
  const decoded = Buffer.from(head, "base64").toString("utf8");
  return /^\d{15,22}$/.test(decoded) ? decoded : null;
}

/**
 * Reads one Project's table out of its raw config. `null` when the Project has no table —
 * the ordinary case for a Project that does not run a bot — and a refusal, never a throw,
 * for a table that is there but wrong: the operator reads it off the status route.
 */
export function botConfigOf(
  projectId: string,
  raw: Record<string, unknown>,
  agents: Pick<AgentIndex, "exists">,
): BotConfig | null {
  const table = raw[CONFIG_TABLE];
  if (table === undefined || table === null) return null;
  if (typeof table !== "object" || Array.isArray(table)) {
    return { ok: false, projectId, error: `[${CONFIG_TABLE}] must be a table` };
  }
  const t = table as Record<string, unknown>;
  const token = typeof t.bot_token === "string" ? t.bot_token.trim() : "";
  if (token === "")
    return { ok: false, projectId, error: `[${CONFIG_TABLE}].bot_token is required` };
  if (botIdOf(token) === null) {
    return {
      ok: false,
      projectId,
      error: `[${CONFIG_TABLE}].bot_token is not a Discord bot token (three dot-separated segments, the first naming the bot)`,
    };
  }
  const agentId =
    typeof t.agent === "string" && t.agent.trim() !== "" ? t.agent.trim() : DEFAULT_AGENT;
  if (!agents.exists(projectId, agentId)) {
    return {
      ok: false,
      projectId,
      error: `[${CONFIG_TABLE}].agent "${agentId}" does not exist in this Project`,
    };
  }
  const enabled = t.enabled === undefined ? true : t.enabled === true;
  return { ok: true, projectId, botToken: token.replace(/^Bot\s+/i, ""), agentId, enabled };
}
