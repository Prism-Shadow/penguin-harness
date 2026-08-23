/**
 * Which source the desktop download buttons point at — the browser half of the rule the installers
 * apply (see the matching block in install.sh and install.ps1):
 *
 *   1. Measure GitHub on the release's large probe file. At or above
 *      SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND it wins outright and OSS is never touched.
 *   2. Only below that is OSS measured, and it takes over only when it is more than
 *      SPEED_PROBE_OSS_SWITCH_RATIO of GitHub — a mirror that is merely a little quicker does not
 *      justify its bandwidth bill, and a slow GitHub download still resumes.
 *
 * GitHub is the free source, so every tie and every unmeasurable comparison stays there. The two
 * constants are spelled out in all three places because none of them can import from the others —
 * an installer is a standalone file fetched over the network. Change them in all three at once,
 * which scripts/test-installer.sh pins.
 *
 * Throughput is read from the Resource Timing entry, not from the response body: GitHub's release
 * assets send no `access-control-allow-origin`, so a cross-origin read of them is blocked outright.
 * An opaque `no-cors` request still records a timing entry whose `duration` covers the whole
 * transfer even though the body stays unreadable. Both sources are measured that same way so the
 * two numbers are comparable — the alternative, reading OSS through CORS, would time the JS-side
 * buffering on one side only. GitHub's duration additionally covers the two redirect hops its
 * release URLs take, which can only make it read slower than it is, never faster.
 *
 * Unlike the installers, this runs with someone watching a page, so every wait is bounded twice:
 * each request has its own cap, and PROBE_BUDGET_MS caps the whole sequence. A visitor who cannot
 * reach GitHub at all is the one this matters most for, and they are also the one whose GitHub
 * request will never come back — so the answer has to be reached on a clock, not on completion.
 */

import { GITHUB_LATEST_DOWNLOAD, OSS_LATEST_JSON_URL, OSS_ORIGIN } from "./links";

export const SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND = 262144;

/** How much faster the mirror has to be before its paid bandwidth beats a free GitHub download. */
export const SPEED_PROBE_OSS_SWITCH_RATIO = 1.5;

/**
 * The whole sequence — mirror pointer, manifest, and up to two probes — from its first request.
 * Every phase below clamps to what is left of it, so the buttons cannot stay behind a spinner
 * longer than this no matter which request is the one hanging.
 */
export const PROBE_BUDGET_MS = 9000;

/** Cap for the two small JSON/TSV lookups, which are a round trip and a few hundred bytes. */
const METADATA_TIMEOUT_MS = 2500;

/** A source that has not sent response headers by here is treated as unreachable, not as slow. */
const CONNECT_TIMEOUT_MS = 2500;

/**
 * Cap for a probe's body. The large probe is 1 MiB, which is exactly the minimum's worth of bytes
 * in 4s, so anything still running at this point is already below the minimum and the extra second
 * is only there to absorb GitHub's redirect hops rather than to refine a number.
 */
const TRANSFER_TIMEOUT_MS = 5000;

/** Cap for the small probe, which is only ever asked whether a source answers at all. */
const REACHABILITY_TIMEOUT_MS = 2500;

export type DownloadSource = "github" | "oss";

export interface ReleaseProbe {
  /** Probe file name, identical on both sources. */
  file: string;
  /** Its exact size, the numerator of every measurement — the opaque body cannot be counted. */
  size: number;
}

export interface ReleaseProbes {
  /** 64 KiB: cheap enough to ask "does this source answer" without paying for a megabyte. */
  small: ReleaseProbe;
  /** 1 MiB: long enough that a throughput reading is not swallowed by connection setup. */
  large: ReleaseProbe;
}

/**
 * The shared rule, in one place: GitHub clears the minimum and wins outright, otherwise the mirror
 * has to beat it by the switch ratio to take over.
 */
export function selectDownloadSource(
  githubBytesPerSecond: number,
  ossBytesPerSecond: number,
): DownloadSource {
  if (githubBytesPerSecond >= SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND) return "github";
  return ossBytesPerSecond > githubBytesPerSecond * SPEED_PROBE_OSS_SWITCH_RATIO ? "oss" : "github";
}

/** A shrinking budget shared by every phase, the browser's form of the installers' total timeout. */
export interface ProbeDeadline {
  /** This phase's cap, clamped to what is left; 0 means the budget is spent. */
  slice(capMs: number): number;
}

export function createDeadline(budgetMs: number = PROBE_BUDGET_MS): ProbeDeadline {
  const endsAt = Date.now() + budgetMs;
  return { slice: (capMs) => Math.max(0, Math.min(capMs, endsAt - Date.now())) };
}

const SAFE_ASSET_NAME = /^[A-Za-z0-9._+-]+$/;

function parseProbeRow(fields: string[]): ReleaseProbe | null {
  if (fields.length !== 5) return null;
  const file = fields[2] ?? "";
  const size = Number(fields[3]);
  if (!SAFE_ASSET_NAME.test(file) || file.includes("..")) return null;
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  return { file, size };
}

