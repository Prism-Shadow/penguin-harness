/**
 * Body elision for history windows: the bulky values the chat shows folded — a tool's output,
 * a child record's inline images, a long string inside a tool call's arguments, a thinking
 * block — travel as a preview, and the whole value is fetched when the reader unfolds it
 * (`GET …/sessions/:id/trace-body?ref=`).
 *
 * One pure rule for every server and both legs of a remote history stream, and importable by
 * the Web App at run time: the server elides (`elideHistoryRecord`), the page puts back what it
 * fetched (`withElidedBody`), and both read the same path syntax. The elided entries ride the
 * history envelope (`HistoryMessage.elided`), beside `tracePosition`; nothing here is ever
 * written to a Trace, and no AMSP record gains a field.
 *
 * A path names one value of a record: `payload.output`, `payload.thinking`,
 * `payload.images.<i>`, or `payload.arguments#<JSON Pointer>` for a string inside a tool call's
 * arguments (RFC 6901, `payload.arguments#` alone for arguments that are not JSON). A string
 * keeps a preview of its head and tail; an image keeps none (its value becomes the empty
 * string), since half a data URL draws nothing.
 */
import type { AmspRecord } from "@prismshadow/amsp/records";

/** A value above this many UTF-8 bytes is elided. */
export const ELIDE_BYTES = 16 * 1024;

/** What an elided string keeps: its first `head` and its last `tail` UTF-16 code units. */
export const ELIDE_PREVIEW: { readonly head: number; readonly tail: number } = {
  head: 1024,
  tail: 512,
};

/** One elided value of a history record. */
export interface ElidedBody {
  /** Where the value sits in the record (see the module header for the syntax). */
  path: string;
  /** The whole value's UTF-8 byte length. */
  bytes: number;
  /** The whole value's line count; absent for an image. */
  lines?: number;
  /**
   * How many UTF-16 code units of the preview are the value's head; the rest of the preview is
   * its tail. 0 for an image, whose preview is the empty string.
   */
  head: number;
  /** Opaque handle for `trace-body?ref=`: the record's Trace file, its ordinal and the path. */
  ref: string;
}

/** Where a record's line lives: the Trace file and the ordinal a ref names. */
export interface BodySource {
  agentId: string;
  sessionId: string;
  /** Trace shard index (`001` on disk is 1). */
  fileIndex: number;
  /** Zero-based record ordinal within the shard. */
  ordinal: number;
}

/** A history record: an AMSP record, possibly already carrying its elided entries. */
export type HistoryRecordLike = AmspRecord & { elided?: ElidedBody[] };

/** UTF-8 byte length of a string, without an encoder (this module runs in the browser too). */
function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
}

/** Whether a string is above the threshold, measuring only when its length cannot tell. */
function aboveThreshold(s: string): boolean {
  if (s.length > ELIDE_BYTES) return true; // every code unit is at least one byte
  if (s.length * 3 <= ELIDE_BYTES) return false; // and at most three
  return utf8Length(s) > ELIDE_BYTES;
}

function lineCount(s: string): number {
  let n = 1;
  for (let i = s.indexOf("\n"); i !== -1 && i < s.length - 1; i = s.indexOf("\n", i + 1)) n += 1;
  return n;
}

/** A string's preview: its head and tail, neither cutting a surrogate pair. */
function preview(s: string): { text: string; head: number } {
  let head = ELIDE_PREVIEW.head;
  if ((s.charCodeAt(head - 1) & 0xfc00) === 0xd800) head -= 1;
  let tailStart = s.length - ELIDE_PREVIEW.tail;
  if ((s.charCodeAt(tailStart) & 0xfc00) === 0xdc00) tailStart += 1;
  return { text: s.slice(0, head) + s.slice(tailStart), head };
}

