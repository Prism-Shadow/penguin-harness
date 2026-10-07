/**
 * Reading a Session's source (`session_meta.source`) back from a Trace or from a forwarded meta.
 *
 * Every meta written since the source became required carries one of the five values. A Trace
 * kept from before may carry none (it was a person's conversation) or the retired `benchmark`
 * (a Test Session `penguin run --source benchmark` started, which `penguin run` now records as
 * `cli`). Old Traces are never rewritten: each reader narrows what it reads through this one
 * function instead.
 *
 * Removal: at the 0.3.0 release preparation the two `compat(0.3.0)` branches go, and the
 * function becomes a strict narrowing that answers `undefined` for anything but the five
 * values; a head without a valid source is then malformed, the way one without `provider` is.
 */
import type { SessionSource } from "./types.js";

const SESSION_SOURCES: ReadonlySet<unknown> = new Set<SessionSource>([
  "user",
  "api",
  "schedule",
  "subagent",
  "cli",
]);

/** Narrows an untrusted `session_meta.source` to a SessionSource. */
export function normalizeSessionSource(value: unknown): SessionSource {
  if (SESSION_SOURCES.has(value)) return value as SessionSource;
  // compat(0.3.0): a meta written before the source was required has none; it was a person's.
  if (value === undefined) return "user";
  // compat(0.3.0): the retired `benchmark` marked Test Sessions `penguin run` started.
  if (value === "benchmark") return "cli";
  // Junk a third party wrote is never cast through: it reads as a person's conversation.
  return "user";
}
