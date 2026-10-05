/**
 * A proposal comment as the page draws it, wherever it stands — under a section, beside a scope
 * or test entry, under a file of the diff — and the composer that writes one.
 *
 * A comment on a target names it when it is shown away from it (the list of comments on earlier
 * revisions). A comment on the diff written at commits the branches have since moved past is
 * outdated: it says so, and a line comment unfolds the lines it was written on, as they read then.
 */
import { useState } from "react";
import type { ProposalComment, ProposalCommentTarget } from "@prismshadow/penguin-server/api";
import { Badge, Button, Textarea } from "@prismshadow/penguin-ui";
import { isSubmitChord } from "../../lib/shortcuts/submit-chord";
import { S } from "../../lib/strings";
import { formatDateTime, formatRelativeShort } from "../../lib/format";
import { toneInk, toneSurface } from "../../lib/tone";
import { principalLabel } from "../company/shared";

/** A target in words: "Scope · edit src/a.ts", "Lines 3–5 (new) · src/a.ts". */
export function targetLabel(target: ProposalCommentTarget): string {
  const t = S.company.proposals.targets;
  switch (target.kind) {
    case "scope":
      return t.onScope(S.company.proposals.scopeKind[target.scopeKind], target.file);
    case "test":
      return t.onTest(target.file);
    case "change-file":
      return t.onFile(target.path);
    case "change-lines":
      return `${t.lines(target.side, target.start, target.end)} · ${target.path}`;
  }
}

/** The composer: what the comment is on, as a quote, the text, Add / Cancel; Ctrl/Cmd+Enter adds. */
export function CommentComposer({
  quote,
  busy,
  onCancel,
  onSubmit,
  label,
}: {
  quote: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<boolean>;
  /** The quote's caption; "Selected text" by default. */
  label?: string;
}) {
  const t = S.company.proposals;
  const [text, setText] = useState("");
  const submit = async () => {
    const value = text.trim();
    if (value === "") return;
    if (await onSubmit(value)) setText("");
  };
  return (
    <div className="mt-2 space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-800">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label ?? t.selectedText}</div>
      <blockquote className="max-h-40 overflow-y-auto border-l-2 border-gray-300 pl-2 text-xs whitespace-pre-wrap text-gray-700 dark:border-gray-600 dark:text-gray-200">
        {quote}
      </blockquote>
      <Textarea
        size="sm"
        rows={3}
        aria-label={t.addComment}
        placeholder={t.commentPlaceholder}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitChord(e)) void submit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onCancel} disabled={busy}>
          {S.common.cancel}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || text.trim() === ""}
          onClick={() => void submit()}
        >
          {t.addComment}
        </Button>
      </div>
    </div>
  );
}

