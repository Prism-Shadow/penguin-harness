/**
 * Where a GitHub pull request stands — the one fact about a `pr` material the page wants
 * beside the link. Read from GitHub when a proposal is read, never stored: the ledger
 * records that a PR was attached, GitHub knows whether it was merged.
 *
 * One lookup per URL at a time, its answer kept for a minute, a failure (network, 404, a
 * rate limit) kept just as long so a broken URL is not asked about on every read; the page
 * simply shows no status then. A failure is logged at most once per URL per ten minutes.
 */
import type { ProposalPrStatus } from "@prismshadow/penguin-server/api";

/** `https://github.com/<owner>/<repo>/pull/<n>` (or `/pulls/<n>`), with or without a trailing slash or a fragment. */
const PR_URL =
  /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pulls?\/(\d+)(?:[/?#].*)?$/i;

export interface PullRef {
  owner: string;
  repo: string;
  number: number;
}

/** The pull request a URL names on GitHub, or null for any other URL. */
export function parsePullUrl(url: string): PullRef | null {
  const m = PR_URL.exec(url.trim());
  if (m === null) return null;
  const repo = m[2]!.replace(/\.git$/, "");
  return { owner: m[1]!, repo, number: Number(m[3]) };
}

/** GitHub's answer, reduced to the four states the page names. */
export function statusOf(pull: {
  draft?: unknown;
  merged?: unknown;
  merged_at?: unknown;
  state?: unknown;
}): ProposalPrStatus {
  if (pull.merged === true || (typeof pull.merged_at === "string" && pull.merged_at !== ""))
    return "merged";
  if (pull.state === "closed") return "closed";
  if (pull.draft === true) return "draft";
  return "open";
}

export const STATUS_TTL_MS = 60_000;
const FAILURE_LOG_INTERVAL_MS = 10 * 60_000;
const TIMEOUT_MS = 3_000;

interface Cached {
  status: ProposalPrStatus | null;
  checkedAt: number;
}

export interface PrStatusDeps {
  fetch?: typeof fetch;
  /** The GitHub token to send, when the server has one. */
  token: () => string | null;
  log: (line: string) => void;
  now?: () => number;
}

/** The lookup with its cache; one per service. */
export class PrStatusReader {
  private readonly cache = new Map<string, Cached>();
  private readonly inFlight = new Map<string, Promise<Cached>>();
  private readonly failureLoggedAt = new Map<string, number>();

  constructor(private readonly deps: PrStatusDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The status of a PR URL — from the cache while fresh, else from GitHub; null when unknown. */
  async read(url: string): Promise<{ status: ProposalPrStatus; checkedAt: string } | null> {
    const ref = parsePullUrl(url);
    if (ref === null) return null;
    const key = `${ref.owner}/${ref.repo}#${ref.number}`;
    const cached = this.cache.get(key);
    const now = this.now();
    const entry =
      cached !== undefined && now - cached.checkedAt < STATUS_TTL_MS
        ? cached
        : await this.lookup(key, ref);
    return entry.status === null
      ? null
      : { status: entry.status, checkedAt: new Date(entry.checkedAt).toISOString() };
  }

  private lookup(key: string, ref: PullRef): Promise<Cached> {
    const pending = this.inFlight.get(key);
    if (pending !== undefined) return pending;
    const run = this.fetchStatus(key, ref)
      .then((status): Cached => {
        const entry = { status, checkedAt: this.now() };
        this.cache.set(key, entry);
        return entry;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, run);
    return run;
  }

  private async fetchStatus(key: string, ref: PullRef): Promise<ProposalPrStatus | null> {
    const doFetch = this.deps.fetch ?? globalThis.fetch;
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "penguin-harness",
    };
    const token = this.deps.token();
    if (token !== null) headers.authorization = `Bearer ${token}`;
    try {
      const res = await doFetch(
        `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pulls/${ref.number}`,
        { headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (!res.ok) {
        this.failed(key, `HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as Parameters<typeof statusOf>[0];
      return statusOf(body);
    } catch (err) {
      this.failed(key, err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  private failed(key: string, reason: string): void {
    const now = this.now();
    const last = this.failureLoggedAt.get(key);
    if (last !== undefined && now - last < FAILURE_LOG_INTERVAL_MS) return;
    this.failureLoggedAt.set(key, now);
    this.deps.log(`[company-proposals] PR status not read for ${key}: ${reason}`);
  }
}
