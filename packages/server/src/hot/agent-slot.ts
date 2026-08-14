/**
 * Agent slot: an agent's code is loaded at runtime from a module URL (the
 * agent.tar.gz stand-in — any file a URL can reach), its serializable state is
 * carried in the parked context. Hot-swapping agent code = park the slot,
 * remove it, re-add with a bumped rev (the cache-busting query makes the
 * re-import load fresh code) — the state document rides across unchanged.
 *
 * The slot treats agent state as an opaque Json (s.json()): versioning inside
 * that document is the agent module's own business (its create() receives the
 * old state and upcasts by hand). MVP boundary, noted in the proposal.
 */
import type { Impl, Json, Park } from "@prismshadow/penguin-core/kernel";
import { BootError, defineIface, s } from "@prismshadow/penguin-core/kernel";

export interface AgentSlotApi extends Park {
  run(input: Json): Promise<Json>;
  describe(): { name: string; version: number };
}

export type AgentSlotCtx = { module: string; rev: number; state: Json };

export const AgentSlotIface = defineIface<AgentSlotApi, AgentSlotCtx>({
  name: "agent-slot",
  version: 1,
  context: s.object<AgentSlotCtx>({ module: s.string(), rev: s.number(), state: s.json() }),
  methods: ["park", "run", "describe"],
});

/** The contract an agent module exports: `export const agent = {...}`. */
export interface AgentModule {
  name: string;
  version: number;
  create(
    host: Record<string, never>,
    state: Json,
  ): { park(): Json; run(input: Json): Json | Promise<Json> };
}

export const agentSlotImpl: Impl<AgentSlotApi, AgentSlotCtx> = {
  async create(_ctx, context) {
    const url = `${context.module}${context.module.includes("?") ? "&" : "?"}v=${context.rev}`;
    const mod = (await import(url)) as { agent?: AgentModule };
    if (mod.agent === undefined || typeof mod.agent.create !== "function") {
      throw new BootError(`agent module ${context.module} does not export an 'agent' contract`);
    }
    const agent = mod.agent;
    const api = agent.create({}, context.state);
    return {
      park: () => ({ module: context.module, rev: context.rev, state: api.park() }),
      run: async (input) => await api.run(input),
      describe: () => ({ name: agent.name, version: agent.version }),
    };
  },
};
