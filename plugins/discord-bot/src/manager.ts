/**
 * One bot per Project that configures one, kept in line with the Projects' config files.
 *
 * The manager reads every Project's `.project_config.toml` (through the harness's own
 * config store, which caches by mtime, so a pass is a stat per Project), builds a bot for
 * each `[discord_bot]` table, and on later passes restarts a bot whose table changed and
 * stops one whose table went. A pass runs at start, on a short interval, and on every read
 * of the status route — so an edit takes effect within seconds, and an operator who wants it
 * now reads the status. A table that cannot be used (no token, a malformed one, an Agent the
 * Project has not got) is listed with its reason instead of a bot.
 */
import type { AgentIndex, ProjectConfigStore, Projects } from "@prismshadow/penguin-server/plugin";
import { DiscordBot, mask } from "./bot.js";
import type { BotDeps, BotInfo, BotTarget } from "./bot.js";
import { botConfigOf } from "./config.js";

/** How often the config files are re-read. */
export const RECONCILE_INTERVAL_MS = 15_000;

/** A Project whose table could not be used: what the status route lists in a bot's place. */
export interface BrokenBotInfo {
  projectId: string;
  error: string;
}

export interface ManagerDeps extends BotDeps {
  projects: Pick<Projects, "listAll">;
  configStore: Pick<ProjectConfigStore, "readRaw">;
  agents: Pick<AgentIndex, "exists">;
  /** Test hook: the re-read interval (default RECONCILE_INTERVAL_MS; 0 disables the timer). */
  reconcileIntervalMs?: number;
}

/** What a running bot was built from, so a pass can tell whether the table changed. */
function signatureOf(t: BotTarget): string {
  return JSON.stringify([t.botToken, t.agentId, t.enabled]);
}

export class DiscordBots {
  private readonly bots = new Map<string, DiscordBot>();
  private readonly broken = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private pass: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly deps: ManagerDeps) {}

  async start(): Promise<void> {
    await this.reconcile();
    const every = this.deps.reconcileIntervalMs ?? RECONCILE_INTERVAL_MS;
    if (every > 0) {
      this.timer = setInterval(() => void this.reconcile(), every);
      // A config poll must never be the reason the process cannot exit.
      this.timer.unref?.();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const bot of this.bots.values()) bot.stop();
    this.bots.clear();
    this.broken.clear();
  }

  /** Every Project's bot or broken table, for the status route. */
  list(): { bots: BotInfo[]; broken: BrokenBotInfo[] } {
    return {
      bots: [...this.bots.values()].map((b) => b.info()),
      broken: [...this.broken].map(([projectId, error]) => ({ projectId, error })),
    };
  }

  /** One pass over the config files; concurrent callers share the pass in flight. */
  reconcile(): Promise<void> {
    this.pass ??= this.runPass().finally(() => {
      this.pass = null;
    });
    return this.pass;
  }

  private async runPass(): Promise<void> {
    if (this.stopped) return;
    const seen = new Set<string>();
    for (const project of this.deps.projects.listAll()) {
      const projectId = project.projectId;
      let raw: Record<string, unknown>;
      try {
        raw = await this.deps.configStore.readRaw(projectId);
      } catch (err) {
        this.markBroken(
          projectId,
          `config could not be read: ${err instanceof Error ? err.message : String(err)}`,
        );
        seen.add(projectId);
        continue;
      }
      const config = botConfigOf(projectId, raw, this.deps.agents);
      if (config === null) continue;
      seen.add(projectId);
      if (!config.ok) {
        this.markBroken(projectId, config.error);
        continue;
      }
      this.broken.delete(projectId);
      const target: BotTarget = {
        projectId,
        botToken: config.botToken,
        agentId: config.agentId,
        enabled: config.enabled,
      };
      const running = this.bots.get(projectId);
      if (running !== undefined && signatureOf(running.target) === signatureOf(target)) continue;
      if (running !== undefined) {
        running.stop();
        this.deps.log.line(
          `[discord-bot] ${projectId}: config changed, restarting (${mask(target.botToken)}, agent ${target.agentId}, ${target.enabled ? "enabled" : "disabled"})`,
        );
      } else {
        this.deps.log.line(
          `[discord-bot] ${projectId}: bot ${mask(target.botToken)} on agent ${target.agentId}, ${target.enabled ? "enabled" : "disabled"}`,
        );
      }
      if (this.stopped) return;
      const bot = new DiscordBot(target, this.deps);
      this.bots.set(projectId, bot);
      await bot.start();
    }
    // A table that went away — or a Project that did — takes its bot down.
    for (const [projectId, bot] of this.bots) {
      if (seen.has(projectId)) continue;
      bot.stop();
      this.bots.delete(projectId);
      this.deps.log.line(`[discord-bot] ${projectId}: table removed, bot stopped`);
    }
    for (const projectId of this.broken.keys())
      if (!seen.has(projectId)) this.broken.delete(projectId);
  }

  private markBroken(projectId: string, error: string): void {
    const running = this.bots.get(projectId);
    if (running !== undefined) {
      running.stop();
      this.bots.delete(projectId);
    }
    if (this.broken.get(projectId) !== error) {
      this.deps.log.line(`[discord-bot] ${projectId}: ${error}`);
      this.broken.set(projectId, error);
    }
  }
}
