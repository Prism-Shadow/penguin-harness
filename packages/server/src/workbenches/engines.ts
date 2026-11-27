/**
 * The engines a plugin may contribute to the Agent State repository (./repo.ts), and which one
 * records versions now.
 *
 * A contribution to `AgentStateHistoryModule.engines` is `{ id, name }` in the manifest and an
 * `AgentStateEngineSource` bound by the contributor: a function the module calls once per App,
 * handing it a directory under the data root to keep files in (`<root>/cache/<contribution id>/`)
 * and a log line. The answer may take a while (a plugin that fetches its program first), and a
 * source that fails answers with nothing: either way the deployment has no engine from it, and
 * asking for the repository is an error, said with every contribution's reason. The first
 * contribution that is ready wins, in contribution order.
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

/** Which engine records Agent State versions. */
@Interface()
export abstract class AgentStateEngines {
  /**
   * The first contributed engine that is ready. An error when none is — no contribution, one
   * that failed, or one that has not answered yet: nothing records versions without it.
   */
  abstract current(): AgentStateEngine;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class EngineChoice implements AgentStateEngines {
  private readonly ready = new Map<string, AgentStateEngine>();
  /** Why a contribution has no engine, said again if asking for the repository is an error. */
  private readonly without = new Map<string, string>();
  private readonly order: string[] = [];

  constructor(
    contributions: ReadonlyArray<{ id: string; name: string; source: AgentStateEngineSource }>,
    opts: { root: string; log: (line: string) => void },
  ) {
    for (const { id, name, source } of contributions) {
      this.order.push(id);
      const say = (line: string) => opts.log(`[agent-state] ${name}: ${line}`);
      let answer: ReturnType<AgentStateEngineSource>;
      try {
        answer = source({
          cacheDir: path.join(opts.root, "cache", id),
          log: (line) => opts.log(line),
        });
      } catch (err) {
        this.without.set(id, `not started (${messageOf(err)})`);
        say(`not started (${messageOf(err)})`);
        continue;
      }
      void Promise.resolve(answer).then(
        (engine) => {
          if (engine === null || engine === undefined) {
            this.without.set(id, "answered without an engine");
            say("answered without an engine");
            return;
          }
          this.ready.set(id, engine);
          say(`${engine.name} records Agent State versions`);
        },
        (err: unknown) => {
          this.without.set(id, `failed (${messageOf(err)})`);
          say(`failed (${messageOf(err)})`);
        },
      );
    }
  }

  current(): AgentStateEngine {
    for (const id of this.order) {
      const engine = this.ready.get(id);
      if (engine !== undefined) return engine;
    }
    const why =
      this.order.map((id) => `${id} ${this.without.get(id) ?? "has not answered yet"}`).join(", ") ||
      "none contributed";
    throw new Error(`no Agent State engine is ready (${why})`);
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
