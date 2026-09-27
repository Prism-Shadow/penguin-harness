/**
 * Where a GitHub pull request stands — the one fact about a `pr` material the page wants
 * beside the link. Read from GitHub when a proposal is read, never stored: the ledger
 * records that a PR was attached, GitHub knows whether it was merged.
 *
 * GitHub is asked through the machine's own `gh` (`gh api repos/<owner>/<repo>/pulls/<n>`),
 * so the lookup runs under whatever identity `gh auth` holds there — no token of the
 * server's, and no anonymous quota to exhaust. Without `gh`, or with it logged out, the
 * lookup fails like any other failure below.
 *
 * One lookup per URL at a time, its answer kept for a minute, a failure (network, 404, a
 * rate limit) kept just as long so a broken URL is not asked about on every read; the page
 * simply shows no status then. A failure is logged at most once per URL per ten minutes.
 */
import { execFile } from "node:child_process";
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
/** A pull request's JSON is tens of KiB; anything past this is not an answer worth parsing. */
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** An owner or repository name GitHub accepts; anything else is never put on a command line. */
const GITHUB_NAME = /^(?!\.\.?$)[A-Za-z0-9_.-]+$/;

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

interface Cached {
  status: ProposalPrStatus | null;
  checkedAt: number;
}

export interface PrStatusDeps {
  /** How `gh` is run; the machine's own by default (a test feeds answers). */
  gh?: RunGh;
  log: (line: string) => void;
  now?: () => number;
}

const defaultGh = ghRunner();

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
    if (!GITHUB_NAME.test(ref.owner) || !GITHUB_NAME.test(ref.repo)) {
      this.failed(key, "not a GitHub repository name");
      return null;
    }
    const runGh = this.deps.gh ?? defaultGh;
    try {
      const stdout = await runGh(["api", `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`], {
        timeoutMs: TIMEOUT_MS,
        maxBytes: MAX_OUTPUT_BYTES,
      });
      const body = JSON.parse(stdout) as Parameters<typeof statusOf>[0];
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
