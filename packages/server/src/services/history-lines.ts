/**
 * The machine leg of a history stream: `GET /api/sessions/:sessionId/history-lines`.
 *
 * A machine cuts the window of its own Session (only it holds every earlier byte the cut
 * needs) and sends it as what the hub can rebuild it from: the envelope `/messages` answers
 * beside the records, the layout of the Trace bytes the records come from
 * (history-layout.ts), and then only the Trace lines the hub does not already hold — whole
 * lines, newest segment first, in frames of at most FRAME_TEXT_BUDGET (socket/line-frames.ts),
 * paced by the hub's acks. The stream begins, and beats, before anything is read, so however
 * long the plan takes the hub hears it. Events, in order:
 *
 *   window   HistoryLinesWindow: envelope, files, layout, stubs, totals — or, when larger than
 *            a frame, `window-part`s whose texts join to it
 *   lines    the window's light lines (and a line longer than a frame as `part`s), the rest of
 *            one the hub holds in part among them
 *   ready    the hub can assemble the window now
 *   part     the rest of every other line the hub holds in part (a heavy line, another file's)
 *   lines    the window's heavy lines, then with `fill=1` the rest of the Session's files:
 *            each file from its top backward, the Session's own newest first, then its
 *            descendants' — frames carry lines in file order, the frames themselves go back
 *   done     (or `error`, for a stream that cannot be served: a ref into no line of it)
 *
 * `have` names every run the hub holds of each file; a file whose `have` does not validate
 * (identity, size, line edges, ordinals, anchors) is `reset` and planned from scratch, and a
 * held partial line that does not validate is simply sent whole. Bytes past a file's last
 * `\n` are never sent: a record that is still an unterminated tail rides the window as a stub.
 */
import fs from "node:fs/promises";
import {
  decodeBodyRef,
  ELIDE_BYTES,
  elideHistoryRecord,
} from "@prismshadow/penguin-core/interfaces";
import type {
  HistoryFileFact,
  HistoryHave,
  HistoryLinesFrame,
  HistoryLinesWindow,
  HistoryMessage,
  HistoryPartFrame,
  HistoryStreamError,
  HistoryStub,
  HistoryWindowPart,
} from "../api/types.js";
import type { SessionRow } from "../db/repos/sessions.js";
import { HttpError } from "../http/errors.js";
import type { EventSink } from "../http/event-stream.js";
import { badRequest } from "../http/validate.js";
import type { Channels } from "../hmr/capabilities.js";
import type { Traces } from "../mechanisms/traces.js";
import type { Sessions } from "../runtime/session-manager.js";
import { FRAME_TEXT_BUDGET, lineFrames, partFrames } from "../socket/line-frames.js";
import type { LineFrame, PartFrame } from "../socket/line-frames.js";
import { windowLayout } from "./history-layout.js";
import {
  anchorOf,
  decodeHistoryHave,
  hiAnchorRange,
  historyFileKey,
  loAnchorRange,
  sameHistoryFile,
} from "./history-wire.js";
import type { HistoryLinesQuery } from "./history-wire.js";
import { decodeCursor } from "./message-window.js";
import {
  MESSAGES_PAGE_LIMIT_DEFAULT,
  appendPendingInputs,
  captureHistoryEnvelope,
  messagesPageInfo,
  pageLimit,
} from "./session-history.js";
import { withImagesByReference } from "./trace-images.js";
import type { HistoryTraceFile, HistoryWindowRead } from "./trace-service.js";

/** A machine-leg stream beats this often while it waits on credit or disk. */
export const HISTORY_LINES_BEAT_MS = 5_000;

/** Bytes read from a Trace file at a time while framing it. */
const READ_CHUNK = 1024 * 1024;

const NEWLINE = 0x0a;

export interface HistoryLinesDeps {
  traces: Pick<Traces, "readHistoryWindow" | "historyTraceFiles">;
  manager: Pick<Sessions, "statusOf" | "liveFragments" | "pendingInputs" | "pendingBootstrap">;
  channels: Pick<Channels, "get">;
}

