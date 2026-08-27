/**
 * Update-source selection for the desktop auto-updater.
 *
 * This module owns the same source-neutral speed-probe contract the release installers
 * and download page use: fix the target tag first, read that tag's
 * release-download-manifest.tsv, prove both sources can serve the shared probe file, and
 * then compare the large probe using the current installer rule. GitHub is the free
 * source: it wins outright at or above the minimum speed, and the OSS mirror takes over
 * only when GitHub misses that minimum and OSS is clearly faster.
 *
 * The desktop default feed is still the GitHub Releases feed electron-builder publishes.
 * An inconclusive test never blocks updates; the caller keeps that default.
 */
import { createHash } from "node:crypto";

export const OSS_ORIGIN = "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com";
export const OSS_RELEASE_ROOT = `${OSS_ORIGIN}/releases`;
export const GITHUB_RELEASE_ROOT =
  "https://github.com/Prism-Shadow/penguin-harness/releases/download";
export const OSS_LATEST_JSON_URL = `${OSS_ORIGIN}/latest.json`;

/** Same contract as the release installers (install.sh / install.ps1). */
export const SPEED_PROBE_MANIFEST_TIMEOUT_SECONDS = 5;
export const SPEED_PROBE_SMALL_TIMEOUT_SECONDS = 5;
export const SPEED_PROBE_LARGE_TIMEOUT_SECONDS = 8;
export const SPEED_PROBE_TOTAL_TIMEOUT_SECONDS = 26;
export const SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND = 262144;
export const SPEED_PROBE_OSS_SWITCH_RATIO = 1.5;

/** Minimal structural slice of fetch so callers can inject Electron's net.fetch or a fake. */
export interface ProbeFetchInit {
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface ProbeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchFn = (url: string, init: ProbeFetchInit) => Promise<ProbeResponse>;

export interface ReleaseProbe {
  name: string;
  size: number;
  sha256: string;
}

export interface ReleaseDownloadManifest {
  smallProbe: ReleaseProbe;
  largeProbe: ReleaseProbe;
  /** Integrity check that the manifest belongs to a release carrying this update asset. */
  assetSize: number;
}

/** The update asset electron-updater replaces on this platform (dmg is manual-only). */
export function desktopUpdateAssetName(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "darwin") {
    return arch === "arm64" || arch === "x64" ? `penguin-desktop-darwin-${arch}.zip` : null;
  }
  if (platform === "win32") {
    return arch === "x64" ? "penguin-desktop-win32-x64.exe" : null;
  }
  if (platform === "linux") {
    return arch === "x64" ? "penguin-desktop-linux-x86_64.AppImage" : null;
  }
  return null;
}

/** Generic-provider feed base for the OSS mirror's immutable tag directory. */
export function ossFeedUrl(tag: string): string {
  return `${OSS_RELEASE_ROOT}/${tag}/`;
}

/** Generic-provider feed base for the same tag on GitHub Releases. */
export function githubFeedUrl(tag: string): string {
  return `${GITHUB_RELEASE_ROOT}/${tag}/`;
}

export type FeedLabel = "OSS mirror" | "GitHub" | "configured mirror";

export function feedLabel(url: string): FeedLabel {
  try {
    const host = new URL(url).host;
    if (host.endsWith(".aliyuncs.com")) return "OSS mirror";
    if (host === "github.com") return "GitHub";
  } catch {
    // fall through: an unparseable feed keeps the neutral label
  }
  return "configured mirror";
}

/**
 * Resolves the OSS mirror's latest immutable tag, validated exactly like the installers
 * and the download page validate latest.json: schema 1, a safe v-tag, and a
 * releaseBaseUrl that names the expected bucket path (metadata cannot redirect the feed
 * to an arbitrary host).
 */