/**
 * The probe rows of a release's download manifest, validated the way the installers validate them:
 * the header has to name this exact tag, and a file name has to be a plain asset name so a tampered
 * manifest cannot point a request at another path.
 */
export function parseProbes(manifest: string, tag: string): ReleaseProbes | null {
  const lines = manifest.split("\n");
  if (lines[0] !== `penguin-release-download-manifest\t1\t${tag}`) return null;
  let small: ReleaseProbe | null = null;
  let large: ReleaseProbe | null = null;
  for (const line of lines.slice(1)) {
    const fields = line.split("\t");
    if (fields[0] !== "probe") continue;
    const probe = parseProbeRow(fields);
    if (!probe) return null;
    if (fields[1] === "small") small = probe;
    if (fields[1] === "large") large = probe;
  }
  return small && large ? { small, large } : null;
}

/**
 * A fresh query string per request: a cached hit would time the disk rather than the network, and
 * it keeps every measurement on a resource timing entry name of its own.
 */
function probeUrl(base: string, file: string): string {
  return `${base}/${file}?probe=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The entry's duration in ms, or null when none is recorded before the deadline. */
function awaitResourceTiming(url: string, timeoutMs: number): Promise<number | null> {
  if (typeof PerformanceObserver === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let observer: PerformanceObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (durationMs: number | null) => {
      if (timer !== null) clearTimeout(timer);
      observer?.disconnect();
      observer = null;
      resolve(durationMs);
    };
    observer = new PerformanceObserver((list) => {
      const entry = list.getEntries().find((candidate) => candidate.name === url);
      if (entry) finish(entry.duration);
    });
    timer = setTimeout(() => finish(null), timeoutMs);
    try {
      observer.observe({ type: "resource" });
    } catch {
      finish(null);
    }
  });
}

/**
 * Starts an opaque request and resolves once its headers land, or null if they do not land inside
 * `connectMs`. The returned `settled` promise is the transfer itself; the caller decides how long
 * to wait for the body and keeps `abort` armed until then, so a stalled body is cut off rather than
 * measured. Opaque is the only option for GitHub, whose release assets refuse cross-origin reads.
 */
function startProbeRequest(
  url: string,
  connectMs: number,
): { reachable: Promise<boolean>; abort: () => void } {
  const controller = new AbortController();
  if (connectMs <= 0) {
    controller.abort();
    return { reachable: Promise.resolve(false), abort: () => controller.abort() };
  }
  const headers = fetch(url, {
    mode: "no-cors",
    cache: "no-store",
    signal: controller.signal,
  }).then(
    () => true,
    () => false,
  );
  const reachable = Promise.race([headers, delay(connectMs).then(() => false)]).then((ok) => {
    if (!ok) controller.abort();
    return ok;
  });
  return { reachable, abort: () => controller.abort() };
}

/** Whether a source answers at all, asked with the cheap 64 KiB probe. */
export async function probeReachable(url: string, deadline: ProbeDeadline): Promise<boolean> {
  const { reachable, abort } = startProbeRequest(url, deadline.slice(REACHABILITY_TIMEOUT_MS));
  const ok = await reachable;
  abort();
  return ok;
}

/** Bytes per second for one probe download; 0 when it did not complete inside its caps. */
export async function measureBytesPerSecond(
  url: string,
  sizeBytes: number,
  deadline: ProbeDeadline,
): Promise<number> {
  const connectMs = deadline.slice(CONNECT_TIMEOUT_MS);
  const { reachable, abort } = startProbeRequest(url, connectMs);
  try {
    if (!(await reachable)) return 0;
    const transferMs = deadline.slice(TRANSFER_TIMEOUT_MS);
    if (transferMs <= 0) return 0;
    const durationMs = await awaitResourceTiming(url, transferMs);
    if (durationMs === null || durationMs <= 0) return 0;
    return Math.round((sizeBytes * 1000) / durationMs);
  } catch {
    return 0;
  } finally {
    abort();
  }
}

export interface ProbeSources {
  githubBase: string;
  ossBase: string;
}

/**
 * Applies the rule to one release. OSS is measured only once GitHub has failed the minimum: above
 * it GitHub has already won, and the mirror's bandwidth is not spent on a probe that could not
 * change the answer. The two run one after the other on purpose — concurrent transfers share the
 * link and would each read as half as fast, which an absolute threshold cannot tolerate.
 *
 * When GitHub produced no measurement at all — blocked, or too slow to finish a megabyte inside its
 * cap — the rule reduces to whether the mirror answers, since anything above zero beats zero. That
 * question is asked with the 64 KiB probe rather than a second megabyte: same answer, a fraction of
 * the wait, and it is the case where someone is most likely to be watching a spinner.
 */
export async function probeDownloadSource(
  sources: ProbeSources,
  probes: ReleaseProbes,
  deadline: ProbeDeadline,
): Promise<DownloadSource> {
  const github = await measureBytesPerSecond(
    probeUrl(sources.githubBase, probes.large.file),
    probes.large.size,
    deadline,
  );
  if (github >= SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND) return "github";
  if (github === 0) {
    return (await probeReachable(probeUrl(sources.ossBase, probes.small.file), deadline))
      ? "oss"
      : "github";
  }
  const oss = await measureBytesPerSecond(
    probeUrl(sources.ossBase, probes.large.file),
    probes.large.size,
    deadline,
  );
  return selectDownloadSource(github, oss);
}

/** Reads a small JSON/TSV lookup under the shared budget; null on any failure. */
async function fetchMetadata(url: string, deadline: ProbeDeadline): Promise<Response | null> {
  const timeoutMs = deadline.slice(METADATA_TIMEOUT_MS);
  if (timeoutMs <= 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The release's probe rows, read from the mirror — the one origin of the two that answers a
 * cross-origin read at all, and the same file the installers parse.
 */
export async function fetchProbes(
  ossBase: string,
  tag: string,
  deadline: ProbeDeadline,
): Promise<ReleaseProbes | null> {
  const res = await fetchMetadata(`${ossBase}/release-download-manifest.tsv`, deadline);
  return res ? parseProbes(await res.text(), tag) : null;
}

/** Reads the mirror pointer under the shared budget. */
export async function fetchMirrorPointer(
  url: string,
  deadline: ProbeDeadline,
): Promise<unknown | null> {
  const res = await fetchMetadata(url, deadline);
  return res ? await res.json() : null;
}

/** Data Saver is a request not to spend a megabyte on measuring; the unprobed default stands. */
export function probingAllowed(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData !== true;
}

/** The OSS mirror the buttons would use: an immutable per-tag directory in the release bucket. */
export interface Mirror {
  tag: string;
  base: string;
}

/** What the probe settled on, plus the mirror it would use. Never partially applied. */
export interface Resolution {
  source: DownloadSource;
  mirror: Mirror | null;
}

const RELEASE_TAG = /^v[0-9A-Za-z][0-9A-Za-z._-]*$/;

/**
 * The only shape a mirror is ever allowed to take: a safe release tag, and the exact bucket path
 * that tag implies. Every way a mirror can enter the page goes through here — the live pointer and
 * the session cache alike — so neither metadata nor stored state can aim a download at some other
 * host. Keep it that way: a second definition is a second thing to get wrong.
 */
export function toMirror(tag: unknown, base: unknown): Mirror | null {
  if (typeof tag !== "string" || !RELEASE_TAG.test(tag)) return null;
  if (base !== `${OSS_ORIGIN}/releases/${tag}`) return null;
  return { tag, base };
}

/** latest.json validated like the installer forwarders validate it: schema 1, then the shape above. */
export function parseMirror(value: unknown): Mirror | null {
  if (typeof value !== "object" || value === null) return null;
  const manifest = value as { schemaVersion?: unknown; tag?: unknown; releaseBaseUrl?: unknown };
  if (manifest.schemaVersion !== 1) return null;
  return toMirror(manifest.tag, manifest.releaseBaseUrl);
}

/**
 * The result survives the rest of the browser session, so coming back to the page — or bouncing off
 * it to a release page and returning — spends neither another megabyte nor another spinner. It is
 * per-tab and short-lived on purpose: network conditions change, and a stale answer is only ever one
 * reload away from being re-measured. What comes back out is validated exactly like a live pointer,
 * so a tampered entry cannot aim a download anywhere the live lookup could not.
 */
const CACHE_KEY = "penguin.downloadSource.v1";

export function readCachedResolution(): Resolution | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { source, mirror } = parsed as { source?: unknown; mirror?: unknown };
    if (source !== "github" && source !== "oss") return null;
    if (mirror === null) return { source, mirror: null };
    if (typeof mirror !== "object") return null;
    const { tag, base } = mirror as { tag?: unknown; base?: unknown };
    const validated = toMirror(tag, base);
    return validated ? { source, mirror: validated } : null;
  } catch {
    // Private mode, blocked site data and a corrupt entry all land here; the page measures again.
    return null;
  }
}

export function cacheResolution(resolution: Resolution): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(resolution));
  } catch {
    // Storage being unavailable costs a re-measure next visit, nothing more.
  }
}

/**
 * Resolves the mirror pointer, then measures. Every failure lands on GitHub, the free source that
 * always has a valid version-less URL, so no path here can leave the page without a download.
 */
export async function resolveDownloadSource(): Promise<Resolution> {
  const deadline = createDeadline();
  const mirror = parseMirror(await fetchMirrorPointer(OSS_LATEST_JSON_URL, deadline));
  if (!mirror) return { source: "github", mirror: null };
  if (!probingAllowed()) return { source: "github", mirror };
  const probes = await fetchProbes(mirror.base, mirror.tag, deadline);
  if (!probes) return { source: "github", mirror };
  const source = await probeDownloadSource(
    { githubBase: GITHUB_LATEST_DOWNLOAD, ossBase: mirror.base },
    probes,
    deadline,
  );
  return { source, mirror };
}
