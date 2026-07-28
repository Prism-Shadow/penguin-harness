/**
 * Update-check service: resolves the newest published release from the GitHub Releases
 * API and compares it with the running version (core's VERSION), for the web UI's
 * update reminder (GET /api/version/update-check).
 *
 * This is the server's only outbound internet call, so it is strictly fail-soft: check()
 * never throws and never surfaces an upstream failure as a 5xx — a failed lookup returns
 * a normal response with `error` set and `latestVersion` null. Outcomes are cached
 * in-memory (success for 1 hour, failure for 10 minutes) so a sidebar that opens on every
 * page load cannot hammer GitHub's unauthenticated rate limit; concurrent requests share
 * one in-flight lookup. `PENGUIN_UPDATE_CHECK=off` disables the lookup entirely (no
 * network call), for air-gapped or privacy-sensitive deployments.
 *
 * The request mirrors the CLI's fetchLatestVersion (packages/cli/src/commands/update.ts):
 * same endpoint, same accept / user-agent header shape, same 15s timeout — the server
 * cannot import the CLI package (the dependency runs the other way), hence the small
 * duplication. fetch and the clock are injectable so tests never touch the network.
 */
import { BUILD_DATE, VERSION, compareVersions, normalizeVersion } from "@prismshadow/penguin-core";
import type { UpdateCheckResponse } from "../api/types.js";

/** Repository the released artifacts come from (same slug as cli/update.ts's REPO_SLUG). */
const REPO_SLUG = "Prism-Shadow/penguin-harness";
/** Releases API endpoint for the newest published release. */
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;

/** How long a successful lookup is served from cache. */
export const SUCCESS_TTL_MS = 60 * 60 * 1000;
/** How long a failed lookup is served from cache (short: transient failures should heal). */
export const FAILURE_TTL_MS = 10 * 60 * 1000;

export interface UpdateCheckServiceOptions {
  /** Test double for the network call (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** Injectable clock for TTL determinism in tests. */
  now?: () => Date;
  /** Environment to read PENGUIN_UPDATE_CHECK from (defaults to process.env). */
  env?: Record<string, string | undefined>;
}

export class UpdateCheckService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly env: Record<string, string | undefined>;
  private cached: { response: UpdateCheckResponse; expiresAt: number } | null = null;
  private inflight: Promise<UpdateCheckResponse> | null = null;

  constructor(options: UpdateCheckServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.env = options.env ?? process.env;
  }

  /**
   * Never throws; never makes a network call when disabled or (without `force`) while
   * the cache is fresh. `force` — the web's manual "check for updates" action — skips
   * the freshness check and performs a real lookup even over a warm cache: the cache
   * exists to shield GitHub's unauthenticated rate limit from *passive* checks fired
   * by every sidebar open, and an explicit user click is rare enough to press through
   * it. Everything else is unchanged: the opt-out stays authoritative (force never
   * dials out under PENGUIN_UPDATE_CHECK=off), the outcome lands in the same cache
   * (subsequent passive checks reuse it), and concurrent callers — forced or not —
   * still share one in-flight lookup.
   */
  async check(force = false): Promise<UpdateCheckResponse> {
    if (this.env["PENGUIN_UPDATE_CHECK"] === "off") {
      return {
        currentVersion: VERSION,
        buildDate: BUILD_DATE,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        publishedAt: null,
        checkedAt: this.now().toISOString(),
        disabled: true,
      };
    }
    if (!force && this.cached && this.now().getTime() < this.cached.expiresAt) {
      return this.cached.response;
    }
    this.inflight ??= this.lookup().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** One real lookup; stores the outcome (success or failure) in the cache with its TTL. */
  private async lookup(): Promise<UpdateCheckResponse> {
    const response = await this.resolveLatest();
    const ttl = response.error === undefined ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
    this.cached = { response, expiresAt: this.now().getTime() + ttl };
    return response;
  }

  /**
   * Failure taxonomy mirrors the CLI's fetchLatestVersion: an unreachable endpoint or
   * timeout is "network"; a 403/429 is "rate_limited" (unauthenticated clients hit
   * GitHub's per-IP limit); any other non-2xx status, an unparsable body, or a body
   * without a usable tag_name is "bad_response".
   */
  private async resolveLatest(): Promise<UpdateCheckResponse> {
    const checkedAt = this.now().toISOString();
    const base = { currentVersion: VERSION, buildDate: BUILD_DATE, checkedAt };
    const failure = (error: "network" | "rate_limited" | "bad_response"): UpdateCheckResponse => ({
      ...base,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      publishedAt: null,
      error,
    });

    let res: Response;
    try {
      res = await this.fetchImpl(LATEST_RELEASE_API, {
        headers: { accept: "application/vnd.github+json", "user-agent": "penguin-server" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return failure("network");
    }
    if (res.status === 403 || res.status === 429) return failure("rate_limited");
    if (!res.ok) return failure("bad_response");

    let body: { tag_name?: unknown; html_url?: unknown; published_at?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return failure("bad_response");
    }
    const tag = typeof body.tag_name === "string" ? normalizeVersion(body.tag_name) : "";
    if (tag === "") return failure("bad_response");
    return {
      ...base,
      latestVersion: tag,
      updateAvailable: compareVersions(tag, VERSION) > 0,
      releaseUrl: typeof body.html_url === "string" ? body.html_url : null,
      publishedAt: typeof body.published_at === "string" ? body.published_at : null,
    };
  }
}
