/**
 * Settings › Personal › Archived chats: the conversations that are not in the sidebar — the ones
 * the user archived, and the ones a program opened (the Agent API, a scheduled task, `penguin
 * run`) that the user has not kept. An archived conversation shows only its title and its time;
 * unarchiving returns it to the sidebar, deleting removes it for good.
 *
 * - A search box and two filters (source, Project) on top, and under them, while rows are
 *   chosen, the batch bar: both stay put while the list scrolls in its own box below, so a batch
 *   chosen far down the list is still in reach. The list holds the groups, one per Workspace of
 *   a Project, newest first, each with its count and Select all, which chooses every Session of
 *   the group, loaded or not (Deselect all once all of it is chosen).
 * - A row: a box to choose it (shown while the row is hovered or the box has keyboard focus,
 *   always on touch, and on every row while anything is chosen), the title and the time, the
 *   source as a word in a pill (on every row, a person's conversation included), a busy glyph
 *   while it runs, then a delete icon and Unarchive. Whatever is chosen, the one bar acts on it.
 * - An admin also sees the archived chats of the machines their Projects use: a machine's group
 *   names the machine after its Workspace (`[SSH: alias]`, as the sidebar's groups do), and a
 *   machine that could not be read is named in one muted line above the list.
 * - Every delete asks first, with the count — the only red on the page; unarchive does not ask.
 *
 * The page's state and every request live in archived-sessions-state.ts; this renders it.
 */
import { useEffect, useState } from "react";
import type { ArchivedSessionGroup, SessionInfo } from "@prismshadow/penguin-server/api";
import {
  Pill,
  Button,
  Checkbox,
  ConfirmModal,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
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
import { subscribeUserEvents } from "../../lib/amsp/user-events";
import { revealPlan, workspaceLabel } from "../../lib/session-grouping";
import { programSource } from "../../lib/session-source-mark";
import { nameOnMachine } from "../../lib/workspace-machines";
import { S } from "../../lib/strings";
import { projectDisplayName, useProject } from "../../state/project";
import { Truncated } from "../../components/ui/truncated";
import {
  ARCHIVE_ROW_PAGE,
  createArchiveStore,
  groupKey,
  isChosen,
  selectedCount,
  shownGroups,
  shownRows,
  targetCount,
  wholeGroupChosen,
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
const SOURCES = ["user", "api", "schedule", "cli", "workbench"] as const;

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
  const chosen = selectedCount(state);
  const choosing = chosen > 0;
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
            <span className="text-sm font-medium">{S.archivedSessions.selected(chosen)}</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={state.busy}
                onClick={() => void store.getState().unarchive({ kind: "selection" })}
              >
                {S.chat.unarchiveSession}
              </Button>
              <Button
                size="sm"
                disabled={state.busy}
                onClick={() => askDelete({ kind: "selection" })}
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

        {state.unreachable.length > 0 && (
          <p className="text-xs text-fg-muted">
            {S.archivedSessions.unreachable(state.unreachable)}
          </p>
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
                rows={state.rows.get(groupKey(group))}
                allChosen={wholeGroupChosen(state, group)}
                chosen={(id) => isChosen(state, groupKey(group), id)}
                choosing={choosing}
                busy={state.busy}
                onMore={() => void store.getState().showMoreRows(groupKey(group))}
                onLess={() => store.getState().showLessRows(groupKey(group))}
                onToggle={(id) => store.getState().toggle(groupKey(group), id)}
                onToggleAll={() => store.getState().toggleGroup(groupKey(group))}
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

/** One group: its header (Project › Workspace, the count, Select all) and its rows. */
function ArchiveGroup({
  group,
  rows,
  allChosen,
  chosen,
  choosing,
  busy,
  onMore,
  onLess,
  onToggle,
  onToggleAll,
  onUnarchive,
  onDelete,
}: {
  group: ArchivedSessionGroup;
  rows: GroupRows | undefined;
  /** Every Session of the group is chosen: its button deselects them all. */
  allChosen: boolean;
  /** Whether one of the group's rows is chosen. */
  chosen: (sessionId: string) => boolean;
  choosing: boolean;
  busy: boolean;
  onMore: () => void;
  onLess: () => void;
  onToggle: (sessionId: string) => void;
  onToggleAll: () => void;
  onUnarchive: (target: ArchiveTarget) => void;
  onDelete: (target: ArchiveTarget, title?: string) => void;
}) {
  const temp = group.workspace === "temp";
  const workspace = temp ? S.chat.tempWorkspaces : workspaceLabel(group.workspace);
  /** The machine the group's Sessions live on, by its ssh alias; null on this server. */
  const machine = group.machineAlias ?? null;
  const shown = shownRows(rows);
  /** One row's own action, on the server the group is on. */
  const rowTarget = (sessionId: string): ArchiveTarget => ({
    kind: "ids",
    ids: [sessionId],
    ...(group.machineId !== undefined ? { machineId: group.machineId } : {}),
  });
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
          // The heading names the directory by its basename; the path behind it is nowhere else
          // on this page — and a path means a directory only on the machine it is on.
          {...(temp
            ? {}
            : {
                "data-tooltip": nameOnMachine(group.workspace, machine),
                "data-tooltip-extra": true,
              })}
        >
          {group.projectName}
          <span className="px-1.5 text-fg-subtle">›</span>
          {workspace}
          {machine !== null && (
            <span className="ml-1.5 text-xs font-normal text-fg-subtle">
              {S.chat.machineTag(machine)}
            </span>
          )}
        </h3>
        <span className="shrink-0 text-xs text-fg-muted">
          {S.archivedSessions.count(group.count)}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={onToggleAll}
          className="shrink-0 text-xs text-fg-muted transition-colors duration-150 hover:text-fg disabled:opacity-60"
        >
          {allChosen ? S.archivedSessions.deselectAll : S.archivedSessions.selectAll}
        </button>
      </div>
      {rows === undefined || (rows.loading && shown.length === 0) ? (
        <SkeletonList rows={Math.min(group.count, 3)} />
      ) : (
        <ul className="divide-y divide-line-muted border-t border-line-muted">
          {shown.map((s) => (
            <ArchiveRow
              key={s.sessionId}
              s={s}
              selected={chosen(s.sessionId)}
              choosing={choosing}
              busy={busy}
              onToggle={() => onToggle(s.sessionId)}
              onUnarchive={() => onUnarchive(rowTarget(s.sessionId))}
              onDelete={() =>
                onDelete(rowTarget(s.sessionId), s.title ?? S.chat.defaultSessionTitle)
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

/**
 * A row's box at rest: hidden until the row is hovered or the box has KEYBOARD focus. Mouse focus
 * does not count — a box clicked, or a button whose confirm returned focus to it, would otherwise
 * keep its row's box painted beside the hovered row's after nothing is chosen any more.
 */
const BOX_AT_REST =
  "opacity-0 transition-opacity duration-150 group-hover:opacity-100 has-[:focus-visible]:opacity-100 [@media(hover:none)]:opacity-100";

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
  // Every row names where it came from: a program's source, or a person's conversation.
  const source = programSource(s) ?? "user";
  return (
    <li className="group flex items-center gap-3 py-2.5">
      <Checkbox
        checked={selected}
        onChange={onToggle}
        aria-label={S.archivedSessions.select(title)}
        className={selected || choosing ? "" : BOX_AT_REST}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <Truncated text={title} className="min-w-0" />
          <Pill tone="neutral">{S.chat.sessionSource[source]}</Pill>
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
