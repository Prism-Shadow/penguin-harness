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
/** One address's window for a tarball: a slow mirror still finishes a plugin, a dead one costs this. */
export const TARBALL_TIMEOUT_MS = 120_000;
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
  timeoutMs: number;
  maxBytes: number;
  /** The Accept header sent. */
  mediaTypes?: string;
  /** Called as the body arrives: bytes so far, and the total when the answer declared one. */
  onProgress?: (received: number, total: number | null) => void;
}

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/**
 * The body at `url`, whole: refused (AddressError) on a non-2xx answer, a declared or streamed
 * length past `maxBytes`, or the window running out — before the headers or while the body
 * streams, the request is aborted either way.
 */
export async function fetchWithin(url: string, limits: FetchLimits): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  try {
    let res: Response;
    try {
      res = await limits.fetch(url, {
        headers: limits.mediaTypes !== undefined ? { accept: limits.mediaTypes } : {},
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (err) {
      throw new AddressError(
        controller.signal.aborted
          ? `no answer within ${Math.round(limits.timeoutMs / 1000)} s`
          : `unreachable (${err instanceof Error ? err.message : String(err)})`,
      );
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
    try {
      while (reader !== undefined) {
        const { done, value } = await reader.read();
        if (done) break;
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
      throw new AddressError(
        controller.signal.aborted
          ? `did not finish within ${Math.round(limits.timeoutMs / 1000)} s`
          : `broke off (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    const body = new Uint8Array(received);
    let at = 0;
    for (const chunk of chunks) {
      body.set(chunk, at);
      at += chunk.byteLength;
    }
    return body;
  } finally {
    clearTimeout(timer);
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
