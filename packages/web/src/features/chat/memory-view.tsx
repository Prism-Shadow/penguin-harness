/**
 * The side panel's Memory tab (see files-panel.tsx for the tab bar): two levels, modeled by
 * memory-nav.ts. The list shows both scopes' topic lists — the same server routes the
 * agent-settings memory tab reads — with a marker on topics this conversation changed. A
 * changed topic's detail shows the body itself as one GitHub-style whole-file line diff:
 * this conversation's calls replayed backwards over the current content reconstruct the
 * pre-conversation text (memory-replay.ts), frontmatter stays out of the comparison, and
 * DetailContent picks the display for each replay outcome. An unchanged topic renders as
 * plain Markdown.
 *
 * Entry routes by origin: a memory-changes card row lands directly on that memory's detail
 * (diff in view, back returns to the list); entering through the panel tab lands on the
 * list. Management (add / edit / delete) stays on the agent-settings tab — the list header
 * links there — so this view never duplicates the bridge-modal flows.
 */
import { useEffect, useState } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { formatRelativeDate } from "../../lib/format";
import { bodyWithoutFrontmatter } from "../../lib/frontmatter";
import { diffLines } from "../../lib/line-diff";
import type { DiffLine } from "../../lib/line-diff";
import { replayBackwards } from "../../lib/memory-replay";
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
import { buildMemoryList, findChangeRow, memoryNavBack, memoryNavForRequest } from "./memory-nav";
import type { MemoryListGroup, MemoryNavMode, ScopeFiles } from "./memory-nav";

/** Person (User scope), folder (Workspace scope), boxed arrow (open the settings tab), left arrow (back to the list). */
const USER_ICON = "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z";
const FOLDER_ICON = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";
const OPEN_SETTINGS_ICON =
  "M14 4h6v6M20 4 10 14M9 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3";
const BACK_ICON = "M19 12H5m6-6-6 6 6 6";
/** Trash can (the memory-tab's delete glyph): the deleted-row marker. */
const TRASH_ICON =
  "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7m4 4v6m4-6v6";

/** The scope glyph + tooltip pair, shared with the memory-changes card's rows. */
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
          <span className="min-w-0 flex-1">{line.text || " "}</span>
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

/** List-group title: the User scope's fixed label, or the Workspace directory's basename. */
function groupTitle(group: MemoryListGroup): string {
  return group.scope === "user"
    ? S.memory.userScope
    : (group.workspacePath?.split(/[\\/]/).filter(Boolean).at(-1) ?? group.scopeKey);
}

/**
 * Per-call diffs, chronological — the fallback when no whole-file diff exists: expanded
 * where it is the only change display (content unavailable), behind a flat toggle where it
 * backs up an unaligned whole-file view.
 */
function ChangeSection({
  row,
  collapsible = false,
}: {
  row: MemoryChangeRow;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const events = row.events.map((event, i) => {
    const lines = eventDiff(event);
    return (
      <div key={i}>
        <p className="mb-1 text-[11px] text-gray-400 dark:text-gray-500">
          {eventLabel(event, i, row.events.length)}
        </p>
        {lines === null ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">{S.chat.memoryNoDiff}</p>
        ) : (
          <DiffBlock lines={lines} />
        )}
      </div>
    );
  });
  if (!collapsible) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {S.chat.memoryChangesSection}
        </p>
        {events}
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500 transition-colors duration-150 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        {S.chat.memoryPerCallToggle}
        <Chevron open={open} size={12} />
      </button>
      {open && <div className="mt-2 space-y-3">{events}</div>}
    </div>
  );
}

/** A quiet one-line annotation above a diff or body (rewrite / unaligned / meta-only notes). */
function SubtleNote({ text }: { text: string }) {
  return <p className="text-xs text-gray-400 dark:text-gray-500">{text}</p>;
}

/**
 * The detail's body once the content has loaded: with no change row it is the memory
 * rendered as Markdown; with one, the conversation's calls are replayed backwards over the
 * raw content (memory-replay.ts) and the result decides the display — a clean reversal
 * renders one GitHub-style whole-body line diff (frontmatter stripped from both sides,
 * removed lines in place, no context folding — memory topics are small by construction), a
 * write cutoff renders the whole body as added lines, and a failed alignment falls back to
 * the rendered body with the per-call diffs behind a toggle.
 */
