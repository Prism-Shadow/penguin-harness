/**
 * Stale-while-revalidate in front of the PR graph, one entry per organization.
 *
 * A cold graph read asks GitHub for every open PR, the closed PRs a base walk passes and the
 * comparisons between heads — measured 20–45 s on a ~130-PR fork, longer than a hub's 15 s
 * forward timeout, so the page failed while the read went on and warmed the caches anyway.
 * Here a request answers at once with the last graph when there is one, and at most one read
 * per organization is in flight: a page left open, several viewers or a reload loop no longer
 * multiply GitHub calls (each person's `gh` quota is 5000 an hour). Only the first read after
 * a restart waits for GitHub. The ledger side (proposals, deployments, delivery settings) is
 * cheap and must never look stale, so a changed `input` waits for a read like a cold one.
 */
import type { ProposalGraphResponse } from "@prismshadow/penguin-server/api";

/** A graph younger than this is answered without starting a refresh. */
export const GRAPH_FRESH_MS = 10_000;

interface Entry {
  graph: ProposalGraphResponse | null;
  input: string;
  at: number;
  inFlight: Promise<ProposalGraphResponse> | null;
}

export class GraphCache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * The graph for `key`: the cached one when it was laid out from the same `input` (refreshed
   * in the background once older than GRAPH_FRESH_MS), else the result of `read` — shared
   * with any read already running.
   */
  async get(
    key: string,
    input: string,
    read: () => Promise<ProposalGraphResponse>,
  ): Promise<ProposalGraphResponse> {
    const entry = this.entries.get(key) ?? { graph: null, input: "", at: 0, inFlight: null };
    this.entries.set(key, entry);
    if (entry.graph !== null && entry.input === input) {
      if (this.now() - entry.at >= GRAPH_FRESH_MS && entry.inFlight === null) {
        // A failed background refresh keeps the last graph; the next request tries again.
        this.refresh(entry, read).catch(() => undefined);
      }
      return entry.graph;
    }
    if (entry.inFlight !== null && entry.input === input) return entry.inFlight;
    entry.input = input;
    return this.refresh(entry, read);
  }

  private refresh(
    entry: Entry,
    read: () => Promise<ProposalGraphResponse>,
  ): Promise<ProposalGraphResponse> {
    const input = entry.input;
    const run = read().then(
      (graph) => {
        // A read for an input that has since changed still answers its own caller, but
        // never overwrites the newer input's graph.
        if (entry.input !== input) return graph;
        entry.graph = graph;
        entry.at = this.now();
        entry.inFlight = null;
        return graph;
      },
      (err: unknown) => {
        if (entry.input === input) entry.inFlight = null;
        throw err;
      },
    );
    entry.inFlight = run;
    return run;
  }
}
