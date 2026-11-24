/**
 * The Task Manager page: what runs right now, read from `/api/me/tasks` and kept live from the
 * user event stream (`/api/events`).
 *
 * Supports two views, defaulting to `flat`:
 * - `flat`: running/compacting sessions first, followed by the most recent idle sessions (5 by
 *   default, loaded on demand from `/api/me/tasks?idleLimit=…`).
 * - `tree`: grouped as `machine > user` → `app / direct sessions` → `session` → `process`.
 *
 * Clicking column headers (`Status`, `Tokens`, `CPU`, `Memory`) sorts sessions; clicking a session
 * row navigates to `/chat/<sessionId>`; right-clicking (or Shift+F10 / long press) opens the
 * session context menu; clicking the process toggle expands or folds its active tool calls and
 * background commands.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Chevron,
  ContextMenu,
  EmptyState,
  Fold,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  MenuItem,
  MenuSeparator,
  PageFrame,
  PageHeader,
  Pill,
  Segmented,
  Skeleton,
  StatusIcon,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import {
  apiErrorText,
  formatBytes,
  navigate,
  subscribeUserEvents,
  toastApiError,
} from "@prismshadow/penguin-web-plugin";
import type {
  TaskAppInfo,
  TaskProcessInfo,
  TaskProcessSignal,
  TaskSessionInfo,
  TaskTokens,
  TaskTreeResponse,
  TaskUserInfo,
} from "../types";
import { getTaskTree, killTaskSession, signalTaskProcess } from "./api";
import { S } from "./strings";
import { formatCost, formatCpu, formatMemory, formatTokens, touchesTaskTree } from "./task-format";

const DEFAULT_IDLE_LIMIT = 5;
const IDLE_LIMIT_STEP = 10;

type ViewMode = "flat" | "tree";
export type SortKey = "status" | "tokens" | "cpu" | "memory";
export type SortDir = "desc" | "asc";

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/**
 * Shared row flex layout for the monitor table:
 * left side holds the hierarchy node (`min-w-48 flex-1`), right side holds the four fixed-width
 * metric columns (`[status, token, cpu, memory]`, `ml-auto shrink-0`) so every row aligns
 * vertically on both desktop and mobile viewports.
 */
const TREE_ROW_CLASS =
  "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-xs";

const METRIC_ROW_CLASS = "ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2 tabular-nums";
const COL_STATUS = "w-14 sm:w-16";
const COL_TOKENS = "w-14 sm:w-20";
const COL_CPU = "w-11 sm:w-14";
const COL_MEMORY = "w-14 sm:w-16";

/** What the page holds while it reads, and what it shows when the first read fails. */
interface Loaded {
  /** The last answer; null until the first one lands. */
  tree: TaskTreeResponse | null;
  error: string | null;
}

/** Sums the Token totals of a slice of Sessions (used for a user's direct-sessions group). */
function sumSessionTokens(sessions: readonly TaskSessionInfo[]): TaskTokens {
  return {
    cacheRead: sessions.reduce((n, s) => n + s.tokens.cacheRead, 0),
    cacheWrite: sessions.reduce((n, s) => n + s.tokens.cacheWrite, 0),
    output: sessions.reduce((n, s) => n + s.tokens.output, 0),
    total: sessions.reduce((n, s) => n + s.tokens.total, 0),
    requests: sessions.reduce((n, s) => n + s.tokens.requests, 0),
    cost: sessions.every((s) => s.tokens.cost !== null)
      ? sessions.reduce((n, s) => n + (s.tokens.cost ?? 0), 0)
      : null,
  };
}

/** Sums measured CPU and memory across a slice of Sessions when at least one has a reading. */
function sumSessionResources(sessions: readonly TaskSessionInfo[]): {
  cpu: number | null;
  memory: number | null;
} {
  const hasCpu = sessions.some((s) => s.cpu !== null);
  const hasMemory = sessions.some((s) => s.memory !== null);
  return {
    cpu: hasCpu ? sessions.reduce((n, s) => n + (s.cpu ?? 0), 0) : null,
    memory: hasMemory ? sessions.reduce((n, s) => n + (s.memory ?? 0), 0) : null,
  };
}

/** Short tail of a session id (`session-2026-11-25-16-15-22-9efce196` → `9efce196`). */
function shortSessionId(sessionId: string): string {
  const dash = sessionId.lastIndexOf("-");
  return dash >= 0 && dash < sessionId.length - 1 ? sessionId.slice(dash + 1) : sessionId;
}

/** Default monitor order: running/compacting first, then most recently active. */
export function compareSessions(a: TaskSessionInfo, b: TaskSessionInfo): number {
  const rank = (s: TaskSessionInfo): number =>
    s.status === "running" ? 0 : s.status === "compacting" ? 1 : 2;
  return (
    rank(a) - rank(b) ||
    b.lastActiveAt.localeCompare(a.lastActiveAt) ||
    a.sessionId.localeCompare(b.sessionId)
  );
}

