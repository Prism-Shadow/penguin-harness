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
import type { ChannelEvent } from "@prismshadow/penguin-library-session";

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

/** A channel event listener, as the SSE channel's subscribe takes it (server `ChannelListener`). */
export type MessagingChannelListener = (evt: ChannelEvent) => void;

/**
 * One Session's SSE channel, as the bridge may reach it: the same surface main's `ChannelApi`
 * (what server `Channels.get` returns) carries — publish, a direct send, subscribe, replay
 * after a cursor, and the cursor the channel publishes its events under.
 */
export interface MessagingChannelApi {
  publish(data: unknown, event?: string): ChannelEvent;
  sendTo(listener: MessagingChannelListener, data: unknown, event?: string): ChannelEvent;
  subscribe(listener: MessagingChannelListener): () => void;
  replayAfter(lastEventId: string): { hit: boolean; events: ChannelEvent[] };
  readonly lastEventId: string;
}

/**
 * The session event channels, as the bridge reaches them: the hub's contract surface — one
 * channel per Session key, to observe run-state events (the server's `Channels` hub satisfies
 * it; `ChannelEvent` names the session domain's event shape). Subscribing returns the
 * unsubscribe half.
 */
export interface MessagingChannels {
  get(key: string): MessagingChannelApi;
  peek(key: string): MessagingChannelApi | undefined;
  broadcast(prefix: string, data: unknown, event?: string): void;
  dispose(): void;
  setActivityProbe(probe: (key: string) => boolean): void;
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
  /**
   * A POST whose body is bytes rather than JSON, with a deadline of its own. The hot update
   * is megabytes, and the machine unpacks, boots and commits it before answering — a timeout
   * sized for a settings write would call a working upgrade dead halfway through.
   */
  postBytes(
    path: string,
    contentType: string,
    body: Buffer,
    timeoutMs: number,
    /** Request headers beyond the ones every call carries. */
    headers?: Record<string, string>,
  ): Promise<{ status: number; text: string }>;
}