function positiveInt(raw: string, name: string, max: number): number {
  if (!/^\d{1,9}$/.test(raw)) throw badRequest(`${name} must be a positive integer.`);
  const v = Number(raw);
  if (v < 1 || v > max) throw badRequest(`${name} must be an integer between 1 and ${max}.`);
  return v;
}

/** The query of one `history-lines` call (history-wire.ts HistoryLinesQuery), or a 400. */
export function parseHistoryLinesQuery(url: URL): HistoryLinesQuery {
  const q = url.searchParams;
  const rawHave = q.get("have");
  const have = rawHave === null ? [] : decodeHistoryHave(rawHave);
  if (have === null) throw badRequest("have must be base64url JSON of the held ranges.");
  const tail = q.get("tailLimit");
  const before = q.get("before");
  const full = q.get("full");
  const body = q.get("body");
  const fill = q.get("fill");
  const chosen = [tail, before, full, body, fill === "only" ? fill : null].filter(
    (v) => v !== null,
  );
  if (chosen.length !== 1) {
    throw badRequest("Exactly one of tailLimit, before, full=1, body or fill=only is required.");
  }
  const budget =
    q.get("budget") === null ? undefined : positiveInt(q.get("budget")!, "budget", 2 ** 31);
  const fillAfter = fill === "1";
  if (fill !== null && fill !== "1" && fill !== "only") throw badRequest("fill must be 1 or only.");
  if (tail !== null) {
    return {
      kind: "tail",
      limit: pageLimit(tail, "tailLimit"),
      ...(budget !== undefined ? { budget } : {}),
      fill: fillAfter,
      have,
    };
  }
  if (before !== null) {
    if (decodeCursor(before) === null) {
      throw badRequest("before must be a cursor of the form <shardIndex>:<ordinal>.");
    }
    const limit = q.get("limit");
    return {
      kind: "before",
      cursor: before,
      limit: limit === null ? MESSAGES_PAGE_LIMIT_DEFAULT : pageLimit(limit, "limit"),
      ...(budget !== undefined ? { budget } : {}),
      fill: fillAfter,
      have,
    };
  }
  if (full !== null) {
    if (full !== "1") throw badRequest("full must be 1.");
    return { kind: "full", fill: fillAfter, have };
  }
  if (body !== null) return { kind: "body", ref: body, have };
  const file = q.get("file");
  return { kind: "fill", ...(file !== null ? { file } : {}), have };
}

type Range = [start: number, end: number];

/** `ranges` without `cut`, each piece kept in order. */
function subtract(ranges: readonly Range[], cut: Range): Range[] {
  const out: Range[] = [];
  for (const [a, b] of ranges) {
    if (cut[1] <= a || cut[0] >= b) {
      out.push([a, b]);
      continue;
    }
    if (a < cut[0]) out.push([a, cut[0]]);
    if (cut[1] < b) out.push([cut[1], b]);
  }
  return out;
}

/** Records starting before `off`: the ordinal of the first record at or after it. */
function recordsBefore(starts: readonly number[], off: number): number {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid]! < off) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