/** base64url of a string's UTF-8 bytes (btoa takes one byte per code unit). */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(raw: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(raw)) return null;
  try {
    const binary = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The ref `trace-body` takes for one value of the record at `source`. */
export function encodeBodyRef(source: BodySource, path: string): string {
  return toBase64Url(
    JSON.stringify({
      a: source.agentId,
      s: source.sessionId,
      i: source.fileIndex,
      o: source.ordinal,
      p: path,
    }),
  );
}

/**
 * The id alphabet of Agents and Sessions (core's isValidId): a ref naming anything else is not
 * one. A ref is the client's to send back, so its ids are checked before any path is built
 * from them — `..` in one would otherwise reach another Project's Traces.
 */
const ID = /^[A-Za-z0-9_-]+$/;

/** What a ref names, or null when it is not one. */
export function decodeBodyRef(ref: string): (BodySource & { path: string }) | null {
  const text = fromBase64Url(ref);
  if (text === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const count = (x: unknown): x is number =>
    typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
  if (typeof o.a !== "string" || !ID.test(o.a) || typeof o.s !== "string" || !ID.test(o.s)) {
    return null;
  }
  if (!count(o.i) || o.i < 1 || !count(o.o) || typeof o.p !== "string") return null;
  return { agentId: o.a, sessionId: o.s, fileIndex: o.i, ordinal: o.o, path: o.p };
}

/** RFC 6901 tokens of a JSON Pointer ("" is the whole document). */
function pointerTokens(pointer: string): string[] | null {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return null;
  return pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}

const pointerToken = (key: string | number): string =>
  String(key).replace(/~/g, "~0").replace(/\//g, "~1");

/**
 * The tool-call arguments with every long string value folded, or null when none is long. The
 * JSON stays valid, so a card still reads its short fields.
 */
function elideArguments(args: string, source: BodySource, out: ElidedBody[]): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    // Not a JSON document: the arguments fold as one string.
    if (!aboveThreshold(args)) return null;
    out.push(entryFor(args, "payload.arguments#", source));
    return preview(args).text;
  }
  const before = out.length;
  const walk = (value: unknown, pointer: string): unknown => {
    if (typeof value === "string") {
      if (!aboveThreshold(value)) return value;
      out.push(entryFor(value, `payload.arguments#${pointer}`, source));
      return preview(value).text;
    }
    if (Array.isArray(value)) return value.map((v, i) => walk(v, `${pointer}/${i}`));
    if (typeof value === "object" && value !== null) {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value))
        next[k] = walk(v, `${pointer}/${pointerToken(k)}`);
      return next;
    }
    return value;
  };
  const folded = walk(parsed, "");
  return out.length > before ? JSON.stringify(folded) : null;
}

function entryFor(value: string, path: string, source: BodySource): ElidedBody {
  return {
    path,
    bytes: utf8Length(value),
    lines: lineCount(value),
    head: preview(value).head,
    ref: encodeBodyRef(source, path),
  };
}

/**
 * The record with every value above `ELIDE_BYTES` replaced by its preview, and the entries
 * that name them. A record with nothing to elide comes back as the same object with no new
 * entries; an already elided record keeps its entries (eliding twice changes nothing). The
 * returned record carries `elided` when there is any.
 */
export function elideHistoryRecord<R extends HistoryRecordLike>(
  record: R,
  source: BodySource,
): { record: R; elided: ElidedBody[] } {
  const prior = record.elided ?? [];
  if (record.type !== "model_msg") return { record, elided: prior };
  const payload = record.payload as unknown as Record<string, unknown>;
  const added: ElidedBody[] = [];
  const changes: Record<string, unknown> = {};
  switch (payload.type) {
    case "tool_call_output": {
      const output = payload.output;
      if (typeof output === "string" && aboveThreshold(output)) {
        added.push(entryFor(output, "payload.output", source));
        changes.output = preview(output).text;
      }
      const images = payload.images;
      if (Array.isArray(images)) {
        const folded: unknown[] = [...images];
        let any = false;
        for (let i = 0; i < images.length; i++) {
          const image: unknown = images[i];
          if (typeof image !== "string" || !image.startsWith("data:") || !aboveThreshold(image)) {
            continue;
          }
          const path = `payload.images.${i}`;
          added.push({ path, bytes: utf8Length(image), head: 0, ref: encodeBodyRef(source, path) });
          folded[i] = "";
          any = true;
        }
        if (any) changes.images = folded;
      }
      break;
    }
    case "tool_call": {
      if (typeof payload.arguments === "string") {
        const folded = elideArguments(payload.arguments, source, added);
        if (folded !== null) changes.arguments = folded;
      }
      break;
    }
    case "thinking": {
      const thinking = payload.thinking;
      if (typeof thinking === "string" && aboveThreshold(thinking)) {
        added.push(entryFor(thinking, "payload.thinking", source));
        changes.thinking = preview(thinking).text;
      }
      break;
    }
  }
  if (added.length === 0) return { record, elided: prior };
  const elided = [...prior, ...added];
  return { record: { ...record, payload: { ...payload, ...changes }, elided } as R, elided };
}

