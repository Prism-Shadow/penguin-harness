/**
 * File summary card for a supplied assistant-text scope: the root conversation passes a
 * completed Task's aggregated assistant text, while nested conversations — which don't produce
 * task_stats — pass one settled assistant message to preserve their existing behavior. Extracts
 * inline-code paths heuristically via isFilePathLike, normalizes them to Workspace-relative
 * paths, confirms they actually exist via files/stat, and renders them as the UI package's
 * ChangesCard — an "N files" card whose rows open the Files panel, folded past 3 rows.
 *
 * The card waits for stat results and doesn't render when no candidate exists. It intentionally
 * does not claim these files were changed: opaque exec_command shells provide no reliable
 * structured edit signal, so this is only an aggregated view of text references that are
 * currently openable.
 */
import { useEffect, useMemo, useState } from "react";
import { ChangesCard, ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { isFilePathLike, toWorkspaceRelative } from "../../lib/file-path";

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

export function MessageFilesCard({
  text,
  workspace,
  statFiles,
  onOpenFile,
}: {
  /** Raw Markdown from the assistant scope being summarized (a root Task or one nested message). */
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

  if (paths === null || paths.length === 0) return null;

  // Each row shows its full path as its tooltip (the row itself may truncate it), and says in
  // words that a click previews it — no card-level action: every row already has its own.
  return (
    <ChangesCard
      glyph={ICONS.file}
      title={S.chat.filesInMessage(paths.length)}
      rows={paths.map((path) => ({
        id: path,
        path,
        glyph: ICONS.file,
        tooltip: path,
        onOpen: () => onOpenFile(path),
      }))}
      openHint={S.chat.openPreview}
      showMore={S.chat.showMoreFiles}
      showLess={S.chat.showLess}
    />
  );
}
