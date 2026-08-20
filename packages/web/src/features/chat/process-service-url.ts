/**
 * Service-URL detection for the background-process list: a dev server the conversation
 * starts usually prints its local URL ("Local: http://localhost:5173/"), and that text is
 * already in the transcript — exec_command's promotion note names the process_id the
 * output belongs to, and every input_command call carries its process_id in the
 * arguments. Scanning those tool outputs attaches a clickable URL to a process row
 * without any server round-trip; a URL printed later (a server that restarts on another
 * port) replaces the earlier one, and a poll that prints no URL leaves the last one
 * standing.
 */
import type { ChatItem } from "../../lib/omni/stream-model";

/** exec_command / input_command notes that bind an output text to a process id. */
const PROCESS_NOTE_RE = /\[process (?:still )?running with process_id ([^\s\];,]+)/g;

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

/** Display label for a detected URL: the scheme is noise at 11px — the row links, the tooltip carries the full form. */
export function serviceUrlLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

/** input_command arguments name their process id; tolerate partially streamed JSON. */
function processIdFromArgs(argumentsText: string): string | null {
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    if (parsed !== null && typeof parsed === "object") {
      const id = (parsed as Record<string, unknown>)["process_id"];
      if (typeof id === "string" && id.length > 0) return id;
    }
  } catch {
    const m = /"process_id"\s*:\s*"([^"]+)"/.exec(argumentsText);
    if (m) return m[1] ?? null;
  }
  return null;
}

function scanItems(items: readonly ChatItem[], urls: Map<string, string>): void {
  for (const item of items) {
    if (item.kind === "subagent") {
      scanItems(item.model.items, urls);
      continue;
    }
    if (item.kind !== "tool_call") continue;
    if (item.subagent) scanItems(item.subagent.items, urls);
    if (item.name !== "exec_command" && item.name !== "input_command") continue;
    if (item.output.length === 0) continue;

    const ids = new Set<string>();
    for (const m of item.output.matchAll(PROCESS_NOTE_RE)) {
      const id = m[1];
      if (id !== undefined) ids.add(id);
    }
    if (item.name === "input_command") {
      const id = processIdFromArgs(item.argumentsText);
      if (id !== null) ids.add(id);
    }
    if (ids.size === 0) continue;

    const url = extractLastLocalUrl(item.output);
    if (url === null) continue;
    for (const id of ids) urls.set(id, url);
  }
}

/**
 * process_id → last service URL its output printed, walked over the whole loaded
 * transcript in order (nested subagent conversations included — their processes register
 * in the same environment list). Processes that never printed a local URL are absent.
 */
export function detectProcessServiceUrls(items: readonly ChatItem[]): Map<string, string> {
  const urls = new Map<string, string>();
  scanItems(items, urls);
  return urls;
}
