/**
 * The bot's configuration: the options this package declares in `package.json#penguin
 * .configuration` and an admin fills in on the System settings dialog's Plugins page —
 * the harness stores them and hands them to the module through its `PluginConfig`
 * mechanism, merged onto the schema's defaults, and fires the module's watch on every save.
 *
 *   bot_token   the Bot page of the Discord developer portal (a secret)
 *   project     the Project every chat's Session is created under (a Project picker)
 *   agent       the Agent in that Project that answers (default: default_agent)
 *   enabled     off keeps the token and stops the bot (default: true)
 *
 * Nothing else configures it — no environment variable, no file to edit by hand.
 */
import type { AgentIndex } from "@prismshadow/penguin-server/plugin";

/** The package name, which is what the harness keys this plugin's configuration by. */
export const PACKAGE_NAME = "@prismshadow/penguin-plugin-discord-bot";

/** The Agent a configuration that names none answers with: every Project has one. */
export const DEFAULT_AGENT = "default_agent";

/** The bot as the configuration describes it — or the reason the configuration is unusable. */
export type BotConfig =
  | { ok: true; projectId: string; botToken: string; agentId: string; enabled: boolean }
  | { ok: false; error: string };

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
 * Reads the bot out of the stored values. `null` while nothing has been filled in — the
 * ordinary state of a freshly installed plugin — and a refusal, never a throw, for values
 * that are there but wrong: the operator reads it off the status route.
 */
export function botConfigOf(
  values: Record<string, unknown>,
  agents: Pick<AgentIndex, "exists">,
): BotConfig | null {
  const token = typeof values.bot_token === "string" ? values.bot_token.trim() : "";
  const projectId = typeof values.project === "string" ? values.project.trim() : "";
  if (token === "" && projectId === "") return null;
  if (token === "") return { ok: false, error: "the bot token is not set" };
  if (botIdOf(token) === null) {
    return {
      ok: false,
      error:
        "the bot token is not a Discord bot token (three dot-separated segments, the first naming the bot)",
    };
  }
  if (projectId === "") return { ok: false, error: "no Project is chosen" };
  const agentId =
    typeof values.agent === "string" && values.agent.trim() !== ""
      ? values.agent.trim()
      : DEFAULT_AGENT;
  if (!agents.exists(projectId, agentId)) {
    return { ok: false, error: `Agent "${agentId}" does not exist in Project "${projectId}"` };
  }
  const enabled = values.enabled === undefined ? true : values.enabled === true;
  return { ok: true, projectId, botToken: token.replace(/^Bot\s+/i, ""), agentId, enabled };
}
