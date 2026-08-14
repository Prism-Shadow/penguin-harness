/**
 * Hot platform, version 1: the demo distro. Tree: platform { terminals:
 * keyed(terminal@1), agents: keyed(agent-slot@1), skills: keyed(skill-slot@1) }.
 */
import type { Impl, Json, KeyedHandle, Park } from "@prismshadow/penguin-core/kernel";
import { defineIface, keyed, s } from "@prismshadow/penguin-core/kernel";
import type { AgentSlotApi } from "./agent-slot.js";
import { AgentSlotIface, agentSlotImpl } from "./agent-slot.js";
import type { SkillSlotApi } from "./skill-slot.js";
import { SkillSlotIface, skillSlotImpl } from "./skill-slot.js";
import type { TerminalApi } from "./terminal.js";
import { TerminalIfaceV1, terminalImplV1 } from "./terminal.js";
import { spawnShellResource } from "./resources.js";
import { ToolRegistry } from "./tools.js";

export interface PlatformApi extends Park {
  info(): Json;
  createTerminal(command: string, cwd: string): Promise<{ id: string }>;
  terminals(): KeyedHandle<TerminalApi>;
  agents(): KeyedHandle<AgentSlotApi>;
  skills(): KeyedHandle<SkillSlotApi>;
  tools(): ToolRegistry;
}

export type PlatformCtxV1 = { motd: string };

export const PlatformIfaceV1 = defineIface<PlatformApi, PlatformCtxV1>({
  name: "platform",
  version: 1,
  context: s.object<PlatformCtxV1>({ motd: s.string() }),
  methods: ["park", "info", "createTerminal", "terminals", "agents", "skills", "tools"],
  children: {
    terminals: keyed(TerminalIfaceV1),
    agents: keyed(AgentSlotIface),
    skills: keyed(SkillSlotIface),
  },
});

export const platformImplV1: Impl<PlatformApi, PlatformCtxV1> = {
  children: { terminals: terminalImplV1, agents: agentSlotImpl, skills: skillSlotImpl },
  create(ctx, context, children) {
    const terminals = children.terminals as KeyedHandle<TerminalApi>;
    const agents = children.agents as KeyedHandle<AgentSlotApi>;
    const skills = children.skills as KeyedHandle<SkillSlotApi>;
    // Owned by the instance, never module scope (a module-level registry
    // would silently survive hot swaps). Tools are derived state: reseeded
    // here from the parked skills after every boot, never parked themselves.
    const registry = new ToolRegistry();
    for (const id of skills.keys()) skills.get(id)!.setup(id, registry);
    return {
      park: () => ({ motd: context.motd }),
      info: () => ({
        impl: "platform-v1",
        ifaceVersion: PlatformIfaceV1.version,
        motd: context.motd,
        terminals: terminals.keys(),
        agents: agents.keys(),
        skills: skills.keys(),
        tools: registry.list().map((t) => t.name),
      }),
      async createTerminal(command, cwd) {
        const id = `term_${Math.random().toString(36).slice(2, 10)}`;
        // Spawn the live resource on the runtime side first; the node only
        // carries its handle id (linear state, rule 2).
        spawnShellResource(ctx.resources, `proc_${id}`, command, cwd);
        await terminals.add(id, { procId: `proc_${id}`, command, cwd });
        return { id };
      },
      terminals: () => terminals,
      agents: () => agents,
      skills: () => skills,
      tools: () => registry,
    };
  },
};

export const platformV1 = { id: "v1", iface: PlatformIfaceV1, impl: platformImplV1 };
