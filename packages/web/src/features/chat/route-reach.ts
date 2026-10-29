/**
 * Whether the servers that could hold the routed Session have answered, and what a failed direct
 * lookup of it settles (features/chat/chat-page.tsx).
 *
 * The lookup asks THIS server, which answers for its own Sessions and, through its forward, for
 * those of the machines it can reach. When a machine that could hold the Session is out of reach
 * — no connection held, or its server went quiet behind one — this server's "no such Session" is
 * only "not here": taking it for "deleted" told the reader a conversation was gone when its
 * machine was merely silent. So a failure is a verdict only once every server that could hold the
 * Session has answered; until then it is a doubt, asked again when they have.
 */

/**
 * Where the routed Session's possible holders stand: all `answered`; one still being `asking`
 * (wait for it, say nothing yet); or one `unanswered` (out of reach, which the page says).
 * With an owner on record, only that machine counts; without one, every machine of the Project.
 */
export type RouteReach = "answered" | "asking" | "unanswered";

export function routeReach(state: {
  /** The machine the Session is known to live on, or null when unknown or this server. */
  owner: string | null;
  /** Machines out of reach: no connection held, or silent in the list's last round. */
  offline: readonly string[];
  /** Machines the list is asking and has no answer from yet. */
  asking: readonly string[];
}): RouteReach {
  const counts = (ids: readonly string[]) =>
    state.owner === null ? ids.length > 0 : ids.includes(state.owner);
  if (counts(state.asking)) return "asking";
  if (counts(state.offline)) return "unanswered";
  return "answered";
}

/**
 * What a failed lookup settles: `missing` (the Session does not exist — a 404 with every
 * possible holder answering), `doubt` (a holder had not answered: nothing is settled, and the
 * lookup is made again once they have), or `failed` (no answer to be had, with every holder
 * answering: not a verdict about the Session either).
 */
export type LookupVerdict = "missing" | "doubt" | "failed";

export function lookupVerdict(
  failure: { status: number | null },
  reach: RouteReach,
): LookupVerdict {
  if (reach !== "answered") return "doubt";
  return failure.status === 404 ? "missing" : "failed";
}

/**
 * Whether the routed Session is still being looked for: it is not listed, and either no lookup
 * has failed yet, or the one that failed settled nothing — a holder had not answered when it
 * failed (`doubted`, made again once they have), or one is still out of reach (`unowned`). The
 * render in which a silent machine answers must still read the doubted failure as pending, or
 * the page takes it for a verdict and opens another conversation before the lookup is made
 * again.
 */
export function routeLookupPending(state: {
  listed: boolean;
  failed: boolean;
  unowned: boolean;
  doubted: boolean;
}): boolean {
  return !state.listed && (!state.failed || state.unowned || state.doubted);
}
