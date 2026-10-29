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
import type { BigIntStats } from "node:fs";
import type { HistoryFileKey, HistoryHave, HistoryHeldRange } from "../api/types.js";

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

/** What says a Trace file is still the one a copy was taken of (see `sameHistoryFile`). */
export interface HistoryFileIdentity {
  /** The inode, decimal: an NTFS file id passes 2^53. */
  ino: string;
  /** The device, decimal. Reported, never compared: on overlayfs it can change across a restart. */
  dev: string;
  /** The birth time in whole milliseconds, or 0 where the platform keeps none. */
  birthtimeMs: number;
}

/**
 * A file's identity from a `bigint` stat. A birth time equal to the change time is no birth
 * time: where Linux has no statx (old kernels, old container seccomp profiles) libuv reports
 * the change time in its place, which moves on every append, and comparing it would reset the
 * live file on every open. Such a file reports 0, and only inode and content identify it.
 */
export function fileIdentityOf(
  stat: Pick<BigIntStats, "ino" | "dev" | "birthtimeMs" | "ctimeMs">,
): HistoryFileIdentity {
  return {
    ino: stat.ino.toString(),
    dev: stat.dev.toString(),
    birthtimeMs: stat.birthtimeMs !== stat.ctimeMs ? Number(stat.birthtimeMs) : 0,
  };
}

/**
 * Whether a held copy and the file now are one file, by identity alone: the same inode, and the
 * same birth time where both sides know one. The device is not compared. Content is the rest of
 * the check — size, line edges, ordinals and the anchors of every held run (history-lines.ts).
 */
export function sameHistoryFile(
  held: Pick<HistoryFileIdentity, "ino" | "birthtimeMs"> & { dev?: string },
  now: Pick<HistoryFileIdentity, "ino" | "birthtimeMs"> & { dev?: string },
): boolean {
  if (held.ino !== now.ino) return false;
  return held.birthtimeMs === 0 || now.birthtimeMs === 0 || held.birthtimeMs === now.birthtimeMs;
}

/** The longest run an anchor hashes. */
export const ANCHOR_BYTES = 4096;

/** The ceiling on an encoded `have=` (the socket path builds its Request in-process; this bounds the work). */
export const HAVE_MAX_CHARS = 256 * 1024;

/** The id alphabet of Agents and Sessions (core's isValidId): a key is never a path. */
const ID = /^[A-Za-z0-9_-]+$/;

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
  if (!ID.test(agentId) || !ID.test(sessionId) || !/^[1-9]\d{0,5}$/.test(index)) return null;
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

/** A file id as the wire carries it: a decimal string, or (from a hub not yet moved) a count. */
function decimalId(v: unknown): string | null {
  if (typeof v === "string") return /^\d{1,40}$/.test(v) ? v : null;
  return isCount(v) ? String(v) : null;
}

function heldRange(v: unknown): HistoryHeldRange | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (!isCount(r.lo) || !isCount(r.loOrd) || !isCount(r.hi) || r.hi < r.lo) return null;
  if (typeof r.loAnchor !== "string" || typeof r.hiAnchor !== "string") return null;
  return { lo: r.lo, loOrd: r.loOrd, hi: r.hi, loAnchor: r.loAnchor, hiAnchor: r.hiAnchor };
}

/**
 * A `have=` value, or null when it is not one (the machine then answers 400). Each entry comes
 * back with every run it names in `ranges` — a single-run entry (its run beside `k`) included.
 */
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
    const ino = decimalId(h.ino);
    const dev = h.dev === undefined ? undefined : decimalId(h.dev);
    if (ino === null || dev === null || typeof h.birthtimeMs !== "number") return null;
    let ranges: HistoryHeldRange[] = [];
    if (h.ranges !== undefined) {
      if (!Array.isArray(h.ranges)) return null;
      for (const r of h.ranges) {
        const range = heldRange(r);
        if (range === null) return null;
        ranges.push(range);
      }
    } else if (h.lo !== undefined || h.hi !== undefined) {
      const range = heldRange(h);
      if (range === null) return null;
      ranges = [range];
    }
    let partial: HistoryHave["partial"];
    if (h.partial !== undefined) {
      const p = h.partial as Record<string, unknown> | null;
      if (p === null || typeof p !== "object") return null;
      if (!isCount(p.off) || !isCount(p.len) || typeof p.anchor !== "string") return null;
      partial = { off: p.off, len: p.len, anchor: p.anchor };
    }
    out.push({
      k: h.k,
      ino,
      ...(dev !== undefined ? { dev } : {}),
      birthtimeMs: h.birthtimeMs,
      ranges,
      ...(partial !== undefined ? { partial } : {}),
    });
  }
  return out;
}
