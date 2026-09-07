/**
 * @prismshadow/penguin-plugin-discord-bot — a Discord bot that starts agents from chat.
 *
 * A PLUGIN PACKAGE, not part of the harness: a Project lists it in its config and the
 * harness resolves it from the installation (see the server's plugin/loader.ts). It compiles
 * against the type-only `@prismshadow/penguin-core/plugin` and
 * `@prismshadow/penguin-server/plugin` surfaces; at runtime it imports the SDK the host
 * already has (`@prismshadow/penguin-core`, external in the bundle) and bundles its own
 * copy of Hono for the settings routes.
 *
 * The harness has no notion of a chat bot. What it lends this package is what it already
 * has — the Discord messaging connector (credential shape, Gateway, sends, Markdown, the
 * 2000-character cap), Session creation, the task runner, the Session event channel and the
 * settings store — reached through the module's `requires`; everything that makes those a
 * bot lives in bot.ts: one Gateway connection, a Session per chat, replies relayed back,
 * `/new`, `/approve`, `/deny`, `/status`. routes.ts is the admin settings API at
 * `/api/discord-bot`, contributed through the `HttpModule.routes` slot.
 *
 * A seed read from the server's environment configures a deployment without the API:
 *
 *   PENGUIN_DISCORD_BOT_TOKEN   the bot token from the Discord developer portal
 *   PENGUIN_DISCORD_PROJECT     the Project every chat's Session is created under
 *   PENGUIN_DISCORD_AGENT       the Agent in that Project
 *
 * The seed applies only where nothing is stored yet: what an administrator saves through the
 * API wins, and a bot switched off there stays off. With all three variables set the bot
 * starts enabled; with the token alone it waits for a target.
 */
import type { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/plugin";
import type { ClassCtx, Plugin } from "@prismshadow/penguin-core/plugin";
import type {
  AgentIndex,
  Channels,
  Errors,
  Log,
  Messaging,
  MessagingTaskRunner,
  Paths,
  ScheduleSessionCreator,
  SessionIndex,
  Sessions,
  Settings,
} from "@prismshadow/penguin-server/plugin";
import { DiscordBot, type BotDefaults } from "./bot.js";
import { ROUTES_ID, discordBotRoutes } from "./routes.js";

export {
  DiscordBot,
  BotError,
  APPROVAL_NOTICE,
  NEW_NOTICE,
  NOTHING_PENDING_NOTICE,
  NOT_CONFIGURED_NOTICE,
  UNSUPPORTED_NOTICE,
  CONFIG_KEY,
  CHATS_KEY,
  REPLY_CHUNK_CHARS,
  botIdOf,
  chunkReply,
  mask,
  safeFileName,
  writeAttachment,
} from "./bot.js";
export type { BotDefaults, BotDeps, BotInfo, BotStatus, StoredConfig } from "./bot.js";
export { ROUTES_ID, discordBotRoutes } from "./routes.js";

/** The seed read off the environment; absent or blank variables leave their field unset. */
export function envDefaults(env: NodeJS.ProcessEnv = process.env): BotDefaults {
  const pick = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value !== undefined && value !== "" ? value : undefined;
  };
  const botToken = pick("PENGUIN_DISCORD_BOT_TOKEN");
  const projectId = pick("PENGUIN_DISCORD_PROJECT");
  const agentId = pick("PENGUIN_DISCORD_AGENT");
  return {
    ...(botToken !== undefined ? { botToken } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(agentId !== undefined ? { agentId } : {}),
    // Enabled only when the seed is complete: a token with no target could connect and
    // answer every message with "not configured", which is worse than staying dark.
    ...(botToken !== undefined && projectId !== undefined && agentId !== undefined
      ? { enabled: true }
      : {}),
  };
}

/**
 * The plugin's one module: the bot, built over what the host lends it (each requirement
 * names the host module that provides it — a plugin has no host class to point at), and
 * the status route on the HttpModule.routes slot. Its manifest is generated into
 * ifaces.json from here.
 */
@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "discord-bot.routes", prefix: "/api/discord-bot", auth: "user", order: 286 },
    ],
  },
  context: { version: 1 },
})
export class DiscordBotPlugin {
  @Use("MessagingHubModule") private readonly messaging!: Messaging;
  @Use("SessionRuntimeModule") private readonly runner!: MessagingTaskRunner;
  @Use("SessionRuntimeModule") private readonly sessions!: Sessions;
  @Use("SessionRuntimeModule") private readonly sessionCreator!: ScheduleSessionCreator;
  @Use("SessionRuntimeModule") private readonly sessionIndex!: SessionIndex;
  @Use("ProjectsModule") private readonly agents!: AgentIndex;
  @Use("SettingsModule") private readonly settings!: Settings;
  @Use("RuntimeModule") private readonly channels!: Channels;
  @Use("ObservabilityModule") private readonly errors!: Errors;
  @Use("RuntimeModule") private readonly paths!: Paths;
  @Use("RuntimeModule") private readonly log!: Log;
  @Bind("discord-bot.routes") routes!: Hono;

  async setup({ effect }: ClassCtx) {
    const bot = new DiscordBot({
      messaging: this.messaging,
      runner: this.runner,
      sessions: this.sessions,
      sessionCreator: this.sessionCreator,
      sessionIndex: this.sessionIndex,
      agents: this.agents,
      settings: this.settings,
      channels: this.channels,
      errors: this.errors,
      paths: this.paths,
      log: this.log,
      defaults: envDefaults(),
    });
    await bot.start();
    effect(() => bot.stop());
    this.routes = discordBotRoutes(bot);
  }
}

const plugin: Plugin = { modules: [DiscordBotPlugin] };

export default plugin;
