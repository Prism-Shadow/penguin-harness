/**
 * Settings › Personal › Archived chats: the conversations that are not in the sidebar — the ones
 * the user archived, and the ones a program opened (the Agent API, a scheduled task, `penguin
 * run`) that the user has not kept. An archived conversation shows only its title and its time;
 * unarchiving returns it to the sidebar, deleting removes it for good.
 *
 * - A search box and two filters (source, Project) on top, and under them, while rows are
 *   chosen, the batch bar: both stay put while the list scrolls in its own box below, so a batch
 *   chosen far down the list is still in reach. The list holds the groups, one per Workspace of
 *   a Project, newest first, each with its count and a ⋯ menu acting on the whole group as
 *   that count saw it.
 * - A row: a box to choose it (shown on hover or focus, always on touch, and on every row while
 *   anything is chosen), the title and the time, the source's glyph, a busy glyph while it runs,
 *   then a delete icon and Unarchive. Choosing rows brings up one bar for the batch.
 * - Every delete asks first, with the count — the only red on the page; unarchive does not ask.
 *
 * The page's state and every request live in archived-sessions-state.ts; this renders it.
 */
import { useEffect, useMemo, useState } from "react";
import type { ArchivedSessionGroup, SessionInfo } from "@prismshadow/penguin-server/api";
import {
  Button,
  Checkbox,
  ConfirmModal,
  Dropdown,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Menu,
  MenuItem,
  MoreRow,
  SearchInput,
  Select,
  SettingsEmpty,
  SkeletonList,
  Spinner,
  toastError,
} from "@prismshadow/penguin-ui";
import { useStore } from "zustand/react";
import { formatDateTime } from "../../lib/format";
import { subscribeUserEvents } from "../../lib/omni/user-events";
import { revealPlan, workspaceLabel } from "../../lib/session-grouping";
import { backgroundSourceMark } from "../../lib/session-source-mark";
import { S } from "../../lib/strings";
import { projectDisplayName, useProject } from "../../state/project";
import { Truncated } from "../../components/ui/truncated";
import {
  ARCHIVE_ROW_PAGE,
  createArchiveStore,
  groupKey,
  groupTarget,
  shownGroups,
  shownRows,
  targetCount,
} from "./archived-sessions-state";
import type {
  ArchiveFilters,
  ArchiveStore,
  ArchiveTarget,
  GroupRows,
} from "./archived-sessions-state";

/** How long typing in the search box rests before the page reads again. */
const SEARCH_DEBOUNCE_MS = 250;

/** The source filter's choices, in the order the menu lists them. */
const SOURCES = ["user", "api", "schedule", "cli"] as const;

/** A delete waiting for its confirm: what it removes, and how many. */
interface PendingDelete {
  target: ArchiveTarget;
  count: number;
  /** One conversation's title, when the delete names one row: the confirm then reads like the chat's own. */
  title?: string;
}

