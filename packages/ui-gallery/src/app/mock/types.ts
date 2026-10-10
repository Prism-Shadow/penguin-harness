/**
 * The message types the demo store speaks, derived from the server's API contract rather
 * than imported from core: the gallery does not depend on the core package, and the contract
 * already carries every shape the app reads off the wire, so deriving keeps one source.
 */
import type { MessagesLiveTail, ServerEvent } from "@prismshadow/penguin-server/api";

export type OmniMessage = MessagesLiveTail["fragments"][number];
export type OmniPayload = OmniMessage["payload"];
/** The `session_meta` record's payload, the one arm of the union that carries no `type`. */
export type SessionMetaPayload = Extract<OmniPayload, { session_id: string }>;
/** Every other payload: a model message or an event, discriminated by `type`. */
export type TypedPayload = Exclude<OmniPayload, SessionMetaPayload>;
export type PayloadOf<T extends TypedPayload["type"]> = Extract<TypedPayload, { type: T }>;
export type ToolCallMessage = Extract<ServerEvent, { type: "approval_request" }>["toolCall"];

/**
 * A message's typed payload, or null for the `session_meta` record. The envelope's `type` is
 * what says which payload a message carries (the payload union itself has no shared
 * discriminant), so this is the one place that reads it.
 */
export function payloadOf(msg: OmniMessage): TypedPayload | null {
  return msg.type === "session_meta" ? null : (msg.payload as TypedPayload);
}

/** The stream handlers the app's SSE module declares, as the mock delivers to them. */
export interface StreamHandlers {
  onOmniMessage: (msg: OmniMessage, eventId: string | null) => void;
  onServerEvent: (event: ServerEvent, eventId: string | null) => void;
  onOpen?: () => void;
  onError?: (closed: boolean) => void;
}

export type Lang = "en" | "zh";
