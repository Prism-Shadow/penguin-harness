/**
 * What one run of the layout migration hands its steps: the data root, the journal and how to
 * save it, where to report, and the store of absolute paths the host keeps outside the files —
 * the server's web.db — when the host has one.
 *
 * Compatibility owner: core's `state/layout-migration/`, removed with the migration at 1.0.
 */
import type { LayoutJournal, LayoutStepId, PathMove } from "./journal.js";
import { writeJournal } from "./journal.js";

/**
 * The absolute paths a host stores beside the files, rewritten when a folder moves. The server
 * implements it over web.db (its Sessions' Workspaces, the Agent API's Workspaces, the sandbox
 * settings' masked paths, the drafts' Workspaces, the Trace cache). Without one — the SDK — the
 * moves are kept in the journal for the server's next start.
 */
export interface LayoutStore {
  /** Rewrites every stored path under a move's `from` to the same place under its `to`, in one transaction. */
  rewritePaths(moves: readonly PathMove[]): void | Promise<void>;
}

export class StepContext {
  constructor(
    readonly root: string,
    readonly journal: LayoutJournal,
    readonly store: LayoutStore | null,
    readonly log: (line: string) => void,
  ) {}

  /** Records that `step` has begun for the Project, before its first change to disk. */
  async begin(step: LayoutStepId, projectId: string): Promise<void> {
    if (this.journal.inProgress.some((e) => e.step === step && e.projectId === projectId)) return;
    this.journal.inProgress.push({ step, projectId });
    await writeJournal(this.root, this.journal);
  }

  /** Records that `step` is done for the Project, after its last change to disk. */
  async finish(step: LayoutStepId, projectId: string): Promise<void> {
    this.journal.inProgress = this.journal.inProgress.filter(
      (e) => !(e.step === step && e.projectId === projectId),
    );
    await writeJournal(this.root, this.journal);
  }

  /** The Projects an earlier run left in the middle of `step`. */
  unfinished(step: LayoutStepId): string[] {
    return this.journal.inProgress.filter((e) => e.step === step).map((e) => e.projectId);
  }

  /**
   * Rewrites the stored copies of `moves`: at once with a store, else kept in the journal until a
   * run that has one. Moves kept from an earlier run go along with the first run that can.
   */
  async rewriteStore(moves: readonly PathMove[]): Promise<void> {
    if (this.store === null) {
      const known = new Set(this.journal.pendingStore.map((m) => `${m.from}\0${m.to}`));
      this.journal.pendingStore.push(...moves.filter((m) => !known.has(`${m.from}\0${m.to}`)));
      await writeJournal(this.root, this.journal);
      return;
    }
    const all = [...this.journal.pendingStore, ...moves];
    if (all.length === 0) return;
    await this.store.rewritePaths(all);
    this.journal.pendingStore = [];
    await writeJournal(this.root, this.journal);
  }
}
