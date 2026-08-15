/**
 * THE platform: the one hot-swappable unit this build of the server packages.
 *
 * The repo carries exactly one platform — versions exist BETWEEN deployments
 * (this packaged build vs the next bundle pushed over HTTP), not as parallel
 * files. When a future build changes the context shape, it bumps `version`
 * and ships the migrator alongside the new schema; the previous shape lives
 * only in already-parked documents out in the world.
 *
 * Tree: platform { terminals: keyed(terminal) } — terminals are the
 * live-state proof (their processes are runtime-owned and survive swaps).
 */
import type { Impl, Json, KeyedHandle, Park } from "@prismshadow/penguin-core/kernel";
import { defineIface, keyed, schema, type } from "@prismshadow/penguin-core/kernel";
import type { TerminalApi } from "./terminal.js";
import { TerminalIface, terminalImpl } from "./terminal.js";
import { spawnShellResource } from "../hmr/resources.js";

export interface PlatformApi extends Park {
  info(): Json;
  createTerminal(command: string, cwd: string): Promise<{ id: string }>;
  terminals(): KeyedHandle<TerminalApi>;
}

export type PlatformCtx = { motd: string };

export const PlatformIface = defineIface<PlatformApi, PlatformCtx>({
  name: "platform",
  version: 1,
  context: schema<PlatformCtx>(type({ motd: "string" })),
  methods: ["park", "info", "createTerminal", "terminals"],
  children: { terminals: keyed(TerminalIface) },
});

export const platformImpl: Impl<PlatformApi, PlatformCtx> = {
  children: { terminals: terminalImpl },
  create(ctx, context, children) {
    const terminals = children.terminals as KeyedHandle<TerminalApi>;
    return {
      park: () => ({ motd: context.motd }),
      info: () => ({
        impl: "packaged",
        ifaceVersion: PlatformIface.version,
        motd: context.motd,
        terminals: terminals.keys(),
      }),
      async createTerminal(command, cwd) {
        const id = `term_${Math.random().toString(36).slice(2, 10)}`;
        // Spawn the live resource on the runtime side first; the node only
        // carries its handle id (linear state).
        spawnShellResource(ctx.resources, `proc_${id}`, command, cwd);
        await terminals.add(id, { procId: `proc_${id}`, command, cwd });
        return { id };
      },
      terminals: () => terminals,
    };
  },
};

/** The packaged bundle the runtime boots when nothing has been pushed yet. */
export const packagedPlatform = { id: "packaged", iface: PlatformIface, impl: platformImpl };
