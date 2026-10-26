/**
 * The status bar's counting and marking rules, kept free of React so tests drive them
 * directly (the component only wires polling, storage and navigation on top).
 *
 * What the user asked the bar to keep, over the WHOLE harness — every machine it spans, not
 * the Project the sidebar lists:
 *
 * - `session: ${active} / ${viewed}` — `active` is the server's answer: the Sessions with a
 *   Task in progress or a compaction running, summed over every machine that answered.
 *   `viewed` is THIS browser's own count: the Sessions the user has opened (the route sat on
 *   one once), still kept — the bar's second number is 「我查看了多少个」. The list the count
 *   opens is exactly those Sessions, each row stamped with the machine it lives on; a row's
 *   x stops keeping it — the ticket's 「移除即关闭」, the one removal that makes the count go
 *   down by one. What the harness itself holds is the first number's business, not the
 *   second's.
 * - A Session the user has OPENED is marked once when it goes idle — a finished-working
 *   signal the list carries until the user looks at the Session again. Transitions are
 *   observed between consecutive polls; a reload forgets the previous statuses, so a flip
 *   that happens while the page is closed is not re-marked (there was nothing observed to
 *   mark from).
 * - Both sets are client bookkeeping (localStorage) capped at CAP ids, oldest evicted: they
 *   are the user's own tracker, not a deletion — the Sessions themselves are untouched.
 * - The company a row's Session belongs to — `companyOfRow` — is named only when the shell's
 *   own organization list holds it, so the click can take the company view there before it
 *   asks the sidebar to locate the row; a company this shell cannot show reads as none.
 * - The reach a click owes the shell's mode before that ask can be answered — `reachOfRow` —
 *   is the row's company for a company row this shell can show, and the development list for
 *   a normal row while the shell stands in company mode; the shell already standing where
 *   the row lives, a company the shell cannot show, and company mode being unavailable all
 *   reach nothing.
 */
import type { HarnessStatusSession, SessionStatus } from "@prismshadow/penguin-server/api";
import type { WorkMode } from "../features/company/company-nav";

/** localStorage keys under which the two sets persist (all best-effort; see the loader). */
export const OPENED_KEY = "penguin.statusBar.opened";
export const MARKS_KEY = "penguin.statusBar.marks";

/** How many ids each set keeps; the oldest evicted. */
export const CAP = 200;

/** The storage the sets persist in, as narrow as the model needs (tests stand one in). */
export interface StatusBarStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The page's own localStorage, read at call time so a stubbed global is honoured. */
export function pageStorage(): StatusBarStorage | null {
  try {
    const store = globalThis.localStorage;
    if (store === undefined || store === null) return null;
    return store;
  } catch {
    return null;
  }
}

/**
 * An insertion-ordered set of session ids with a size cap (oldest evicted). Order is what
 * makes the cap fair — the oldest bookkeeping entry goes, not an arbitrary one — and what
 * names the machine the user works on: the last id in the set is the Session they viewed
 * most recently. A Set subclass, so it flows anywhere a set of ids is read; the only
 * behaviour it adds is the cap, and that re-adding an id moves it to the end (recency is
 * what eviction goes by).
 */
export class IdSet extends Set<string> {
  constructor(
    ids: Iterable<string> = [],
    private readonly cap: number = CAP,
  ) {
    super();
    // Deduplicate on the way in, keeping each id's first position (a plain Set's order).
    for (const id of new Set(ids)) super.add(id);
    while (this.size > this.cap) this.deleteOldest();
  }

  add(id: string): this {
    super.delete(id);
    super.add(id);
    while (this.size > this.cap) this.deleteOldest();
    return this;
  }

  toArray(): string[] {
    return [...this];
  }

  /** Evicts the oldest entry — the first one a Set's insertion order hands back. */
  private deleteOldest(): void {
    const oldest = this.values().next().value;
    if (oldest !== undefined) super.delete(oldest);
  }
}

