/**
 * The HMR layer's entry: the operations that are FROZEN.
 *
 * Everything that decides how a generation becomes current lives here and in host.ts —
 * how the first one boots, how a push is applied and what happens when its boot fails, when
 * a request may be handed to a generation, and what the layer must refresh once a new one
 * is current. The product hands in three things and drives nothing itself:
 *
 * - `host`: the store and the swap (HmrHost), built over the product's packaged bundle;
 * - `replace`: what the product does with a generation once it is current — point its
 *   handles at it, refresh what it derives from a version. Called for the first boot and
 *   after every push: the pushed generation when it lands, the previous one re-booted
 *   when it does not;
 * - `start`: the product's boot — publish what a generation claims, then the first `ensure`.
 *
 * `start` receives the control object before it runs, so the product's routes and seam can
 * be built over it while the first generation is still coming up.
 */
import { Readable, pipeline } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import zlib from "node:zlib";
import type { Instance, Park } from "@prismshadow/penguin-core/kernel";
import type {
  BlobLease,
  BlobRef,
  BlobWriter,
  HmrHost,
  UpgradeAllTarget,
  UpgradeOutcome,
} from "./host.js";
import { isBlobName } from "./host.js";

/** Where a push arrives. The product declares and contributes the route like any other; the protocol behind it is this file's. */
export const HMR_ROUTE_PREFIX = "/api/hmr";
export const HMR_UPGRADE_PATH = `${HMR_ROUTE_PREFIX}/upgrade`;
/** Names the blobs a pusher holds; answers which of them this store lacks, so the push carries only those. */
export const HMR_PROBE_PATH = `${HMR_ROUTE_PREFIX}/assets/probe`;
/** `PUT ${HMR_BLOBS_PATH}/<sha256>` with the raw bytes: one blob into the store, hashed as it lands. */
export const HMR_BLOBS_PATH = `${HMR_ROUTE_PREFIX}/blobs`;

/** What the product does with a generation once it is current. */
export type Replace<Api extends Park> = (instance: Instance<Api>) => void;

/** The frozen operations, as the product sees them. */
export interface Hmr<Api extends Park> {
  /**
   * The generation requests go to. Waits out an in-flight swap FIRST: the kernel disposes the
   * old tree before the new one has booted, and for that window the host still answers with
   * the old instance — a caller that did not wait would be handed a disposed tree. Throws
   * when no generation can boot at all; the product's own routes are the fallback then, and
   * the upgrade channel stays reachable to push a working one.
   */
  current(): Promise<Instance<Api>>;
  /**
   * THE upgrade, serialized: store the bundles, boot the new generation, swap, commit the
   * version — or put the previous generation back and report why. `replace` runs once the
   * new one is current.
   */
  upgrade(target: UpgradeAllTarget): Promise<UpgradeOutcome>;
  /**
   * The channel's endpoints, framework-free: a Request in, a Response out — what the routes
   * the product declares under HMR_ROUTE_PREFIX answer with. HMR_PROBE_PATH names blobs and
   * answers which ones the store lacks; HMR_BLOBS_PATH takes one blob, raw; HMR_UPGRADE_PATH
   * is the push, each part of it inline or `{ sha }` resolved from the store. Any
   * generation may serve the routes by handing the request here, which is how one without a
   * platform of its own still carries the channel.
   */
  endpoint(
    request: Request,
    onLanded?: (outcome: Extract<UpgradeOutcome, { status: "ok" }>) => void,
  ): Promise<Response>;
}

/** The control object alone, for a product that boots its first generation some other way (tests). */
export function hmrControl<Api extends Park>(host: HmrHost<Api>, replace: Replace<Api>): Hmr<Api> {
  const hmr: Hmr<Api> = {
    endpoint: (request, onLanded) => {
      const { pathname } = new URL(request.url);
      if (pathname === HMR_PROBE_PATH) return probeEndpoint(host, request);
      if (pathname.startsWith(`${HMR_BLOBS_PATH}/`)) return blobEndpoint(host, request);
      return upgradeEndpoint(hmr, request, onLanded, host);
    },
    current: async () => {
      await host.waitIdle();
      return host.ensure();
    },
    upgrade: async (target) => {
      const outcome = await host.upgradeAll(target, admitsUpgradeRoute);
      // Whatever is current now is a NEW instance — the pushed generation, or the previous
      // one re-booted after the pushed one failed — and the product is told either way. A
      // double fault leaves nothing current: ensure() throws, and the product keeps its last.
      try {
        replace(await host.ensure());
      } catch {
        // No generation is current; the upgrade channel stays reachable to push a good one.
      }
      return outcome;
    },
  };
  return hmr;
}