export function ArchivedSessionsSection() {
  const { projects } = useProject();
  const [store] = useState<ArchiveStore>(() =>
    createArchiveStore((reason) => toastError(S.archivedSessions.actionFailed(reason))),
  );
  const state = useStore(store);
  const [q, setQ] = useState("");
  const [source, setSource] = useState<ArchiveFilters["source"]>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  // Focus the search on open where a keyboard is the likely way in; on a phone a focused box
  // would put the keyboard over the list the user came to read.
  const [autoFocus] = useState(() => window.matchMedia("(pointer: fine)").matches);

  // A new query or filter starts over. The query waits for typing to rest; the pickers apply at once.
  useEffect(() => {
    const filters = { q, source, projectId };
    const timer = setTimeout(
      () => void store.getState().load(filters),
      q === store.getState().filters.q ? 0 : SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [store, q, source, projectId]);

  // The page follows the user channel: what changes elsewhere refreshes it.
  useEffect(() => subscribeUserEvents((ev) => store.getState().noteEvent(ev)), [store]);
  useEffect(() => () => store.getState().dispose(), [store]);

  const groups = shownGroups(state);
  const hiddenGroups = (state.groups?.length ?? 0) - groups.length;
  const choosing = state.selection.size > 0;
  const filtered =
    state.filters.q.trim() !== "" ||
    state.filters.source !== null ||
    state.filters.projectId !== null;

  const askDelete = (target: ArchiveTarget, title?: string) =>
    setPendingDelete({
      target,
      count: targetCount(state, target),
      ...(title !== undefined ? { title } : {}),
    });

  /** The delete the confirm asked about: reached only from its confirm button. */
  const deletePending = () => {
    if (pendingDelete === null) return;
    void store
      .getState()
      .remove(pendingDelete.target)
      .then(() => setPendingDelete(null));
  };

  return (
    // The page fills the dialog's pane and scrolls its list itself, below the controls; the
    // list's 4px inset keeps the focus rings of its edge controls inside the box that clips it.
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            size="sm"
            icon
            value={q}
            onChange={setQ}
            placeholder={S.archivedSessions.search}
            aria-label={S.archivedSessions.search}
            autoFocus={autoFocus}
            className="min-w-0 basis-full sm:flex-1 sm:basis-auto"
          />
          <Select
            size="sm"
            aria-label={S.archivedSessions.sourceFilter}
            value={source ?? ""}
            onChange={(e) =>
              setSource(e.target.value === "" ? null : (e.target.value as (typeof SOURCES)[number]))
            }
            className="min-w-0 flex-1 sm:w-36 sm:flex-none"
          >
            <option value="">{S.archivedSessions.allSources}</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {S.chat.sessionSource[s]}
              </option>
            ))}
          </Select>
          <Select
            size="sm"
            aria-label={S.archivedSessions.projectFilter}
            value={projectId ?? ""}
            onChange={(e) => setProjectId(e.target.value === "" ? null : e.target.value)}
            className="min-w-0 flex-1 sm:w-44 sm:flex-none"
          >
            <option value="">{S.archivedSessions.allProjects}</option>
            {projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {projectDisplayName(p)}
              </option>
            ))}
          </Select>
        </div>

        {choosing && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line-muted py-2">
            <span className="text-sm font-medium">
              {S.archivedSessions.selected(state.selection.size)}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={state.busy}
                onClick={() =>
                  void store.getState().unarchive({ kind: "ids", ids: [...state.selection] })
                }
              >
                {S.chat.unarchiveSession}
              </Button>
              <Button
                size="sm"
                disabled={state.busy}
                onClick={() => askDelete({ kind: "ids", ids: [...state.selection] })}
              >
                {S.common.delete}
              </Button>
            </div>
            <button
              type="button"
              onClick={() => store.getState().clearSelection()}
              className="text-xs text-fg-muted transition-colors duration-150 hover:text-fg"
            >
              {S.archivedSessions.clearSelection}
            </button>
          </div>
        )}
      </div>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {state.groups === null ? (
          <SkeletonList rows={4} />
        ) : state.groups.length === 0 ? (
          <SettingsEmpty>
            {state.error !== null
              ? S.archivedSessions.loadFailed(state.error)
              : filtered
                ? S.archivedSessions.noMatches
                : S.archivedSessions.empty}
          </SettingsEmpty>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <ArchiveGroup
                key={groupKey(group)}
                group={group}
                whole={groupTarget(state, groupKey(group))}
                rows={state.rows.get(groupKey(group))}
                selection={state.selection}
                choosing={choosing}
                busy={state.busy}
                onMore={() => void store.getState().showMoreRows(groupKey(group))}
                onLess={() => store.getState().showLessRows(groupKey(group))}
                onToggle={(id) => store.getState().toggle(id)}
                onUnarchive={(target) => void store.getState().unarchive(target)}
                onDelete={askDelete}
              />
            ))}
            {hiddenGroups > 0 && (
              <MoreRow
                label={S.archivedSessions.moreGroups(hiddenGroups)}
                ariaLabel={S.archivedSessions.moreGroups(hiddenGroups)}
                onClick={() => void store.getState().showMoreGroups()}
              />
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={pendingDelete !== null}
        title={
          pendingDelete?.title !== undefined
            ? S.chat.deleteSession
            : S.archivedSessions.deleteTitle(pendingDelete?.count ?? 0)
        }
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
        busy={state.busy}
        onClose={() => (state.busy ? undefined : setPendingDelete(null))}
        onConfirm={deletePending}
      >
        <p className="text-sm text-fg-muted">
          {pendingDelete === null
            ? ""
            : pendingDelete.title !== undefined
              ? S.chat.deleteSessionConfirm(pendingDelete.title)
              : S.archivedSessions.deleteConfirm(pendingDelete.count)}
        </p>
      </ConfirmModal>
    </section>
  );
}

