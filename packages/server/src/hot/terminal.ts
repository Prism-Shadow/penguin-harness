/**
 * Terminal node: the first real hot node (see the proposal's stage 1). It
 * exercises the four hard points at once — keyed collections, live-resource
 * claiming, freeze buffering (the buffer lives in the runtime registry, so
 * output produced during an upgrade window is never lost), and degraded boot
 * when a claim fails (an explicit discard, not a silent one: the terminal
 * reports itself lost instead of blocking the whole platform swap).
 */
import type { Impl, Park } from "@prismshadow/penguin-core/kernel";
import { defineIface, schema, type } from "@prismshadow/penguin-core/kernel";
import type { ShellProcResource } from "./resources.js";

export interface TerminalApi extends Park {
  write(data: string): void;
  read(): string;
  alive(): boolean;
  /** True when the boot-time claim failed (process lost, e.g. cross-machine restore). */
  lost(): boolean;
}

export type TerminalCtxV1 = { procId: string; command: string; cwd: string };

export const TerminalIfaceV1 = defineIface<TerminalApi, TerminalCtxV1>({
  name: "terminal",
  version: 1,
  context: schema<TerminalCtxV1>(type({ procId: "string", command: "string", cwd: "string" })),
  methods: ["park", "write", "read", "alive", "lost"],
});

export interface TerminalApiV2 extends TerminalApi {
  title(): string;
}

export type TerminalCtxV2 = TerminalCtxV1 & { title: string };

/** v2 adds a user-facing title; the 1→2 migrator derives it from the command. */
export const TerminalIfaceV2 = defineIface<TerminalApiV2, TerminalCtxV2>({
  name: "terminal",
  version: 2,
  context: schema<TerminalCtxV2>(
    type({ procId: "string", command: "string", cwd: "string", title: "string" }),
  ),
  methods: ["park", "write", "read", "alive", "lost", "title"],
  migrations: {
    1: (old) => ({ ...(old as TerminalCtxV1), title: (old as TerminalCtxV1).command }),
  },
});

function claimProc(
  claim: <T>(id: string) => T | undefined,
  procId: string,
): ShellProcResource | undefined {
  const res = claim<ShellProcResource>(procId);
  return res?.kind === "shell-proc" ? res : undefined;
}

/** Shared api body over an optionally-claimed process. */
function terminalBody(res: ShellProcResource | undefined): Omit<TerminalApi, "park"> {
  return {
    write: (data) => res?.write(data),
    read: () => (res === undefined ? "[terminal lost: process not claimable]" : res.read()),
    alive: () => res?.alive() ?? false,
    lost: () => res === undefined,
  };
}

export const terminalImplV1: Impl<TerminalApi, TerminalCtxV1> = {
  create(ctx, context) {
    const res = claimProc((id) => ctx.resources.claim(id), context.procId);
    return {
      park: () => ({ procId: context.procId, command: context.command, cwd: context.cwd }),
      ...terminalBody(res),
    };
  },
};

export const terminalImplV2: Impl<TerminalApiV2, TerminalCtxV2> = {
  create(ctx, context) {
    const res = claimProc((id) => ctx.resources.claim(id), context.procId);
    return {
      park: () => ({
        procId: context.procId,
        command: context.command,
        cwd: context.cwd,
        title: context.title,
      }),
      ...terminalBody(res),
      title: () => context.title,
    };
  },
};
