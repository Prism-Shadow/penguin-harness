/**
 * The machine leg's shared vocabulary (`GET …/history-lines`): how a Trace file is named on the
 * wire, how the hub's `have` travels, and the anchors both ends compute to tell a file that
 * only grew from one that was rewritten.
 *
 * Both ends import these, so the machine validates exactly what the hub computed: an anchor is
 * the sha256 of a byte range of the file, and the ranges are fixed by `lo`/`hi` alone (no line
 * parsing), so each end reads the same bytes from its own copy.
 */
import { createHash } from "node:crypto";
import type { HistoryFileKey, HistoryHave } from "../api/types.js";

/**
 * One `history-lines` call: what it reads — the newest `limit` units (`tail`), the units before
 * a cursor (`before`), the whole transcript (`full`), one heavy value's line (`body`, a
 * trace-body ref), or only the fill (`fill`, of one file when `file` is given) — and what the
 * hub holds. `budget` caps the window's bytes as the `history` stream sends its records;
 * `fill` after a window keeps the stream going until the Session's every file is whole.
 */
export type HistoryLinesQuery = { have: HistoryHave[] } & (
  | { kind: "tail"; limit: number; budget?: number; fill?: boolean }
  | { kind: "before"; cursor: string; limit: number; budget?: number; fill?: boolean }
  | { kind: "full"; fill?: boolean }
  | { kind: "body"; ref: string }
  | { kind: "fill"; file?: HistoryFileKey }
);

/** The path of one `history-lines` call (the hub prefixes nothing: it is the machine's own route). */
export function historyLinesPath(sessionId: string, q: HistoryLinesQuery): string {
  const params = new URLSearchParams();
  switch (q.kind) {
    case "tail":
      params.set("tailLimit", String(q.limit));
      break;
    case "before":
      params.set("before", q.cursor);
      params.set("limit", String(q.limit));
      break;
    case "full":
      params.set("full", "1");
      break;
    case "body":
      params.set("body", q.ref);
      break;
    case "fill":
      params.set("fill", "only");
      if (q.file !== undefined) params.set("file", q.file);
      break;
  }
  if ((q.kind === "tail" || q.kind === "before") && q.budget !== undefined) {
    params.set("budget", String(q.budget));
  }
  if ((q.kind === "tail" || q.kind === "before" || q.kind === "full") && q.fill === true) {
    params.set("fill", "1");
  }
  if (q.have.length > 0) params.set("have", encodeHistoryHave(q.have));
  return `/api/sessions/${encodeURIComponent(sessionId)}/history-lines?${params.toString()}`;
}

/** The longest run an anchor hashes. */
export const ANCHOR_BYTES = 4096;

/** The ceiling on an encoded `have=` (the socket path builds its Request in-process; this bounds the work). */
export const HAVE_MAX_CHARS = 64 * 1024;

/** The wire name of one Trace file. Agent and Session ids never hold a `/`. */
export function historyFileKey(
  agentId: string,
  sessionId: string,
  fileIndex: number,
): HistoryFileKey {
  return `${agentId}/${sessionId}/${fileIndex}`;
}

/** The parts of a file key, or null when it is not one. */
export function parseHistoryFileKey(
  k: string,
): { agentId: string; sessionId: string; fileIndex: number } | null {
  const parts = k.split("/");
  if (parts.length !== 3) return null;
  const [agentId, sessionId, index] = parts as [string, string, string];
  if (agentId === "" || sessionId === "" || !/^[1-9]\d{0,5}$/.test(index)) return null;
  return { agentId, sessionId, fileIndex: Number(index) };
}

/** sha256 of `bytes`, base64url. */
export function anchorOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("base64url");
}

/** The range `loAnchor` hashes: the first ≤ 4 KiB of the held run. */
export function loAnchorRange(lo: number, hi: number): [number, number] {
  return [lo, Math.min(hi, lo + ANCHOR_BYTES)];
}

/** The range `hiAnchor` hashes: the last ≤ 4 KiB of the held run. */
export function hiAnchorRange(lo: number, hi: number): [number, number] {
  return [Math.max(lo, hi - ANCHOR_BYTES), hi];
}

/** `have=` as it rides the query. */
export function encodeHistoryHave(have: readonly HistoryHave[]): string {
  return Buffer.from(JSON.stringify(have), "utf8").toString("base64url");
}

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** A `have=` value, or null when it is not one (the machine then answers 400). */
export function decodeHistoryHave(raw: string): HistoryHave[] | null {
  if (raw.length > HAVE_MAX_CHARS) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const out: HistoryHave[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const h = item as Record<string, unknown>;
    if (typeof h.k !== "string" || parseHistoryFileKey(h.k) === null) return null;
    if (!isCount(h.ino) || typeof h.birthtimeMs !== "number") return null;
    if (!isCount(h.lo) || !isCount(h.loOrd) || !isCount(h.hi) || h.hi < h.lo) return null;
    if (typeof h.loAnchor !== "string" || typeof h.hiAnchor !== "string") return null;
    let partial: HistoryHave["partial"];
    if (h.partial !== undefined) {
      const p = h.partial as Record<string, unknown> | null;
      if (p === null || typeof p !== "object") return null;
      if (!isCount(p.off) || !isCount(p.len) || typeof p.anchor !== "string") return null;
      partial = { off: p.off, len: p.len, anchor: p.anchor };
    }
    out.push({
      k: h.k,
      ino: h.ino,
      birthtimeMs: h.birthtimeMs,
      lo: h.lo,
      loOrd: h.loOrd,
      hi: h.hi,
      loAnchor: h.loAnchor,
      hiAnchor: h.hiAnchor,
      ...(partial !== undefined ? { partial } : {}),
    });
  }
  return out;
}