/** Parses a path into the payload field it names and, for the arguments, the pointer inside. */
function parsePath(
  path: string,
):
  | { field: "output" | "thinking" }
  | { field: "images"; index: number }
  | { field: "arguments"; pointer: string }
  | null {
  if (path === "payload.output") return { field: "output" };
  if (path === "payload.thinking") return { field: "thinking" };
  const image = /^payload\.images\.(\d+)$/.exec(path);
  if (image !== null) return { field: "images", index: Number(image[1]) };
  if (path.startsWith("payload.arguments#")) {
    return { field: "arguments", pointer: path.slice("payload.arguments#".length) };
  }
  return null;
}

/** The whole value at `path` in a record as its Trace line holds it, or null when there is none. */
export function bodyAt(record: AmspRecord, path: string): string | null {
  const where = parsePath(path);
  if (where === null) return null;
  const payload = record.payload as unknown as Record<string, unknown>;
  switch (where.field) {
    case "output":
    case "thinking": {
      const v = payload[where.field];
      return typeof v === "string" ? v : null;
    }
    case "images": {
      const images = payload.images;
      const v = Array.isArray(images) ? images[where.index] : undefined;
      return typeof v === "string" ? v : null;
    }
    case "arguments": {
      const args = payload.arguments;
      if (typeof args !== "string") return null;
      if (where.pointer === "") return args;
      const tokens = pointerTokens(where.pointer);
      if (tokens === null) return null;
      let v: unknown;
      try {
        v = JSON.parse(args);
      } catch {
        return null;
      }
      for (const t of tokens) {
        if (typeof v !== "object" || v === null) return null;
        v = (v as Record<string, unknown>)[t];
      }
      return typeof v === "string" ? v : null;
    }
  }
}

/**
 * The record with the whole `value` put back at `path` and that entry dropped from `elided`:
 * what the page holds once it has fetched an elided body. A path the record does not hold
 * leaves it as it is.
 */
export function withElidedBody<R extends HistoryRecordLike>(
  record: R,
  path: string,
  value: string,
): R {
  const where = parsePath(path);
  const entries = record.elided ?? [];
  if (where === null || !entries.some((e) => e.path === path)) return record;
  const payload = { ...(record.payload as unknown as Record<string, unknown>) };
  switch (where.field) {
    case "output":
    case "thinking":
      payload[where.field] = value;
      break;
    case "images": {
      const images = Array.isArray(payload.images) ? [...(payload.images as unknown[])] : [];
      images[where.index] = value;
      payload.images = images;
      break;
    }
    case "arguments": {
      if (where.pointer === "") {
        payload.arguments = value;
        break;
      }
      const tokens = pointerTokens(where.pointer);
      let doc: unknown;
      try {
        doc = JSON.parse(String(payload.arguments));
      } catch {
        return record;
      }
      if (tokens === null || tokens.length === 0) return record;
      let holder: unknown = doc;
      for (const t of tokens.slice(0, -1)) {
        if (typeof holder !== "object" || holder === null) return record;
        holder = (holder as Record<string, unknown>)[t];
      }
      if (typeof holder !== "object" || holder === null) return record;
      (holder as Record<string, unknown>)[tokens[tokens.length - 1]!] = value;
      payload.arguments = JSON.stringify(doc);
      break;
    }
  }
  const rest = entries.filter((e) => e.path !== path);
  const { elided: _elided, ...envelope } = record;
  return {
    ...envelope,
    payload,
    ...(rest.length > 0 ? { elided: rest } : {}),
  } as unknown as R;
}
