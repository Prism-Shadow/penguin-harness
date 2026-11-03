/**
 * Deep-linking into a conversation at a specific moment: a search hit's `at` becomes a
 * `?at=` on the chat route, and the chat page works out which turn that lands on
 * (features/chat/chat-page.tsx).
 *
 * Pure, because the choice is the whole feature: which of the loaded turns to scroll to is a
 * decision about numbers, and this package's vitest runs in a node environment where nothing
 * that renders can be tested.
 */

/** One turn the stream has stamped with the time its prompt arrived. */
export interface MessageAnchor {
  /** The turn's own timestamp in ms (the message's `atMs`, as stamped into the DOM). */
  atMs: number;
}

/** The chat route a search hit opens, pinned to the hit's moment. */
export function messageJumpPath(sessionId: string, at: string): string {
  return `/chat/${encodeURIComponent(sessionId)}?at=${encodeURIComponent(at)}`;
}

/**
 * The `?at=` parameter as a timestamp in ms, or null when there is nothing to jump to.
 *
 * Unparsable input is null rather than NaN: the parameter comes from a URL anyone can edit,
 * and a search hit's `at` is only as trustworthy as the record it was read from.
 */
export function parseMessageJumpAt(param: string | null | undefined): number | null {
  if (param === null || param === undefined || param.trim() === "") return null;
  const ms = Date.parse(param);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The turn a jump lands on: the latest one that started at or before the target moment.
 *
 * "At or before" is the rule that makes an assistant's or tool's timestamp resolve to the
 * exchange that contains it — a hit inside a turn is stamped after the turn's own prompt, so
 * the nearest earlier turn is the one the reader is looking for. Landing on the following
 * turn instead would show a reply to a question they have not reached yet.
 *
 * A target earlier than every loaded turn returns null: the turn it names is not on screen,
 * and the caller answers that by loading older history (or by saying so) — never by jumping
 * to the top and pretending that was the match.
 */
export function messageAnchorFor(
  targetMs: number,
  anchors: readonly MessageAnchor[],
): MessageAnchor | null {
  let best: MessageAnchor | null = null;
  for (const anchor of anchors) {
    if (!Number.isFinite(anchor.atMs) || anchor.atMs > targetMs) continue;
    if (best === null || anchor.atMs > best.atMs) best = anchor;
  }
  return best;
}

/**
 * Whether the target predates everything on screen, i.e. the turn it names sits in history
 * that has not been loaded yet. A single unstamped turn cannot answer this (an anchor with no
 * time is not evidence about anything), so it answers false and the jump proceeds.
 */
export function targetIsBeforeLoadedWindow(
  targetMs: number,
  anchors: readonly MessageAnchor[],
): boolean {
  const times = anchors.map((a) => a.atMs).filter((t) => Number.isFinite(t));
  if (times.length === 0) return false;
  return Math.min(...times) > targetMs;
}