/** One comment: the passage it is on, who, when, the text; its pending tag; and the resolution folded under it when there is one. */
export function CommentLine({
  comment,
  names,
  locale,
  focused = false,
  stale = false,
  outdated = false,
  showTarget = false,
  mine = false,
  busy = false,
  onEdit,
  onDelete,
}: {
  comment: ProposalComment;
  names: ReadonlyMap<string, string>;
  locale: "zh" | "en";
  /** Named by a click on its mark. */
  focused?: boolean;
  /** Its passage is not in the current revision. */
  stale?: boolean;
  /** On the diff at commits the branches have moved past. */
  outdated?: boolean;
  /** Name the target: the comment is listed away from it. */
  showTarget?: boolean;
  /** Written by the signed-in person: pending, it can still be reworded or withdrawn. */
  mine?: boolean;
  busy?: boolean;
  onEdit?: (commentId: string, text: string) => Promise<boolean>;
  onDelete?: (commentId: string) => Promise<boolean>;
}) {
  const t = S.company.proposals;
  const [showResolved, setShowResolved] = useState(false);
  const [showLines, setShowLines] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // Only a pending comment is still the writer's own; sent, it stands as the author read it.
  const editable =
    mine && comment.batchId === null && onEdit !== undefined && onDelete !== undefined;
  const saveEdit = async () => {
    if (editing === null || onEdit === undefined) return;
    const next = editing.trim();
    if (next === "" || next === comment.text) {
      setEditing(null);
      return;
    }
    if (await onEdit(comment.id, next)) setEditing(null);
  };
  const lines = comment.target?.kind === "change-lines";
  return (
    <div
      id={`comment-${comment.id}`}
      className={`rounded px-1 text-xs transition-colors duration-150 ${
        focused ? toneSurface.attention : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-gray-500 dark:text-gray-400">
        <span className="font-medium text-gray-700 dark:text-gray-200">
          {principalLabel(comment.by, names)}
        </span>
        <span data-tooltip={formatDateTime(comment.at)}>
          {formatRelativeShort(comment.at, locale)}
        </span>
        {comment.batchId === null && <Badge tone="attention">{t.pending}</Badge>}
        {outdated && (
          <span
            className={`rounded-sm px-1 ${toneSurface.attention}`}
            data-tooltip={t.targets.outdatedHint}
          >
            {t.targets.outdated}
          </span>
        )}
        {editable && editing === null && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(comment.text)}
              className="rounded px-1 text-gray-500 underline-offset-2 hover:underline disabled:opacity-50 dark:text-gray-400"
            >
              {S.common.edit}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onDelete?.(comment.id)}
              className={`rounded px-1 underline-offset-2 hover:underline disabled:opacity-50 ${toneInk.danger}`}
            >
              {S.common.delete}
            </button>
          </>
        )}
        {stale && comment.target === undefined && <span>{t.fromRevision(comment.revision)}</span>}
        {stale && comment.target !== undefined && (
          <span>{t.targets.onRevision(comment.revision)}</span>
        )}
        {comment.resolved !== undefined && (
          <button
            type="button"
            aria-expanded={showResolved}
            onClick={() => setShowResolved(!showResolved)}
            className={`rounded px-1 ${toneSurface.success}`}
          >
            {t.resolved}
          </button>
        )}
      </div>
      {comment.target !== undefined && (showTarget || lines) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-gray-500 dark:text-gray-400">
          <span className="min-w-0 break-all">{targetLabel(comment.target)}</span>
          {lines && outdated && (
            <button
              type="button"
              aria-expanded={showLines}
              onClick={() => setShowLines((v) => !v)}
              className="rounded px-1 font-sans underline-offset-2 hover:underline"
            >
              {showLines ? t.targets.hideLines : t.targets.showLines}
            </button>
          )}
        </div>
      )}
      {lines && outdated && showLines && (
        <pre className="mt-0.5 max-h-40 overflow-auto rounded border border-gray-200 bg-gray-50 px-2 py-1 font-mono whitespace-pre text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
          {comment.quote}
        </pre>
      )}
      {comment.target === undefined && (stale || focused) && comment.quote !== "" && (
        <blockquote className="mt-0.5 line-clamp-2 border-l-2 border-gray-300 pl-2 text-gray-600 dark:border-gray-600 dark:text-gray-300">
          {comment.quote}
        </blockquote>
      )}
      {editing !== null ? (
        <div className="mt-1 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Textarea
              size="sm"
              rows={2}
              aria-label={S.common.edit}
              value={editing}
              autoFocus
              onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => {
                if (isSubmitChord(e)) void saveEdit();
                if (e.key === "Escape") setEditing(null);
              }}
            />
          </div>
          <Button
            size="sm"
            disabled={busy || editing.trim() === ""}
            onClick={() => void saveEdit()}
          >
            {S.common.save}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(null)}>
            {S.common.cancel}
          </Button>
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap text-gray-800 dark:text-gray-100">
          {comment.text}
        </p>
      )}
      {comment.resolved !== undefined && showResolved && (
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          {t.resolvedNote(comment.resolved.text)} · {principalLabel(comment.resolved.by, names)}
        </p>
      )}
    </div>
  );
}