function DetailContent({
  raw,
  changeRow,
  flash,
}: {
  raw: string;
  changeRow: MemoryChangeRow | undefined;
  flash: boolean;
}) {
  const afterBody = bodyWithoutFrontmatter(raw);
  if (changeRow === undefined) {
    return (
      <div className="md-body text-sm">
        <Md text={afterBody} />
      </div>
    );
  }
  const flashClass = `rounded-lg p-1 transition-colors duration-700 ${
    flash ? "bg-brand-50 dark:bg-brand-900/20" : ""
  }`;
  const replay = replayBackwards(raw, changeRow.events);
  if (replay.kind === "diff") {
    const lines = diffLines(bodyWithoutFrontmatter(replay.before), afterBody);
    if (lines.some((l) => l.type !== "same")) {
      return (
        <div className={flashClass}>
          <DiffBlock lines={lines} />
        </div>
      );
    }
    // Only frontmatter moved (e.g. an updated_at bump): nothing in the body to mark up.
    return (
      <>
        <SubtleNote text={S.chat.memoryBodyUnchanged} />
        <div className="md-body text-sm">
          <Md text={afterBody} />
        </div>
      </>
    );
  }
  if (replay.kind === "rewritten") {
    // Written whole this conversation: the all-added diff says it by itself.
    return (
      <div className={flashClass}>
        <DiffBlock lines={diffLines("", afterBody)} />
      </div>
    );
  }
  return (
    <>
      <SubtleNote text={S.chat.memoryUnalignedNote} />
      <div className="md-body text-sm">
        <Md text={afterBody} />
      </div>
      <ChangeSection row={changeRow} collapsible />
    </>
  );
}