async function readRange(path: string, start: number, end: number): Promise<Buffer> {
  const length = Math.max(0, end - start);
  const buf = Buffer.allocUnsafe(length);
  const fh = await fs.open(path, "r");
  try {
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await fh.read(buf, filled, length - filled, start + filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return filled === length ? buf : buf.subarray(0, filled);
  } finally {
    await fh.close();
  }
}

/** One file as this stream plans it. */
interface FilePlan {
  file: HistoryTraceFile;
  k: string;
  /** The runs the hub holds and this machine vouches for (none when reset). */
  held: Range[];
  /** A partial line the hub holds: the rest of it goes first, as parts from `off + len`. */
  partial: { off: number; len: number; lineEnd: number } | null;
  reset: boolean;
  /** Ranges this stream sends before the fill (and the held partial's line), which the fill skips. */
  sent: Range[];
}

/** The byte at `at` of a file, or -1 past its end. */
async function byteAt(path: string, at: number): Promise<number> {
  const b = await readRange(path, at, at + 1);
  return b.length === 0 ? -1 : b[0]!;
}

/**
 * What a `have` entry earns: the runs it vouches for and its partial line, or null for a file
 * that is not the one the hub copied (another inode, or birth time where both know one — see
 * history-wire.ts `sameHistoryFile` — a run past its last
 * `\n`, a run whose edges are not line edges, or whose ordinals or anchors differ). A partial
 * line that does not check is dropped on its own: the file's runs stay held, and the line is
 * sent whole.
 */
async function validate(
  file: HistoryTraceFile,
  have: HistoryHave,
): Promise<{ held: Range[]; partial: FilePlan["partial"] } | null> {
  if (!sameHistoryFile(have, file)) return null;
  const ranges = have.ranges ?? [];
  const held: Range[] = [];
  for (const r of ranges) {
    if (r.hi > file.scanned || r.hi > file.size) return null;
    if (r.hi === r.lo) continue;
    if (r.loOrd !== recordsBefore(file.starts, r.lo)) return null;
    if (r.lo > 0 && (await byteAt(file.path, r.lo - 1)) !== NEWLINE) return null;
    if ((await byteAt(file.path, r.hi - 1)) !== NEWLINE) return null;
    const [la, lb] = loAnchorRange(r.lo, r.hi);
    const [ha, hb] = hiAnchorRange(r.lo, r.hi);
    if (anchorOf(await readRange(file.path, la, lb)) !== r.loAnchor) return null;
    if (anchorOf(await readRange(file.path, ha, hb)) !== r.hiAnchor) return null;
    held.push([r.lo, r.hi]);
  }
  let partial: FilePlan["partial"] = null;
  if (have.partial !== undefined) {
    const { off, len, anchor } = have.partial;
    const index = recordsBefore(file.starts, off);
    const lineEnd = file.starts[index] === off ? file.ends[index]! : -1;
    const fits = lineEnd >= 0 && len > 0 && off + len < lineEnd && lineEnd <= file.scanned;
    const inHeld = held.some(([a, b]) => a <= off && off < b);
    if (fits && !inHeld && anchorOf(await readRange(file.path, off, off + len)) === anchor) {
      partial = { off, len, lineEnd };
    }
  }
  return { held, partial };
}

/** One send of the plan: whole lines of a range, or the rest of a partly held line. */
type Send =
  | { kind: "range"; plan: FilePlan; range: Range; backward: boolean }
  | { kind: "rest"; plan: FilePlan; lineStart: number; from: number; end: number };

/** Bytes a send puts on the wire (file bytes) and the records it carries. */
function sizeOf(send: Send): { bytes: number; lines: number } {
  const starts = send.plan.file.starts;
  if (send.kind === "rest") return { bytes: send.end - send.from, lines: 1 };
  const [a, b] = send.range;
  return { bytes: b - a, lines: recordsBefore(starts, b) - recordsBefore(starts, a) };
}

/** A prepared stream: everything decided before the first event goes out. */
export interface HistoryLinesPlan {
  window: HistoryLinesWindow;
  windowSends: Send[];
  heavySends: Send[];
  fillSends: Send[];
}

/**
 * Reads the window and the files and decides every byte this stream sends, before the
 * stream starts: a bad ref or cursor is a status, not a broken stream.
 */
export async function planHistoryLines(
  deps: HistoryLinesDeps,
  row: SessionRow,
  q: HistoryLinesQuery,
): Promise<HistoryLinesPlan> {
  const { projectId, agentId, sessionId } = row;
  // The envelope first, before any file is read (captureHistoryEnvelope's contract).
  const envelope = captureHistoryEnvelope(
    deps,
    sessionId,
    q.kind === "tail" || q.kind === "full" || q.kind === "before" ? q.kind : "none",
  );
  let read: HistoryWindowRead | null = null;
  if (q.kind === "tail") {
    read = await deps.traces.readHistoryWindow(projectId, agentId, sessionId, {
      kind: "tail",
      limit: q.limit,
      budget: q.budget ?? Number.MAX_SAFE_INTEGER,
    });
  } else if (q.kind === "before") {
    read = await deps.traces.readHistoryWindow(projectId, agentId, sessionId, {
      kind: "before",
      cursor: decodeCursor(q.cursor)!,
      limit: q.limit,
      budget: q.budget ?? Number.MAX_SAFE_INTEGER,
    });
  } else if (q.kind === "full") {
    read = await deps.traces.readHistoryWindow(projectId, agentId, sessionId, { kind: "full" });
  }
  const files = await deps.traces.historyTraceFiles(projectId, agentId, sessionId);
  const plans = new Map<string, FilePlan>();
  for (const file of files) {
    const k = historyFileKey(file.agentId, file.sessionId, file.fileIndex);
    plans.set(k, { file, k, held: [], partial: null, reset: false, sent: [] });
  }
  for (const have of q.have) {
    const plan = plans.get(have.k);
    if (plan === undefined) continue; // gone on this machine: its absence from `files` says so
    const valid = await validate(plan.file, have);
    if (valid === null) plan.reset = true;
    else {
      plan.held = valid.held;
      plan.partial = valid.partial;
    }
  }
  /** What of `range` the hub lacks and this stream has not planned yet. */
  const missing = (plan: FilePlan, range: Range): Range[] => {
    let pieces: Range[] = [range];
    for (const cut of [...plan.held, ...plan.sent]) pieces = subtract(pieces, cut);
    return pieces.filter(([a, b]) => b > a);
  };
  const holds = (plan: FilePlan, start: number, end: number): boolean =>
    plan.held.some(([a, b]) => a <= start && end <= b);

  let body: { plan: FilePlan; line: Range } | null = null;
  if (q.kind === "body") {
    const ref = decodeBodyRef(q.ref);
    if (ref === null) throw new HttpError(400, "invalid_ref", "ref is not a trace-body ref.");
    const plan = plans.get(historyFileKey(ref.agentId, ref.sessionId, ref.fileIndex));
    const start = plan?.file.starts[ref.ordinal];
    const end = plan?.file.ends[ref.ordinal];
    if (plan === undefined || start === undefined || end === undefined || end > plan.file.scanned) {
      throw new HttpError(404, "trace_body_not_found", "The ref names no line of this Session.");
    }
    body = { plan, line: [start, end] };
  }

  // The window: its layout, its heavy lines (sent after `ready`, a stub standing in), and
  // the light bytes the hub lacks.
  const layout =
    read === null
      ? []
      : windowLayout(read.messages, read.sources, (k) => plans.get(k)?.file ?? null);
  const stubs: HistoryStub[] = [];
  const heavy = new Map<string, Range[]>();
  if (read !== null) {
    // One stub per record: a child expanded under two pointers puts its lines in the window
    // twice, and both places take the same stub.
    const stubbed = new Set<string>();
    read.messages.forEach((record, i) => {
      const source = read.sources[i]!;
      const k = historyFileKey(source.agentId, source.sessionId, source.fileIndex);
      if (stubbed.has(`${k}#${source.ordinal}`)) return;
      const plan = plans.get(k)!;
      const start = plan.file.starts[source.ordinal]!;
      const end = plan.file.ends[source.ordinal]!;
      const unterminated = end > plan.file.scanned;
      if (holds(plan, start, end)) return;
      const served = elideHistoryRecord(withImagesByReference(sessionId, record), {
        agentId: source.agentId,
        sessionId: source.sessionId,
        fileIndex: source.fileIndex,
        ordinal: source.ordinal,
      }).record as HistoryMessage;
      if (!unterminated) {
        const servedBytes = Buffer.byteLength(JSON.stringify(served), "utf8");
        if (end - start < servedBytes + ELIDE_BYTES) return; // light: its line goes as it is
      }
      stubbed.add(`${k}#${source.ordinal}`);
      stubs.push({
        k,
        ordinal: source.ordinal,
        offset: start,
        length: end - start,
        record: served,
      });
      if (!unterminated) heavy.set(k, [...(heavy.get(k) ?? []), [start, end]]);
    });
  }
  // The rest of each line the hub holds in part. Before `ready` only when the window needs it
  // to be assembled — a light line of the window itself (a long prompt); every other one, a
  // heavy line of the window included (its stub stands in) or a line of another file of the
  // Session, goes after `ready`, ahead of the heavy lines: a window reopened after a cut inside
  // a 1.5 MB screenshot must not wait for the screenshot. Parts name their line, so a rest
  // completes its held line whatever arrives before it. (A `body` read sends only its line's.)
  const windowSends: Send[] = [];
  const restsAfterReady: Send[] = [];
  const lightInWindow = (plan: FilePlan, off: number, end: number): boolean =>
    layout.some((s) => s.k === plan.k && s.from[0] <= off && end <= s.to[0]) &&
    !(heavy.get(plan.k) ?? []).some(([a]) => a === off);
  for (const plan of plans.values()) {
    const p = plan.partial;
    if (p === null) continue;
    if (body !== null && (body.plan !== plan || body.line[0] !== p.off)) continue;
    plan.sent.push([p.off, p.lineEnd]);
    const rest: Send = {
      kind: "rest",
      plan,
      lineStart: p.off,
      from: p.off + p.len,
      end: p.lineEnd,
    };
    if (body !== null || lightInWindow(plan, p.off, p.lineEnd)) windowSends.push(rest);
    else restsAfterReady.push(rest);
  }

  for (const segment of [...layout].reverse()) {
    const plan = plans.get(segment.k)!;
    let pieces: Range[] = [[segment.from[0], Math.min(segment.to[0], plan.file.scanned)]];
    for (const line of heavy.get(segment.k) ?? []) pieces = subtract(pieces, line);
    for (const piece of pieces) {
      for (const range of missing(plan, piece)) {
        plan.sent.push(range);
        windowSends.push({ kind: "range", plan, range, backward: false });
      }
    }
  }
  if (body !== null) {
    for (const range of missing(body.plan, body.line)) {
      body.plan.sent.push(range);
      windowSends.push({ kind: "range", plan: body.plan, range, backward: false });
    }
  }
  const heavySends: Send[] = [...restsAfterReady];
  for (const [k, lines] of heavy) {
    const plan = plans.get(k)!;
    for (const line of [...lines].reverse()) {
      for (const range of missing(plan, line)) {
        plan.sent.push(range);
        heavySends.push({ kind: "range", plan, range, backward: false });
      }
    }
  }

  // The fill: what is left of each file, its top first and backward; the Session's own
  // files newest first, then its descendants' the same way.
  const fillSends: Send[] = [];
  const wantsFill =
    q.kind === "fill" ||
    ((q.kind === "tail" || q.kind === "before" || q.kind === "full") && q.fill === true);
  if (wantsFill) {
    // Sessions in the order the files list them (the Session first, then its descendants
    // level by level), each Session's files newest first.
    const bySession = new Map<string, FilePlan[]>();
    for (const plan of plans.values()) {
      const list = bySession.get(plan.file.sessionId) ?? [];
      list.push(plan);
      bySession.set(plan.file.sessionId, list);
    }
    const order = [...bySession.values()].flatMap((list) =>
      [...list].sort((a, b) => b.file.fileIndex - a.file.fileIndex),
    );
    for (const plan of order) {
      if (q.kind === "fill" && q.file !== undefined && q.file !== plan.k) continue;
      for (const range of missing(plan, [0, plan.file.scanned]).reverse()) {
        fillSends.push({ kind: "range", plan, range, backward: true });
      }
    }
  }

  const total = (sends: Send[]) =>
    sends.map(sizeOf).reduce((t, s) => ({ bytes: t.bytes + s.bytes, lines: t.lines + s.lines }), {
      bytes: 0,
      lines: 0,
    });
  const filesOut = body !== null ? [body.plan] : [...plans.values()];
  const facts: HistoryFileFact[] = filesOut.map((plan) => ({
    k: plan.k,
    ino: plan.file.ino,
    dev: plan.file.dev,
    birthtimeMs: plan.file.birthtimeMs,
    size: plan.file.size,
    records: plan.file.starts.length,
    final: plan.file.final,
    ...(plan.reset ? { reset: true as const } : {}),
  }));
  return {
    window: {
      envelope: {
        ...(read?.page !== undefined ? { page: messagesPageInfo(read.page) } : {}),
        ...envelope,
        // Only the held inputs this window does not already hold, judged on its raw records —
        // `/messages`' own dedup, before any stub serves a record's image by reference: the hub
        // dedups again on what it assembles, where a stubbed image no longer equals its held
        // inline copy and would be appended a second time.
        pendingInputs:
          read === null
            ? envelope.pendingInputs
            : appendPendingInputs(read.messages, envelope.pendingInputs).slice(
                read.messages.length,
              ),
      },
      files: facts,
      layout,
      stubs,
      totals: { window: total(windowSends), heavy: total(heavySends), fill: total(fillSends) },
    },
    windowSends,
    heavySends,
    fillSends,
  };
}

/** Whole-line chunks of [start, end), read forward: each ends at a `\n` (start is a line start). */
async function* forwardChunks(path: string, start: number, end: number) {
  let pos = start;
  while (pos < end) {
    let to = Math.min(end, pos + READ_CHUNK);
    let bytes = await readRange(path, pos, to);
    let whole = bytes.lastIndexOf(NEWLINE) + 1;
    while (whole === 0 && to < end) {
      // One line longer than a chunk: read on to its end.
      to = Math.min(end, to + READ_CHUNK);
      bytes = await readRange(path, pos, to);
      whole = bytes.lastIndexOf(NEWLINE) + 1;
    }
    if (whole === 0) return; // no `\n` to the end: nothing whole to send
    yield { off: pos, bytes: bytes.subarray(0, whole) };
    pos += whole;
  }
}

/** Whole-line chunks of [start, end), read backward from `end` (both are line boundaries). */
async function* backwardChunks(path: string, start: number, end: number) {
  let hi = end;
  let span = READ_CHUNK;
  while (hi > start) {
    const lo = Math.max(start, hi - span);
    const bytes = await readRange(path, lo, hi);
    if (lo > start) {
      // Begin at a line start: just after the first `\n` that is not the chunk's last byte.
      const nl = bytes.indexOf(NEWLINE);
      if (nl === -1 || nl === bytes.length - 1) {
        span *= 2; // the chunk is one line's tail: widen and read again
        continue;
      }
      yield { off: lo + nl + 1, bytes: bytes.subarray(nl + 1) };
      hi = lo + nl + 1;
    } else {
      yield { off: lo, bytes };
      hi = lo;
    }
    span = READ_CHUNK;
  }
}

/** A line frame, or the parts of one line, as the unit the backward order keeps whole. */
function units(frames: Iterable<LineFrame | PartFrame>): Array<Array<LineFrame | PartFrame>> {
  const out: Array<Array<LineFrame | PartFrame>> = [];
  let open: Array<LineFrame | PartFrame> | null = null;
  for (const frame of frames) {
    if (!("last" in frame)) {
      out.push([frame]);
      continue;
    }
    open ??= [];
    open.push(frame);
    if (frame.last) {
      out.push(open);
      open = null;
    }
  }
  return out;
}

/**
 * A JSON text as `window-part` pieces whose event data stays within one frame: each piece's
 * escaped form (it rides inside a JSON string) is measured, not its length.
 */
function* windowParts(
  text: string,
  budget: number = FRAME_TEXT_BUDGET,
): Iterable<HistoryWindowPart> {
  let pos = 0;
  while (pos < text.length) {
    let n = Math.min(text.length - pos, budget);
    for (;;) {
      let end = pos + n;
      if (end < text.length && (text.charCodeAt(end - 1) & 0xfc00) === 0xd800) end -= 1;
      const piece = text.slice(pos, end);
      const last = end === text.length;
      if (JSON.stringify({ text: piece, last }).length <= budget || n <= 64) {
        yield { text: piece, last };
        pos = end;
        break;
      }
      n = Math.floor(n * 0.8);
    }
  }
}

/** A stream that cannot be served, said in the stream: it has begun, so no status is left. */
export async function sendHistoryLinesError(sink: EventSink, err: HttpError): Promise<void> {
  const error: HistoryStreamError = { code: err.code, message: err.message };
  const data = JSON.stringify(error);
  await sink.writable(data.length);
  await sink.send("error", null, data);
}

/** Sends one prepared stream's events (the plan is planHistoryLines'). */
export async function sendHistoryLines(sink: EventSink, plan: HistoryLinesPlan): Promise<void> {
  const emit = async (event: string, id: string | null, payload: unknown): Promise<void> => {
    const data = JSON.stringify(payload);
    await sink.writable(data.length);
    await sink.send(event, id, data);
  };
  const emitUnit = async (fp: FilePlan, unit: Array<LineFrame | PartFrame>) => {
    for (const frame of unit) {
      const after =
        frame.off + Buffer.byteLength(frame.text, frame.b64 === true ? "base64" : "utf8");
      const id = `${fp.k}@${after}`;
      if ("last" in frame) {
        const part: HistoryPartFrame = {
          k: fp.k,
          line: frame.line,
          off: frame.off,
          ord: recordsBefore(fp.file.starts, frame.line),
          text: frame.text,
          last: frame.last,
          ...(frame.b64 === true ? { b64: true as const } : {}),
        };
        await emit("part", id, part);
      } else {
        const lines: HistoryLinesFrame = {
          k: fp.k,
          off: frame.off,
          ord: recordsBefore(fp.file.starts, frame.off),
          text: frame.text,
          ...(frame.b64 === true ? { b64: true as const } : {}),
        };
        await emit("lines", id, lines);
      }
    }
  };
  const run = async (send: Send): Promise<void> => {
    const fp = send.plan;
    if (send.kind === "rest") {
      const bytes = await readRange(fp.file.path, send.from, send.end);
      await emitUnit(fp, [...partFrames(bytes, send.from, FRAME_TEXT_BUDGET, send.lineStart)]);
      return;
    }
    const [a, b] = send.range;
    const chunks = send.backward
      ? backwardChunks(fp.file.path, a, b)
      : forwardChunks(fp.file.path, a, b);
    for await (const { off, bytes } of chunks) {
      const ordered = units(lineFrames(bytes, off));
      if (send.backward) ordered.reverse();
      for (const unit of ordered) await emitUnit(fp, unit);
    }
  };
  // The window in one event when it fits a frame; otherwise in pieces of one frame each, so
  // nothing on the socket waits behind it longer than behind any line.
  const window = JSON.stringify(plan.window);
  if (window.length <= FRAME_TEXT_BUDGET) {
    await sink.writable(window.length);
    await sink.send("window", null, window);
  } else {
    for (const part of windowParts(window)) await emit("window-part", null, part);
  }
  for (const send of plan.windowSends) await run(send);
  await emit("ready", null, {});
  for (const send of plan.heavySends) await run(send);
  for (const send of plan.fillSends) await run(send);
  await emit("done", null, {});
}
