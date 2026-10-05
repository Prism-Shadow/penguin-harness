/**
 * Which route back the key-authorization dialog offers: the provider's redirect to the server
 * (`callback`), or the person carrying a one-time code across by hand (`manual`).
 *
 * The person picks one, but the server has the last word on the flow it opened: when it cannot
 * name a callback the browser can reach — a machine behind a hub too old to say where the
 * browser is — it opens the flow in manual mode and says so, and the dialog follows it rather
 * than sending the person to a redirect that strands them on a page that never loads.
 */
import type { ModelOAuthMode } from "@prismshadow/penguin-server/api";

/** What the server answered for the flow it opened; `mode` is absent from older servers. */
export interface OpenedFlow {
  flowId: string;
  authorizeUrl: string;
  mode?: ModelOAuthMode;
}

/** The mode the dialog shows: the opened flow's own, else what was asked for. */
export function shownMode(asked: ModelOAuthMode, flow: OpenedFlow | null): ModelOAuthMode {
  return flow?.mode ?? asked;
}

/** The redirect was asked for and the server could not offer it. */
export function fellBackToManual(asked: ModelOAuthMode, flow: OpenedFlow | null): boolean {
  return asked === "callback" && flow?.mode === "manual";
}

/**
 * How long after the person returns to this window a redirect flow may still be pending before
 * the dialog suggests entering the code instead. A redirect that worked has deposited its code
 * by the time the provider's page has loaded, and the next poll (every two seconds) redeems
 * it; this leaves room for a few of those.
 */
export const OAUTH_STALL_MS = 8000;

/**
 * Whether a redirect flow looks stranded: the person came back from the authorization page
 * (`returnedAt`, when this window regained focus) at least {@link OAUTH_STALL_MS} ago and the
 * flow is still waiting. Then the provider's redirect most likely went somewhere that never
 * answered, and the code route is the way to finish.
 */
export function stalledAfterReturn(input: {
  waiting: boolean;
  mode: ModelOAuthMode;
  returnedAt: number | null;
  now: number;
}): boolean {
  if (!input.waiting || input.mode !== "callback" || input.returnedAt === null) return false;
  return input.now - input.returnedAt >= OAUTH_STALL_MS;
}
