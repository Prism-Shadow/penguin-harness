/**
 * Message-level file summary card (visual reference: Codex's "files changed" card): extracts
 * file paths from inline code in the assistant's text (heuristic via isFilePathLike), normalizes
 * them to Workspace-relative paths, confirms they actually exist via files/stat, and aggregates
 * them into a unified card at the end of the message — a light-background single-line header bar
 * ("N files") + a list of file rows inside the card; each row's path is split into a "faded
 * directory / bold filename" pair, with a "Preview" label at the end of the row making the action
 * explicit, and clicking the whole row navigates to the Files panel preview for that relative
 * path via onOpenFile. Collapses when there are more than 3 rows.
 * The whole card doesn't render until the stat result comes back (to avoid a flash-then-disappear);
 * it also doesn't render if none of the candidates exist — the heuristic extraction inevitably
 * matches error message examples, external paths, and other strings that can't actually be
 * opened, so this card is only responsible for "if you click it, it really opens".
 * Doesn't include diff stats — file writes may happen inside opaque run_command shells, so
 * the protocol has no reliable structured edit signal; this is just an aggregated view of
 * text references, hence the neutral "N files" title.
 */
import { useEffect, useMemo, useState } from "react";
import { S } from "../../lib/strings";
import { isFilePathLike, toWorkspaceRelative } from "../../lib/file-path";

const MAX_VISIBLE = 3;

/** Extracts file paths from inline code in raw Markdown (deduplicated, preserving order of appearance). */
export function extractFilePaths(markdown: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of markdown.matchAll(/`([^`\n]+)`/g)) {
    const text = m[1]!.trim();
    if (!isFilePathLike(text) || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/** Path split into segments: directory prefix faded, filename bold (Codex-style). The directory
 *  segment has shrink-[9999] and collapses first, the filename segment truncates only after —
 *  both segments are truncatable, so the row never overflows its container on a narrow panel. */
function PathLabel({ path }: { path: string }) {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  return (
    <span className="flex min-w-0 items-baseline font-mono text-sm">
      {dir && (
        <span className="min-w-0 shrink-[9999] truncate text-gray-400 dark:text-gray-500">
          {dir}
        </span>
      )}
      <span className="min-w-0 truncate font-semibold text-gray-800 dark:text-gray-100">
        {name}
      </span>
    </span>
  );
}

export function MessageFilesCard({
  text,
  workspace,
  statFiles,
  onOpenFile,
}: {
  /** Raw Markdown text of the assistant message. */
  text: string;
  /** Absolute Workspace path of the current Session (used to normalize absolute paths found in the text). */
  workspace: string | null;
  /** Batched existence check (provided by chat-page, with a session-level cache): returns the set of relative paths confirmed to exist. */
  statFiles: (paths: string[]) => Promise<ReadonlySet<string>>;
  onOpenFile: (path: string) => void;
}) {
  // Candidates: lexical extraction -> normalize to Workspace-relative paths (discard ones that
  // can't be normalized) -> deduplicate keyed by the normalized result (used for both display and onOpenFile).
  const candidates = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of extractFilePaths(text)) {
      const rel = toWorkspaceRelative(raw, workspace);
      if (rel === null || seen.has(rel)) continue;
      seen.add(rel);
      out.push(rel);
    }
    return out;
  }, [text, workspace]);

  // null = stat hasn't returned yet (don't render, to avoid a flash-then-disappear); once returned, only list paths confirmed to exist.
  const [paths, setPaths] = useState<string[] | null>(null);
  useEffect(() => {
    setPaths(null);
    if (candidates.length === 0) return;
    let cancelled = false;
    statFiles(candidates)
      .then((existing) => {
        if (!cancelled) setPaths(candidates.filter((p) => existing.has(p)));
      })
      // Query failure keeps it unrendered: the error has already been cleared by the cache layer, so the next mount will re-query.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [candidates, statFiles]);

  const [expanded, setExpanded] = useState(false);
  if (paths === null || paths.length === 0) return null;

  const visible = expanded ? paths : paths.slice(0, MAX_VISIBLE);
  const hidden = paths.length - visible.length;

  return (
    <div className="anim-msg my-3 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      {/* Header bar: a single line of "icon + N files", light background to distinguish it from
          the rows (Codex-style). No card-level action entry point — each row already has its own
          "Preview", adding one to the header would just duplicate the row action. */}
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800/60 dark:bg-gray-800/40">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden
          className="shrink-0 text-gray-400"
        >
          <path d="M6 3h8l4 4v14H6zM14 3v4h4" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {S.chat.filesInMessage(paths.length)}
        </span>
      </div>
      {/* File row list: thin dividers within the card, clicking a row opens it in the Files panel preview. */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
        {visible.map((path) => (
          <button
            key={path}
            type="button"
            title={path}
            onClick={() => onOpenFile(path)}
            className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden
              className="shrink-0 text-gray-400"
            >
              <path d="M6 3h8l4 4v14H6zM14 3v4h4" />
            </svg>
            <PathLabel path={path} />
            <span className="min-w-0 flex-1" />
            {/* Right-aligned "click to preview" text: makes the row action explicit (a trailing
                chevron would read as expand/collapse instead). The whole row is already a
                <button> (buttons can't nest), so this uses a span, and the click still targets
                the whole row. */}
            <span
              aria-hidden
              className="shrink-0 text-xs text-gray-400 transition-colors duration-150 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300"
            >
              {S.chat.openPreview}
            </span>
          </button>
        ))}
        {(hidden > 0 || expanded) && paths.length > MAX_VISIBLE && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50"
          >
            {expanded ? S.chat.showLess : S.chat.showMoreFiles(hidden)}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
