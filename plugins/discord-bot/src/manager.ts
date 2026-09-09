/**
 * The one bot this deployment runs, kept in line with the plugin's configuration.
 *
 * The manager reads the values the harness holds for this package (`PluginConfig.get`),
 * builds the bot when they describe one, restarts it when they change (the harness fires
 * the watch after every save on the Plugins page) and stops it when they stop describing
 * one. A configuration that cannot be used — no token, a malformed one, no Project, an
 * Agent the Project has not got — is reported as the reason instead of a bot.
 */
import type { AgentIndex, PluginConfig } from "@prismshadow/penguin-server/plugin";
import { DiscordBot, mask } from "./bot.js";
import type { BotDeps, BotInfo, BotTarget } from "./bot.js";
import { PACKAGE_NAME, botConfigOf } from "./config.js";

export interface ManagerDeps extends BotDeps {
  pluginConfig: Pick<PluginConfig, "get" | "watch">;
  agents: Pick<AgentIndex, "exists">;
}

/** What the status route answers: the bot, or why there is none. */
export interface BotsStatus {
  bot: BotInfo | null;
  /** Why the configuration makes no bot; null while it does, or while nothing is filled in. */
  error: string | null;
  configured: boolean;
}

/** What a running bot was built from, so a pass can tell whether the configuration changed. */
function signatureOf(t: BotTarget): string {
  return JSON.stringify([t.projectId, t.botToken, t.agentId, t.enabled]);
}

export class DiscordBots {
  private bot: DiscordBot | null = null;
  private error: string | null = null;
  private configured = false;
  private unwatch: (() => void) | null = null;
  private pass: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly deps: ManagerDeps) {}

  async start(): Promise<void> {
    this.unwatch = this.deps.pluginConfig.watch(PACKAGE_NAME, () => void this.reconcile());
    await this.reconcile();
  }

  stop(): void {
    this.stopped = true;
    this.unwatch?.();
    this.unwatch = null;
    this.bot?.stop();
    this.bot = null;
  }

  status(): BotsStatus {
    return { bot: this.bot?.info() ?? null, error: this.error, configured: this.configured };
  }

  /** One pass over the configuration; concurrent callers share the pass in flight. */
  reconcile(): Promise<void> {
    this.pass ??= this.runPass().finally(() => {
      this.pass = null;
    });
    return this.pass;
  }

  private async runPass(): Promise<void> {
    if (this.stopped) return;
    const config = botConfigOf(this.deps.pluginConfig.get(PACKAGE_NAME), this.deps.agents);
    this.configured = config !== null;
    if (config === null || !config.ok) {
      const error = config === null ? null : config.error;
      if (this.bot !== null) {
        this.bot.stop();
        this.bot = null;
        this.deps.log.line(`[discord-bot] stopped: ${error ?? "configuration cleared"}`);
      } else if (error !== null && error !== this.error) {
        this.deps.log.line(`[discord-bot] ${error}`);
      }
      this.error = error;
      return;
    }
    this.error = null;
    const target: BotTarget = {
      projectId: config.projectId,
      botToken: config.botToken,
      agentId: config.agentId,
      enabled: config.enabled,
    };
    if (this.bot !== null && signatureOf(this.bot.target) === signatureOf(target)) return;
    this.bot?.stop();
    this.deps.log.line(
      `[discord-bot] ${this.bot === null ? "starting" : "configuration changed, restarting"}: bot ${mask(target.botToken)} on ${target.projectId}/${target.agentId}, ${target.enabled ? "enabled" : "disabled"}`,
    );
    if (this.stopped) return;
    const bot = new DiscordBot(target, this.deps);
    this.bot = bot;
    await bot.start();
  }
}