export function ChatMemoryView({
  session,
  changes,
  scopes,
  listingError,
  request,
  active,
  onOpenSettings,
}: {
  session: SessionInfo;
  /** This conversation's aggregated memory changes (identity-stable — chat-page only swaps the array when the content moved). */
  changes: MemoryChangeRow[];
  /** The server listing, loaded by chat-page's use-memory-listing (shared with the card's deleted-row marking); null = not loaded. */
  scopes: ScopeFiles[] | null;
  listingError: string | null;
  /** Navigation command from openMemory (object identity re-triggers): with a target it lands on that memory's detail, without one on the list. */
  request: { target: MemoryLocateTarget | null } | null;
  /** Whether the panel is showing (detail loading waits for it). */
  active: boolean;
  /** Opens the agent-settings memory tab, where management (add / edit / delete) lives. */
  onOpenSettings?: () => void;
}) {
  const { locale } = useLocale();

  // ---- navigation (memory-nav.ts): entry routing + back ----
  const [mode, setMode] = useState<MemoryNavMode>({ kind: "list" });
  const [flashDiff, setFlashDiff] = useState(false);
  useEffect(() => {
    if (request === null) return;
    const next = memoryNavForRequest(request);
    setMode(next);
    // A located detail flashes its diff section briefly — the click's landing spot.
    if (next.kind === "detail") {
      setFlashDiff(true);
      const timer = setTimeout(() => setFlashDiff(false), 1600);
      return () => clearTimeout(timer);
    }
    return;
  }, [request]);

  // ---- detail content (loaded per target; keyed so a stale response can't cross targets) ----
  const detailKey = mode.kind === "detail" ? memoryRowKey(mode.target) : null;
  const [detail, setDetail] = useState<{
    key: string;
    content: string | null;
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    if (!active || mode.kind !== "detail") return;
    const target = mode.target;
    const key = memoryRowKey(target);
    let cancelled = false;
    setDetail({ key, content: null, failed: false });
    void api
      .getMemoryFile(
        session.projectId,
        session.agentId,
        target.scope === "user" ? "user" : (target.scopeKey ?? ""),
        target.file,
      )
      .then((res) => {
        if (!cancelled) setDetail({ key, content: res.content, failed: false });
      })
      .catch(() => {
        if (!cancelled) setDetail({ key, content: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
    // detailKey stands in for mode.target's identity; changes refresh a just-rewritten file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, detailKey, session.projectId, session.agentId, changes]);

  const groups = buildMemoryList(scopes, changes);

  // ---- detail level ----
  if (mode.kind === "detail") {
    const target = mode.target;
    const listedRow = groups
      .flatMap((g) => g.rows)
      .find((r) => memoryRowKey(r.target) === detailKey);
    const changeRow = findChangeRow(changes, target);
    const loaded = detail !== null && detail.key === detailKey;
    const glyph = scopeGlyph(target.scope, target.scopeKey);
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800/60">
          <button
            type="button"
            onClick={() => setMode(memoryNavBack())}
            title={S.chat.memoryBack}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <GlyphIcon d={BACK_ICON} size={ICON_SIZE.iconButton} />
            <span className="sr-only">{S.chat.memoryBack}</span>
          </button>
          <span title={glyph.title} className="shrink-0 text-gray-400">
            <GlyphIcon d={glyph.d} size={ICON_SIZE.rowLead} />
            <span className="sr-only">{glyph.title}</span>
          </span>
          <p className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold">
            {listedRow?.title ?? target.file}
          </p>
          {listedRow &&
            (listedRow.updatedAt !== undefined || listedRow.modifiedAt !== undefined) && (
              <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                {listedRow.updatedAt ??
                  (listedRow.modifiedAt !== undefined
                    ? formatRelativeDate(listedRow.modifiedAt, locale)
                    : "")}
              </span>
            )}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3">
          {listedRow?.description !== undefined && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{listedRow.description}</p>
          )}
          {!loaded || (!detail.failed && detail.content === null) ? (
            <SkeletonList rows={3} />
          ) : detail.failed ? (
            <>
              <SubtleNote text={S.chat.memoryContentUnavailable} />
              {/* No content to diff against — the per-call record is the only change display, so it stays expanded. */}
              {changeRow !== undefined && <ChangeSection row={changeRow} />}
            </>
          ) : (
            <DetailContent raw={detail.content ?? ""} changeRow={changeRow} flash={flashDiff} />
          )}
        </div>
      </div>
    );
  }

  // ---- list level ----
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="flex items-center gap-1 px-3.5 pb-1 pt-2">
        <span className="min-w-0 flex-1" />
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
      {listingError !== null && groups.length === 0 ? (
        <p className="px-3.5 py-2 text-xs text-gray-500 dark:text-gray-400">{listingError}</p>
      ) : scopes === null && groups.length === 0 ? (
        <div className="px-3.5 py-2">
          <SkeletonList rows={3} />
        </div>
      ) : groups.every((g) => g.rows.length === 0) ? (
        <p className="px-3.5 py-2 text-xs text-gray-400 dark:text-gray-500">
          {S.chat.memoryEmptyAll}
        </p>
      ) : (
        groups.map((group) =>
          group.rows.length === 0 ? null : (
            <div key={`${group.scope} ${group.scopeKey}`} className="pb-2">
              <div className="flex items-center gap-2 px-3.5 py-1.5">
                <span className="shrink-0 text-gray-400">
                  <GlyphIcon
                    d={group.scope === "user" ? USER_ICON : FOLDER_ICON}
                    size={ICON_SIZE.inlineGlyph}
                  />
                </span>
                <p
                  className="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400"
                  title={group.workspacePath}
                >
                  {groupTitle(group)}
                </p>
                <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                  {S.memory.itemCount(group.rows.length)}
                </span>
              </div>
              <ul>
                {group.rows.map((row) => {
                  // A changed file the loaded listing doesn't carry was deleted after the
                  // change: the row stays visible but can't open — its detail would only 404.
                  const deleted = scopes !== null && row.changed !== undefined && !row.listed;
                  const inner = (
                    <>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`flex items-center gap-1.5 truncate font-mono text-[13px] font-medium ${
                            deleted
                              ? "text-gray-400 line-through dark:text-gray-500"
                              : "text-gray-800 dark:text-gray-200"
                          }`}
                        >
                          {row.changed !== undefined && !deleted && (
                            <span
                              title={S.chat.memoryChangedMark}
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
                            >
                              <span className="sr-only">{S.chat.memoryChangedMark}</span>
                            </span>
                          )}
                          <span className="min-w-0 truncate">{row.title}</span>
                        </p>
                        {row.description !== undefined && (
                          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                            {row.description}
                          </p>
                        )}
                      </div>
                      {deleted ? (
                        <span title={S.chat.memoryDeleted} className="shrink-0 text-gray-400">
                          <GlyphIcon d={TRASH_ICON} size={ICON_SIZE.inlineGlyph} />
                          <span className="sr-only">{S.chat.memoryDeleted}</span>
                        </span>
                      ) : (
                        (row.updatedAt !== undefined || row.modifiedAt !== undefined) && (
                          <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                            {row.updatedAt ??
                              (row.modifiedAt !== undefined
                                ? formatRelativeDate(row.modifiedAt, locale)
                                : "")}
                          </span>
                        )
                      )}
                    </>
                  );
                  return (
                    <li key={memoryRowKey(row.target)}>
                      {deleted ? (
                        <div className="flex w-full items-center gap-3 px-3.5 py-2 text-left">
                          {inner}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setMode({ kind: "detail", target: row.target })}
                          className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-2 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          {inner}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
        )
      )}
    </div>
  );
}
