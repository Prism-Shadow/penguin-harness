/**
 * Where a pull request stands — the one fact about a `pr` material (and an impl PR) the page
 * wants beside the link — kept in the organization store's `pr_status` with its age.
 *
 * A proposal read answers at once from that table, fresh or not, with `statusCheckedAt`; the
 * keys missing or older than STATUS_TTL_MS are read in the background in one batch through the
 * Forge, at most one batch per organization at a time — a read never waits for `gh`. The graph
 * refresh writes the status of every PR it reads as well. Reporting `merged` asks the forge
 * now, past the table (a write is not decided on a five-minute-old `open`), and writes back.
 */
import { execFile } from "node:child_process";
import type { ProposalPrStatus } from "@prismshadow/penguin-server/api";
import type { ChangeRequest, Forge, GraphStore, PrStatusRow } from "./ports.js";

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

/** The status the page names, from a change request. */
export function statusOfChange(cr: Pick<ChangeRequest, "state" | "draft">): ProposalPrStatus {
  if (cr.state === "merged") return "merged";
  if (cr.state === "closed") return "closed";
  return cr.draft ? "draft" : "open";
}

/** How long a PR's status is answered without asking again: the graph's probe window. */
export const STATUS_TTL_MS = 5 * 60_000;

/** An owner or repository name GitHub accepts; anything else is never put on a command line. */
export const GITHUB_NAME = /^(?!\.\.?$)[A-Za-z0-9_.-]+$/;

/** Runs `gh` with these arguments and answers its stdout; rejects when it cannot run, fails or times out. */
export type RunGh = (
  args: readonly string[],
  limits: { timeoutMs: number; maxBytes: number },
) => Promise<string>;

/**
 * The `gh` on the PATH, started as an argument vector (no shell). The bare name also
 * resolves `gh.exe` on Windows, where the process spawner tries `.com` and `.exe`.
 * A failure's message is the reason: not found, timed out, or the last line gh wrote to stderr.
 */
export function ghRunner(command = "gh"): RunGh {
  return (args, limits) =>
    new Promise((resolve, reject) => {
      execFile(
        command,
        [...args],
        {
          timeout: limits.timeoutMs,
          maxBuffer: limits.maxBytes,
          windowsHide: true,
          env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
        },
        (err, stdout, stderr) => {
          if (err === null) {
            resolve(stdout);
            return;
          }
          const lastLine = stderr.trim().split(/\r?\n/).at(-1) ?? "";
          const reason =
            err.code === "ENOENT"
              ? `${command} not found`
              : err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                ? `${command} wrote more than ${limits.maxBytes} bytes`
                : err.killed === true
                  ? `${command} timed out after ${limits.timeoutMs} ms`
                  : lastLine !== ""
                    ? lastLine
                    : err.message;
          reject(new Error(reason));
        },
      );
    });
}

/** A pull request's fresh reading for a write: its status, where it points, whether it landed. */
export interface PrLanding {
  status: ProposalPrStatus;
  /** The branch it targets, null when the forge did not say. */
  base: string | null;
  /** The target repository's default branch, null when the forge did not say. */
  defaultBranch: string | null;
  /** Merged, into the target repository's default branch. */
  landed: boolean;
  checkedAt: string;
}

/** `owner/repo#n` lower-cased: the key of a PR in `pr_status`. */
export function statusKey(url: string): string | null {
  const ref = parsePullUrl(url);
  return ref === null ? null : `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`;
}

export interface PrStatusDeps {
  forge: Forge;
  log: (line: string) => void;
  now?: () => number;
}

