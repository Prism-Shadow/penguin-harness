/**
 * The downloads an install made without npm makes (direct-install.ts): a package's registry
 * document, and the tarball or release asset its version names — each over an ordered list of
 * addresses (the canonical URL, then the CDN mirrors the Plugin mirrors setting rewrites it
 * into), each address with its own window and every answer under a size cap.
 *
 * One address at a time, in order. An address that cannot be reached, times out, answers a
 * server error or passes the cap hands the walk to the next one; so does one whose bytes the
 * caller refuses (a tarball that does not match its pinned sha512 — `take`). An answer that
 * settles the question stops the walk: for a document, a 404 means the registry does not have
 * the package (a mirror copies the registry, it is not asked again), and a 401 or 403 means it
 * refuses to say. All addresses failed: the error names each one and why.
 *
 * Fetches go through the global fetch unless a caller hands one in, so the server's outbound
 * proxy setting (net/proxy.ts sets the global dispatcher) applies to them as to every other.
 */

/** Long enough for a registry document over a slow link; short enough that a dead address is not a hang. */
export const DOCUMENT_TIMEOUT_MS = 30_000;
/** Far past any plugin's document; the abbreviated form is kilobytes. */
export const DOCUMENT_MAX_BYTES = 32 * 1024 * 1024;
/**
 * How long a package's download may go without a byte before it counts as stalled: the
 * address is cut and the next one tried. A download that keeps moving has no ceiling at all
 * — a slow link is slow, not dead — so the big assets this server fetches itself are bounded
 * by movement, not by a clock (see FetchLimits.stallMs).
 */
export const TARBALL_STALL_MS = 30_000;
/** Far past any plugin's tarball. */
export const TARBALL_MAX_BYTES = 64 * 1024 * 1024;

