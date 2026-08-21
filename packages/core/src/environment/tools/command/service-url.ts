/**
 * Service-URL detection for command sessions: a dev server the conversation starts usually
 * prints its local URL ("Local: http://localhost:5173/"). The session scans its own output
 * stream as it is produced — core sees every chunk whether the command runs foreground or
 * background, so detection never depends on the model polling or on what reaches the
 * transcript. The scan is incremental: each chunk is inspected together with a small
 * carry-over tail of the previous one, so a URL (or the ANSI escape wrapping it) split
 * across chunk boundaries is still recognized; the LATEST hit wins — a server that
 * restarts on another port replaces the earlier URL, and output that prints none leaves
 * the last one standing.
 */

/**
 * Local-service URL: only hosts that mean "this machine" — a link to a remote host in
 * some log line is not the process's own service. Port and path are optional (a proxy on
 * port 80 prints a bare origin).
 */
const LOCAL_URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{1,5})?(?:\/[^\s"'`<>()[\]]*)?/gi;

/** ANSI CSI (colors, cursor) and OSC (title, hyperlink) sequences, which dev servers wrap around their URLs. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** Punctuation a sentence context glues onto a printed URL; the path's own trailing slash stays. */
const TRAILING_PUNCT_RE = /[.,;:!?'"]+$/;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** `0.0.0.0` / `[::]` are listen-side wildcards, not clickable hosts; rewrite them to localhost. */
function normalizeHost(url: string): string {
  return url
    .replace(/^(https?:\/\/)0\.0\.0\.0(?=[:/]|$)/i, "$1localhost")
    .replace(/^(https?:\/\/)\[::\](?=[:/]|$)/i, "$1localhost");
}

/**
 * The last local-service URL printed in `text`, ANSI-stripped, host-normalized and with
 * sentence punctuation trimmed; null when the text prints none.
 */
export function extractLastLocalUrl(text: string): string | null {
  const clean = stripAnsi(text);
  let last: string | null = null;
  for (const m of clean.matchAll(LOCAL_URL_RE)) {
    const trimmed = m[0].replace(TRAILING_PUNCT_RE, "");
    if (trimmed.length > 0) last = trimmed;
  }
  return last === null ? null : normalizeHost(last);
}

/**
 * Carry-over tail (characters) re-scanned with the next chunk. Long enough for any
 * realistic printed URL plus the ANSI wrapping around it; a match inside the carry that a
 * later chunk extends (the boundary cut it mid-URL) simply re-matches longer and replaces
 * itself under the latest-hit rule.
 */
const CARRY_CHARS = 256;

/** Incremental scanner over one session's output stream (see the module doc). */
export class ServiceUrlScanner {
  private carry = "";
  private latest: string | null = null;

  /** Feeds one output chunk; cheap enough to sit on the write path (window ≤ carry + chunk). */
  push(chunk: string): void {
    if (chunk.length === 0) return;
    const window = this.carry + chunk;
    const found = extractLastLocalUrl(window);
    if (found !== null) this.latest = found;
    this.carry = window.length > CARRY_CHARS ? window.slice(window.length - CARRY_CHARS) : window;
  }

  /** The latest local-service URL the stream printed; null before any hit. */
  get url(): string | null {
    return this.latest;
  }
}
