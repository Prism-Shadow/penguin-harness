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
 */

export const SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND = 262144;

/** How much faster the mirror has to be before its paid bandwidth beats a free GitHub download. */
export const SPEED_PROBE_OSS_SWITCH_RATIO = 1.5;

/** The installers' large-probe cap: a source that cannot deliver the probe in this long loses. */
export const SPEED_PROBE_TIMEOUT_MS = 8000;

export type DownloadSource = "github" | "oss";

export interface ReleaseProbe {
  /** Probe file name, identical on both sources. */
  file: string;
  /** Its exact size, the numerator of every measurement — the opaque body cannot be counted. */
  size: number;
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

const SAFE_ASSET_NAME = /^[A-Za-z0-9._+-]+$/;

/**
 * The large probe row of a release's download manifest, validated the way the installers validate
 * it: the header has to name this exact tag, and the file name has to be a plain asset name so a
 * tampered manifest cannot point the probe at another path.
 */
export function parseLargeProbe(manifest: string, tag: string): ReleaseProbe | null {
  const lines = manifest.split("\n");
  if (lines[0] !== `penguin-release-download-manifest\t1\t${tag}`) return null;
  for (const line of lines.slice(1)) {
    const fields = line.split("\t");
    if (fields[0] !== "probe" || fields[1] !== "large") continue;
    if (fields.length !== 5) return null;
    const file = fields[2] ?? "";
    const size = Number(fields[3]);
    if (!SAFE_ASSET_NAME.test(file) || file.includes("..")) return null;
    if (!Number.isSafeInteger(size) || size <= 0) return null;
    return { file, size };
  }
  return null;
}

/**
 * A fresh query string per probe: a cached hit would time the disk rather than the network, and it
 * keeps every measurement on a resource timing entry name of its own.
 */
function probeUrl(base: string, file: string): string {
  return `${base}/${file}?probe=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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

/** Bytes per second for one probe download; 0 when it did not complete inside the deadline. */
export async function measureBytesPerSecond(
  url: string,
  sizeBytes: number,
  timeoutMs: number = SPEED_PROBE_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<number> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  if (signal?.aborted) controller.abort();
  const timing = awaitResourceTiming(url, timeoutMs);
  try {
    // An opaque fetch settles once the headers land, not once the body does. The timing entry is
    // what waits for the transfer to finish; the abort above is what bounds it, and stays armed
    // until then so a stalled body is cut off rather than measured.
    await fetch(url, { mode: "no-cors", cache: "no-store", signal: controller.signal });
    const durationMs = await timing;
    if (controller.signal.aborted || durationMs === null || durationMs <= 0) return 0;
    return Math.round((sizeBytes * 1000) / durationMs);
  } catch {
    return 0;
  } finally {
    clearTimeout(deadline);
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
 */
export async function probeDownloadSource(
  sources: ProbeSources,
  probe: ReleaseProbe,
  signal?: AbortSignal,
): Promise<DownloadSource> {
  const measure = (base: string) =>
    measureBytesPerSecond(probeUrl(base, probe.file), probe.size, SPEED_PROBE_TIMEOUT_MS, signal);
  const github = await measure(sources.githubBase);
  if (github >= SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND) return "github";
  return selectDownloadSource(github, await measure(sources.ossBase));
}

/**
 * The release's large probe row, read from the mirror — the one origin of the two that answers a
 * cross-origin read at all, and the same file the installers parse.
 */
export async function fetchLargeProbe(
  ossBase: string,
  tag: string,
  signal?: AbortSignal,
): Promise<ReleaseProbe | null> {
  try {
    const res = await fetch(`${ossBase}/release-download-manifest.tsv`, {
      signal,
      cache: "no-store",
    });
    return res.ok ? parseLargeProbe(await res.text(), tag) : null;
  } catch {
    return null;
  }
}

/** Data Saver is a request not to spend a megabyte on measuring; the unprobed default stands. */
export function probingAllowed(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData !== true;
}
