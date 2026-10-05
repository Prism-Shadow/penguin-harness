/**
 * An impl branch's `+N/−M` on the proposal's detail, without the read waiting for it.
 *
 * The totals come from the impl's structured diff (impl-diff.ts), whose cache is keyed by the head
 * and base commits; this module keeps, per proposal, the last answer and when it was read. A read
 * returns what is known — `computing` the first time — and, when that is missing, stale (older
 * than `ttlMs`) or for another impl, starts one computation in the background. When the answer it
 * brings differs from the one held, `onChange` runs: the service publishes a plugin event, and the
 * page reads the detail again. A branch that moves is therefore seen on the first read after the
 * held answer went stale: the computation reads the tips again, and a new pair of commits is a new
 * diff.
 *
 * In memory only: a restart starts from `computing` again.
 */
import type { ProposalImplChanges, ProposalImplStat } from "@prismshadow/penguin-server/api";

/** How long a known answer is served before a read checks the branches again. */
export const STAT_TTL_MS = 60_000;
/** Proposals whose answers are kept; the least recently read go first. */
const MAX_ENTRIES = 500;

interface Entry {
  /** The impl the answer is for: a re-registered impl is a new question. */
  implKey: string;
  value: ProposalImplStat;
  /** When `value` was computed; 0 while it never was. */
  at: number;
  running: boolean;
}

export class ImplStats {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = STAT_TTL_MS,
  ) {}

  /**
   * The answer held for `key` (a proposal), starting `compute` in the background when it is
   * missing, stale or for another impl; `onChange` runs once a computation changed the answer.
   */
  read(
    key: string,
    implKey: string,
    compute: () => Promise<ProposalImplStat>,
    onChange: () => void,
  ): ProposalImplStat {
    let entry = this.entries.get(key);
    if (entry === undefined || entry.implKey !== implKey) {
      entry = { implKey, value: { state: "computing" }, at: 0, running: false };
    }
    // Most recently read last.
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    if (!entry.running && (entry.at === 0 || this.now() - entry.at >= this.ttlMs)) {
      const held = entry;
      held.running = true;
      void compute()
        .catch((err: unknown): ProposalImplStat => ({
          state: "unavailable",
          reason: err instanceof Error ? err.message : String(err),
        }))
        .then((next) => {
          held.running = false;
          held.at = this.now();
          // A re-registered impl replaced the entry meanwhile: this answer is for the old one.
          if (this.entries.get(key) !== held) return;
          const changed = JSON.stringify(next) !== JSON.stringify(held.value);
          held.value = next;
          if (!changed) return;
          try {
            onChange();
          } catch {
            // Telling the pages is a courtesy: the next read carries the answer regardless.
          }
        });
    }
    return entry.value;
  }
}

/** The totals of a structured diff, as the detail carries them. */
export function statOf(changes: ProposalImplChanges): ProposalImplStat {
  return {
    state: "ready",
    head: changes.head,
    base: changes.base,
    headSha: changes.headSha,
    baseSha: changes.baseSha,
    files: changes.files.length,
    additions: changes.additions,
    deletions: changes.deletions,
    compareUrl: changes.compareUrl,
  };
}