/** Reads one set; an unreadable or malformed value reads as empty (the bar degrades, never breaks). */
export function loadIdSet(storage: StatusBarStorage | null, key: string): IdSet {
  if (storage === null) return new IdSet();
  try {
    const raw = storage.getItem(key);
    if (raw === null) return new IdSet();
    const parsed: unknown = JSON.parse(raw);
    return new IdSet(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new IdSet();
  }
}

/** Writes one set; a refused write only costs persistence for this tab. */
export function saveIdSet(storage: StatusBarStorage | null, key: string, ids: IdSet): void {
  if (storage === null) return;
  try {
    storage.setItem(key, JSON.stringify(ids.toArray()));
  } catch {
    // Storage refused or is full: the in-memory set keeps working for this tab.
  }
}

/**
 * The ids to mark this poll: a Session the user has opened that just read idle after being
 * observed running (or compacting) in the previous poll, and that does not already carry a
 * mark. 「标记一次」 per transition — an id that keeps its mark is not marked again.
 */
export function marksForTransitions(
  rows: readonly HarnessStatusSession[],
  prevStatusById: ReadonlyMap<string, SessionStatus>,
  opened: ReadonlySet<string>,
  marked: ReadonlySet<string>,
): string[] {
  const newlyMarked: string[] = [];
  for (const row of rows) {
    if (row.status !== "idle") continue;
    if (!opened.has(row.sessionId) || marked.has(row.sessionId)) continue;
    const prev = prevStatusById.get(row.sessionId);
    if (prev !== undefined && prev !== "idle" && !newlyMarked.includes(row.sessionId)) {
      newlyMarked.push(row.sessionId);
    }
  }
  return newlyMarked;
}

/**
 * The bar's `all`: how many Sessions the user has viewed and still keeps — the opened set's
 * own size. An x removes from the set, so it is the one thing that makes this count go down.
 */
export function viewedCount(opened: ReadonlySet<string>): number {
  return opened.size;
}

/**
 * The machine the user is working on: the machine of the Session they viewed most recently
 * that this poll still holds a row for — the opened set read newest-first, so a Session
 * opened out of order (or whose machine went quiet) falls to the next one, and null means
 * this server. The company a person works with lives on its machine, so the load the bar
 * shows is the load of whatever they last worked on.
 */
export function workingMachineOf(
  opened: ReadonlySet<string>,
  rows: readonly HarnessStatusSession[],
): string | null {
  const rowBySession = new Map(rows.map((row) => [row.sessionId, row]));
  const ids = [...opened]; // a Set iterates oldest-first; the LAST is the most recent.
  for (let i = ids.length - 1; i >= 0; i--) {
    const row = rowBySession.get(ids[i]!);
    if (row !== undefined) return row.machineId;
  }
  return null;
}

/** The poll's rows in the order the list shows them: newest activity first, id last. */
export function byLatest(rows: readonly HarnessStatusSession[]): HarnessStatusSession[] {
  return [...rows].sort((a, b) => {
    if (a.lastActiveAt !== b.lastActiveAt) {
      return a.lastActiveAt < b.lastActiveAt ? 1 : -1;
    }
    return a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0;
  });
}

/**
 * The company a row's Session belongs to, as the pair that names an organization — or null
 * when the click should not reach for one. The row's own `orgId` says which company holds the
 * Session (the poll stamped it from the answering server's caches); `organizations` — the
 * shell's own list, spanning every Project it can reach — says whether THIS shell can show
 * that company at all. A row without one, a company of a machine this shell has no page for,
 * or a list that has not loaded yet all read null, and the click keeps its old behaviour:
 * the jump alone, with the locate ask left standing for whatever sidebar can answer it.
 */
export function companyOfRow(
  row: Pick<HarnessStatusSession, "projectId" | "orgId">,
  organizations: ReadonlyArray<{ projectId: string; orgId: string }>,
): { projectId: string; orgId: string } | null {
  if (row.orgId === null) return null;
  return organizations.some((o) => o.projectId === row.projectId && o.orgId === row.orgId)
    ? { projectId: row.projectId, orgId: row.orgId }
    : null;
}

/**
 * The reach a click on this row owes the shell's mode before the locate ask can be answered:
 * the row's company for a company row this shell can show, the development list for a normal
 * Session while the shell stands in company mode, and nothing when the sidebar is already
 * where the row lives or cannot be taken to it at all. The company side names the pair
 * `companyOfRow` answered with, and the store's setters are no-ops where the shell already
 * stands, so a row of the company on screen only jumps. A company this shell cannot show
 * keeps the jump-only degradation from whichever mode the shell is in — such a row is not a
 * normal Session, so it never reaches for the development list either.
 *
 * `workMode` is the mode the shell STANDS in (the effective one: development whenever company
 * mode is unavailable, so a normal row reaches nothing then), and `companyAvailable` is
 * whether the company reach may be made at all — with it off, a company row reaches nothing
 * too.
 */
export type RowReach =
  { workMode: "company"; projectId: string; orgId: string } | { workMode: "dev" };

export function reachOfRow(
  row: Pick<HarnessStatusSession, "projectId" | "orgId">,
  organizations: ReadonlyArray<{ projectId: string; orgId: string }>,
  workMode: WorkMode,
  companyAvailable: boolean,
): RowReach | null {
  const company = companyOfRow(row, organizations);
  if (company !== null) return companyAvailable ? { workMode: "company", ...company } : null;
  // Only a row no organization holds is the development list's to locate: one a company the
  // shell cannot show holds keeps the jump alone, and a shell standing in development
  // already lists the row.
  if (row.orgId === null && workMode === "company") return { workMode: "dev" };
  return null;
}

/** One decimal of GB — the bar's memory shape (`6.2 / 16 GB`). */
export function gigabytes(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1);
}