/** The cached status reader; one per service. */
export class PrStatusReader {
  /** The batch in flight per organization. */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly deps: PrStatusDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * The cached status of each PR URL (by URL; absent when never read or unknown). The missing
   * and the stale ones are read in the background, in one batch; `refreshed` settles when it is
   * done (a test awaits it).
   */
  read(
    orgKey: string,
    store: Pick<GraphStore, "prStatuses" | "putPrStatuses">,
    urls: readonly string[],
  ): {
    statuses: Map<string, { status: ProposalPrStatus; checkedAt: string }>;
    refreshed: Promise<void>;
  } {
    const keys = new Map<string, string>();
    for (const url of urls) {
      const key = statusKey(url);
      if (key !== null) keys.set(url, key);
    }
    const rows = store.prStatuses([...new Set(keys.values())]);
    const statuses = new Map<string, { status: ProposalPrStatus; checkedAt: string }>();
    const stale = new Set<string>();
    for (const [url, key] of keys) {
      const row = rows.get(key);
      if (row?.status != null) statuses.set(url, { status: row.status, checkedAt: row.checkedAt });
      if (row === undefined || this.now() - Date.parse(row.checkedAt) >= STATUS_TTL_MS)
        stale.add(key);
    }
    const refreshed =
      stale.size === 0 ? Promise.resolve() : this.refresh(orgKey, store, [...stale]);
    return { statuses, refreshed };
  }

  /** One batch per organization at a time; a batch asked while one runs is skipped, the next read asks again. */
  private refresh(
    orgKey: string,
    store: Pick<GraphStore, "putPrStatuses">,
    keys: string[],
  ): Promise<void> {
    const running = this.inFlight.get(orgKey);
    if (running !== undefined) return running;
    const run = this.batch(store, keys)
      .catch((err: unknown) => {
        this.deps.log(
          `[company-proposals] PR status not read: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => this.inFlight.delete(orgKey));
    this.inFlight.set(orgKey, run);
    return run;
  }

  private async batch(store: Pick<GraphStore, "putPrStatuses">, keys: string[]): Promise<void> {
    const byRepo = new Map<string, number[]>();
    for (const key of keys) {
      const [repo, n] = key.split("#") as [string, string];
      byRepo.set(repo, [...(byRepo.get(repo) ?? []), Number(n)]);
    }
    const rows: PrStatusRow[] = [];
    for (const [repo, numbers] of byRepo) {
      const checkedAt = new Date(this.now()).toISOString();
      try {
        const found = await this.deps.forge.listChangeRequests({ repo, numbers });
        const byNumber = new Map(found.map((cr) => [cr.number, cr]));
        for (const n of numbers) {
          const cr = byNumber.get(n);
          rows.push({
            key: `${repo}#${n}`,
            status: cr === undefined ? null : statusOfChange(cr),
            base: cr?.base ?? null,
            defaultBranch: cr?.defaultBranch ?? null,
            checkedAt,
            error: cr === undefined ? "not found" : null,
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        // A failure is kept as long as an answer, so a broken URL is not asked on every read.
        for (const n of numbers) {
          rows.push({
            key: `${repo}#${n}`,
            status: null,
            base: null,
            defaultBranch: null,
            checkedAt,
            error,
          });
        }
        this.deps.log(`[company-proposals] PR status not read for ${repo}: ${error}`);
      }
    }
    store.putPrStatuses(rows);
  }

  /**
   * Whether a PR URL landed: asked of the forge now, past the cache — a write is decided on it.
   * The answer is written back to the cache the page reads; null when the URL is not a pull
   * request or the forge could not say.
   */
  async landing(store: Pick<GraphStore, "putPrStatuses">, url: string): Promise<PrLanding | null> {
    const key = statusKey(url);
    if (key === null) return null;
    const read = await this.deps.forge.isMerged(url);
    const checkedAt = new Date(this.now()).toISOString();
    store.putPrStatuses([
      {
        key,
        status: read?.status ?? null,
        base: read?.base ?? null,
        defaultBranch: read?.defaultBranch ?? null,
        checkedAt,
        error: read === null ? "not read" : null,
      },
    ]);
    return read === null ? null : { ...read, checkedAt };
  }
}
