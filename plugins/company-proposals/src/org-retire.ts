/**
 * Deleting an organization, as this plugin takes part in it (the host's
 * `OrganizationModule.retirements`, contributed by index.ts's retirement node). The plugin keeps
 * per organization what it opened on first use: the `company.db` connection (proposals, the PR
 * graph and the PR status cache share it), the deployment registry's append chain, the graph
 * refresher's state with any refresh in flight (git and gh children) and the PR status batch in
 * flight. A retirement stops and awaits that organization's work, closes its connection and
 * drops what is kept of it; other organizations are not touched.
 *
 * Until the host has moved the directory, nothing may open the organization's stores again —
 * a new connection would hold the file open (Windows refuses the move) or write into the trashed
 * one. RetiredOrgs keeps that refusal, and lifts it only for a caller that read the organization
 * as existing after the retirement began: the host answers that read with null while the delete
 * runs, so an organization found then is a new one under the same id, or one whose delete failed.
 */

/** The organizations retired, and the reads that may open their stores again. */
export class RetiredOrgs {
  private generation = 0;
  private readonly marks = new Map<string, number>();

  /** Taken before reading the organization through the gateway; handed to `admit` with what it opened. */
  stamp(): number {
    return this.generation;
  }

  /** The organization's retirement begins: its stores may not open until `admit` says so. */
  retire(key: string): void {
    this.generation += 1;
    this.marks.set(key, this.generation);
  }

  /**
   * Whether the organization's stores may open: it was never retired, or `seen` is a stamp taken
   * after its retirement began, before a read that found the organization (the mark is then
   * lifted). Without a stamp a retired organization stays closed.
   */
  admit(key: string, seen?: number): boolean {
    const at = this.marks.get(key);
    if (at === undefined) return true;
    if (seen === undefined || seen < at) return false;
    this.marks.delete(key);
    return true;
  }
}

/** What one organization holds open, as the retirement releases it. */
export interface RetiringStores {
  proposals: { close(): void };
  deployments: { settled(): Promise<void> };
}

/** The pieces of the service that keep work or state per organization. */
export interface RetireParts {
  key: string;
  retired: RetiredOrgs;
  stores: Map<string, RetiringStores>;
  /** Aborts and awaits the organization's graph refresh, and drops its state. */
  graph(key: string): Promise<void>;
  /** Awaits the organization's PR status batch in flight. */
  prStatus(key: string): Promise<void>;
  /** Drops every other in-memory entry of the organization. */
  forget(key: string): void;
}

/**
 * The retirement itself: refuse new opens first, then stop the work that writes (the graph
 * refresh, the PR status batch), then close the connection.
 */
export async function retireOrg(parts: RetireParts): Promise<void> {
  const { key } = parts;
  parts.retired.retire(key);
  await parts.graph(key);
  await parts.prStatus(key);
  const stores = parts.stores.get(key);
  parts.stores.delete(key);
  parts.forget(key);
  if (stores === undefined) return;
  await stores.deployments.settled();
  stores.proposals.close();
}

/** One organization, as the host names it to a retirement. */
export interface OrgRef {
  projectId: string;
  orgId: string;
}

export type RetireListener = (org: OrgRef) => Promise<void>;

/**
 * The plugin's retirements, registered by its module at setup and removed when its App stops.
 * The retirement node reaches them through this module's scope, which the two nodes of one
 * bundle share: it contributes to the organization module, so it cannot require the gateway
 * that module provides, nor the module that does (the same reason as company-roadmaps' claim).
 */
export const retireListeners = new Set<RetireListener>();

/** What the retirement node binds: every registered retirement of the organization, awaited. */
export async function retireRegistered(org: OrgRef): Promise<void> {
  await Promise.all([...retireListeners].map((listener) => listener(org)));
}
