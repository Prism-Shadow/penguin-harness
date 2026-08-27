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
 * Two passes, because the two questions have incompatible clocks.
 *
 * Whether a source answers at all is a round trip, and it is the question that decides whether
 * someone is handed a link that never starts — so it gates the buttons and gets one second.
 *
 * How fast a source is cannot be answered in one second at any probe size. The minimum is
 * 256 KB/s and the large probe is 1 MiB, so the boundary case *is* a four-second transfer, on top
 * of roughly half a second of DNS, TLS and GitHub's two redirect hops; shrink the probe and that
 * fixed half-second swamps the reading instead. So throughput runs afterwards, gates nothing, and
 * silently upgrades the links if the mirror turns out to be worth switching to. The worst it can
 * cost is a download that was slower than necessary — never one that does not start.
 */
/**
 * Three clocks, because the gate and the mirror pointer must not share one. The gate hinges on
 * GitHub — a GitHub that answers keeps the download whatever the mirror is doing — so GitHub gets
 * its own window, and the gate as a whole is capped at roughly a second.
 *
 * That one second is a target, not a guarantee, and the caps are set accordingly. A cap only ever
 * bites a source that is slow or silent: a healthy GitHub answers in a few hundred milliseconds and
 * never notices it. So the cost of a generous cap falls entirely on the blocked case, which is
 * already waiting, while the cost of a tight one falls on a distant-but-working GitHub that gets
 * written off and has its download handed to the mirror we pay for. Prefer the generous side.
 *
 * The pointer's clock is longer than the gate's on purpose. It used to share the gate's, which
 * meant a pointer that arrived late was discarded, and a visitor who could not reach GitHub was
 * left on GitHub links with no mirror to switch to for the rest of the visit. It now outlives the
 * gate: the gate takes it only if it is there in time, and a late arrival still reaches the page,
 * where it enables the manual switch and lets the throughput pass correct the answer.
 */
export const GITHUB_REACHABILITY_MS = 800;
export const GATE_BUDGET_MS = 1000;
export const MIRROR_POINTER_MS = 2500;
export const THROUGHPUT_BUDGET_MS = 9000;

/** Cap for the two small JSON/TSV lookups, which are a round trip and a few hundred bytes. */
const METADATA_TIMEOUT_MS = 2500;

/** A source that has not sent response headers by here is treated as unreachable, not as slow. */
const CONNECT_TIMEOUT_MS = 2500;

/**
 * The file the reachability pass asks GitHub for. Which file hardly matters — a 404 answers the
 * question as well as a 200 does, and an opaque response cannot tell them apart anyway — so a
 * version-less URL that needs no manifest and no tag is exactly right here.
 */
const GITHUB_REACHABILITY_PROBE = "probe-64k.bin";

/**
 * Cap for a probe's body. The large probe is 1 MiB, which is exactly the minimum's worth of bytes
 * in 4s, so anything still running at this point is already below the minimum and the extra second
 * is only there to absorb GitHub's redirect hops rather than to refine a number.
 *
 * The installers allow 8s here, and that difference is deliberate. A source slower than 1 MiB per
 * cap reads as unmeasured rather than as a number, so this cap sets the floor under which the
 * tie-break rule stops seeing a speed at all: ~210 KB/s here against ~131 KB/s there. Between those
 * two figures a slow GitHub the installers would have kept goes to the mirror instead — a bandwidth
 * cost on a connection that is slow whichever source it uses, traded for a page that answers in
 * seconds. Widening it to match would put the worst case past PROBE_BUDGET_MS, with someone sitting
 * in front of it.
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

export function createDeadline(budgetMs: number): ProbeDeadline {
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

/**
 * What one probe learned about a source. The two fields answer two different questions, and the
 * installers keep them apart too: their small-probe pair settles reachability before any throughput
 * probe runs. A source that never answered loses to one that did, full stop; a source that answered
 * but could not finish the probe is merely unmeasured, and the rule's tie-break decides it.
 */
export interface Measurement {
  /** Response headers landed inside the connect cap. */
  reachable: boolean;
  /** Throughput, or 0 when the transfer did not finish inside the transfer cap. */
  bytesPerSecond: number;
}

const UNREACHABLE: Measurement = { reachable: false, bytesPerSecond: 0 };

/** Measures one probe download under both caps. */
export async function measureSource(
  url: string,
  sizeBytes: number,
  deadline: ProbeDeadline,
): Promise<Measurement> {
  const { reachable, abort } = startProbeRequest(url, deadline.slice(CONNECT_TIMEOUT_MS));
  try {
    if (!(await reachable)) return UNREACHABLE;
    const transferMs = deadline.slice(TRANSFER_TIMEOUT_MS);
    if (transferMs <= 0) return { reachable: true, bytesPerSecond: 0 };
    const durationMs = await awaitResourceTiming(url, transferMs);
    const measured = durationMs !== null && durationMs > 0;
    return {
      reachable: true,
      bytesPerSecond: measured ? Math.round((sizeBytes * 1000) / durationMs) : 0,
    };
  } catch {
    return UNREACHABLE;
  } finally {
    abort();
  }
}

export interface ProbeSources {
  githubBase: string;
  ossBase: string;
}

/** The one question the throughput pass asks of a source, injected so the branches are testable. */
export interface SourceProbes {
  measure(base: string, probe: ReleaseProbe): Promise<Measurement>;
}

