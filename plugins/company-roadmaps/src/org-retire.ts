/**
 * Deleting an organization, as this plugin takes part in it (the host's
 * `OrganizationModule.retirements`, contributed by index.ts's retirement node). The plugin keeps
 * per organization its `company.db` connection, opened on first use, and the lock chain its
 * writes run on. A retirement awaits the organization's writes in
 * flight, closes its connection and drops both; other organizations are not touched.
 *
 * Until the host has moved the directory, nothing may open the organization's store again: a new
 * connection would hold the file open (Windows refuses the move) or write into the trashed one.
 * RetiredOrgs keeps that refusal and lifts it only for a caller that read the organization as
 * existing after the retirement began — the host answers that read with null while the delete
 * runs, so an organization found then is a new one under the same id, or one whose delete failed.
 *
 * The same class lives in company-proposals: the two plugins share no code (company-proposals
 * knows nothing of roadmaps, and this plugin reaches it only through the module tree), and each
 * evolves with its own stores.
 */

/** The organizations retired, and the reads that may open their stores again. */
export class RetiredOrgs {
  private generation = 0;
  private readonly marks = new Map<string, number>();

  /** Taken before reading the organization through the gateway; handed to `admit` with what it opened. */
  stamp(): number {
    return this.generation;
  }

  /** The organization's retirement begins: its store may not open until `admit` says so. */
  retire(key: string): void {
    this.generation += 1;
    this.marks.set(key, this.generation);
  }

  /**
   * Whether the organization's store may open: it was never retired, or `seen` is a stamp taken
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

/** One organization, as the host names it to a retirement. */
export interface OrgRef {
  projectId: string;
  orgId: string;
}

export type RetireListener = (org: OrgRef) => Promise<void>;

/**
 * The service's retirements, registered at its setup and removed when its App stops; the
 * retirement node reaches them through this module's scope, since it contributes to the
 * organization module and so cannot require the service's own dependencies (index.ts).
 */
export const retireListeners = new Set<RetireListener>();

/** What the retirement node binds: every registered retirement of the organization, awaited. */
export async function retireRegistered(org: OrgRef): Promise<void> {
  await Promise.all([...retireListeners].map((listener) => listener(org)));
}