export async function resolveOssLatestTag(fetchFn: FetchFn): Promise<string | null> {
  let response: ProbeResponse;
  try {
    response = await fetchFn(OSS_LATEST_JSON_URL, {
      headers: {},
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(await response.arrayBuffer()));
    if (typeof body !== "object" || body === null) return null;
    const { schemaVersion, tag, releaseBaseUrl } = body as {
      schemaVersion?: unknown;
      tag?: unknown;
      releaseBaseUrl?: unknown;
    };
    if (schemaVersion !== 1 || typeof tag !== "string") return null;
    if (!/^v[0-9A-Za-z][0-9A-Za-z._-]*$/.test(tag)) return null;
    if (releaseBaseUrl !== `${OSS_RELEASE_ROOT}/${tag}`) return null;
    return tag;
  } catch {
    return null;
  }
}

/**
 * Fetches and strictly validates the release-download-manifest.tsv for the fixed tag
 * (OSS first, then GitHub, each capped by the shared budget). Only the probe rows and the
 * current platform's desktop_asset size are needed — the updater still trusts Electron's
 * latest*.yml feeds for the update itself.
 */
export async function loadReleaseDownloadManifest(opts: {
  fetchFn: FetchFn;
  tag: string;
  assetName: string;
  deadlineMs: number;
}): Promise<ReleaseDownloadManifest | null> {
  const { fetchFn, tag, assetName, deadlineMs } = opts;
  const timeoutMs = remainingTimeout(deadlineMs, SPEED_PROBE_MANIFEST_TIMEOUT_SECONDS);
  if (timeoutMs <= 0) return null;

  let text: string | null = null;
  for (const base of [`${OSS_RELEASE_ROOT}/${tag}`, `${GITHUB_RELEASE_ROOT}/${tag}`]) {
    try {
      const response = await fetchFn(`${base}/release-download-manifest.tsv`, {
        headers: {},
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) text = new TextDecoder().decode(await response.arrayBuffer());
    } catch {
      // try the other source
    }
    if (text !== null) break;
  }
  if (text === null) return null;

  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length < 4) return null;
  if (lines[0] !== `penguin-release-download-manifest\t1\t${tag}`) return null;

  let smallProbe: ReleaseProbe | null = null;
  let largeProbe: ReleaseProbe | null = null;
  let assetSize: number | null = null;
  for (const line of lines.slice(1)) {
    const parts = line.split("\t");
    if (parts[0] === "probe" && parts.length === 5) {
      const probe = parseProbeRow(parts[1]!, parts[2]!, parts[3]!, parts[4]!);
      if (probe === null) return null;
      if (parts[1] === "small") smallProbe = probe;
      if (parts[1] === "large") largeProbe = probe;
    } else if (parts[0] === "desktop_asset" && parts.length === 4 && parts[1] === assetName) {
      const size = parsePositiveSize(parts[2]!);
      if (size === null) return null;
      assetSize = size;
    }
  }
  if (smallProbe === null || largeProbe === null || assetSize === null) return null;
  return { smallProbe, largeProbe, assetSize };
}

function parseProbeRow(
  label: string,
  name: string,
  size: string,
  hash: string,
): ReleaseProbe | null {
  if (label !== "small" && label !== "large") return null;
  if (!/^[A-Za-z0-9._+-]+$/.test(name) || name.includes("..")) return null;
  const parsedSize = parsePositiveSize(size);
  if (parsedSize === null) return null;
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  return { name, size: parsedSize, sha256: hash };
}

function parsePositiveSize(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export interface ProbeResult {
  ok: boolean;
  /** Whole-body throughput in bytes/second; only computed when wantSpeed is set. */
  speedBps?: number;
}

function probeSpeed(result: ProbeResult): number {
  return result.ok && result.speedBps !== undefined ? result.speedBps : 0;
}

export function selectMeasuredSource(githubBps: number, ossBps: number): "github" | "oss" {
  if (githubBps >= SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND) return "github";
  return ossBps > githubBps * SPEED_PROBE_OSS_SWITCH_RATIO ? "oss" : "github";
}

/**
 * Downloads one probe within the shared budget. Success requires a 2xx status, no
 * non-identity content encoding, an exact byte count and a matching sha256 — the same
 * success criteria the installers use.
 */
export async function probeSource(opts: {
  fetchFn: FetchFn;
  base: string;
  probe: ReleaseProbe;
  deadlineMs: number;
  maxTimeoutSeconds: number;
  wantSpeed: boolean;
}): Promise<ProbeResult> {
  const timeoutMs = remainingTimeout(opts.deadlineMs, opts.maxTimeoutSeconds);
  if (timeoutMs <= 0) return { ok: false };
  const startedAt = Date.now();
  try {
    const response = await opts.fetchFn(`${opts.base}/${opts.probe.name}`, {
      headers: { "accept-encoding": "identity" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false };
    const encoding = response.headers.get("content-encoding");
    if (encoding !== null && encoding.toLowerCase() !== "identity") return { ok: false };
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength !== opts.probe.size) return { ok: false };
    if (createHash("sha256").update(body).digest("hex") !== opts.probe.sha256) {
      return { ok: false };
    }
    if (!opts.wantSpeed) return { ok: true };
    const seconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
    return { ok: true, speedBps: Math.floor(body.byteLength / seconds) };
  } catch {
    return { ok: false };
  }
}

function remainingTimeout(deadlineMs: number, maxSeconds: number): number {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) return 0;
  return Math.min(maxSeconds * 1000, remaining);
}

export type FeedDecision =
  /** Keep electron-updater's default GitHub Releases feed (no setFeedURL). */
  | { kind: "keep-github"; reason: string }
  /** Pin generic feeds: primary now, same-tag fallback on a failed check. */
  | { kind: "pinned"; primaryUrl: string; fallbackUrl: string };

export interface SelectAutoUpdateFeedOptions {
  fetchFn: FetchFn;
  platform: NodeJS.Platform;
  arch: string;
  log: (line: string) => void;
  /** Total probe budget as a duration in ms; tests can stretch or exhaust it. */
  budgetMs?: number;
}

/**
 * The auto-mode selection tree. It mirrors the installers' current rule while keeping
 * the desktop's default GitHub feed on inconclusive input.
 */
export async function selectAutoUpdateFeed(
  opts: SelectAutoUpdateFeedOptions,
): Promise<FeedDecision> {
  const { fetchFn, platform, arch, log } = opts;
  const deadlineMs = Date.now() + (opts.budgetMs ?? SPEED_PROBE_TOTAL_TIMEOUT_SECONDS * 1000);

  const inconclusive = (): FeedDecision => {
    log("Download source test was inconclusive; keeping GitHub update feed.");
    return { kind: "keep-github", reason: "inconclusive" };
  };

  const assetName = desktopUpdateAssetName(platform, arch);
  if (assetName === null) return inconclusive();

  const tag = await resolveOssLatestTag(fetchFn);
  if (tag === null) return inconclusive();

  const manifest = await loadReleaseDownloadManifest({ fetchFn, tag, assetName, deadlineMs });
  if (manifest === null) return inconclusive();

  log("Testing OSS mirror and GitHub download sources ...");
  const ossBase = `${OSS_RELEASE_ROOT}/${tag}`;
  const githubBase = `${GITHUB_RELEASE_ROOT}/${tag}`;

  const [ossSmall, githubSmall] = await Promise.all([
    probeSource({
      fetchFn,
      base: ossBase,
      probe: manifest.smallProbe,
      deadlineMs,
      maxTimeoutSeconds: SPEED_PROBE_SMALL_TIMEOUT_SECONDS,
      wantSpeed: false,
    }),
    probeSource({
      fetchFn,
      base: githubBase,
      probe: manifest.smallProbe,
      deadlineMs,
      maxTimeoutSeconds: SPEED_PROBE_SMALL_TIMEOUT_SECONDS,
      wantSpeed: false,
    }),
  ]);

  if (!ossSmall.ok && githubSmall.ok) {
    log("Selected GitHub (OSS mirror probe unavailable).");
    return { kind: "pinned", primaryUrl: githubFeedUrl(tag), fallbackUrl: ossFeedUrl(tag) };
  }
  if (ossSmall.ok && !githubSmall.ok) {
    log("Selected OSS mirror (GitHub probe unavailable).");
    return { kind: "pinned", primaryUrl: ossFeedUrl(tag), fallbackUrl: githubFeedUrl(tag) };
  }
  if (!ossSmall.ok && !githubSmall.ok) return inconclusive();

  const githubLarge = await probeSource({
    fetchFn,
    base: githubBase,
    probe: manifest.largeProbe,
    deadlineMs,
    maxTimeoutSeconds: SPEED_PROBE_LARGE_TIMEOUT_SECONDS,
    wantSpeed: true,
  });
  const githubSpeed = probeSpeed(githubLarge);
  if (githubSpeed >= SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND) {
    log("Selected GitHub (meets minimum download speed).");
    return { kind: "pinned", primaryUrl: githubFeedUrl(tag), fallbackUrl: ossFeedUrl(tag) };
  }

  const ossLarge = await probeSource({
    fetchFn,
    base: ossBase,
    probe: manifest.largeProbe,
    deadlineMs,
    maxTimeoutSeconds: SPEED_PROBE_LARGE_TIMEOUT_SECONDS,
    wantSpeed: true,
  });
  const ossSpeed = probeSpeed(ossLarge);
  if (selectMeasuredSource(githubSpeed, ossSpeed) === "oss") {
    log("Selected OSS mirror (clearly faster than GitHub here).");
    return { kind: "pinned", primaryUrl: ossFeedUrl(tag), fallbackUrl: githubFeedUrl(tag) };
  }
  log("Selected GitHub (the OSS mirror was not enough faster to be worth switching).");
  return { kind: "pinned", primaryUrl: githubFeedUrl(tag), fallbackUrl: ossFeedUrl(tag) };
}
