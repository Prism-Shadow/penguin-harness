/**
 * The engines a plugin may contribute to the Agent State repository (./repo.ts), and which one
 * records versions now.
 *
 * A contribution to `AgentStateHistoryModule.engines` is `{ id, name }` in the manifest and an
 * `AgentStateEngineSource` bound by the contributor: a function the module calls once per App,
 * handing it a directory under the data root to keep files in (`<root>/cache/<contribution id>/`)
 * and a log line. The answer may take a while (a plugin that fetches its program first), so the
 * module never waits for it: until an engine has answered with itself, and after it answered
 * null, the built-in engine records versions. Which engine records versions is the harness's own
 * decision, not a contributor's: the built-in side prefers the harness's own plugins' engines —
 * a host Git over a fetched build — and the first ready one in that order wins; anything else a
 * plugin contributed runs behind them, in contribution order. An engine that later fails to run
 * is dropped for the rest of the App.
 *
 * A node of the tree rather than a module singleton, like every other plugin floor: a hot swap
 * that removes the plugin builds an App without its contribution, and the engine goes with it.
 */
import path from "node:path";
import {
  Interface,
  Module,
  Provide,
  Use,
  type ClassCtx,
  type Slot,
} from "@prismshadow/penguin-core/kernel";
import type { AgentStateEngine, AgentStateEngineSource } from "@prismshadow/penguin-core/plugin";
import type { Log, Paths } from "../hmr/capabilities.js";

export interface AgentStateEnginesSlots {
  /** One engine: its name here, its source bound by the contributor. */
  engines: Slot<{ name: string }, AgentStateEngineSource>;
}

/**
 * The engines the harness prefers, first wins: the built-in plugins' own, a host Git over a
 * build a plugin fetches. An engine a name here does not cover — another plugin's, or a future
 * one — runs behind them, in contribution order.
 */
const PREFERRED = ["agent-state-gitcl", "agent-state-dugite"];

const rankOf = (name: string): number => {
  const at = PREFERRED.indexOf(name);
  return at === -1 ? PREFERRED.length : at;
};

/** Which engine records Agent State versions. */
@Interface()
export abstract class AgentStateEngines {
  /** The first contributed engine that is ready and has not failed to run; null: the built-in one. */
  abstract current(): AgentStateEngine | null;
  /** Stops using an engine for the rest of this App: it could not run. */
  abstract drop(engine: AgentStateEngine): void;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class EngineChoice implements AgentStateEngines {
  private readonly ready = new Map<string, AgentStateEngine>();
  private readonly dropped = new Set<AgentStateEngine>();
  private readonly order: string[] = [];

  constructor(
    contributions: ReadonlyArray<{
      id: string;
      name: string;
      source: AgentStateEngineSource;
    }>,
    opts: { root: string; log: (line: string) => void },
  ) {
    // The harness's own engines run before any other contributor's, whatever the contribution
    // order; the sort is stable, so engines of the same mind keep their contribution order.
    const ordered = [...contributions].sort((a, b) => rankOf(a.name) - rankOf(b.name));
    for (const { id, name, source } of ordered) {
      this.order.push(id);
      const say = (line: string) => opts.log(`[agent-state] ${name}: ${line}`);
      let answer: ReturnType<AgentStateEngineSource>;
      try {
        answer = source({
          cacheDir: path.join(opts.root, "cache", id),
          log: (line) => opts.log(line),
        });
      } catch (err) {
        say(`not started (${messageOf(err)}); the built-in engine records versions`);
        continue;
      }
      void Promise.resolve(answer).then(
        (engine) => {
          if (engine === null) {
            say("not available on this host; the built-in engine records versions");
            return;
          }
          this.ready.set(id, engine);
          say(`${engine.name} records Agent State versions`);
        },
        (err: unknown) => say(`failed (${messageOf(err)}); the built-in engine records versions`),
      );
    }
  }

  current(): AgentStateEngine | null {
    for (const id of this.order) {
      const engine = this.ready.get(id);
      if (engine !== undefined && !this.dropped.has(engine)) return engine;
    }
    return null;
  }

  drop(engine: AgentStateEngine): void {
    this.dropped.add(engine);
  }
}

@Module()
export class AgentStateHistoryModule {
  @Use() private readonly paths!: Paths;
  @Use() private readonly log!: Log;
  @Provide() engines!: AgentStateEngines;

  setup({ contributions }: ClassCtx) {
    this.engines = new EngineChoice(
      (contributions.engines ?? []).map((c) => ({
        id: c.id,
        name: c.data.name as string,
        source: c.code as AgentStateEngineSource,
      })),
      { root: this.paths.root, log: (line) => this.log.line(line) },
    );
  }
}
