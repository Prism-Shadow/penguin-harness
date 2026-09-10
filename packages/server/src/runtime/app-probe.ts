/**
 * App status probing: one HTTP request against an app's health URL decides whether it is
 * running. Any HTTP response counts (a 404 or a 500 still means a server answered on that
 * port); a connection refusal or a timeout means stopped; an app without a URL is unknown.
 * HEAD goes first and GET is the fallback for servers that drop HEAD connections, each bounded
 * by a short timeout. Results are cached per URL for a few seconds so the list's polling and
 * several viewers do not turn into a request storm against the user's own app; a forced probe
 * (the page's refresh button) bypasses the cache, and concurrent probes of one URL share one
 * request.
 */

export type AppStatus = "running" | "stopped" | "unknown";

export interface AppStatusResult {
  status: AppStatus;
  /** When the probe that produced `status` ran (ISO 8601); absent for `unknown`. */
  checkedAt?: string;
}

export interface AppProbeOptions {
  /** Test double for the network. */
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  /** How long a result is served from cache (default 10s). */
  ttlMs?: number;
  /** Per-request bound (default 2s), applied to HEAD and to the GET fallback separately. */
  timeoutMs?: number;
}

interface CachedStatus {
  status: AppStatus;
  checkedAtMs: number;
}

export class AppStatusProbe {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CachedStatus>();
  private readonly inflight = new Map<string, Promise<AppStatusResult>>();

  constructor(opts: AppProbeOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = opts.now ?? (() => Date.now());
    this.ttlMs = opts.ttlMs ?? 10_000;
    this.timeoutMs = opts.timeoutMs ?? 2_000;
  }

  /** The status of the app served at `url` (cached), or `unknown` when there is nothing to probe. */
  status(url: string | undefined, opts: { force?: boolean } = {}): Promise<AppStatusResult> {
    if (url === undefined) return Promise.resolve({ status: "unknown" });
    const cached = this.cache.get(url);
    if (!opts.force && cached && this.now() - cached.checkedAtMs < this.ttlMs) {
      return Promise.resolve(this.result(cached));
    }
    const existing = this.inflight.get(url);
    if (existing) return existing;
    const run = this.probe(url)
      .then((status) => {
        const entry = { status, checkedAtMs: this.now() };
        this.cache.set(url, entry);
        return this.result(entry);
      })
      .finally(() => {
        this.inflight.delete(url);
      });
    this.inflight.set(url, run);
    return run;
  }

  /** Forgets a URL's cached status (an app's URL changed or the app was unregistered). */
  invalidate(url: string | undefined): void {
    if (url !== undefined) this.cache.delete(url);
  }

  private result(entry: CachedStatus): AppStatusResult {
    return { status: entry.status, checkedAt: new Date(entry.checkedAtMs).toISOString() };
  }

  private async probe(url: string): Promise<AppStatus> {
    for (const method of ["HEAD", "GET"] as const) {
      try {
        const res = await this.fetchImpl(url, {
          method,
          // Never leave the app's own origin: a redirect elsewhere is still an answer.
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        void res.body?.cancel();
        return "running";
      } catch {
        // Refused, reset or timed out: try the next method, then call it stopped.
      }
    }
    return "stopped";
  }
}
