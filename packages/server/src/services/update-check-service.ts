/**
 * Update-check service: resolves the newest published release from the GitHub Releases
 * API and compares it with the running version (core's VERSION), for the web UI's
 * update reminder (GET /api/version/update-check).
 *
 * This service is the server's only outbound internet caller, and it is strictly
 * fail-soft: check() never throws and never surfaces an upstream failure as a 5xx — a
 * failed lookup returns a normal response with `error` set and `latestVersion` null.
 * Outcomes are cached in-memory (success for 1 hour, failure for 10 minutes) so a
 * sidebar that opens on every page load cannot hammer GitHub's unauthenticated rate
 * limit; concurrent requests share one in-flight lookup. `PENGUIN_UPDATE_CHECK=off`
 * disables the lookup entirely (no network call), for air-gapped or privacy-sensitive
 * deployments.
 *
 * Besides the latest release, a lookup also resolves the *running* version's own publish
 * date (`currentPublishedAt`) from the releases-by-tag endpoint — but only when core's
 * BUILD_DATE is null: releases stamped before date stamping existed (v0.1.2 and earlier)
 * have no build date, and this is the web footer's fallback for them. A stamped build
 * date answers the question locally, so no second request is made then. The resolution
 * shares the one cache entry (and thus the success/failure TTLs) and is itself fail-soft:
 * any failure just leaves the field null without touching the check's own outcome.
 *
 * The request mirrors the CLI's fetchLatestVersion (packages/cli/src/commands/update.ts):
 * same endpoint, same accept / user-agent header shape, same 15s timeout — the server
 * cannot import the CLI package (the dependency runs the other way), hence the small
 * duplication. fetch, the clock, and the build date are injectable so tests never touch
 * the network and can exercise both stamped and unstamped builds.
 */
import { BUILD_DATE, VERSION, compareVersions, normalizeVersion } from "@prismshadow/penguin-core";
import type { UpdateCheckResponse } from "../api/types.js";

/** Repository the released artifacts come from (same slug as cli/update.ts's REPO_SLUG). */
const REPO_SLUG = "Prism-Shadow/penguin-harness";
/** Releases API root for that repository. */
const RELEASES_API = `https://api.github.com/repos/${REPO_SLUG}/releases`;
/** Releases API endpoint for the newest published release. */
export const LATEST_RELEASE_API = `${RELEASES_API}/latest`;
/** Releases API endpoint for a specific version's own release (tags carry a leading `v`). */
export const releaseTagApi = (version: string): string => `${RELEASES_API}/tags/v${version}`;

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
  /** Overrides core's BUILD_DATE in tests (a stamped date skips the current-release lookup; null forces it). */
  buildDate?: string | null;
}

export class UpdateCheckService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly env: Record<string, string | undefined>;
  private readonly buildDate: string | null;
  private cached: { response: UpdateCheckResponse; expiresAt: number } | null = null;
  private inflight: Promise<UpdateCheckResponse> | null = null;

  constructor(options: UpdateCheckServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.env = options.env ?? process.env;
    // ?? would coerce an explicit null (meaning "unstamped build") back to core's constant.
    this.buildDate = options.buildDate !== undefined ? options.buildDate : BUILD_DATE;
  }

  /** Never throws; never makes a network call when disabled or while the cache is fresh. */
  async check(): Promise<UpdateCheckResponse> {
    if (this.env["PENGUIN_UPDATE_CHECK"] === "off") {
      return {
        currentVersion: VERSION,
        buildDate: this.buildDate,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        publishedAt: null,
        currentPublishedAt: null,
        checkedAt: this.now().toISOString(),
        disabled: true,
      };
    }
    if (this.cached && this.now().getTime() < this.cached.expiresAt) {
      return this.cached.response;
    }
    this.inflight ??= this.lookup().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /**
   * One real lookup (latest release + the running release's date, in parallel); stores
   * the combined outcome in the one cache entry with its TTL — the TTL classification
   * follows the latest-release lookup alone, since the date resolution never errors.
   */
  private async lookup(): Promise<UpdateCheckResponse> {
    const [latest, currentPublishedAt] = await Promise.all([
      this.resolveLatest(),
      this.resolveCurrentPublishedAt(),
    ]);
    const response: UpdateCheckResponse = { ...latest, currentPublishedAt };
    const ttl = response.error === undefined ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
    this.cached = { response, expiresAt: this.now().getTime() + ttl };
    return response;
  }

  /**
   * Publish date of the running version's own release — the web footer's date for
   * installs released before BUILD_DATE stamping existed. Skipped without a request
   * when a build date is stamped (it already answers the question). Strictly fail-soft:
   * offline, rate-limited, 404 (a dev version has no release tag), or an unusable body
   * all resolve to null and never affect the update check's own outcome.
   */
  private async resolveCurrentPublishedAt(): Promise<string | null> {
    if (this.buildDate !== null) return null;
    try {
      const res = await this.fetchImpl(releaseTagApi(VERSION), {
        headers: { accept: "application/vnd.github+json", "user-agent": "penguin-server" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { published_at?: unknown };
      return typeof body.published_at === "string" ? body.published_at : null;
    } catch {
      return null;
    }
  }

  /**
   * Failure taxonomy mirrors the CLI's fetchLatestVersion: an unreachable endpoint or
   * timeout is "network"; a 403/429 is "rate_limited" (unauthenticated clients hit
   * GitHub's per-IP limit); any other non-2xx status, an unparsable body, or a body
   * without a usable tag_name is "bad_response". `currentPublishedAt` is resolved
   * separately and merged by lookup(), hence the Omit.
   */
  private async resolveLatest(): Promise<Omit<UpdateCheckResponse, "currentPublishedAt">> {
    type LatestResult = Omit<UpdateCheckResponse, "currentPublishedAt">;
    const checkedAt = this.now().toISOString();
    const base = { currentVersion: VERSION, buildDate: this.buildDate, checkedAt };
    const failure = (error: "network" | "rate_limited" | "bad_response"): LatestResult => ({
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
