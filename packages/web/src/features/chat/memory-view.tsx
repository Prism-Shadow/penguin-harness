/**
 * Chat side panel's Memory view — the Files panel's sibling view (see files-panel.tsx):
 * this conversation's memory changes with a per-call diff for each file, then the Agent's
 * memory itself (both scopes' topic lists, read-only), the same data the agent-settings
 * memory tab shows and the same server routes. Management (add / edit / delete) stays on
 * that tab — the header links there — so this view never duplicates the bridge-modal flows.
 *
 * A locate request (clicking a row in the message's memory-changes card) expands that row's
 * diffs, scrolls to it and flashes a highlight. Diffs replay the structured tool record kept
 * on the row (see lib/omni/memory-changes.ts): an edit renders old/new as removed/added
 * lines, a full write renders the written content as added lines — there is no "before"
 * in the transcript for a write, so a rewrite is shown as the new content, labeled a rewrite.
 */
import { useEffect, useRef, useState } from "react";
import type { MemoryFileInfo, MemoryScopeInfo, SessionInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatRelativeDate } from "../../lib/format";
import { bodyWithoutFrontmatter } from "../../lib/frontmatter";
import { diffLines } from "../../lib/line-diff";
import type { DiffLine } from "../../lib/line-diff";
import type {
  MemoryChangeEvent,
  MemoryChangeRow,
  MemoryLocateTarget,
} from "../../lib/omni/memory-changes";
import { memoryRowKey } from "../../lib/omni/memory-changes";
import { useLocale } from "../../state/locale";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { Chevron } from "../../components/ui/chevron";
import { SkeletonList } from "../../components/ui/skeleton";
import { Md } from "./md";
import { PathLabel } from "./message-files-card";

/** Person (User scope), folder (Workspace scope), page-with-plus (full write), pencil (edit), boxed arrow (open the settings tab), left arrow (back to the lists). */
const USER_ICON = "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z";
const FOLDER_ICON = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";
const WRITE_ICON = "M6 3h8l4 4v14H6zM12 11v6M9 14h6";
const EDIT_ICON = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z";
const OPEN_SETTINGS_ICON =
  "M14 4h6v6M20 4 10 14M9 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3";
const BACK_ICON = "M19 12H5m6-6-6 6 6 6";

/** The scope glyph + tooltip pair, shared by change rows and browse groups. */
export function scopeGlyph(scope: "user" | "workspace", scopeKey?: string) {
  return {
    d: scope === "user" ? USER_ICON : FOLDER_ICON,
    title: scope === "user" ? S.memory.userScope : S.chat.memoryScopeWorkspace(scopeKey ?? ""),
  };
}

/** One call's diff rows: an edit diffs its old/new snippets, a write lists the written content as additions. */
function eventDiff(event: MemoryChangeEvent): DiffLine[] | null {
  if (event.op === "edit") {
    if (event.oldString === undefined && event.newString === undefined) return null;
    return diffLines(event.oldString ?? "", event.newString ?? "");
  }
  if (event.content === undefined) return null;
  return diffLines("", event.content);
}

