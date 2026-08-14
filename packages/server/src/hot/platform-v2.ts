/**
 * Hot platform, version 2: same tree shape, evolved contexts.
 * - platform ctx gains `theme` (1→2 migrator supplies the default);
 * - terminals move to terminal@2 which gains `title` (its 1→2 migrator
 *   derives it from the command) — exercising a child migration during a
 *   platform swap.
 */
import type { Impl, Json, KeyedHandle, Park } from "@prismshadow/penguin-core/kernel";
import { defineIface, keyed, s } from "@prismshadow/penguin-core/kernel";
import type { AgentSlotApi } from "./agent-slot.js";
import { AgentSlotIface, agentSlotImpl } from "./agent-slot.js";
import type { PlatformApi } from "./platform-v1.js";
import type { SkillSlotApi } from "./skill-slot.js";
import { SkillSlotIface, skillSlotImpl } from "./skill-slot.js";
import type { TerminalApiV2 } from "./terminal.js";
import { TerminalIfaceV2, terminalImplV2 } from "./terminal.js";
import { spawnShellResource } from "./resources.js";
import { ToolRegistry } from "./tools.js";

export type PlatformCtxV2 = { motd: string; theme: string };

export const PlatformIfaceV2 = defineIface<PlatformApi, PlatformCtxV2>({
  name: "platform",
  version: 2,
  context: s.object<PlatformCtxV2>({ motd: s.string(), theme: s.string() }),
  methods: ["park", "info", "createTerminal", "terminals", "agents", "skills", "tools"],
  children: {
    terminals: keyed(TerminalIfaceV2),
    agents: keyed(AgentSlotIface),
    skills: keyed(SkillSlotIface),
  },
  migrations: {
    1: (old) => ({ ...(old as PlatformCtxV2), theme: "classic" }),
  },
});

export const platformImplV2: Impl<PlatformApi, PlatformCtxV2> = {
  children: { terminals: terminalImplV2, agents: agentSlotImpl, skills: skillSlotImpl },
  create(ctx, context, children) {
    const terminals = children.terminals as KeyedHandle<TerminalApiV2>;
    const agents = children.agents as KeyedHandle<AgentSlotApi>;
    const skills = children.skills as KeyedHandle<SkillSlotApi>;
    // Instance-owned; reseeded from parked skills on every boot (see v1).
    const registry = new ToolRegistry();
    for (const id of skills.keys()) skills.get(id)!.setup(id, registry);
    return {
      park: () => ({ motd: context.motd, theme: context.theme }),
      info: (): Json => ({
        impl: "platform-v2",
        ifaceVersion: PlatformIfaceV2.version,
        motd: context.motd,
        theme: context.theme,
        terminals: terminals.keys(),
        titles: terminals.keys().map((k) => terminals.get(k)?.title() ?? ""),
        agents: agents.keys(),
        skills: skills.keys(),
        tools: registry.list().map((t) => t.name),
      }),
      async createTerminal(command, cwd) {
        const id = `term_${Math.random().toString(36).slice(2, 10)}`;
        spawnShellResource(ctx.resources, `proc_${id}`, command, cwd);
        await terminals.add(id, { procId: `proc_${id}`, command, cwd, title: command });
        return { id };
      },
      terminals: () => terminals,
      agents: () => agents,
      skills: () => skills,
      tools: () => registry,
    };
  },
};

export const platformV2 = { id: "v2", iface: PlatformIfaceV2, impl: platformImplV2 };
