/**
 * Demo distro: a fully self-contained platform module (the platform.tar.gz
 * story in miniature). Loaded at runtime via
 *   POST /api/hot/upgrade { modulePath: ".../platform-v3.demo.mjs" }
 * — no rebuild, no restart. It redeclares its interfaces from scratch (only
 * the kernel is shared), and its schemas accept the v2 parked document:
 * terminals reclaim their live processes from the runtime registry, agents
 * carry their state documents across.
 *
 * Contract: `export const hotPlatform = { id, iface, impl }`.
 */
import { spawn } from "node:child_process";
import { defineIface, keyed, s, BootError } from "@prismshadow/penguin-core/kernel";

// -- terminal@2 (schema-compatible with the in-repo v2) ----------------------

const TerminalIface = defineIface({
  name: "terminal",
  version: 2,
  context: s.object({
    procId: s.string(),
    command: s.string(),
    cwd: s.string(),
    title: s.string(),
  }),
  methods: ["park", "write", "read", "alive", "lost", "title"],
  migrations: {
    1: (old) => ({ ...old, title: old.command }),
  },
});

const terminalImpl = {
  create(ctx, context) {
    const res = ctx.resources.claim(context.procId);
    const live = res !== undefined && res.kind === "shell-proc" ? res : undefined;
    return {
      park: () => ({ ...context }),
      write: (data) => live?.write(data),
      read: () => (live === undefined ? "[terminal lost: process not claimable]" : live.read()),
      alive: () => live?.alive() ?? false,
      lost: () => live === undefined,
      title: () => `[demo] ${context.title}`,
    };
  },
};

// -- agent-slot@1 (schema-compatible with the in-repo slot) ------------------

const AgentSlotIface = defineIface({
  name: "agent-slot",
  version: 1,
  context: s.object({ module: s.string(), rev: s.number(), state: s.json() }),
  methods: ["park", "run", "describe"],
});

const agentSlotImpl = {
  async create(_ctx, context) {
    const url = `${context.module}${context.module.includes("?") ? "&" : "?"}v=${context.rev}`;
    const mod = await import(url);
    if (mod.agent === undefined) throw new BootError(`no agent contract in ${context.module}`);
    const api = mod.agent.create({}, context.state);
    return {
      park: () => ({ module: context.module, rev: context.rev, state: api.park() }),
      run: async (input) => await api.run(input),
      describe: () => ({ name: mod.agent.name, version: mod.agent.version }),
    };
  },
};

// -- platform@3 --------------------------------------------------------------

const PlatformIface = defineIface({
  name: "platform",
  version: 3,
  context: s.object({ motd: s.string(), theme: s.string(), edition: s.string() }),
  methods: ["park", "info", "createTerminal", "terminals", "agents"],
  children: { terminals: keyed(TerminalIface), agents: keyed(AgentSlotIface) },
  migrations: {
    2: (old) => ({ ...old, edition: "community-demo" }),
  },
});

const platformImpl = {
  children: { terminals: terminalImpl, agents: agentSlotImpl },
  create(ctx, context, children) {
    const terminals = children.terminals;
    const agents = children.agents;
    return {
      park: () => ({ motd: context.motd, theme: context.theme, edition: context.edition }),
      info: () => ({
        impl: "v3-demo",
        ifaceVersion: PlatformIface.version,
        motd: context.motd,
        theme: context.theme,
        edition: context.edition,
        terminals: terminals.keys(),
        agents: agents.keys(),
      }),
      async createTerminal(command, cwd) {
        const id = `term_${Math.random().toString(36).slice(2, 10)}`;
        const procId = `proc_${id}`;
        const proc = spawn(command, { shell: true, cwd, stdio: ["pipe", "pipe", "pipe"] });
        const chunks = [];
        let exited = false;
        proc.stdout?.on("data", (d) => chunks.push(d.toString("utf8")));
        proc.stderr?.on("data", (d) => chunks.push(d.toString("utf8")));
        proc.on("exit", () => (exited = true));
        proc.on("error", () => (exited = true));
        ctx.resources.register(procId, {
          kind: "shell-proc",
          proc,
          read: () => chunks.join(""),
          write: (data) => proc.stdin?.write(data),
          alive: () => !exited,
          kill: () => {
            if (!exited) proc.kill();
          },
        });
        await terminals.add(id, { procId, command, cwd, title: command });
        return { id };
      },
      terminals: () => terminals,
      agents: () => agents,
    };
  },
};

export const hotPlatform = { id: "v3-demo", iface: PlatformIface, impl: platformImpl };
