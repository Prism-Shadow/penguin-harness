/**
 * The messaging domain's structural ports: what the connectors and the bridge reach beyond
 * this package's own mechanisms, declared at the consumer (Go style). The server binds them
 * to its own mechanisms in its assembly (see packages/server). Each port is an interface
 * class (`@Interface()`), structural like the rest: the server's own capabilities satisfy
 * them without this package importing the server.
 *
 * This package never imports the server.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { ErrorRecordArgs } from "@prismshadow/penguin-library-observability";

/** The pacing and budgets the messaging bridge and its connectors run with (was bridge.ts's). */
@Interface()
export abstract class MessagingTuning {
  abstract lineDelayMs?: number;
  abstract inboundImageBudgetBytes?: number;
  abstract qqTailFlushMs?: number;
  abstract retryDelayMs?: (failures: number) => number;
}

/** What the connectors read of the clock: wall time for pacing and fire-at math (the server's `Clock` satisfies it). */
@Interface()
export abstract class MessagingClock {
  abstract now(): Date;
}

/**
 * The session event channels, as the bridge reaches them: one channel per Session key, to
 * observe run-state events (the server's hub satisfies it; `ChannelEvent` names the session
 * domain's event shape). Subscribing returns the unsubscribe half.
 */
export interface MessagingChannels {
  get(key: string): {
    subscribe(
      listener: (evt: import("@prismshadow/penguin-library-session").ChannelEvent) => void,
    ): () => void;
  };
}

/** What the bridge needs of the error recorder (the server's recorder satisfies it). */
export interface MessagingErrorSink {
  record(args: ErrorRecordArgs): void;
}

/** What the account-holders reader needs of a machine's API while it is connected (the server's `MachineApi` satisfies it). */
export interface MessagingMachineApi {
  request(
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; text: string }>;
}
