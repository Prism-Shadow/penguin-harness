/**
 * Recording a scene composition to a video (experimental, behind `activityVideoExperiment`).
 *
 * The composition (see composition.ts) is opened once in the test browser (see
 * browser-session.ts) with Playwright's own page recorder on, at the composition's canvas
 * size; once its bridge says it is ready, the timeline is sought to its start and played, and
 * the page is left to play for the composition's length and half a second more. Closing the
 * page's context is what finishes the file. What comes out is a WebM: there is no FFmpeg and no
 * other encoder, and the file is kept as the recorder wrote it.
 *
 * Known limit: the recorder starts with the page, so a recording opens with a short blank
 * lead-in (the page loading, before the timeline plays). Trimming it would need an encoder,
 * which Penguin does not ship; the App says so beside the recording.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { openPage, type BrowserLauncher } from "./browser-session.js";
import type { VideoProblemCode } from "./video-types.js";

/** How long the browser may take to start and the composition to load, and each page action. */
export const RENDER_PAGE_TIMEOUT_MS = 30_000;
/** Played past the composition's end, so its last frame is on the recording. */
export const RENDER_TAIL_MS = 500;
/** The longest a recording plays: the longest composition (60 s), its tail, and some slack. */
export const RENDER_MAX_MS = 65_000;
/** The largest recording kept. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;


/** Waits for the bridge's promise and answers the length the page says it plays for. */
const READY_SCRIPT =
  "Promise.resolve(window.__composition && window.__composition.ready).then(function () {" +
  " var c = window.__composition; return c && typeof c.duration === 'number' ? c.duration : 0; })";

/** Seeks the timeline to its start and plays it; false when the page has no timeline. */
const PLAY_SCRIPT =
  "(function () { var c = window.__composition; var t = c && c.timeline;" +
  " if (!t || typeof t.play !== 'function') return false;" +
  " if (typeof t.seek === 'function') t.seek(0); t.play(); return true; })()";

export interface RenderRequest {
  executablePath: string;
  /** The composition page, on a link the test browser on this machine can open. */
  compositionUrl: string;
  width: number;
  height: number;
  /** How long the composition was checked to play, used when the page says nothing. */
  seconds: number;
  /** Where the recorder writes; the caller's to remove. */
  dir: string;
  launcher?: BrowserLauncher;
  /** How long each page step may take; `RENDER_PAGE_TIMEOUT_MS` unless a test shortens it. */
  pageTimeoutMs?: number;
}

/** Why a recording did not come out, with the code the App words it by when Penguin knows it. */
export class RenderError extends Error {
  constructor(
    message: string,
    readonly code: VideoProblemCode | null = null,
  ) {
    super(message);
  }
}

/**
 * Bounds a page step. `page.evaluate` does not honour the page's default timeout, and the page is
 * agent-written: a `ready` promise that never settles, or a page that blocks its main thread,
 * would otherwise hold the recording (and its browser) forever.
 */
function within<T>(work: Promise<T>, ms: number, error: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error()), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** How long a recording plays for a composition of this length: its length and a tail, bounded. */
export function recordingMs(seconds: number): number {
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  return Math.min(Math.round(ms) + RENDER_TAIL_MS, RENDER_MAX_MS);
}

/**
 * Plays the composition once in the test browser and records it. Answers the path of the WebM
 * the recorder wrote. The browser is closed whatever happens.
 */
