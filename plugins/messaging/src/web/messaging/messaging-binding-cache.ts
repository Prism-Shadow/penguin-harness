/**
 * What a machine conversation's messaging binding last looked like, kept in this browser.
 *
 * The binding lives on the machine, and the machine can only be asked while this server holds
 * a connection to it. Out of reach, the editor would otherwise have nothing to show but a
 * failure — which reads as a dead bot, while the bot is in fact still answering over there. So
 * every answer the machine gives is written down with its time, and shown read-only while the
 * machine is away, under a notice saying how old it is.
 *
 * Only what the read route already hands the browser is kept: the masked view, whose secrets
 * are the site-wide mask and never round-trip. One entry per Session, replaced whole by every
 * answer; an answer with nothing saved removes it, which is how a binding deleted over there
 * stops coming back. This server's own conversations are never cached: this server always
 * answers.
 *
 * Storage is best-effort both ways, as in `lib/machine-cache.ts`: a browser that refuses it, or
 * a value that no longer parses, reads as nothing remembered — the editor then shows the notice
 * alone, which is what it did before there was a cache.
 */
import type { MessagingBindingsResponse } from "@prismshadow/penguin-server/api";

const PREFIX = "penguin.machineMessaging.";

const keyFor = (projectId: string, machineId: string, sessionId: string) =>
  `${PREFIX}${projectId}:${machineId}:${sessionId}`;

/** One remembered answer and when the machine gave it. */
export interface CachedBinding {
  /** ISO time of the read. */
  at: string;
  res: MessagingBindingsResponse;
}

/** Replaces what this Session's binding is remembered as; an empty answer forgets it. */
export function rememberBinding(
  projectId: string,
  machineId: string,
  sessionId: string,
  res: MessagingBindingsResponse,
  at: string = new Date().toISOString(),
): void {
  try {
    const key = keyFor(projectId, machineId, sessionId);
    if (res.bindings.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({ at, res } satisfies CachedBinding));
  } catch {
    // Refused or full: the answer is merely not there to show while the machine is away.
  }
}

/** Whether a stored entry still has the shape the editor renders from. */
function readable(value: unknown): value is CachedBinding {
  if (typeof value !== "object" || value === null) return false;
  const { at, res } = value as Partial<CachedBinding>;
  if (typeof at !== "string" || typeof res !== "object" || res === null) return false;
  return (
    Array.isArray(res.bindings) &&
    res.bindings.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.binding?.channel === "string" &&
        typeof entry.status?.state === "string",
    )
  );
}

/** What this Session's binding was last seen as, or null when nothing usable is remembered. */
export function cachedBinding(
  projectId: string,
  machineId: string,
  sessionId: string,
): CachedBinding | null {
  try {
    const raw = localStorage.getItem(keyFor(projectId, machineId, sessionId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return readable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
