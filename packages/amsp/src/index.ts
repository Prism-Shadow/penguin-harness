/**
 * @prismshadow/amsp — public entry point: the AMSP records (OmniMessage, which the PenguinHarness
 * server and core import as their own protocol types) and control frames, the Agent API's request
 * and answer shapes, and a zero-dependency client: `AgentClient` for runs, `SessionReader` for
 * following a Session, both over a `Transport`.
 *
 * The message markers are a separate entry, `@prismshadow/amsp/markers`.
 */
export * from "./types.js";
export { AmspHttpError, AmspStreamError } from "./errors.js";
export { AgentClient } from "./client.js";
export type { AgentClientOptions, ApprovalAnswer, OnApproval, Run, RunOptions } from "./client.js";
export { parseArguments, RunCollector } from "./collect.js";
export type { RunResult } from "./collect.js";
export { SessionReader } from "./reader.js";
export type { ReaderEvent, SessionReaderOptions } from "./reader.js";
export { frameOf, readAmsp, readSse } from "./sse.js";
export type { AmspFrame, SseEvent } from "./sse.js";
export { deliver, HttpTransport } from "./transport.js";
export type {
  HttpTransportOptions,
  StreamEnd,
  StreamHandlers,
  StreamRequest,
  Transport,
  TransportResponse,
} from "./transport.js";