/** Measurements retained for the download page's visual source report. */
export interface DownloadProbeReport {
  source: DownloadSource;
  github: Measurement;
  /** Null when GitHub already cleared the threshold, so probing paid mirror traffic was unnecessary. */
  oss: Measurement | null;
}

/**
 * The throughput half of the rule, in the order the installers apply it. It runs once the
 * reachability pass has found a mirror, which is why an unreachable GitHub here needs no second
 * question: that pass already proved the mirror replies, so it wins by default.
 *
 * GitHub is measured first. At or above the minimum it wins outright and the mirror is never
 * touched — no paid bandwidth spent on a probe that could not change the answer. Below it, the
 * mirror is measured on the same probe and has to win by the switch ratio.
 *
 * The measurements run one after another on purpose: concurrent transfers share the link and would
 * each read as half as fast, which an absolute threshold cannot tolerate.
 */
export async function decideDownloadSourceWithReport(
  sources: ProbeSources,
  probes: ReleaseProbes,
  io: SourceProbes,
): Promise<DownloadProbeReport> {
  const github = await io.measure(sources.githubBase, probes.large);
  if (github.bytesPerSecond >= SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND) {
    return { source: "github", github, oss: null };
  }
  if (!github.reachable) {
    return { source: "oss", github, oss: null };
  }
  const oss = await io.measure(sources.ossBase, probes.large);
  return {
    source: selectDownloadSource(github.bytesPerSecond, oss.bytesPerSecond),
    github,
    oss,
  };
}

/** Source-only compatibility wrapper used by the installer-rule tests and other callers. */
export async function decideDownloadSource(
  sources: ProbeSources,
  probes: ReleaseProbes,
  io: SourceProbes,
): Promise<DownloadSource> {
  return (await decideDownloadSourceWithReport(sources, probes, io)).source;
}

/** The decision above, wired to real requests under the shared budget. */
export function probeDownloadSource(
  sources: ProbeSources,
  probes: ReleaseProbes,
  deadline: ProbeDeadline,
): Promise<DownloadSource> {
  return decideDownloadSource(sources, probes, {
    measure: (base, probe) => measureSource(probeUrl(base, probe.file), probe.size, deadline),
  });
}

/** The same real probe, retaining both measurements for the download page. */
export function probeDownloadSourceWithReport(
  sources: ProbeSources,
  probes: ReleaseProbes,
  deadline: ProbeDeadline,
): Promise<DownloadProbeReport> {
  return decideDownloadSourceWithReport(sources, probes, {
    measure: (base, probe) => measureSource(probeUrl(base, probe.file), probe.size, deadline),
  });
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

/** Resolves and validates the mirror pointer; null when it does not arrive in time or is invalid. */
export function fetchMirror(deadline: ProbeDeadline): Promise<Mirror | null> {
  return fetchMirrorPointer(OSS_LATEST_JSON_URL, deadline).then(parseMirror);
}

/**
 * The gating pass, and the only thing the buttons wait on. It asks one question — does GitHub
 * answer — because that is the question whose wrong answer hands someone a link that never starts,
 * and it is answerable in a round trip.
 *
 * GitHub is the free source and keeps the download whenever it answers, so that path does not wait
 * for the mirror at all; the pointer is only needed to offer the mirror, and it is passed in as a
 * promise so it can still be in flight. Only when GitHub stays silent does the answer depend on
 * having a mirror to hand the download to.
 */
export async function gateDownloadSource(
  mirror: Promise<Mirror | null>,
  deadline: ProbeDeadline,
): Promise<DownloadSource> {
  const githubReachable = await probeReachable(
    `${GITHUB_LATEST_DOWNLOAD}/${GITHUB_REACHABILITY_PROBE}`,
    createDeadline(GITHUB_REACHABILITY_MS),
  );
  if (githubReachable) return "github";
  // GitHub stayed silent, so the answer now needs a mirror — but only for as long as the gate has
  // left. A pointer that misses this race is not lost; it reaches the page on its own clock.
  const remainingMs = deadline.slice(GATE_BUDGET_MS);
  const resolved =
    remainingMs > 0 ? await Promise.race([mirror, delay(remainingMs).then(() => null)]) : null;
  return resolved ? "oss" : "github";
}

/**
 * Whether measuring throughput could still change the gate's answer — which is whenever there is a
 * mirror to compare against. It runs even when GitHub missed its window: that window is under a
 * second, and a distant-but-working GitHub can spend that long on DNS, TLS and two redirect hops
 * alone. The throughput pass gives it a far more generous one and hands the download back if it was
 * wrongly written off.
 */
export function worthRefining(mirror: Mirror | null): boolean {
  return mirror !== null && probingAllowed();
}

/**
 * The unhurried pass. It gates nothing, so it can afford the manifest lookup and a megabyte of
 * probe; its result replaces the gate's answer when it lands.
 */
export async function refineDownloadSource(
  mirror: Mirror,
  deadline: ProbeDeadline,
): Promise<DownloadSource> {
  return (await refineDownloadSourceWithReport(mirror, deadline))?.source ?? "github";
}

/** Refines the source and returns the measurements the download page renders. */
export async function refineDownloadSourceWithReport(
  mirror: Mirror,
  deadline: ProbeDeadline,
): Promise<DownloadProbeReport | null> {
  const probes = await fetchProbes(mirror.base, mirror.tag, deadline);
  if (!probes) return null;
  return probeDownloadSourceWithReport(
    { githubBase: GITHUB_LATEST_DOWNLOAD, ossBase: mirror.base },
    probes,
    deadline,
  );
}
