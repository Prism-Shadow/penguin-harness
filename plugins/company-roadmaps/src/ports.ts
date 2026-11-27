/**
 * The port the roadmap service depends on for its data; the SQLite adapter is store.ts. No SQL
 * above it. ProposalCreator (proposals.ts) is the other port: the one way to company-proposals.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Roadmap, RoadmapStatus, RoadmapWrite } from "./domain.js";

export interface RoadmapStore {
  /** Every roadmap, by number, narrowed by its room or its status. */
  list(filter?: { channel?: string; status?: RoadmapStatus }): Roadmap[];
  get(number: number): Roadmap | null;
  /** One past the highest number so far. */
  nextNumber(): number;
  /**
   * One transaction: `check` is called inside it with the roadmap as it stands (the default
   * rules, guards.ts) and may refuse; then each write changes its tables and records its event.
   * Answers the roadmap after it.
   */
  write(entries: RoadmapWrite | readonly RoadmapWrite[], check?: (r: Roadmap) => void): Roadmap;
  /** A delegation's desk delivery, recorded once it is known (no event: the delegation's is written). */
  recordDelivery(number: number, key: string, delivered: boolean, error: string | null): void;
  /** A view whose every write transaction also calls `sink` inside it (an Action run's start row). */
  scoped(sink: ((db: DatabaseSync) => void) | undefined): RoadmapStore;
  close(): void;
}