/** Compares two sessions according to the active column sort, falling back to `compareSessions`. */
export function compareSessionsBySort(
  a: TaskSessionInfo,
  b: TaskSessionInfo,
  sort: SortState,
): number {
  const rank = (s: TaskSessionInfo): number =>
    s.status === "running" ? 0 : s.status === "compacting" ? 1 : 2;
  if (sort.key === "status") {
    const diff = sort.dir === "desc" ? rank(a) - rank(b) : rank(b) - rank(a);
    if (diff !== 0) return diff;
    return sort.dir === "desc"
      ? b.lastActiveAt.localeCompare(a.lastActiveAt) || a.sessionId.localeCompare(b.sessionId)
      : a.lastActiveAt.localeCompare(b.lastActiveAt) || a.sessionId.localeCompare(b.sessionId);
  }
  if (sort.key === "tokens") {
    const diff =
      sort.dir === "desc" ? b.tokens.total - a.tokens.total : a.tokens.total - b.tokens.total;
    return diff !== 0 ? diff : compareSessions(a, b);
  }
  if (sort.key === "cpu") {
    if (a.cpu === null && b.cpu === null) return compareSessions(a, b);
    if (a.cpu === null) return 1;
    if (b.cpu === null) return -1;
    const diff = sort.dir === "desc" ? b.cpu - a.cpu : a.cpu - b.cpu;
    return diff !== 0 ? diff : compareSessions(a, b);
  }
  if (a.memory === null && b.memory === null) return compareSessions(a, b);
  if (a.memory === null) return 1;
  if (b.memory === null) return -1;
  const diff = sort.dir === "desc" ? b.memory - a.memory : a.memory - b.memory;
  return diff !== 0 ? diff : compareSessions(a, b);
}

/**
 * The page's state: read on mount (with `idleLimit = 5` by default) and whenever the user event
 * stream announces a Session or Workbench change. Expanding idle sessions raises `idleLimit` and
 * fetches the next slice from the server on demand.
 */
