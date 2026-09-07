/**
 * @prismshadow/penguin-plugin-discord-bot — a Discord bot that starts agents from chat.
 *
 * A PLUGIN PACKAGE, not part of the harness: a Project lists it in its config and the
 * harness resolves it from the installation (see the server's plugin/loader.ts). It
 * compiles against the type-only `@prismshadow/penguin-core/plugin` and
 * `@prismshadow/penguin-server/plugin` surfaces and carries no runtime dependency on either.
 *
 * What it contributes is ONE chat bot (server runtime/messaging/chat-bots.ts): the entry
 * `discord` on the harness's chat-bot host, carried by the Discord messaging connector the
 * server already has. Everything that makes it a bot — the Gateway connection, a Session per
 * chat, the relay of replies, `/new`, `/approve` — is the host's; what this package adds is
 * the manifest entry naming the channel, and a seed for the bot's configuration read from
 * the server's environment, so a deployment can be configured without touching the settings
 * API:
 *
 *   PENGUIN_DISCORD_BOT_TOKEN   the bot token from the Discord developer portal
 *   PENGUIN_DISCORD_PROJECT     the Project every chat's Session is created under
 *   PENGUIN_DISCORD_AGENT       the Agent in that Project
 *
 * The seed applies only where nothing is stored yet: what an administrator saves through
 * `PUT /api/chat-bots/discord` wins, and a bot switched off there stays off. With all three
 * variables set the bot starts enabled; with the token alone it waits for a target.
 */
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import type { ChatBotBinding, ChatBotDefaults } from "@prismshadow/penguin-server/plugin";

/** The seed read off the environment; absent variables leave their field unset. */
export function envDefaults(env: NodeJS.ProcessEnv = process.env): ChatBotDefaults {
  const botToken = env.PENGUIN_DISCORD_BOT_TOKEN?.trim();
  const projectId = env.PENGUIN_DISCORD_PROJECT?.trim();
  const agentId = env.PENGUIN_DISCORD_AGENT?.trim();
  const token = botToken !== undefined && botToken !== "" ? botToken : undefined;
  const project = projectId !== undefined && projectId !== "" ? projectId : undefined;
  const agent = agentId !== undefined && agentId !== "" ? agentId : undefined;
  return {
    ...(token !== undefined ? { config: { botToken: token } } : {}),
    ...(project !== undefined ? { projectId: project } : {}),
    ...(agent !== undefined ? { agentId: agent } : {}),
    // Enabled only when the seed is complete: a token with no target could connect and
    // answer every message with "not configured", which is worse than staying dark.
    ...(token !== undefined && project !== undefined && agent !== undefined
      ? { enabled: true }
      : {}),
  };
}

/** The contribution id, as the manifest names it. */
export const DISCORD_BOT_ID = "discord";

const plugin: Plugin = {
  modules: {
    DiscordBot: {
      create: () => ({
        api: {},
        bind: { [DISCORD_BOT_ID]: { defaults: envDefaults() } satisfies ChatBotBinding },
      }),
    },
  },
};

export default plugin;
