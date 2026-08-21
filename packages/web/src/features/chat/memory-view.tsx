/**
 * The Memory side panel's content (see memory-panel.tsx for the shell): two levels, modeled
 * by memory-nav.ts. The list shows both scopes' topic lists — the same server routes the
 * agent-settings memory tab reads — with a marker on topics this conversation changed; a
 * topic's detail is the memory's content rendered like the file viewer (Markdown,
 * frontmatter stripped — the header already shows those fields). A file deleted after being
 * changed simply leaves the list (buildMemoryList); the unavailable note below only covers
 * the race where the file disappears between the listing load and the click.
 *
 * Entry routes by origin: a memory-changes card row lands directly on that memory's detail;
 * entering through the panel toggle lands on the list. Management (add / edit / delete)
 * stays on the agent-settings tab — the list header links there — so this view never
 * duplicates the bridge-modal flows.
 */
import { useEffect, useState } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { formatRelativeDate } from "../../lib/format";
import { bodyWithoutFrontmatter } from "../../lib/frontmatter";
import type { MemoryChangeRow, MemoryLocateTarget } from "../../lib/omni/memory-changes";
import { memoryRowKey } from "../../lib/omni/memory-changes";
import { useLocale } from "../../state/locale";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { SkeletonList } from "../../components/ui/skeleton";
import { Md } from "./md";
import { buildMemoryList, memoryNavBack, memoryNavForRequest } from "./memory-nav";
import type { MemoryNavMode, ScopeFiles } from "./memory-nav";

/** Person (User scope), folder (Workspace scope), boxed arrow (open the settings tab), left arrow (back to the list). */
const USER_ICON = "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z";
const FOLDER_ICON = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";
const OPEN_SETTINGS_ICON =
  "M14 4h6v6M20 4 10 14M9 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3";
const BACK_ICON = "M19 12H5m6-6-6 6 6 6";

/** The scope glyph + tooltip pair, shared with the memory-changes card's rows. */
export function scopeGlyph(scope: "user" | "workspace", scopeKey?: string) {
  return {
    d: scope === "user" ? USER_ICON : FOLDER_ICON,
    title: scope === "user" ? S.memory.userScope : S.chat.memoryScopeWorkspace(scopeKey ?? ""),
  };
}

/** List-group title: the User scope's fixed label, or the Workspace directory's basename. */
function groupTitle(group: {
  scope: "user" | "workspace";
  scopeKey: string;
  workspacePath?: string;
}): string {
  return group.scope === "user"
    ? S.memory.userScope
    : (group.workspacePath?.split(/[\\/]/).filter(Boolean).at(-1) ?? group.scopeKey);
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
  /** The server listing, loaded by chat-page's use-memory-listing; null = not loaded. */
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
  // Landing on a located memory just shows its content — no highlight, no transient tint —
  // the same arrival the file-summary card's rows give (they only preview the file).
  useEffect(() => {
    if (request === null) return;
    setMode(memoryNavForRequest(request));
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
    // detailKey stands in for mode.target's identity; changes refresh a just-rewritten file
    // (identity-stable, so streaming ticks never re-fire this).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, detailKey, session.projectId, session.agentId, changes]);

  const groups = buildMemoryList(scopes, changes);

  // ---- detail level ----
  if (mode.kind === "detail") {
    const target = mode.target;
    const listedRow = groups
      .flatMap((g) => g.rows)
      .find((r) => memoryRowKey(r.target) === detailKey);
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
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
          {listedRow?.description !== undefined && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{listedRow.description}</p>
          )}
          {!loaded || (!detail.failed && detail.content === null) ? (
            <SkeletonList rows={3} />
          ) : detail.failed ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {S.chat.memoryContentUnavailable}
            </p>
          ) : (
            <div className="md-body text-sm">
              <Md text={bodyWithoutFrontmatter(detail.content ?? "")} />
            </div>
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
          // Labelled, not a bare glyph: the arrow says the click leaves this panel, the text
          // says where it lands, and nobody has to hover to find that out. `title` repeats the
          // label verbatim rather than expanding on it, so the accessible name matches the
          // visible one. The label fits the shared width's 320px minimum; past that (a larger
          // text size) it truncates instead of pushing the row wider.
          <button
            type="button"
            onClick={onOpenSettings}
            title={S.chat.openAgentMemory}
            className="flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <GlyphIcon d={OPEN_SETTINGS_ICON} size={ICON_SIZE.inlineGlyph} />
            <span className="truncate">{S.chat.openAgentMemory}</span>
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
                {group.rows.map((row) => (
                  <li key={memoryRowKey(row.target)}>
                    <button
                      type="button"
                      onClick={() => setMode({ kind: "detail", target: row.target })}
                      className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-2 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate font-mono text-[13px] font-medium text-gray-800 dark:text-gray-200">
                          {row.changed !== undefined && (
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
                      {(row.updatedAt !== undefined || row.modifiedAt !== undefined) && (
                        <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                          {row.updatedAt ??
                            (row.modifiedAt !== undefined
                              ? formatRelativeDate(row.modifiedAt, locale)
                              : "")}
                        </span>
                      )}
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
