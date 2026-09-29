/**
 * Serving a media file to a running preview.
 *
 * Loom proxies `/media/*` out of its media clone with range handling tuned for `<video>`.
 * Penguin serves the same thing from the draft's own media directory, which is what makes
 * a newly saved file appear in the preview without another assembly run.
 *
 * The response assembly is separated from the filesystem so the header arithmetic — which
 * is where range serving actually goes wrong — is testable without a socket.
 */
import { ifRangeMatches, parseByteRange, type ByteRange } from "./sandbox-model.js";

/** Content types this origin will name. Anything else is served as bytes. */
const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
  // The WAF media root carries its fonts as a stylesheet beside the font files, and a
  // module's definition requires that stylesheet from there.
  ".css": "text/css; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/**
 * The content type for a file, by extension.
 *
 * `application/octet-stream` rather than a guess: a player handed the wrong type fails in
 * ways that look like a broken file, and sniffing is what `nosniff` exists to prevent.
 */
export function mediaContentType(pathname: string): string {
  const dot = pathname.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MEDIA_TYPES[pathname.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

export interface MediaFileFacts {
  size: number;
  /** Last modification time in epoch milliseconds, for the validator. */
  mtimeMs: number;
}

/** A strong validator over size and modification time, which is what `If-Range` compares. */
export function mediaEtag(facts: MediaFileFacts): string {
  return `"${facts.size.toString(16)}-${Math.floor(facts.mtimeMs).toString(16)}"`;
}

/**
 * The `?v=` a payload puts on a media URL: the file's own size and modification time.
 *
 * Per file rather than per draft, like Loom's dev-sandbox: a file can change without the
 * draft changing (a checkout pull, an LFS fetch replacing a pointer), and a URL that stays
 * the same across such a change is exactly what a year-long cache must never see.
 */
export function mediaVersion(facts: MediaFileFacts): string {
  return `${Math.floor(facts.mtimeMs).toString(36)}-${facts.size.toString(36)}`;
}

/** How long a response whose `?v=` names the bytes it carries may be kept: for good. */
const IMMUTABLE = "private, max-age=31536000, immutable";
/** Anything else is kept but asked about each time; the ETag turns the ask into a 304. */
const REVALIDATE = "private, no-cache";

export interface MediaResponsePlan {
  status: 200 | 206 | 304 | 416;
  headers: Record<string, string>;
  /** The byte range to send, or null for the whole file. Absent for 304 and 416. */
  range: ByteRange | null;
}

/**
 * What to send for one media request.
 *
 * Kept whole and pure so the cases that matter can be checked: a partial response whose
 * `Content-Range` disagrees with its `Content-Length` is a bug no test of the happy path
 * would ever find.
 */
export function planMediaResponse(
  pathname: string,
  facts: MediaFileFacts,
  request: {
    range?: string | null;
    ifRange?: string | null;
    ifNoneMatch?: string | null;
    /** The URL's `?v=`, when it had one. */
    version?: string | null;
  },
): MediaResponsePlan {
  const etag = mediaEtag(facts);
  const base: Record<string, string> = {
    ETag: etag,
    "Accept-Ranges": "bytes",
    "Content-Type": mediaContentType(pathname),
    // A preview's media is a draft's working file and changes under the same path. Only a
    // URL whose version names THIS file's bytes may be cached for good; a stale or missing
    // version is revalidated, so a replaced file shows on the next request.
    "Cache-Control":
      request.version && request.version === mediaVersion(facts) ? IMMUTABLE : REVALIDATE,
    "X-Content-Type-Options": "nosniff",
  };

  if (request.ifNoneMatch && request.ifNoneMatch.trim() === etag)
    return { status: 304, headers: base, range: null };

  // A range is honoured only while the client is looking at the file it last saw.
  // Otherwise a video plays two halves of two different takes.
  const rangeable = ifRangeMatches(request.ifRange, etag);
  const parsed = rangeable ? parseByteRange(request.range, facts.size) : null;

  if (parsed === "unsatisfiable")
    return {
      status: 416,
      headers: { ...base, "Content-Range": `bytes */${facts.size}` },
      range: null,
    };

  if (parsed)
    return {
      status: 206,
      headers: {
        ...base,
        "Content-Range": `bytes ${parsed.start}-${parsed.end}/${facts.size}`,
        "Content-Length": String(parsed.length),
      },
      range: parsed,
    };

  return {
    status: 200,
    headers: { ...base, "Content-Length": String(facts.size) },
    range: null,
  };
}
