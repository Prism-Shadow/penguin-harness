/**
 * Images by reference on windowed history pages.
 *
 * A Trace stores images inline, as base64 `data:` URLs: the user's `image_url` records and
 * the `images` of a tool output (a screenshot is ~1.5 MB of text). A windowed
 * `GET /messages` page replaces each of them with the URL of the route that serves that
 * one image from the Trace record, so a page costs its text and the browser fetches each
 * picture as it draws it. The parameterless full read is left alone.
 *
 * URL: `/api/sessions/<sessionId>/trace-image?file=<fileIndex>&ordinal=<ordinal>[&i=<k>]`,
 * where (file, ordinal) is the record's `tracePosition`; without `i` it names the record's
 * `image_url`, with `i` the tool output's `images[k]`. A Trace record never changes, so the
 * route answers it as immutable.
 *
 * Only raster types a browser renders inertly are referenced (the scratchpad route's
 * allowlist): the route serves bytes on the app's own origin, and an `image/svg+xml` or
 * `text/html` data URL served there would be a document, not a picture. Any other data URL
 * stays inline, where it is as harmless as it always was.
 */
import type {
  ImageUrlPayload,
  OmniMessage,
  ToolCallOutputPayload,
} from "@prismshadow/penguin-core";
import type { HistoryMessage, TracePosition } from "../api/types.js";

/** Image types the trace-image route serves (core's own supported set). */
const REFERENCED_IMAGE_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** A base64 image data URL the route can serve: its type, and where its payload starts. */
function referableImage(url: string): { mime: string; dataStart: number } | null {
  if (!url.startsWith("data:")) return null;
  const comma = url.indexOf(",");
  if (comma < 0 || comma === url.length - 1) return null;
  const header = url.slice("data:".length, comma).toLowerCase();
  if (!header.endsWith(";base64")) return null;
  const mime = header.slice(0, header.indexOf(";")).trim();
  return REFERENCED_IMAGE_MIMES.has(mime) ? { mime, dataStart: comma + 1 } : null;
}

/** The route URL of one image slot of the record at `at` (`slot` = index into a tool output's `images`). */
export function traceImageUrl(sessionId: string, at: TracePosition, slot?: number): string {
  const query = `file=${at.fileIndex}&ordinal=${at.ordinal}${slot !== undefined ? `&i=${slot}` : ""}`;
  return `/api/sessions/${encodeURIComponent(sessionId)}/trace-image?${query}`;
}

/**
 * The message as a windowed page serves it: each referable image of a main-session record
 * (one that carries its `tracePosition`) replaced by its route URL. Expanded subagent
 * messages carry no position and stay inline. The input is never mutated; a message with
 * nothing to replace is returned as is.
 */
export function withImagesByReference(sessionId: string, msg: HistoryMessage): HistoryMessage {
  const at = msg.tracePosition;
  if (at === undefined || msg.type !== "model_msg") return msg;
  const kind = (msg.payload as { type?: string }).type;
  if (kind === "image_url") {
    const payload = msg.payload as ImageUrlPayload;
    if (typeof payload.image_url !== "string" || referableImage(payload.image_url) === null) {
      return msg;
    }
    return { ...msg, payload: { ...payload, image_url: traceImageUrl(sessionId, at) } };
  }
  if (kind === "tool_call_output") {
    const payload = msg.payload as ToolCallOutputPayload;
    if (!Array.isArray(payload.images)) return msg;
    let replaced = false;
    const images = payload.images.map((image, k) => {
      if (typeof image !== "string" || referableImage(image) === null) return image;
      replaced = true;
      return traceImageUrl(sessionId, at, k);
    });
    if (replaced) return { ...msg, payload: { ...payload, images } };
  }
  return msg;
}

/**
 * The decoded image in one slot of a Trace record: the user image of an `image_url` record
 * (`slot` undefined) or a tool output's `images[slot]`. Null when that slot holds no image
 * the route serves — the same test the page applied before it handed out the URL.
 */
export function traceRecordImage(
  record: OmniMessage,
  slot: number | undefined,
): { mime: string; bytes: Buffer } | null {
  if (record.type !== "model_msg") return null;
  const p = record.payload as { type?: string; image_url?: unknown; images?: unknown };
  let url: unknown;
  if (slot === undefined) {
    url = p.type === "image_url" ? p.image_url : undefined;
  } else if (p.type === "tool_call_output" && Array.isArray(p.images)) {
    url = (p.images as unknown[])[slot];
  }
  if (typeof url !== "string") return null;
  const image = referableImage(url);
  if (image === null) return null;
  return { mime: image.mime, bytes: Buffer.from(url.slice(image.dataStart), "base64") };
}