/** One address's answer that is not bytes: its HTTP status when it answered, and why. */
export class AddressError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export interface FetchLimits {
  fetch: typeof fetch;
  /**
   * The absolute window, whole answer included: set for the small registry documents, where
   * a dead address costs one window rather than a hang. A package's bytes are fetched with
   * `stallMs` instead — a slow download is legal, silence is not.
   */
  timeoutMs: number;
  /**
   * When set, the window is not a clock but movement: the answer is cut only after it has
   * gone this long without a byte (before the headers count too), and a download that keeps
   * moving may take as long as it takes. Leaves `timeoutMs` unused.
   */
  stallMs?: number;
  maxBytes: number;
  /** The Accept header sent. */
  mediaTypes?: string;
  /** Called as the body arrives: bytes so far, and the total when the answer declared one. */
  onProgress?: (received: number, total: number | null) => void;
}

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** As many hops as a release asset takes (GitHub's goes through one), and then some. */
const MAX_REDIRECTS = 10;

/** The hosts plain http is allowed to: this machine's own loopback. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Whether an address may be fetched for a package's bytes: https anywhere, or http on this
 * machine's loopback (a registry or an index on the machine itself) — parsed, not prefix-
 * matched, and never with credentials in it. The sha512 the bytes are checked against is what
 * guards them; this keeps the fetch itself off plain http across a network. The same rule as
 * a published index's channel (registry.ts `indexChannelOf`).
 */
export function fetchableAddress(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * The body at `url`, whole: refused (AddressError) on a non-2xx answer, a declared or streamed
 * length past `maxBytes`, or the window running out — before the headers or while the body
 * streams, the request is aborted either way.
 */
export async function fetchWithin(url: string, limits: FetchLimits): Promise<Uint8Array> {
  const controller = new AbortController();
  // The window: an absolute clock when only `timeoutMs` is set (the registry documents), a
  // movement check when `stallMs` is — every byte and the headers themselves count as
  // movement, and a fetch that goes the window without one is cut, its abort carrying the
  // AddressError the catches below hand on.
  const stallMs = limits.stallMs;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const armWatchdog = () => {
    if (watchdog !== undefined) clearTimeout(watchdog);
    if (stallMs === undefined) {
      watchdog = setTimeout(() => {
        controller.abort();
        void activeReader?.cancel().catch(() => undefined);
      }, limits.timeoutMs);
    } else {
      watchdog = setTimeout(() => {
        const cut = new AddressError(
          `went ${Math.round(stallMs / 1000)} s without a byte and was cut`,
        );
        controller.abort(cut);
        void activeReader?.cancel(cut).catch(() => undefined);
      }, stallMs);
    }
  };
  const touch = () => {
    if (stallMs !== undefined) armWatchdog();
  };
  armWatchdog();
  try {
    let res: Response;
    // Redirects are followed by hand, each hop held to the same rule as the address itself:
    // https, or http on this machine's loopback, and never from https down to http.
    let at = url;
    for (let hop = 0; ; hop += 1) {
      if (!fetchableAddress(at)) {
        throw new AddressError(
          hop === 0
            ? "is not an https address"
            : `redirects to ${at}, which is not an https address`,
        );
      }
      try {
        res = await limits.fetch(at, {
          headers: limits.mediaTypes !== undefined ? { accept: limits.mediaTypes } : {},
          redirect: "manual",
          signal: controller.signal,
        });
        touch();
      } catch (err) {
        const cut = controller.signal.reason;
        if (cut instanceof AddressError) throw cut;
        throw new AddressError(
          controller.signal.aborted
            ? `no answer within ${Math.round(limits.timeoutMs / 1000)} s`
            : `unreachable (${err instanceof Error ? err.message : String(err)})`,
        );
      }
      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || location === null) break;
      await res.body?.cancel().catch(() => undefined);
      if (hop >= MAX_REDIRECTS)
        throw new AddressError(`redirects more than ${MAX_REDIRECTS} times`);
      const next = new URL(location, at).href;
      if (at.startsWith("https:") && !next.startsWith("https:")) {
        throw new AddressError(`redirects from https down to ${next}`);
      }
      at = next;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new AddressError(`answered ${res.status}`, res.status);
    }
    const declared = Number(res.headers.get("content-length"));
    const total = Number.isFinite(declared) && declared > 0 ? declared : null;
    if (total !== null && total > limits.maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new AddressError(`is ${megabytes(total)}, past the ${megabytes(limits.maxBytes)} cap`);
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = res.body?.getReader();
    activeReader = reader ?? null;
    try {
      while (reader !== undefined) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) {
          const cut = controller.signal.reason;
          if (cut instanceof AddressError) throw cut;
          throw new AddressError(`did not finish within ${Math.round(limits.timeoutMs / 1000)} s`);
        }
        if (done) break;
        touch();
        received += value.byteLength;
        if (received > limits.maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new AddressError(`runs past the ${megabytes(limits.maxBytes)} cap`);
        }
        chunks.push(value);
        limits.onProgress?.(received, total);
      }
    } catch (err) {
      if (err instanceof AddressError) throw err;
      const cut = controller.signal.reason;
      if (cut instanceof AddressError) throw cut;
      throw new AddressError(
        controller.signal.aborted
          ? `did not finish within ${Math.round(limits.timeoutMs / 1000)} s`
          : `broke off (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    const body = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  } finally {
    if (watchdog !== undefined) clearTimeout(watchdog);
  }
}

/** Why the walk stopped short of bytes: every address's failure, or the one answer that settles it. */
export class WalkError extends Error {
  constructor(
    message: string,
    /** The settling answer's status (a 404 document), when one stopped the walk. */
    readonly settled: number | null,
  ) {
    super(message);
  }
}

/**
 * The first address whose bytes `take` takes (it throws an AddressError to refuse them), in
 * order. A status in `settles` stops the walk with that status. Every address failed: a
 * WalkError naming each and why.
 */
export async function fetchFirst<T>(
  addresses: readonly string[],
  limits: FetchLimits,
  {
    take,
    settles = [],
  }: { take: (bytes: Uint8Array, address: string) => T; settles?: readonly number[] },
): Promise<T> {
  const failures: string[] = [];
  for (const address of addresses) {
    try {
      return take(await fetchWithin(address, limits), address);
    } catch (err) {
      if (!(err instanceof AddressError)) throw err;
      if (err.status !== null && settles.includes(err.status)) {
        throw new WalkError(`${address} ${err.message}`, err.status);
      }
      failures.push(`${address} ${err.message}`);
    }
  }
  throw new WalkError(failures.join("; "), null);
}