export async function hmrMain<Api extends Park>(
  host: HmrHost<Api>,
  replace: Replace<Api>,
  start: (hmr: Hmr<Api>) => Promise<void>,
): Promise<Hmr<Api>> {
  const hmr = hmrControl(host, replace);
  await start(hmr);
  replace(await host.ensure());
  return hmr;
}

/**
 * The one thing every generation must serve: the upgrade channel. A platform without it
 * would be committed and restored on every restart with no way to push another — so it is
 * refused before commit, and the previous generation stays. The probe carries no
 * credential: the route's own gate answering (401/403), or the endpoint refusing the
 * probe's shape (400/405), proves the route is there; null, a 404 or anything else does not.
 */
export async function admitsUpgradeRoute<Api extends Park>(
  instance: Instance<Api>,
): Promise<string | null> {
  if (typeof (instance.api as { http?: unknown }).http !== "function") {
    return `the pushed platform serves no HTTP, so no ${HMR_UPGRADE_PATH}`;
  }
  // A credential-less POST reaches the mechanism's endpoint (400, no body) or stops at the
  // platform's gate (401/403) or its router (405). No other answer is one the channel gives,
  // and a path nothing serves is declined outright, which is how the two are told apart.
  const answer = await probe(instance, HMR_UPGRADE_PATH);
  if (["400", "401", "403", "405"].includes(answer)) return null;
  return (
    `the pushed platform serves no ${HMR_UPGRADE_PATH} (answered ${answer}); ` +
    `a push must carry the upgrade channel, or the installation could never be upgraded again`
  );
}