export async function renderComposition(request: RenderRequest): Promise<string> {
  await fs.mkdir(request.dir, { recursive: true });
  const stepMs = request.pageTimeoutMs ?? RENDER_PAGE_TIMEOUT_MS;
  const late = () =>
    new RenderError("The recording took longer than it may and was stopped.", "video_timeout");
  const session = await openPage(
    request.executablePath,
    request.compositionUrl,
    { width: request.width, height: request.height },
    {
      timeoutMs: stepMs,
      recordVideoDir: request.dir,
      ...(request.launcher ? { launcher: request.launcher } : {}),
    },
  );
  try {
    const { page } = session;
    const reported = Number(
      await within(
        page.evaluate(READY_SCRIPT),
        stepMs,
        () => new RenderError("The composition did not become ready to play.", "video_not_ready"),
      ),
    );
    const seconds = Number.isFinite(reported) && reported > 0 ? reported : request.seconds;
    if (!(await within(page.evaluate(PLAY_SCRIPT), stepMs, late)))
      throw new RenderError("The composition has no timeline to play.", "video_no_timeline");
    const playMs = recordingMs(seconds);
    await within(page.waitForTimeout(playMs), playMs + stepMs, late);
    const video = page.video();
    // The recorder finishes its file when the page's context closes.
    await within(page.context().close(), stepMs, late);
    if (!video) throw new RenderError("The browser did not record the composition.");
    const file = await video.path();
    const inside = path.relative(path.resolve(request.dir), path.resolve(file));
    if (inside.startsWith("..") || path.isAbsolute(inside))
      throw new RenderError("The recording was written outside its directory.");
    return file;
  } finally {
    await session.close();
  }
}

/** Why a file is not a recording Penguin keeps. */
export class WebmError extends Error {
  constructor(
    message: string,
    readonly code: "video_invalid" | "video_too_large" = "video_invalid",
  ) {
    super(message);
  }
}

/**
 * Reads an EBML variable-length integer at `offset`: its value and how many bytes it took.
 * `keepMarker` keeps the length marker, as element ids are written.
 */
function vint(bytes: Uint8Array, offset: number, keepMarker: boolean) {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 8 || offset + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  for (let index = 1; index < length; index += 1) value = value * 256 + bytes[offset + index]!;
  return { value, length };
}

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const DOC_TYPE_ID = 0x4282;

/**
 * Checks that bytes are a WebM Penguin keeps: an EBML header whose document type is `webm`, at
 * most 100 MB. Answers its digest and size; throws a `WebmError` otherwise.
 */
export function inspectWebm(input: Uint8Array): { sha256: string; bytes: number } {
  const bytes = input;
  const invalid = (detail: string) => new WebmError(`The recording is not a WebM video: ${detail}`);
  if (bytes.length > VIDEO_MAX_BYTES)
    throw new WebmError("The recording is larger than 100 MB.", "video_too_large");
  if (bytes.length < 8 || EBML_MAGIC.some((byte, index) => bytes[index] !== byte))
    throw invalid("it has no EBML header.");
  const size = vint(bytes, 4, false);
  if (!size) throw invalid("its header is cut short.");
  const start = 4 + size.length;
  const end = start + size.value;
  if (end > bytes.length) throw invalid("its header is cut short.");
  let docType: string | null = null;
  for (let offset = start; offset < end;) {
    const id = vint(bytes, offset, true);
    if (!id) throw invalid("its header is malformed.");
    const length = vint(bytes, offset + id.length, false);
    if (!length) throw invalid("its header is malformed.");
    const body = offset + id.length + length.length;
    if (body + length.value > end) throw invalid("its header is malformed.");
    if (id.value === DOC_TYPE_ID)
      docType = Buffer.from(bytes.subarray(body, body + length.value))
        .toString("latin1")
        .replace(/\0+$/, "");
    offset = body + length.value;
  }
  if (docType !== "webm") throw invalid(`its document type is ${docType ?? "missing"}.`);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

/** Reads a recording from disk: a regular file, never a link, and at most 100 MB. */
export async function readVideoFile(file: string): Promise<Buffer> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new WebmError("The recording is not a regular file.");
  if (stat.size > VIDEO_MAX_BYTES)
    throw new WebmError("The recording is larger than 100 MB.", "video_too_large");
  const bytes = await fs.readFile(file);
  if (bytes.length > VIDEO_MAX_BYTES)
    throw new WebmError("The recording is larger than 100 MB.", "video_too_large");
  return bytes;
}
