/**
 * @prismshadow/penguin-plugin-discord-bot — a Discord bot that starts agents from chat.
 *
 * A PLUGIN PACKAGE, not part of the harness: a Project lists it in its config and the
 * harness resolves it from the installation (see the server's plugin/loader.ts). It compiles
 * against the type-only `@prismshadow/penguin-core/plugin` and
 * `@prismshadow/penguin-server/plugin` surfaces; at runtime it imports the SDK the host
 * already has (`@prismshadow/penguin-core`, external in the bundle) and bundles its own
 * copy of Hono for the status route.
 *
 * The harness has no notion of a chat bot. What it lends this package is what it already
 * has — the Discord messaging connector (credential shape, Gateway, sends, Markdown, the
 * 2000-character cap), Session creation, the task runner, the Session event channel, the
 * settings store and the Projects' config files — reached through the module's `requires`;
 * everything that makes those a bot lives here: config.ts reads a Project's `[discord_bot]`
 * table, manager.ts keeps one bot per such Project in line with the files, bot.ts is the
 * bot (one Gateway connection, a Session per chat, replies relayed back, `/new`, `/approve`,
 * `/deny`, `/status`), routes.ts the read-only status route at `/api/discord-bot`.
 *
 * Configuration is the Project's config file and nothing else:
 *
 *   [discord_bot]
 *   bot_token = "…"          # the Bot page of the Discord developer portal
 *   agent = "default_agent"  # optional
 *   enabled = true           # optional
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
  ProjectConfigStore,
  Projects,
  ScheduleSessionCreator,
  SessionIndex,
  Sessions,
  Settings,
} from "@prismshadow/penguin-server/plugin";
import { DiscordBots } from "./manager.js";
import { ROUTES_ID, discordBotRoutes } from "./routes.js";

export {
  DiscordBot,
  APPROVAL_NOTICE,
  NEW_NOTICE,
  NOTHING_PENDING_NOTICE,
  UNSUPPORTED_NOTICE,
  REPLY_CHUNK_CHARS,
  chatsKeyOf,
  chunkReply,
  mask,
  safeFileName,
  writeAttachment,
} from "./bot.js";
export type { BotDeps, BotInfo, BotStatus, BotTarget } from "./bot.js";
export { CONFIG_TABLE, DEFAULT_AGENT, botConfigOf, botIdOf } from "./config.js";
export type { BotConfig } from "./config.js";
export { DiscordBots, RECONCILE_INTERVAL_MS } from "./manager.js";
export type { BrokenBotInfo, ManagerDeps } from "./manager.js";
export { ROUTES_ID, discordBotRoutes } from "./routes.js";

/**
 * The plugin's one module: the bot, built over what the host lends it (each requirement
 * names the host module that provides it — a plugin has no host class to point at), and
 * its route on the HttpModule.routes slot. Its manifest is generated into ifaces.json
 * from here.
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
  @Use("ProjectsModule") private readonly projects!: Projects;
  @Use("ProjectsModule") private readonly configStore!: ProjectConfigStore;
  @Use("SettingsModule") private readonly settings!: Settings;
  @Use("RuntimeModule") private readonly channels!: Channels;
  @Use("ObservabilityModule") private readonly errors!: Errors;
  @Use("RuntimeModule") private readonly paths!: Paths;
  @Use("RuntimeModule") private readonly log!: Log;
  @Bind("discord-bot.routes") routes!: Hono;

  async setup({ effect }: ClassCtx) {
    const bots = new DiscordBots({
      messaging: this.messaging,
      runner: this.runner,
      sessions: this.sessions,
      sessionCreator: this.sessionCreator,
      sessionIndex: this.sessionIndex,
      agents: this.agents,
      projects: this.projects,
      configStore: this.configStore,
      settings: this.settings,
      channels: this.channels,
      errors: this.errors,
      paths: this.paths,
      log: this.log,
    });
    await bots.start();
    effect(() => bots.stop());
    this.routes = discordBotRoutes(bots);
  }
}

const plugin: Plugin = { modules: [DiscordBotPlugin] };

export default plugin;