/** One probe, as a comparable string: a status, `none` for a declined path, or the throw. */
async function probe<Api extends Park>(instance: Instance<Api>, path: string): Promise<string> {
  const api = instance.api as {
    http?: (request: Request) => Promise<Response | null> | Response | null;
  };
  try {
    const response = await api.http?.call(
      api,
      new Request(`http://localhost${path}`, { method: "POST" }),
    );
    return response === null || response === undefined ? "none" : String(response.status);
  } catch (err) {
    return `a throw (${err instanceof Error ? err.message : String(err)})`;
  }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bad = (message: string): Response => json(400, { error: { code: "bad_request", message } });

/**
 * What a push's body is: `gzip(JSON.stringify({ platform, cli, web: { files }, assets?, source? }))`.
 * Every content value — a bundle, a web file, an asset — is either inline (bundles as text,
 * files as base64) or `{ sha }`: a blob put in the store beforehand (HMR_BLOBS_PATH).
 *
 * The body is read as a stream and never held whole. It is inflated as it arrives and read by a
 * reader that knows only this shape; every inline content value is decoded as it is read and
 * written straight into the blob store, so what comes back names every part by `{ sha }` and
 * holds no content at all. A push is therefore not one string at any point — V8's ceiling on a
 * string's length (MAX_STRING_LENGTH, ~512MB) does not bound it, and neither does memory: what
 * one push costs here is a chunk of the stream, whatever its size. The blobs it writes or names
 * are held on `lease` until the caller is done with them. Throws with the reason when the body
 * is not a push.
 */
export async function parseUpgradeTarget(
  contentType: string | null,
  body: Buffer | AsyncIterable<Uint8Array>,
  lease: BlobLease,
): Promise<UpgradeAllTarget> {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/gzip" && type !== "application/octet-stream") {
    throw new Error(
      "expected a gzip(JSON.stringify({ platform, cli, web })) body " +
        "(Content-Type application/gzip or application/octet-stream)",
    );
  }
  let payload: RawPush;
  const text = inflatedText(body);
  try {
    payload = await readPush(new JsonReader(text), lease);
  } catch (err) {
    throw new Error(
      `invalid gzip upgrade payload: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    // A push refused halfway stops reading: the inflate and the request body are torn down.
    await text.return(undefined);
  }
  const content = (what: string, value: unknown): BlobRef => {
    const sha = (value as { sha?: unknown } | null)?.sha;
    if (typeof sha !== "string" || !isBlobName(sha)) {
      throw new Error(`payload has no ${what} (content, or { sha } of a blob in the store)`);
    }
    if (!lease.hold(sha)) {
      throw new Error(
        `${what} names blob ${sha.slice(0, 12)}, which this store does not hold — put it first (PUT ${HMR_BLOBS_PATH}/<sha256>)`,
      );
    }
    return { sha };
  };
  const files = (what: string, value: unknown): Record<string, BlobRef> => {
    if (typeof value !== "object" || value === null) {
      throw new Error(`payload has no ${what} (a { relPath: content } map)`);
    }
    return Object.fromEntries(
      Object.entries(value).map(([rel, v]) => [rel, content(`${what} ${rel}`, v)]),
    );
  };
  const source = payload.source as { repo?: unknown; revision?: unknown } | undefined;
  return {
    platform: content("`platform`", payload.platform),
    cli: content("`cli`", payload.cli),
    web: files("`web.files`", payload.web?.files),
    // Optional: a push that needs no real files on disk (no native module, no helper
    // binary) simply omits it.
    ...(payload.assets?.files
      ? {
          assets: {
            files: files("`assets.files`", payload.assets.files),
            ...(payload.assets.exec ? { exec: payload.assets.exec as string[] } : {}),
          },
        }
      : {}),
    // Provenance is optional and, unlike the bundles, outlives the request in harness.json —
    // so it is accepted only fully formed. A half-filled or wrong-typed `source` is dropped
    // rather than committed: readers tolerate its absence, and a malformed record on disk
    // would outlive the push that produced it.
    ...(typeof source?.repo === "string" &&
    typeof source.revision === "string" &&
    source.repo.length > 0 &&
    source.revision.length > 0
      ? { source: { repo: source.repo, revision: source.revision } }
      : {}),
  };
}

/** A push as read: content values are `{ sha }` once written, anything else as it was sent. */
interface RawPush {
  platform?: unknown;
  cli?: unknown;
  web?: { files?: unknown };
  assets?: { files?: unknown; exec?: unknown };
  source?: unknown;
}

/** The body, inflated and decoded to text a chunk at a time, with the stream's backpressure. */
async function* inflatedText(body: Buffer | AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  // Larger than zlib's 16KB default: the reader's cost is per chunk, and a push can be gigabytes.
  const gunzip = zlib.createGunzip({ chunkSize: 256 * 1024 });
  pipeline(Readable.from(body), gunzip, () => {
    // An error reaches the reader through the gunzip stream it iterates; nothing to do here.
  });
  const decoder = new StringDecoder("utf8");
  for await (const chunk of gunzip as AsyncIterable<Buffer>) {
    const piece = decoder.write(chunk);
    if (piece !== "") yield piece;
  }
  const tail = decoder.end();
  if (tail !== "") yield tail;
}

/**
 * Reads the push's shape off the text stream. Only the content positions — `platform`, `cli`,
 * and each entry of `web.files` and `assets.files` — may be large; a string found at one is
 * streamed into a blob writer, decoded as it goes. Everything else a push describes itself with
 * is small and read whole; fields this version does not know are skipped without being kept.
 */
async function readPush(reader: JsonReader, lease: BlobLease): Promise<RawPush> {
  const content = async (encoding: "utf8" | "base64"): Promise<unknown> => {
    if ((await reader.peek()) !== '"') return reader.value(); // `{ sha }`, or something wrong
    const writer = await lease.open();
    try {
      const decode = encoding === "base64" ? base64Decoder(writer) : utf8Encoder(writer);
      await reader.string(decode.write);
      await decode.end();
      return { sha: await writer.close() };
    } catch (err) {
      await writer.abort();
      throw err;
    }
  };
  const files = async (): Promise<unknown> => {
    if ((await reader.peek()) !== "{") return reader.value();
    const map: Record<string, unknown> = {};
    await reader.members(async (rel) => {
      map[rel] = await content("base64");
    });
    return map;
  };
  const push: RawPush = {};
  await reader.members(async (key) => {
    if (key === "platform" || key === "cli") {
      push[key] = await content("utf8");
    } else if (key === "web" || key === "assets") {
      if ((await reader.peek()) !== "{") {
        push[key] = (await reader.value()) as RawPush["web"];
        return;
      }
      const part: { files?: unknown; exec?: unknown } = {};
      await reader.members(async (field) => {
        if (field === "files") part.files = await files();
        else if (key === "assets" && field === "exec") part.exec = await reader.value();
        else await reader.skip();
      });
      push[key] = part;
    } else if (key === "source") {
      push.source = await reader.value();
    } else {
      await reader.skip();
    }
  });
  if ((await reader.peek()) !== "")
    throw new Error("Unexpected non-whitespace character after JSON");
  return push;
}

/** Base64 text in, bytes out to the writer: whole 4-character groups at a time, the rest carried. */
function base64Decoder(writer: BlobWriter) {
  let rest = "";
  return {
    write: async (piece: string): Promise<void> => {
      const text = rest + piece;
      const whole = text.length - (text.length % 4);
      rest = text.slice(whole);
      if (whole > 0) await writer.write(Buffer.from(text.slice(0, whole), "base64"));
    },
    end: async (): Promise<void> => {
      if (rest !== "") await writer.write(Buffer.from(rest, "base64"));
    },
  };
}

/** Source text in, its UTF-8 bytes out to the writer. */
function utf8Encoder(writer: BlobWriter) {
  return {
    write: (piece: string): Promise<void> => writer.write(Buffer.from(piece, "utf8")),
    end: async (): Promise<void> => undefined,
  };
}

/** How much decoded string text a reader gathers before handing it on. */
const STRING_PIECE = 64 * 1024;

/**
 * A JSON reader over text that arrives in chunks: the document is never one string. Strings are
 * handed out in pieces (see `string`), so one value can be longer than any string V8 can hold;
 * `value` and `skip` are for the small parts around them.
 */
class JsonReader {
  private buf = "";
  private pos = 0;

  constructor(private readonly source: AsyncIterator<string>) {}

  /** Makes at least one unread character available; false at the end of the input. */
  private async fill(): Promise<boolean> {
    while (this.pos >= this.buf.length) {
      const next = await this.source.next();
      if (next.done) return false;
      this.buf = next.value;
      this.pos = 0;
    }
    return true;
  }

  /** The next non-whitespace character, not consumed; "" at the end of the input. */
  async peek(): Promise<string> {
    for (;;) {
      if (!(await this.fill())) return "";
      while (this.pos < this.buf.length && isWhitespace(this.buf.charCodeAt(this.pos))) this.pos++;
      if (this.pos < this.buf.length) return this.buf[this.pos]!;
    }
  }

  private async expect(ch: string): Promise<void> {
    const got = await this.peek();
    if (got !== ch) throw unexpected(got);
    this.pos++;
  }

  private async accept(ch: string): Promise<boolean> {
    if ((await this.peek()) !== ch) return false;
    this.pos++;
    return true;
  }

  private async char(): Promise<string> {
    if (!(await this.fill())) throw new Error("Unexpected end of JSON input");
    return this.buf[this.pos++]!;
  }

  /** An object, member by member: `each` reads the member's value itself. */
  async members(each: (key: string) => Promise<void>): Promise<void> {
    await this.expect("{");
    if (await this.accept("}")) return;
    do {
      const key = await this.whole();
      await this.expect(":");
      await each(key);
    } while (await this.accept(","));
    await this.expect("}");
  }

  /**
   * A string, streamed: `emit` receives its decoded text in pieces of about STRING_PIECE, and
   * the next piece is not read until the last one has been taken.
   */
  async string(emit: (piece: string) => Promise<void> | void): Promise<void> {
    await this.expect('"');
    let text = "";
    const flush = async (all: boolean): Promise<void> => {
      // A piece never ends between the two halves of a surrogate pair (from a \uXXXX escape);
      // the high half waits for the next one.
      const last = text.charCodeAt(text.length - 1);
      const keep = !all && last >= 0xd800 && last <= 0xdbff ? 1 : 0;
      const piece = text.slice(0, text.length - keep);
      text = text.slice(text.length - keep);
      if (piece !== "") await emit(piece);
    };
    for (;;) {
      if (!(await this.fill())) throw new Error("Unterminated string in JSON");
      const buf = this.buf;
      let end = this.pos;
      for (; end < buf.length; end++) {
        const c = buf.charCodeAt(end);
        if (c === 0x22 || c === 0x5c) break;
      }
      text += buf.slice(this.pos, end);
      this.pos = end;
      if (end < buf.length) {
        this.pos++;
        if (buf.charCodeAt(end) === 0x22) {
          await flush(true);
          return;
        }
        text += await this.escape();
      }
      if (text.length >= STRING_PIECE) await flush(false);
    }
  }

  /** The character a backslash escape stands for (the backslash already consumed). */
  private async escape(): Promise<string> {
    const c = await this.char();
    switch (c) {
      case '"':
      case "\\":
      case "/":
        return c;
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u": {
        let hex = "";
        for (let i = 0; i < 4; i++) hex += await this.char();
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error("Bad Unicode escape in JSON");
        return String.fromCharCode(parseInt(hex, 16));
      }
      default:
        throw new Error("Bad escaped character in JSON");
    }
  }

  /** A string, whole: keys and the small fields around the content. */
  private async whole(): Promise<string> {
    let text = "";
    await this.string((piece) => {
      text += piece;
    });
    return text;
  }

  /** Any value, built: only for the small parts of a push. */
  async value(): Promise<unknown> {
    const c = await this.peek();
    if (c === '"') return this.whole();
    if (c === "{") {
      const object: Record<string, unknown> = {};
      await this.members(async (key) => {
        object[key] = await this.value();
      });
      return object;
    }
    if (c === "[") {
      this.pos++;
      const array: unknown[] = [];
      if (await this.accept("]")) return array;
      do {
        array.push(await this.value());
      } while (await this.accept(","));
      await this.expect("]");
      return array;
    }
    return this.scalar();
  }

  /** Any value, read and dropped: a field this version does not know costs nothing to carry. */
  async skip(): Promise<void> {
    const c = await this.peek();
    if (c === '"') return this.string(() => undefined);
    if (c === "{") return this.members(() => this.skip());
    if (c === "[") {
      this.pos++;
      if (await this.accept("]")) return;
      do {
        await this.skip();
      } while (await this.accept(","));
      return this.expect("]");
    }
    await this.scalar();
  }

  /** A number, `true`, `false` or `null`. */
  private async scalar(): Promise<unknown> {
    let token = "";
    for (;;) {
      if (!(await this.fill())) break;
      const c = this.buf[this.pos]!;
      if (!/[-+.0-9a-zA-Z]/.test(c)) break;
      token += c;
      this.pos++;
    }
    if (token === "") throw unexpected(await this.peek());
    return JSON.parse(token) as unknown;
  }
}

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09;
}

function unexpected(got: string): Error {
  return new Error(
    got === "" ? "Unexpected end of JSON input" : `Unexpected token '${got}' in JSON`,
  );
}

/**
 * The upgrade endpoint, framework-free: a Request in, a Response out. A malformed push and a
 * push whose generation could not become current both answer 400 with the reason;
 * `blocked` is an outcome, not an error — the body carries the paths for the upper rungs
 * of the upgrade ladder, so clients keep one parsing path. `onLanded` runs for a push that
 * landed: what the product tells its clients (a reload), not what the layer does.
 */
export async function probeEndpoint(
  host: Pick<HmrHost, "missingBlobs">,
  request: Request,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { hashes?: unknown } | null;
  const hashes = body?.hashes;
  if (!Array.isArray(hashes) || hashes.some((h) => typeof h !== "string")) {
    return bad("expected { hashes: string[] }");
  }
  if (hashes.length > 50_000) return bad("too many hashes in one probe");
  return json(200, { missing: host.missingBlobs(hashes as string[]) });
}

/** A request's body as a stream of bytes, never read whole. */
function bodyOf(request: Request): AsyncIterable<Uint8Array> | Buffer {
  return request.body === null
    ? Buffer.alloc(0)
    : Readable.fromWeb(request.body as import("node:stream/web").ReadableStream<Uint8Array>);
}

/**
 * One blob in, raw: `PUT <HMR_BLOBS_PATH>/<sha256>` with the bytes as the body, stored only if
 * they hash to the name. Streamed to disk as it arrives, so a blob of any size costs one chunk.
 */
export async function blobEndpoint(
  host: Pick<HmrHost, "blobLease">,
  request: Request,
): Promise<Response> {
  const sha = new URL(request.url).pathname.slice(HMR_BLOBS_PATH.length + 1);
  if (!isBlobName(sha)) return bad("a blob is named by the lowercase hex sha256 of its content");
  const lease = host.blobLease();
  try {
    const writer = await lease.open();
    try {
      for await (const chunk of bodyOf(request)) await writer.write(chunk as Uint8Array);
    } catch (err) {
      await writer.abort();
      throw err;
    }
    const stored = await writer.close(sha);
    return stored === sha ? json(200, { sha }) : bad(`the body hashes to ${stored}, not ${sha}`);
  } catch (err) {
    return bad(`the blob could not be stored: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    lease.release();
  }
}

export async function upgradeEndpoint<Api extends Park>(
  hmr: Hmr<Api>,
  request: Request,
  onLanded: ((outcome: Extract<UpgradeOutcome, { status: "ok" }>) => void) | undefined,
  store: Pick<HmrHost, "blobLease">,
): Promise<Response> {
  // Everything this push writes or names stays out of reach of a concurrent commit's sweep
  // until its own upgrade has committed (or failed).
  const lease = store.blobLease();
  try {
    let target: UpgradeAllTarget;
    try {
      target = await parseUpgradeTarget(
        request.headers.get("content-type"),
        bodyOf(request),
        lease,
      );
    } catch (err) {
      return bad(err instanceof Error ? err.message : String(err));
    }
    let outcome: UpgradeOutcome;
    try {
      outcome = await hmr.upgrade(target);
    } catch (err) {
      return bad(err instanceof Error ? err.message : String(err));
    }
    if (outcome.status === "ok") onLanded?.(outcome);
    return json(200, outcome);
  } finally {
    lease.release();
  }
}
