/**
 * Terminal node: the live-state proof of the hot-update model. It exercises
 * the hard points at once — keyed collections, live-resource claiming, freeze
 * buffering (the buffer lives in the runtime registry, so output produced
 * during an upgrade window is never lost), and degraded boot when a claim
 * fails (an explicit discard, not a silent one: the terminal reports itself
 * lost instead of blocking the whole platform swap).
 */
import type { Impl, Park } from "@prismshadow/penguin-core/kernel";
import { defineIface, schema, type } from "@prismshadow/penguin-core/kernel";
import type { ShellProcResource } from "../hmr/resources.js";

export interface TerminalApi extends Park {
  write(data: string): void;
  read(): string;
  alive(): boolean;
  /** True when the boot-time claim failed (process lost, e.g. cross-machine restore). */
  lost(): boolean;
}

export type TerminalCtx = { procId: string; command: string; cwd: string };

export const TerminalIface = defineIface<TerminalApi, TerminalCtx>({
  name: "terminal",
  version: 1,
  context: schema<TerminalCtx>(type({ procId: "string", command: "string", cwd: "string" })),
  methods: ["park", "write", "read", "alive", "lost"],
});

export const terminalImpl: Impl<TerminalApi, TerminalCtx> = {
  create(ctx, context) {
    const res = ctx.resources.claim<ShellProcResource>(context.procId);
    const live = res?.kind === "shell-proc" ? res : undefined;
    return {
      park: () => ({ procId: context.procId, command: context.command, cwd: context.cwd }),
      write: (data) => live?.write(data),
      read: () => (live === undefined ? "[terminal lost: process not claimable]" : live.read()),
      alive: () => live?.alive() ?? false,
      lost: () => live === undefined,
    };
  },
};
