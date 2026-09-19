/**
 * Which machine an organization lives on.
 *
 * An organization is files and desks: its chart, handbook, tickets and channels are written
 * by the server whose filesystem holds its shared workspace, and its employees' Sessions run
 * there. So an organization whose workspace is a directory on another machine lives on THAT
 * machine's server — and every call about it, some forty endpoints under
 * `/api/projects/<p>/organizations/<orgId>/…`, has to reach that server.
 *
 * The routing is the same rule Sessions use (./session-machines.ts), over the PATH: a request
 * that names an organization goes wherever that organization was last seen. Call sites stay
 * unchanged, and the mapping is recorded in exactly two places — when a listing hands an
 * organization back, and when one is created.
 *
 * Absence means this machine. In-memory on purpose: the listing that rebuilds it runs before
 * any organization page renders (features/company/org-layout.tsx waits for it), and a stale
 * entry surviving a reload would route a call at a machine that may no longer hold it.
 */

import { rememberSessionMachine } from "./session-machines";

/** `<projectId>/<orgId>` → the machine it lives on. Absent = this server. */
const owners = new Map<string, string>();

const keyOf = (projectId: string, orgId: string) => `${projectId}/${orgId}`;

/** Records where an organization lives. `null` (this machine) is stored as absence. */
export function rememberOrgMachine(
  projectId: string,
  orgId: string,
  machineId: string | null,
): void {
  if (machineId === null) owners.delete(keyOf(projectId, orgId));
  else owners.set(keyOf(projectId, orgId), machineId);
}

/** The machine an organization lives on, or null for this one. */
export function machineForOrg(projectId: string, orgId: string): string | null {
  return owners.get(keyOf(projectId, orgId)) ?? null;
}

/** Forgets everything — for a listing that is about to rebuild the whole map. */
export function forgetOrgMachines(): void {
  owners.clear();
}

/** The collection's own routes: they ask a server about ITS organizations, not about one. */
const COLLECTION_ROUTES = new Set(["suggest-id"]);

/**
 * The organization a path is about, or null when it is not organization-scoped. The bare
 * collection (`…/organizations`, list and create) and `…/organizations/suggest-id` are NOT:
 * they ask a server which organizations it has, or for an id on it, and the caller names the
 * machine for those itself.
 */
export function orgInPath(path: string): { projectId: string; orgId: string } | null {
  const match = /^\/api\/projects\/([^/?#]+)\/organizations\/([^/?#]+)/.exec(path);
  if (match === null) return null;
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s; // A malformed escape is not a reason to lose the id.
    }
  };
  const orgId = decode(match[2]!);
  if (COLLECTION_ROUTES.has(orgId)) return null;
  return { projectId: decode(match[1]!), orgId };
}

/** The machine an organization-scoped path should go to, or null for this one. */
export function machineForOrgPath(path: string): string | null {
  const org = orgInPath(path);
  return org === null ? null : machineForOrg(org.projectId, org.orgId);
}

/**
 * A Session named in an organization's answer lives where the organization lives: a desk, a
 * ticket's work Session, the CEO desk a new organization opens onto. Those ids reach the chat
 * page from a dozen responses (the chart, the desk, a ticket, the Sessions page), so rather
 * than teach each caller, every `sessionId` in an answer from a machine is recorded for that
 * machine as it passes — which is what makes opening one route to the right server.
 */
export function rememberSessionsIn(answer: unknown, machineId: string | null): void {
  if (machineId === null) return;
  const walk = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== "object" || depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "sessionId" && typeof item === "string" && item !== "") {
        rememberSessionMachine(item, machineId);
      } else walk(item, depth + 1);
    }
  };
  walk(answer, 0);
}
