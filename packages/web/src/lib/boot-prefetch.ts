/**
 * The boot's first round trip, started before React mounts.
 *
 * Left to the component tree, the first screen is a waterfall of four dependent requests —
 * `/api/me` (the auth provider), then the Project list (the Project provider, which only mounts
 * once the user is known), then that Project's Agents, and only then the sidebar's Sessions —
 * each waiting on the one before, each a full round trip, and none of them able to start until
 * the whole bundle has been parsed and the tree has rendered once. On a phone across a tunnel
 * that is the difference between "opens" and "hangs".
 *
 * None of the first three depend on each other's ANSWER, only on the browser's memory of what
 * was open last: the user, the Project list, and the Agents of the remembered Project can all be
 * asked for in the same instant as the install-scope probe (main.tsx). So they are, and the
 * providers then TAKE the in-flight promise instead of issuing their own — once each: a later
 * reload (a Project switch, a manual refresh) goes to the network as before, and a taken promise
 * is never handed out twice.
 *
 * The prefetch is a hint, not a contract. A remembered Project that no longer exists makes its
 * Agents request 404 — the provider then sees the rejection exactly as it would see its own
 * request fail, and the Project list's answer picks the real Project. A page opened signed out
 * gets 401s — the same 401 `/api/me` yields, and the same handler (the auth provider's) clears
 * the user. Every promise carries a no-op rejection handler so one nobody takes cannot surface
 * as an unhandled rejection.
 */
import type { AgentsResponse, MeResponse, ProjectsResponse } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { rememberedProjectId } from "./last-selection";

interface Prefetched {
  me: Promise<MeResponse> | null;
  projects: Promise<ProjectsResponse> | null;
  agents: { projectId: string; answer: Promise<AgentsResponse> } | null;
}

const held: Prefetched = { me: null, projects: null, agents: null };

const noop = (): void => {};

/**
 * Starts the round trip. `signedOut` skips everything but `/api/me`: the login page has no use
 * for a Project list, and asking would only be three 401s where one will do.
 */
export function prefetchBoot(opts: { signedOut?: boolean } = {}): void {
  if (held.me !== null) return; // Already started: main.tsx calls this once.
  held.me = api.getMe();
  held.me.catch(noop);
  if (opts.signedOut) return;
  held.projects = api.listProjects();
  held.projects.catch(noop);
  const projectId = rememberedProjectId();
  if (projectId !== null) {
    const answer = api.listAgents(projectId);
    answer.catch(noop);
    held.agents = { projectId, answer };
  }
}

/** The in-flight `/api/me`, once; null when there is none (not prefetched, or already taken). */
export function takePrefetchedMe(): Promise<MeResponse> | null {
  const answer = held.me;
  held.me = null;
  return answer;
}

/** The in-flight Project list, once. */
export function takePrefetchedProjects(): Promise<ProjectsResponse> | null {
  const answer = held.projects;
  held.projects = null;
  return answer;
}

/**
 * The in-flight Agent list, once, and only for the Project it was asked for: a store that landed
 * on a different Project (the remembered one is gone) must ask for its own.
 */
export function takePrefetchedAgents(projectId: string): Promise<AgentsResponse> | null {
  const entry = held.agents;
  if (entry === null || entry.projectId !== projectId) return null;
  held.agents = null;
  return entry.answer;
}

/** Test seam: forgets everything held, so each case starts from a cold boot. */
export function resetBootPrefetch(): void {
  held.me = null;
  held.projects = null;
  held.agents = null;
}