/** One group: its header (Project › Workspace, the count, the ⋯ menu) and its rows. */
function ArchiveGroup({
  group,
  whole,
  rows,
  selection,
  choosing,
  busy,
  onMore,
  onLess,
  onToggle,
  onUnarchive,
  onDelete,
}: {
  group: ArchivedSessionGroup;
  /** The whole group as its ⋯ menu acts on it: the Sessions its count on screen saw. */
  whole: ArchiveTarget;
  rows: GroupRows | undefined;
  selection: ReadonlySet<string>;
  choosing: boolean;
  busy: boolean;
  onMore: () => void;
  onLess: () => void;
  onToggle: (sessionId: string) => void;
  onUnarchive: (target: ArchiveTarget) => void;
  onDelete: (target: ArchiveTarget, title?: string) => void;
}) {
  const temp = group.workspace === "temp";
  const workspace = temp ? S.chat.tempWorkspaces : workspaceLabel(group.workspace);
  const shown = shownRows(rows);
  // The sidebar's own reveal rule: what the row still hides counts what is held past the cap
  // and what the group's count says is not fetched yet.
  const plan = revealPlan({
    cap: rows?.cap ?? ARCHIVE_ROW_PAGE,
    loaded: rows?.sessions.length ?? 0,
    total: group.count,
    fullyLoaded: rows !== undefined && !rows.hasMore,
  });
  return (
    <section>
      <div className="flex items-center gap-2 pb-1.5">
        <GlyphIcon
          d={ICONS.folder}
          size={ICON_SIZE.groupHeaderGlyph}
          className="shrink-0 text-fg-subtle"
        />
        <h3
          className="min-w-0 flex-1 truncate text-sm font-medium"
          {...(temp ? {} : { "data-tooltip": group.workspace })}
        >
          {group.projectName}
          <span className="px-1.5 text-fg-subtle">›</span>
          {workspace}
        </h3>
        <span className="shrink-0 text-xs text-fg-muted">
          {S.archivedSessions.count(group.count)}
        </span>
        <GroupMenu
          disabled={busy}
          onUnarchiveAll={() => onUnarchive(whole)}
          onDeleteAll={() => onDelete(whole)}
        />
      </div>
      {rows === undefined || (rows.loading && shown.length === 0) ? (
        <SkeletonList rows={Math.min(group.count, 3)} />
      ) : (
        <ul className="divide-y divide-line-muted border-t border-line-muted">
          {shown.map((s) => (
            <ArchiveRow
              key={s.sessionId}
              s={s}
              selected={selection.has(s.sessionId)}
              choosing={choosing}
              busy={busy}
              onToggle={() => onToggle(s.sessionId)}
              onUnarchive={() => onUnarchive({ kind: "ids", ids: [s.sessionId] })}
              onDelete={() =>
                onDelete({ kind: "ids", ids: [s.sessionId] }, s.title ?? S.chat.defaultSessionTitle)
              }
            />
          ))}
        </ul>
      )}
      {plan.hidden > 0 && (
        <MoreRow
          label={S.chat.expandRestSessions(plan.hidden)}
          ariaLabel={S.chat.expandRestSessions(plan.hidden)}
          pending={rows?.loading === true}
          onClick={onMore}
          className="mt-1"
        />
      )}
      {plan.canCollapse && (
        <MoreRow
          label={S.chat.showLess}
          ariaLabel={S.chat.showLess}
          onClick={onLess}
          {...(plan.hidden > 0 ? {} : { className: "mt-1" })}
        />
      )}
    </section>
  );
}