/** Colored diff listing (GitHub-style backgrounds; the +/− prefixes don't enter a copy selection). */
function DiffBlock({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-gray-200 font-mono text-xs leading-5 dark:border-gray-800">
      {lines.map((line, i) => (
        <div
          key={i}
          className={`flex whitespace-pre-wrap break-all px-2 ${
            line.type === "add"
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : line.type === "del"
                ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                : "text-gray-500 dark:text-gray-400"
          }`}
        >
          <span aria-hidden className="w-4 shrink-0 select-none">
            {line.type === "add" ? "+" : line.type === "del" ? "−" : ""}
          </span>
          <span className="min-w-0 flex-1">{line.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

/** The label above one call's diff: ordinal (when the file was changed more than once) + what the call did. */
function eventLabel(event: MemoryChangeEvent, index: number, total: number): string {
  const op =
    event.op === "edit"
      ? S.chat.memoryOpEdit + (event.replaceAll === true ? S.chat.memoryReplaceAll : "")
      : index > 0
        ? S.chat.memoryOpRewrite
        : S.chat.memoryOpWrite;
  return total > 1 ? `${S.chat.memoryEventNth(index + 1)} · ${op}` : op;
}

interface ScopeFiles {
  info: MemoryScopeInfo;
  files: MemoryFileInfo[];
}

/** Browse-group title: the User scope's fixed label, or the Workspace directory's basename. */
function scopeTitle(info: MemoryScopeInfo): string {
  return info.kind === "user"
    ? S.memory.userScope
    : (info.workspacePath?.split(/[\\/]/).filter(Boolean).at(-1) ?? info.scopeKey);
}

export function ChatMemoryView({
  session,
  changes,
  request,
  onOpenSettings,
}: {
  session: SessionInfo;
  /** This conversation's aggregated memory changes (chat-page derives them from the stream's task_stats items). */
  changes: MemoryChangeRow[];
  /** Locate command from openMemory (object identity re-triggers); target null = just show the view. */
  request: { target: MemoryLocateTarget | null } | null;
  /** Opens the agent-settings memory tab, where management (add / edit / delete) lives. */
  onOpenSettings?: () => void;
}) {
  const { locale } = useLocale();

  // ---- browse state (the Agent's memory as it is now) ----
  const [scopes, setScopes] = useState<ScopeFiles[] | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{
    scope: MemoryScopeInfo;
    file: MemoryFileInfo;
    content: string;
  } | null>(null);
  const [busyFile, setBusyFile] = useState<string | null>(null);

  // Load the listing on mount, and reload whenever this conversation lands new changes —
  // `changes` identity moves once per settled Task, so this stays cheap and the listing
  // never shows a file the transcript just rewrote at its old mtime.
  useEffect(() => {
    let cancelled = false;
    setBrowseError(null);
    void (async () => {
      try {
        const overview = await api.getMemoryOverview(session.projectId, session.agentId);
        const loaded = await Promise.all(
          overview.scopes.map(async (info) => ({
            info,
            files: (await api.getMemoryFiles(session.projectId, session.agentId, info.scopeKey))
              .files,
          })),
        );
        if (!cancelled) setScopes(loaded);
      } catch (err) {
        if (!cancelled) setBrowseError(apiErrorText(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.projectId, session.agentId, changes]);

  const openFile = async (scope: MemoryScopeInfo, file: MemoryFileInfo) => {
    setBusyFile(`${scope.scopeKey}/${file.name}`);
    try {
      const res = await api.getMemoryFile(
        session.projectId,
        session.agentId,
        scope.scopeKey,
        file.name,
      );
      setViewing({ scope, file, content: res.content });
    } catch (err) {
      setBrowseError(apiErrorText(err));
    } finally {
      setBusyFile(null);
    }
  };

  // ---- change rows: expansion, locate highlight ----
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(new Set());
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const toggleRow = (key: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    const target = request?.target;
    if (target === undefined || target === null) return;
    const key = memoryRowKey(target);
    setViewing(null); // The changes section lives on the list level
    setExpandedRows((prev) => new Set(prev).add(key));
    setHighlightKey(key);
    // Scroll after the expansion has painted; the ref is registered by then.
    const raf = requestAnimationFrame(() => {
      rowRefs.current.get(key)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    const timer = setTimeout(() => setHighlightKey(null), 1600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [request]);

  // ---- content view (one memory, read-only) ----
  if (viewing) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800/60">
          <button
            type="button"
            onClick={() => setViewing(null)}
            title={S.chat.memoryBack}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <GlyphIcon d={BACK_ICON} size={ICON_SIZE.iconButton} />
            <span className="sr-only">{S.chat.memoryBack}</span>
          </button>
          <p className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold">
            {viewing.file.title}
          </p>
          <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
            {viewing.file.updatedAt ?? formatRelativeDate(viewing.file.modifiedAt, locale)}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          {viewing.file.description && (
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              {viewing.file.description}
            </p>
          )}
          <div className="md-body text-sm">
            <Md text={bodyWithoutFrontmatter(viewing.content)} />
          </div>
        </div>
      </div>
    );
  }

  // ---- list level: changes this conversation, then the memory itself ----
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {changes.length > 0 && (
        <div className="border-b border-gray-100 dark:border-gray-800/60">
          <p className="px-3.5 pb-1 pt-3 text-xs font-medium text-gray-500 dark:text-gray-400">
            {S.chat.memoryChangesSection}
          </p>
          {changes.map((row) => {
            const key = memoryRowKey(row);
            const glyph = scopeGlyph(row.scope, row.scopeKey);
            const open = expandedRows.has(key);
            return (
              <div
                key={key}
                ref={(el) => {
                  if (el) rowRefs.current.set(key, el);
                  else rowRefs.current.delete(key);
                }}
                className={`transition-colors duration-500 ${
                  highlightKey === key ? "bg-brand-50 dark:bg-brand-900/20" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleRow(key)}
                  className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <span title={glyph.title} className="shrink-0 text-gray-400">
                    <GlyphIcon d={glyph.d} size={ICON_SIZE.rowLead} />
                    <span className="sr-only">{glyph.title}</span>
                  </span>
                  <PathLabel path={row.file} />
                  <span className="min-w-0 flex-1" />
                  <span
                    title={row.op === "write" ? S.chat.memoryOpWrite : S.chat.memoryOpEdit}
                    className="shrink-0 text-gray-400"
                  >
                    <GlyphIcon
                      d={row.op === "write" ? WRITE_ICON : EDIT_ICON}
                      size={ICON_SIZE.inlineGlyph}
                    />
                  </span>
                  <Chevron open={open} className="shrink-0 text-gray-400" />
                </button>
                {open && (
                  <div className="space-y-3 px-3.5 pb-3">
                    {row.events.map((event, i) => {
                      const lines = eventDiff(event);
                      return (
                        <div key={i}>
                          <p className="mb-1 text-[11px] text-gray-400 dark:text-gray-500">
                            {eventLabel(event, i, row.events.length)}
                          </p>
                          {lines === null ? (
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              {S.chat.memoryNoDiff}
                            </p>
                          ) : (
                            <DiffBlock lines={lines} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-1 px-3.5 pb-1 pt-3">
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-gray-500 dark:text-gray-400">
          {S.chat.memoryViewTitle}
        </p>
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            title={S.chat.openAgentMemory}
            className="flex h-6 w-6 shrink-0 items-center justify-center text-gray-400 transition-colors duration-150 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <GlyphIcon d={OPEN_SETTINGS_ICON} size={ICON_SIZE.inlineGlyph} />
            <span className="sr-only">{S.chat.openAgentMemory}</span>
          </button>
        )}
      </div>
      {browseError !== null ? (
        <div className="px-3.5 py-2 text-xs text-gray-500 dark:text-gray-400">
          <p>{browseError}</p>
        </div>
      ) : scopes === null ? (
        <div className="px-3.5 py-2">
          <SkeletonList rows={3} />
        </div>
      ) : scopes.every((s) => s.files.length === 0) ? (
        <p className="px-3.5 py-2 text-xs text-gray-400 dark:text-gray-500">
          {S.chat.memoryEmptyAll}
        </p>
      ) : (
        scopes.map(({ info, files }) =>
          files.length === 0 ? null : (
            <div key={info.scopeKey} className="pb-2">
              <div className="flex items-center gap-2 px-3.5 py-1.5">
                <span className="shrink-0 text-gray-400">
                  <GlyphIcon
                    d={info.kind === "user" ? USER_ICON : FOLDER_ICON}
                    size={ICON_SIZE.inlineGlyph}
                  />
                </span>
                <p
                  className="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400"
                  title={info.workspacePath}
                >
                  {scopeTitle(info)}
                </p>
                <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                  {S.memory.itemCount(files.length)}
                </span>
              </div>
              <ul>
                {files.map((file) => (
                  <li key={file.name}>
                    <button
                      type="button"
                      onClick={() => void openFile(info, file)}
                      disabled={busyFile !== null}
                      className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-2 text-left transition-colors duration-150 hover:bg-gray-50 disabled:cursor-default dark:hover:bg-gray-800/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[13px] font-medium text-gray-800 dark:text-gray-200">
                          {file.title}
                        </p>
                        {file.description && (
                          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                            {file.description}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                        {busyFile === `${info.scopeKey}/${file.name}`
                          ? S.common.loading
                          : (file.updatedAt ?? formatRelativeDate(file.modifiedAt, locale))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ),
        )
      )}
    </div>
  );
}