function useTaskTree(): Loaded & {
  idleLimit: number;
  loadingMore: boolean;
  retry: () => void;
  expandIdle: () => void;
  collapseIdle: () => void;
} {
  const [state, setState] = useState<Loaded>({ tree: null, error: null });
  const [idleLimit, setIdleLimit] = useState(DEFAULT_IDLE_LIMIT);
  const [loadingMore, setLoadingMore] = useState(false);
  const idleLimitRef = useRef(idleLimit);
  idleLimitRef.current = idleLimit;
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const dirty = useRef(false);

  const read = useCallback(() => {
    if (!mounted.current) return;
    if (inFlight.current) {
      dirty.current = true;
      return;
    }
    inFlight.current = true;
    setState((prev) => (prev.error === null ? prev : { ...prev, error: null }));
    getTaskTree(idleLimitRef.current)
      .then((tree) => {
        if (mounted.current) setState({ tree, error: null });
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        const text = apiErrorText(err);
        setState((prev) => {
          if (prev.tree === null) return { tree: null, error: text };
          toastApiError(err, { text: S.tasks.loadFailed(text) });
          return prev;
        });
      })
      .finally(() => {
        inFlight.current = false;
        if (mounted.current && dirty.current) {
          dirty.current = false;
          read();
        } else if (mounted.current) {
          setLoadingMore(false);
        }
      });
  }, []);

  const expandIdle = useCallback(() => {
    const next = idleLimitRef.current + IDLE_LIMIT_STEP;
    idleLimitRef.current = next;
    setIdleLimit(next);
    setLoadingMore(true);
    read();
  }, [read]);

  const collapseIdle = useCallback(() => {
    idleLimitRef.current = DEFAULT_IDLE_LIMIT;
    setIdleLimit(DEFAULT_IDLE_LIMIT);
    setLoadingMore(true);
    read();
  }, [read]);

  useEffect(() => {
    mounted.current = true;
    read();
    const isPageVisible = () =>
      typeof document === "undefined" || document.visibilityState !== "hidden";
    const unsubscribe = subscribeUserEvents((ev) => {
      if (isPageVisible() && touchesTaskTree(ev)) read();
    });
    const onVisibilityChange = () => {
      if (isPageVisible()) read();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      mounted.current = false;
      dirty.current = false;
      unsubscribe();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [read]);

  const hasActiveSession =
    state.tree?.users.some(
      (u) =>
        u.apps.some((a) => a.sessions.some((s) => s.status !== "idle")) ||
        u.sessions.some((s) => s.status !== "idle"),
    ) ?? false;

  useEffect(() => {
    if (!hasActiveSession) return;
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") {
        read();
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [hasActiveSession, read]);

  return { ...state, idleLimit, loadingMore, retry: read, expandIdle, collapseIdle };
}

export function TaskManagerPage() {
  const { tree, error, idleLimit, loadingMore, retry, expandIdle, collapseIdle } = useTaskTree();
  const [viewMode, setViewMode] = useState<ViewMode>("flat");
  const [sort, setSort] = useState<SortState>({ key: "status", dir: "desc" });
  const words = S.tasks;

  const handleSort = useCallback((key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" },
    );
  }, []);

  const viewSwitcher = (
    <Segmented
      cols={2}
      value={viewMode}
      onChange={setViewMode}
      options={[
        { value: "flat", label: words.viewFlat },
        { value: "tree", label: words.viewTree },
      ]}
    />
  );

  if (tree === null) {
    return (
      <PageFrame width="xl">
        <PageHeader title={words.title} info={words.info} actions={viewSwitcher} />
        {error !== null ? (
          <EmptyState
            title={words.loadFailed(error)}
            action={
              <Button size="sm" onClick={retry}>
                {words.retry}
              </Button>
            }
          />
        ) : (
          <div className="space-y-2" aria-busy>
            <span className="sr-only">{words.loading}</span>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
      </PageFrame>
    );
  }

  const allShownSessions = tree.users
    .flatMap((u) => [...u.apps.flatMap((a) => a.sessions), ...u.sessions])
    .sort((a, b) => compareSessionsBySort(a, b, sort));
  const runningCount = allShownSessions.filter((s) => s.status !== "idle").length;
  const shownIdleCount = allShownSessions.filter((s) => s.status === "idle").length;
  const idleTotal = tree.idleTotal ?? shownIdleCount;
  const totalSessionCount = runningCount + idleTotal;
  const remainingIdleCount = Math.max(0, idleTotal - shownIdleCount);
  const canCollapseIdle = idleLimit > DEFAULT_IDLE_LIMIT && shownIdleCount > DEFAULT_IDLE_LIMIT;

  const appCount = tree.users.reduce((n, u) => n + u.apps.length, 0);
  const processCount = allShownSessions.reduce((n, s) => n + s.processes.length, 0);

  return (
    <PageFrame width="xl">
      <PageHeader title={words.title} info={words.info} actions={viewSwitcher} />
      <Card padding="sm" className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <GlyphIcon
              d={ICONS.server}
              size={ICON_SIZE.inlineGlyph}
              className="shrink-0 text-fg-muted"
            />
            <span className="font-medium text-fg-muted">{words.machine}</span>
            <span className="font-mono text-sm font-semibold text-fg">{tree.machine}</span>
            <span className="text-fg-subtle">
              {words.machineSummary(tree.users.length, appCount)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 tabular-nums">
            <div className="flex items-baseline gap-1">
              <span className="text-fg-muted">{words.totalTokens}</span>
              <span className="font-mono text-sm font-semibold text-fg">
                {formatTokens(tree.tokens.total)}
              </span>
              <span className="text-fg-subtle">({words.requestCount(tree.tokens.requests)})</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-fg-muted">{words.totalCost}</span>
              <span className="font-mono text-sm font-semibold text-fg">
                {formatCost(tree.tokens.cost, words.unmeasured)}
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-fg-muted">{words.sessionCount}</span>
              <span className="font-mono text-sm font-semibold text-fg">{totalSessionCount}</span>
              <span className="text-fg-subtle">({words.processCount(processCount)})</span>
            </div>
          </div>
        </div>
      </Card>
      {allShownSessions.length === 0 ? (
        <EmptyState title={words.empty} description={words.emptyHint} />
      ) : viewMode === "flat" ? (
        <FlatSessionTable
          sessions={allShownSessions}
          runningCount={runningCount}
          shownIdleCount={shownIdleCount}
          idleTotal={idleTotal}
          sort={sort}
          onSort={handleSort}
          remainingIdleCount={remainingIdleCount}
          canCollapseIdle={canCollapseIdle}
          loadingMore={loadingMore}
          onExpandIdle={expandIdle}
          onCollapseIdle={collapseIdle}
          onRefresh={retry}
        />
      ) : (
        <div className="space-y-4">
          {tree.users.map((user, index) => (
            <UserSection
              key={user.userId}
              machine={tree.machine}
              user={user}
              sort={sort}
              onSort={handleSort}
              remainingIdleCount={index === tree.users.length - 1 ? remainingIdleCount : 0}
              canCollapseIdle={index === tree.users.length - 1 ? canCollapseIdle : false}
              loadingMore={loadingMore}
              onExpandIdle={expandIdle}
              onCollapseIdle={collapseIdle}
              onRefresh={retry}
            />
          ))}
        </div>
      )}
    </PageFrame>
  );
}

/**
 * Clickable metric column headers (`Status`, `Tokens`, `CPU`, `Memory`) shared by the flat and
 * tree tables. Each button keeps the exact column width class so header and body cells stay
 * right-aligned across desktop and mobile viewports.
 */
function MetricSortHeaders({
  sort,
  onSort,
}: {
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  const words = S.tasks;
  const cols: readonly { key: SortKey; label: string; width: string }[] = [
    { key: "status", label: words.colStatus, width: COL_STATUS },
    { key: "tokens", label: words.colTokens, width: COL_TOKENS },
    { key: "cpu", label: words.colCpu, width: COL_CPU },
    { key: "memory", label: words.colMemory, width: COL_MEMORY },
  ];
  return (
    <div className={METRIC_ROW_CLASS}>
      {cols.map((col) => {
        const active = sort.key === col.key;
        const ariaSort = active ? (sort.dir === "desc" ? "descending" : "ascending") : "none";
        return (
          <button
            key={col.key}
            type="button"
            data-testid={`sort-${col.key}`}
            aria-sort={ariaSort}
            onClick={() => onSort(col.key)}
            className={`${col.width} inline-flex cursor-pointer select-none items-center justify-end gap-0.5 text-right transition-colors hover:text-fg ${
              active ? "font-semibold text-fg" : "font-medium text-fg-muted"
            }`}
          >
            <span className="truncate">{col.label}</span>
            {active && (
              <span aria-hidden className="shrink-0 font-mono text-[10px] leading-none">
                {sort.dir === "desc" ? "↓" : "↑"}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Trailing clickable row inside the session list (`divide-y divide-line-muted`) for expanding or
 * collapsing additional idle sessions.
 */
function IdleMoreRow({
  remainingIdleCount,
  canCollapseIdle,
  loadingMore,
  onExpandIdle,
  onCollapseIdle,
  flat,
}: {
  remainingIdleCount: number;
  canCollapseIdle: boolean;
  loadingMore: boolean;
  onExpandIdle: () => void;
  onCollapseIdle: () => void;
  flat?: boolean;
}) {
  const words = S.tasks;
  if (remainingIdleCount <= 0 && !canCollapseIdle) return null;
  const indentClass = flat ? "pl-3" : "pl-6";

  if (remainingIdleCount > 0) {
    return (
      <div className="flex items-center justify-between hover:bg-surface-muted">
        <button
          type="button"
          data-testid="expand-idle-sessions"
          disabled={loadingMore}
          onClick={onExpandIdle}
          className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 pr-3 text-left text-xs font-medium text-fg-muted transition-colors duration-150 hover:text-fg disabled:opacity-50 ${indentClass}`}
        >
          <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center">
            <Chevron open size={12} className="text-fg-subtle" />
          </span>
          <span className="truncate">{words.showMoreIdle(remainingIdleCount)}</span>
        </button>
        {canCollapseIdle && (
          <button
            type="button"
            data-testid="collapse-idle-sessions"
            disabled={loadingMore}
            onClick={onCollapseIdle}
            className="shrink-0 cursor-pointer px-3 py-2 text-xs text-fg-subtle transition-colors hover:text-fg disabled:opacity-50"
          >
            {words.showLessIdle}
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="collapse-idle-sessions"
      disabled={loadingMore}
      onClick={onCollapseIdle}
      className={`flex w-full cursor-pointer items-center gap-2 py-2 pr-3 text-left text-xs font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-muted hover:text-fg disabled:opacity-50 ${indentClass}`}
    >
      <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center">
        <Chevron open={false} size={12} className="-rotate-90 text-fg-subtle" />
      </span>
      <span className="truncate">{words.showLessIdle}</span>
    </button>
  );
}

/**
 * Default flat view: one monitor table with running/compacting sessions at the top, followed by
 * the loaded slice of most recent idle sessions and an inline clickable trailing row for loading
 * more idle sessions.
 */
function FlatSessionTable({
  sessions,
  runningCount,
  shownIdleCount,
  idleTotal,
  sort,
  onSort,
  remainingIdleCount,
  canCollapseIdle,
  loadingMore,
  onExpandIdle,
  onCollapseIdle,
  onRefresh,
}: {
  sessions: readonly TaskSessionInfo[];
  runningCount: number;
  shownIdleCount: number;
  idleTotal: number;
  sort: SortState;
  onSort: (key: SortKey) => void;
  remainingIdleCount: number;
  canCollapseIdle: boolean;
  loadingMore: boolean;
  onExpandIdle: () => void;
  onCollapseIdle: () => void;
  onRefresh: () => void;
}) {
  const words = S.tasks;
  return (
    <Card as="section" padding="none">
      <div
        data-slot="head"
        className={`${TREE_ROW_CLASS} border-b border-line-muted bg-surface-muted`}
      >
        <div className="flex min-w-48 flex-1 flex-wrap items-center gap-2">
          <GlyphIcon
            d={ICONS.bubbleLines}
            size={ICON_SIZE.inlineGlyph}
            className="shrink-0 text-fg-muted"
          />
          <span className="font-semibold text-fg">{words.sessionCount}</span>
          <span className="tabular-nums text-fg-subtle">
            ({words.sessionBreakdown(runningCount, shownIdleCount, idleTotal)})
          </span>
        </div>
        <MetricSortHeaders sort={sort} onSort={onSort} />
      </div>
      <div className="divide-y divide-line-muted">
        {sessions.map((session) => (
          <SessionRow key={session.sessionId} session={session} flat onRefresh={onRefresh} />
        ))}
        <IdleMoreRow
          remainingIdleCount={remainingIdleCount}
          canCollapseIdle={canCollapseIdle}
          loadingMore={loadingMore}
          onExpandIdle={onExpandIdle}
          onCollapseIdle={onCollapseIdle}
          flat
        />
      </div>
    </Card>
  );
}

/**
 * One `machine > user` tree table: its header row aligns the four `[status, token, cpu, memory]`
 * columns above the user's apps and direct sessions.
 */
function UserSection({
  machine,
  user,
  sort,
  onSort,
  remainingIdleCount,
  canCollapseIdle,
  loadingMore,
  onExpandIdle,
  onCollapseIdle,
  onRefresh,
}: {
  machine: string;
  user: TaskUserInfo;
  sort: SortState;
  onSort: (key: SortKey) => void;
  remainingIdleCount: number;
  canCollapseIdle: boolean;
  loadingMore: boolean;
  onExpandIdle: () => void;
  onCollapseIdle: () => void;
  onRefresh: () => void;
}) {
  const words = S.tasks;
  const sessionCount =
    user.apps.reduce((n, app) => n + app.sessions.length, 0) + user.sessions.length;
  return (
    <Card as="section" padding="none">
      <div
        data-slot="head"
        className={`${TREE_ROW_CLASS} border-b border-line-muted bg-surface-muted`}
      >
        <div className="flex min-w-48 flex-1 flex-wrap items-center gap-2">
          <GlyphIcon
            d={ICONS.user}
            size={ICON_SIZE.inlineGlyph}
            className="shrink-0 text-fg-muted"
          />
          <span className="font-mono text-fg-muted">{machine}</span>
          <span className="text-fg-subtle">&gt;</span>
          <span className="font-mono font-semibold text-fg">{user.userId}</span>
          <span className="tabular-nums text-fg-subtle">({words.userSessions(sessionCount)})</span>
        </div>
        <MetricSortHeaders sort={sort} onSort={onSort} />
      </div>
      <div className="divide-y divide-line-muted">
        {user.apps.map((app) => (
          <AppGroup
            key={`${app.projectId}/${app.agentId}/${app.pageId}`}
            app={app}
            sort={sort}
            onRefresh={onRefresh}
          />
        ))}
        {user.sessions.length > 0 && (
          <DirectSessionsGroup sessions={user.sessions} sort={sort} onRefresh={onRefresh} />
        )}
        <IdleMoreRow
          remainingIdleCount={remainingIdleCount}
          canCollapseIdle={canCollapseIdle}
          loadingMore={loadingMore}
          onExpandIdle={onExpandIdle}
          onCollapseIdle={onCollapseIdle}
        />
      </div>
    </Card>
  );
}

/** Level 2 (`app`): one workbench page and the Sessions it opened. */
function AppGroup({
  app,
  sort,
  onRefresh,
}: {
  app: TaskAppInfo;
  sort: SortState;
  onRefresh: () => void;
}) {
  const words = S.tasks;
  const resources = sumSessionResources(app.sessions);
  const sortedSessions = [...app.sessions].sort((a, b) => compareSessionsBySort(a, b, sort));
  return (
    <SessionGroup
      icon={ICONS.appWindow}
      title={app.workbenchName}
      meta={words.appMeta(app.projectName ?? app.projectId, app.agentName)}
      tokens={app.tokens}
      cpu={resources.cpu}
      memory={resources.memory}
      sessions={sortedSessions}
      onRefresh={onRefresh}
    />
  );
}

/** Level 2 (`app` sibling): Sessions under a user that no workbench page opened. */
function DirectSessionsGroup({
  sessions,
  sort,
  onRefresh,
}: {
  sessions: readonly TaskSessionInfo[];
  sort: SortState;
  onRefresh: () => void;
}) {
  const words = S.tasks;
  const tokens = sumSessionTokens(sessions);
  const resources = sumSessionResources(sessions);
  const sortedSessions = [...sessions].sort((a, b) => compareSessionsBySort(a, b, sort));
  return (
    <SessionGroup
      icon={ICONS.bubbleLines}
      title={words.directSessions}
      tokens={tokens}
      cpu={resources.cpu}
      memory={resources.memory}
      sessions={sortedSessions}
      onRefresh={onRefresh}
    />
  );
}

/** Shared collapsible level-2 group row + folded session list. */
function SessionGroup({
  icon,
  title,
  meta,
  tokens,
  cpu,
  memory,
  sessions,
  onRefresh,
}: {
  icon: string;
  title: string;
  meta?: string;
  tokens: TaskTokens;
  cpu: number | null;
  memory: number | null;
  sessions: readonly TaskSessionInfo[];
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(true);
  const words = S.tasks;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`${TREE_ROW_CLASS} w-full text-left transition-colors duration-150 hover:bg-surface-muted`}
      >
        <div className="flex min-w-48 flex-1 items-center gap-2 pl-3">
          <Chevron open={open} size={12} className="text-fg-muted" />
          <GlyphIcon d={icon} size={ICON_SIZE.inlineGlyph} className="shrink-0 text-fg-muted" />
          <span className="truncate font-semibold text-fg">{title}</span>
          {meta !== undefined && <span className="min-w-0 truncate text-fg-muted">{meta}</span>}
        </div>
        <div className={METRIC_ROW_CLASS}>
          <span className={`${COL_STATUS} text-right text-fg-subtle`}>
            {words.userSessions(sessions.length)}
          </span>
          <span className={`${COL_TOKENS} text-right font-mono text-fg-muted`}>
            {formatTokens(tokens.total)}
          </span>
          <span className={`${COL_CPU} text-right font-mono text-fg-muted`}>
            {formatCpu(cpu, words.unmeasured)}
          </span>
          <span className={`${COL_MEMORY} text-right font-mono text-fg-muted`}>
            {formatMemory(memory, formatBytes, words.unmeasured)}
          </span>
        </div>
      </button>
      <Fold open={open} bodyClassName="divide-y divide-line-muted border-t border-line-muted">
        {sessions.map((session) => (
          <SessionRow key={session.sessionId} session={session} onRefresh={onRefresh} />
        ))}
      </Fold>
    </div>
  );
}

/**
 * One session row (`hash title ... Agent (source ...)` on the left, `[status token cpu memory]` on
 * the right):
 * - Single-clicking the row navigates to `/chat/<sessionId>`.
 * - Right-clicking, Shift+F10 or touch long-press opens the session context menu.
 * - When the session has active processes, the leading chevron button toggles the process fold.
 */
function SessionRow({
  session,
  flat,
  onRefresh,
}: {
  session: TaskSessionInfo;
  flat?: boolean;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const words = S.tasks;
  const hasProcesses = session.processes.length > 0;
  const sessionTitle = session.title ?? words.untitledSession;
  const sessionPath = `/chat/${encodeURIComponent(session.sessionId)}`;
  const status =
    session.status === "running"
      ? { text: words.running, tone: "success" as const, icon: "running" as const }
      : session.status === "compacting"
        ? { text: words.compacting, tone: "attention" as const, icon: "waiting" as const }
        : { text: words.idle, tone: "neutral" as const, icon: "done" as const };

  const toggleProcesses = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) onRefresh();
      return next;
    });
  };

  const openSession = () => {
    navigate(sessionPath);
  };

  const copyId = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
      void navigator.clipboard.writeText(session.sessionId);
    }
    toastSuccess(words.copiedSessionId);
  };

  const handleKillSession = () => {
    killTaskSession(session.sessionId)
      .then(() => {
        toastSuccess(words.killedSession);
        onRefresh();
      })
      .catch((err: unknown) => {
        toastApiError(err, { text: words.killSessionFailed(apiErrorText(err)) });
      });
  };

  return (
    <div>
      <ContextMenu
        label={sessionTitle}
        items={(close) => (
          <>
            <MenuItem
              glyph={ICONS.bubbleLines}
              label={words.openSession}
              onSelect={() => {
                close();
                openSession();
              }}
            />
            <MenuItem
              glyph={ICONS.externalLink}
              label={words.openInNewTab}
              onSelect={() => {
                close();
                if (typeof window !== "undefined") {
                  window.open(sessionPath, "_blank", "noopener,noreferrer");
                }
              }}
            />
            {hasProcesses && (
              <MenuItem
                glyph={ICONS.terminalPrompt}
                label={open ? words.collapseProcesses : words.expandProcesses}
                onSelect={() => {
                  close();
                  toggleProcesses();
                }}
              />
            )}
            <MenuSeparator />
            <MenuItem
              glyph={ICONS.copy}
              label={words.copySessionId}
              onSelect={() => {
                close();
                copyId();
              }}
            />
            <MenuSeparator />
            <MenuItem
              glyph={ICONS.archive}
              label={words.killSession}
              danger
              onSelect={() => {
                close();
                handleKillSession();
              }}
            />
          </>
        )}
      >
        {(target) => (
          <div
            ref={target.ref}
            {...target.props}
            className={`flex items-center text-xs transition-colors duration-150 hover:bg-surface-muted ${
              flat ? "pl-3" : "pl-6"
            }`}
          >
            {hasProcesses ? (
              <button
                type="button"
                data-testid="toggle-session-processes"
                aria-expanded={open}
                aria-label={words.toggleProcesses}
                data-tooltip={words.toggleProcesses}
                onClick={toggleProcesses}
                className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-control-hover hover:text-fg"
              >
                <Chevron open={open} size={12} />
              </button>
            ) : (
              <span aria-hidden className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center">
                <Chevron open={false} size={12} className="invisible" />
              </span>
            )}
            <button
              type="button"
              data-testid="task-session-row"
              data-session-id={session.sessionId}
              onClick={() => {
                if (target.consumeLongPressClick()) return;
                openSession();
              }}
              className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 pr-3 text-left"
            >
              <div className="flex min-w-48 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <StatusIcon state={status.icon} size="sm" />
                <span className="shrink-0 font-mono text-fg-subtle">
                  {shortSessionId(session.sessionId)}
                </span>
                <span className="truncate text-sm font-medium text-fg">{sessionTitle}</span>
                <span className="truncate text-fg-muted">
                  {`${session.agentName} (${words.sourceLabel(session.source)})`}
                </span>
                {hasProcesses && (
                  <span className="shrink-0 font-mono tabular-nums text-fg-muted">
                    [{words.processCount(session.processes.length)}]
                  </span>
                )}
              </div>
              <div className={METRIC_ROW_CLASS}>
                <span className={`flex ${COL_STATUS} justify-end`}>
                  <Pill tone={status.tone}>{status.text}</Pill>
                </span>
                <span className={`${COL_TOKENS} text-right font-mono font-medium text-fg`}>
                  {formatTokens(session.tokens.total)}
                </span>
                <span className={`${COL_CPU} text-right font-mono text-fg-muted`}>
                  {formatCpu(session.cpu, words.unmeasured)}
                </span>
                <span className={`${COL_MEMORY} text-right font-mono text-fg-muted`}>
                  {formatMemory(session.memory, formatBytes, words.unmeasured)}
                </span>
              </div>
            </button>
          </div>
        )}
      </ContextMenu>
      <Fold
        open={open && hasProcesses}
        bodyClassName="divide-y divide-line-muted border-t border-line-muted bg-surface-muted"
      >
        {session.processes.map((process) => (
          <ProcessRow
            key={process.id}
            sessionId={session.sessionId}
            process={process}
            onRefresh={onRefresh}
          />
        ))}
      </Fold>
    </div>
  );
}

/** Resolves a human-friendly label, primary target/command and optional description for a process row. */
function formatProcessDisplay(
  process: TaskProcessInfo,
  words: typeof S.tasks,
): { label: string; code: string; subtitle?: string } {
  if (process.kind === "background") {
    return { label: words.background, code: process.name };
  }
  const toolLabels: Readonly<Record<string, string>> = {
    exec_command: words.toolExecCommand,
    input_command: words.toolInputCommand,
    read_file: words.toolReadFile,
    write_file: words.toolWriteFile,
    edit_file: words.toolEditFile,
    run_subagent: words.toolRunSubagent,
    input_subagent: words.toolInputSubagent,
  };
  const label = toolLabels[process.name] ?? words.toolCall;
  if (process.detail !== undefined && process.detail.length > 0) {
    return {
      label,
      code: process.detail,
      ...(process.description !== undefined &&
      process.description.length > 0 &&
      process.description !== process.detail
        ? { subtitle: process.description }
        : {}),
    };
  }
  if (process.description !== undefined && process.description.length > 0) {
    return { label, code: process.description };
  }
  return { label, code: process.name };
}

/** Level 4 (`process [status token cpu memory]`), aligned to the same 4 metric columns. */
function ProcessRow({
  sessionId,
  process,
  onRefresh,
}: {
  sessionId: string;
  process: TaskProcessInfo;
  onRefresh: () => void;
}) {
  const words = S.tasks;
  const status =
    process.status === "running"
      ? { text: words.running, tone: "success" as const, icon: "running" as const }
      : process.status === "pending"
        ? { text: words.pending, tone: "attention" as const, icon: "waiting" as const }
        : { text: words.exited, tone: "neutral" as const, icon: "done" as const };
  const display = formatProcessDisplay(process, words);
  const fullTitle =
    display.subtitle !== undefined ? `${display.code} — ${display.subtitle}` : display.code;
  const subagentSessionId =
    process.subagentSessionId !== undefined &&
    process.subagentSessionId !== null &&
    process.subagentSessionId.length > 0
      ? process.subagentSessionId
      : null;
  const subagentSessionPath =
    subagentSessionId !== null ? `/chat/${encodeURIComponent(subagentSessionId)}` : null;

  const openSubagentSession = () => {
    if (subagentSessionPath !== null) {
      navigate(subagentSessionPath);
    }
  };

  const sendSignal = (signal: TaskProcessSignal, isRemoveExited = false) => {
    signalTaskProcess(sessionId, process.id, signal)
      .then(() => {
        toastSuccess(isRemoveExited ? words.removedExitedProcess : words.sentProcessSignal(signal));
        onRefresh();
      })
      .catch((err: unknown) => {
        toastApiError(err, { text: words.signalProcessFailed(apiErrorText(err)) });
      });
  };

  const copyCommand = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
      void navigator.clipboard.writeText(display.code);
    }
    toastSuccess(words.copiedProcessCommand);
  };

  const copyPid = () => {
    if (
      process.pid !== null &&
      typeof navigator !== "undefined" &&
      navigator.clipboard !== undefined
    ) {
      void navigator.clipboard.writeText(String(process.pid));
    }
    toastSuccess(words.copiedProcessPid);
  };

  return (
    <ContextMenu
      label={display.code}
      items={(close) => (
        <>
          {subagentSessionPath !== null && (
            <>
              <MenuItem
                glyph={ICONS.bubbleLines}
                label={words.openSession}
                onSelect={() => {
                  close();
                  openSubagentSession();
                }}
              />
              <MenuItem
                glyph={ICONS.externalLink}
                label={words.openInNewTab}
                onSelect={() => {
                  close();
                  if (typeof window !== "undefined") {
                    window.open(subagentSessionPath, "_blank", "noopener,noreferrer");
                  }
                }}
              />
              <MenuSeparator />
            </>
          )}
          {process.status !== "exited" ? (
            <>
              <MenuItem
                glyph={ICONS.stopCircle}
                label={words.signalSigterm}
                onSelect={() => {
                  close();
                  sendSignal("SIGTERM");
                }}
              />
              <MenuItem
                glyph={ICONS.zap}
                label={words.signalSigint}
                onSelect={() => {
                  close();
                  sendSignal("SIGINT");
                }}
              />
              <MenuItem
                glyph={ICONS.refresh}
                label={words.signalSighup}
                onSelect={() => {
                  close();
                  sendSignal("SIGHUP");
                }}
              />
              <MenuItem
                glyph={ICONS.trash}
                label={words.signalSigkill}
                danger
                onSelect={() => {
                  close();
                  sendSignal("SIGKILL");
                }}
              />
            </>
          ) : (
            <MenuItem
              glyph={ICONS.trash}
              label={words.removeExitedProcess}
              danger
              onSelect={() => {
                close();
                sendSignal("SIGTERM", true);
              }}
            />
          )}
          <MenuSeparator />
          <MenuItem
            glyph={ICONS.copy}
            label={words.copyProcessCommand}
            onSelect={() => {
              close();
              copyCommand();
            }}
          />
          {process.pid !== null && (
            <MenuItem
              glyph={ICONS.hash}
              label={words.copyProcessPid}
              onSelect={() => {
                close();
                copyPid();
              }}
            />
          )}
        </>
      )}
    >
      {(target) => (
        <div
          ref={target.ref}
          {...target.props}
          tabIndex={0}
          role={subagentSessionId !== null ? "button" : undefined}
          onClick={
            subagentSessionId !== null
              ? () => {
                  if (target.consumeLongPressClick()) return;
                  openSubagentSession();
                }
              : undefined
          }
          onKeyDown={
            subagentSessionId !== null
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openSubagentSession();
                  }
                }
              : undefined
          }
          className={`${TREE_ROW_CLASS} ${
            subagentSessionId !== null ? "cursor-pointer" : "cursor-context-menu"
          } transition-colors duration-150 hover:bg-control-hover`}
          data-testid="task-process-row"
          data-process-id={process.id}
          data-subagent-session-id={subagentSessionId ?? undefined}
          title={fullTitle}
        >
          <div className="flex min-w-48 flex-1 items-center gap-2 pl-6">
            <StatusIcon state={status.icon} size="xs" />
            <span className="shrink-0 font-medium text-fg-muted">{display.label}</span>
            {subagentSessionId !== null && (
              <span className="shrink-0 font-mono text-fg-subtle">
                {shortSessionId(subagentSessionId)}
              </span>
            )}
            <code
              className={`min-w-0 truncate font-mono text-fg ${
                display.subtitle !== undefined ? "max-w-48 sm:max-w-xs" : "flex-1"
              }`}
            >
              {display.code}
            </code>
            {display.subtitle !== undefined && (
              <span className="min-w-0 flex-1 truncate text-fg-subtle">— {display.subtitle}</span>
            )}
            {process.pid !== null && (
              <span className="shrink-0 font-mono text-fg-subtle">{words.pid(process.pid)}</span>
            )}
          </div>
          <div className={METRIC_ROW_CLASS}>
            <span className={`flex ${COL_STATUS} justify-end`}>
              <Pill tone={status.tone}>{status.text}</Pill>
            </span>
            <span className={`${COL_TOKENS} text-right font-mono text-fg-subtle`}>
              {words.unmeasured}
            </span>
            <span className={`${COL_CPU} text-right font-mono text-fg-muted`}>
              {formatCpu(process.cpu, words.unmeasured)}
            </span>
            <span className={`${COL_MEMORY} text-right font-mono text-fg-muted`}>
              {formatMemory(process.memory, formatBytes, words.unmeasured)}
            </span>
          </div>
        </div>
      )}
    </ContextMenu>
  );
}