/** A row: the box, the title and the time with its marks, then delete and Unarchive. */
function ArchiveRow({
  s,
  selected,
  choosing,
  busy,
  onToggle,
  onUnarchive,
  onDelete,
}: {
  s: SessionInfo;
  selected: boolean;
  choosing: boolean;
  busy: boolean;
  onToggle: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const title = s.title ?? S.chat.defaultSessionTitle;
  const mark = backgroundSourceMark(s);
  return (
    <li className="group flex items-center gap-3 py-2.5">
      <Checkbox
        checked={selected}
        onChange={onToggle}
        aria-label={S.archivedSessions.select(title)}
        className={
          selected || choosing
            ? ""
            : "opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        }
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <Truncated text={title} className="min-w-0" />
          {mark !== null && (
            <span className="shrink-0 text-fg-subtle" data-tooltip={mark.sourceLabel}>
              <GlyphIcon d={mark.sourceGlyph} size={ICON_SIZE.inlineGlyph} />
              <span className="sr-only">{mark.sourceLabel}</span>
            </span>
          )}
          {(s.status === "running" || s.status === "compacting") && (
            <span className="shrink-0" data-tooltip={S.archivedSessions.running}>
              <Spinner size="sm" tone="success" label={S.archivedSessions.running} />
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">{formatDateTime(s.lastActiveAt)}</p>
      </div>
      <button
        type="button"
        data-tooltip={S.common.delete}
        aria-label={`${S.common.delete} · ${title}`}
        disabled={busy}
        onClick={onDelete}
        className="flex h-7 w-7 shrink-0 items-center justify-center text-fg-subtle transition-colors duration-150 hover:text-fg disabled:opacity-60"
      >
        <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
      </button>
      <Button size="sm" disabled={busy} onClick={onUnarchive} className="shrink-0">
        {S.chat.unarchiveSession}
      </Button>
    </li>
  );
}

/** A group's ⋯: unarchive or delete everything the group holds under the current filters. */
function GroupMenu({
  disabled,
  onUnarchiveAll,
  onDeleteAll,
}: {
  disabled: boolean;
  onUnarchiveAll: () => void;
  onDeleteAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const button = useMemo(
    () => (
      <button
        type="button"
        data-tooltip={S.archivedSessions.groupMenu}
        aria-label={S.archivedSessions.groupMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-7 shrink-0 items-center justify-center text-fg-subtle transition-colors duration-150 hover:text-fg disabled:opacity-60"
      >
        <GlyphIcon d={ICONS.ellipsis} size={ICON_SIZE.groupHeaderAction} filled />
      </button>
    ),
    [open, disabled],
  );
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      portal={{ direction: "down", align: "right" }}
      menuClass="w-max min-w-32"
      className="shrink-0"
      button={button}
    >
      <Menu density="sm">
        <MenuItem
          glyph={ICONS.archiveRestore}
          label={S.archivedSessions.unarchiveAll}
          onSelect={item(onUnarchiveAll)}
        />
        <MenuItem
          glyph={ICONS.trash}
          label={S.archivedSessions.deleteAll}
          onSelect={item(onDeleteAll)}
        />
      </Menu>
    </Dropdown>
  );
}
