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
  /** The Session is known to live on this server (seen in its own list): this server answered. */
  local?: boolean;
  /** Machines out of reach: no connection held, or silent in the list's last round. */
  offline: readonly string[];
  /** Machines the list is asking and has no answer from yet. */
  asking: readonly string[];
}): RouteReach {
  if (state.local === true && state.owner === null) return "answered";
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
 * answering: not a verdict about the Session either). The hub's own `machine_no_answer` — a
 * machine it asked gave no answer in time — is a doubt whatever this page knows of the
 * machines; a hub from before that answer says 404 there, which the page's own knowledge of
 * the silent machines turns into the same doubt.
 */
export type LookupVerdict = "missing" | "doubt" | "failed" | "refused";

/** The hub's answer when a machine that could hold the Session did not answer in time. */
export const MACHINE_NO_ANSWER = "machine_no_answer";
/**
 * The answer when the machine holding the Session will not show it to this server: an answer,
 * not a doubt — the Session is there, and asking again changes nothing.
 */
export const SESSION_FORBIDDEN = "session_forbidden";

export function lookupVerdict(
  failure: { status: number | null; code?: string | null },
  reach: RouteReach,
): LookupVerdict {
  if (failure.code === SESSION_FORBIDDEN) return "refused";
  if (failure.code === MACHINE_NO_ANSWER) return "doubt";
  if (reach !== "answered") return "doubt";
  return failure.status === 404 ? "missing" : "failed";
}

/**
 * The machines a `machine_no_answer` names, from its details: `machineIds` (several, comma
 * separated) or `machineId` (one). Empty when it names none.
 */
export function silentMachinesOf(details: Readonly<Record<string, string>> | undefined): string[] {
  const several = details?.machineIds;
  if (several !== undefined && several !== "") {
    return several
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "");
  }
  const one = details?.machineId;
  return one === undefined || one === "" ? [] : [one];
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
