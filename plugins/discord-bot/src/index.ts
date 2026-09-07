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
import type { Plugin } from "@prismshadow/penguin-core/plugin";
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

const plugin: Plugin = {
  modules: {
    DiscordBot: {
      async create({ use, effect }) {
        const bot = new DiscordBot({
          messaging: use.messaging as Messaging,
          runner: use.runner as MessagingTaskRunner,
          sessions: use.sessions as Sessions,
          sessionCreator: use.sessionCreator as ScheduleSessionCreator,
          sessionIndex: use.sessionIndex as SessionIndex,
          agents: use.agents as AgentIndex,
          settings: use.settings as Settings,
          channels: use.channels as Channels,
          errors: use.errors as Errors,
          paths: use.paths as Paths,
          log: use.log as Log,
          defaults: envDefaults(),
        });
        await bot.start();
        effect(() => bot.stop());
        return { api: {}, bind: { [ROUTES_ID]: discordBotRoutes(bot) } };
      },
    },
  },
};

export default plugin;
