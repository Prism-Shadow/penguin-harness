/**
 * The status bar across the bottom of the shell — this round a fixed part of the Web App's
 * layout (a plugin's own bar can follow later; the seam is this one component).
 *
 * The admin's own view of their harness: the machine they work on on the left, the session
 * counts on the right. One poll (POST /api/harness-status, carrying the Session ids this
 * browser has opened) repaints everything — the load of the machine the most recently viewed
 * Session lives on (this server's when nothing viewed is in the answer), the harness-wide
 * active count summed over every machine that answered, and the rows of the Sessions the user
 * has opened TOGETHER with every active Session in the harness, wherever they live. The route
 * answers 403 for a non-admin, and the bar treats that as "not for this user" and unmounts
 * itself.
 *
 * Collection is deliberately dull: one request every 10 seconds, stopped while the tab is
 * hidden and resumed (with an immediate poll) when it shows again, and re-asked the moment
 * the shell moves onto another Session — the row it lands on is the one the bar's machine
 * read. Nothing is sampled on the main thread beyond painting the numbers; the CPU's window
 * is measured server-side.
 *
 * Counting and marking follow the ticket's own words, spelled out in lib/status-bar-model:
 * `session: ${active} / ${viewed}` — active is the server's live truth over the whole
 * harness, viewed is this browser's own opened set, and a row's x is the 「移除即关闭」 that
 * makes that count go down by one; a Session the user has opened carries a one-time
 * 「已空闲」 mark from the poll that first sees it idle after a running one, until they look
 * at it again. A row the user has NOT opened is the active half's own: it rides the list only
 * while the poll still reports it active — no x, no mark, nothing kept — and one click moves
 * it into the opened half with every current semantic (the sidebar is asked to locate it
 * too, so the left column follows the jump: its desk's row, or its conversation's — and the
 * reach before the ask takes the sidebar where the row lives: a row whose company is not the
 * one on screen goes there first, a normal row takes the shell back to the development
 * list, and the ask is kept waiting for the rows that mount to answer it).
 */
import { useEffect, useRef, useState } from "react";
import { useMatch, useNavigate } from "react-router";
import { Badge, CloseIcon, Dropdown } from "@prismshadow/penguin-ui";
import type {
  HarnessStatusResponse,
  HarnessStatusSession,
  HarnessStatusSystem,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { workspaceLabel } from "../../lib/session-grouping";
import {
  MARKS_KEY,
  OPENED_KEY,
  IdSet,
  byLatest,
  gigabytes,
  loadIdSet,
  marksForTransitions,
  pageStorage,
  reachOfRow,
  saveIdSet,
  viewedCount,
  workingMachineOf,
} from "../../lib/status-bar-model";
import { locateSessionInSidebar } from "../../lib/sidebar-locate";
import { rememberSessionMachine } from "../../lib/session-machines";
import { toneDot } from "../../lib/tone";
import { useCompany } from "../../state/company";
import { orgKey } from "../../features/company/company-nav";

/** One poll every 10 seconds: a status bar cadence, not a monitoring one. */
const POLL_MS = 10_000;

/** The route-ids that are not Sessions: the new-chat page and its parked drafts. */
const notASession = (id: string): boolean => id === "new" || id.startsWith("draft-");

export function StatusBar() {
  const navigate = useNavigate();
  /** The Session the shell is on, if it is on one (the draft page's ids are not Sessions). */
  const routeSessionId = useMatch("/chat/:sessionId")?.params.sessionId ?? null;
  /**
   * The shell's company side, for the click's reach: which organization the sidebar stands on,
   * and the organizations this shell can show at all — the pair that says whether a row's
   * company is somewhere the sidebar can be taken to.
   */
  const company = useCompany();

  /** The harness's last answer; null until the first poll lands (and forever on a 403). */
  const [data, setData] = useState<HarnessStatusResponse | null>(null);
  /** Bumped whenever one of the tracked sets changed, so the rows re-read the refs. */
  const [, setBookkeeping] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  /** Bumped by a removal, so the poll asks again at once — the row leaves the list now. */
  const [pollNonce, setPollNonce] = useState(0);

  /** The bar's own bookkeeping, loaded once and saved on every change (best-effort). */
  const opened = useRef<IdSet | null>(null);
  const marks = useRef<IdSet | null>(null);
  if (opened.current === null) {
    const storage = pageStorage();
    opened.current = loadIdSet(storage, OPENED_KEY);
    marks.current = loadIdSet(storage, MARKS_KEY);
  }
  /** Every set change persists; one function so no change path forgets the save. */
  const note = () => {
    const storage = pageStorage();
    saveIdSet(storage, OPENED_KEY, opened.current!);
    saveIdSet(storage, MARKS_KEY, marks.current!);
    setBookkeeping((v) => v + 1);
  };

  /** The statuses the previous poll observed — the before-side of every mark's transition. */
  const prevStatuses = useRef<ReadonlyMap<string, SessionStatus> | null>(null);

  // Looking at a Session opens it (it becomes one the bar marks when it goes idle) and
  // clears any idle mark it carries — the mark has done its job once it brought the user
  // here. Declared above the poll, so the poll a route change restarts asks with the row it
  // landed on already in the opened set.
  useEffect(() => {
    const id = routeSessionId;
    if (id === null || notASession(id)) return;
    let changed = !opened.current!.has(id);
    opened.current!.add(id);
    if (marks.current!.has(id)) {
      marks.current!.delete(id);
      changed = true;
    }
    if (changed) note();
  }, [routeSessionId]);

  // The one poll: every POLL_MS while the tab shows, stopped while it hides (resumed with an
  // immediate poll on show), and started over when the shell moves onto another Session or a
  // removal shrinks the opened set — the row it lands on, and the row that left, are in the
  // answer at once. A 403 is the endpoint saying "not this user" — the bar stops for good;
  // any other failure is transient and the next tick tries again with the last data still
  // painted.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      let forbidden = false;
      try {
        const next = await api.getHarnessStatus(opened.current!.toArray());
        if (cancelled) return;
        setData(next);
        // Where each row lives, so the two dozen Session-scoped calls about it reach the
        // machine that holds it — the poll's rows are the authority the lists rebuilt anyway.
        for (const row of next.sessions) rememberSessionMachine(row.sessionId, row.machineId);
        const newlyMarked = marksForTransitions(
          next.sessions,
          prevStatuses.current ?? new Map(),
          opened.current!,
          marks.current!,
        );
        for (const id of newlyMarked) marks.current!.add(id);
        prevStatuses.current = new Map(next.sessions.map((row) => [row.sessionId, row.status]));
        if (newlyMarked.length > 0) {
          saveIdSet(pageStorage(), MARKS_KEY, marks.current!);
          setBookkeeping((v) => v + 1);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) forbidden = true;
      }
      if (cancelled || forbidden) return; // not this user's bar: no data, no retries
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        void tick();
      } else if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [routeSessionId, pollNonce]);

  /** The x: stop keeping the Session — the ticket's 「移除即关闭」, so `viewed` goes down by one. */
  const remove = (sessionId: string) => {
    opened.current!.delete(sessionId);
    marks.current!.delete(sessionId);
    note();
    setPollNonce((v) => v + 1); // ask again now: the row leaves the list in this breath
  };

  /**
   * A row's click: open the Session, and ask the sidebar to catch up — the left column
   * locates what the jump landed on (its desk's row in company mode, its conversation's in
   * development mode), so the two halves of the shell never disagree about where the user
   * is. The reach before the ask is `reachOfRow`'s to name: a company row the shell's own
   * list holds takes the sidebar to that company (both setters no-ops where the shell
   * already stands, so a row of the company on screen only jumps), a normal row takes the
   * shell back to the development list when it stands in company mode, and anything else —
   * the development the shell already lists in, a company the shell cannot show, company
   * mode unavailable — reaches nothing. The row itself carries what the locate needs: the
   * employee's Agent for a company Session, and a title to fall back on.
   */
  const open = (row: HarnessStatusSession) => {
    setListOpen(false);
    navigate(`/chat/${row.sessionId}`);
    // The reach before the ask: the sidebar has to stand where the row lives for the ask to
    // be answerable — the row's company for a company row, the development list for a
    // normal Session — so the shell's mode is moved first (the store's setters are no-ops
    // where it already stands), and the ask — held by the locate store until a sidebar can
    // answer — waits out the switch and lands on the rows that can answer it.
    const reach = reachOfRow(row, company.organizations, company.workMode, company.available);
    if (reach !== null) {
      company.setWorkMode(reach.workMode);
      if (reach.workMode === "company") {
        company.setCurrentOrg(orgKey(reach.projectId, reach.orgId));
      }
    }
    locateSessionInSidebar(row.sessionId, row.agentId, row.title);
  };

  if (data === null) return null; // nothing polled yet, or a 403: no bar

  // The left side's machine: the one the most recently viewed Session lives on — the load
  // that matters is the load of whatever the user last worked on, which for a company on
  // its own machine is that machine. This server's when nothing viewed is in the answer.
  const working = workingMachineOf(opened.current!, data.sessions);
  const workingEntry =
    working === null ? null : (data.machines.find((m) => m.machineId === working) ?? null);
  const system: HarnessStatusSystem | null =
    working === null ? data.system : (workingEntry?.system ?? null);

  return (
    <StatusBarView
      running={data.running}
      rows={data.sessions}
      system={system}
      systemAlias={working === null ? null : (workingEntry?.alias ?? null)}
      marks={marks.current!}
      opened={opened.current!}
      listOpen={listOpen}
      onListOpen={setListOpen}
      onOpenSession={open}
      onRemove={remove}
    />
  );
}

/** The bar's presentational half, props only — tests render it without the app around it. */
export function StatusBarView({
  running,
  rows,
  system,
  systemAlias,
  marks,
  opened,
  listOpen,
  onListOpen,
  onOpenSession,
  onRemove,
}: {
  /** The harness-wide active count: every machine that answered, summed. */
  running: number;
  /** The poll's rows: the opened Sessions it still holds plus every active one — the list. */
  rows: readonly HarnessStatusSession[];
  /** The machine the left side reads; null when that machine did not answer this poll. */
  system: HarnessStatusSystem | null;
  /** The alias of the machine the left side reads; null when it is this server. */
  systemAlias: string | null;
  marks: ReadonlySet<string>;
  /** The Sessions this browser has opened and still keeps — the second count. */
  opened: ReadonlySet<string>;
  listOpen: boolean;
  /** The list's open state, handed both ways (the trigger toggles, the shell closes). */
  onListOpen: (open: boolean) => void;
  /** Opens the row's Session — the whole row, so the parent can hand the sidebar what it is. */
  onOpenSession: (row: HarnessStatusSession) => void;
  onRemove: (sessionId: string) => void;
}) {
  // The counts: active is the harness's live truth over every machine; viewed is this
  // browser's own opened set. The list shows both halves' rows.
  const all = viewedCount(opened);
  const list = byLatest(rows);
  const machineSuffix = systemAlias === null ? "" : `: ${systemAlias}`;

  return (
    <footer
      data-slot="status-bar"
      className="flex h-7 shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-line bg-surface-muted px-3 text-xs text-fg-muted"
    >
      {/* Left: the machine the user works on. Two facts, no more (no disk — the ticket
          names CPU and memory alone), read from the poll, never measured here. A machine
          that did not answer this poll shows no numbers at all rather than another
          machine's. */}
      <div className="flex min-w-0 items-center gap-4">
        <span
          className="whitespace-nowrap"
          data-tooltip={`${S.statusBar.cpuTooltip}${machineSuffix}`}
        >
          {S.statusBar.cpu}{" "}
          {system === null
            ? "—"
            : system.cpuPercent === null
              ? S.statusBar.measuring
              : `${system.cpuPercent}%`}
        </span>
        <span
          className="whitespace-nowrap"
          data-tooltip={`${S.statusBar.memoryTooltip}${machineSuffix}`}
        >
          {S.statusBar.memory}{" "}
          {system === null
            ? "—"
            : S.statusBar.memoryOf(
                gigabytes(system.memoryUsedBytes),
                gigabytes(system.memoryTotalBytes),
              )}
        </span>
      </div>
      {/* Right: the session counts alone — the company and workdir labels were this bar's
          first draft and the review took them off. The counts' click opens the list. */}
      <Dropdown
        open={listOpen}
        setOpen={onListOpen}
        portal={{ direction: "up", align: "right" }}
        button={
          <button
            type="button"
            aria-label={S.statusBar.sessionsTooltip}
            aria-expanded={listOpen}
            data-tooltip={S.statusBar.sessionsTooltip}
            onClick={() => onListOpen(!listOpen)}
            className="whitespace-nowrap rounded px-1 font-medium text-fg transition-colors hover:bg-fg/5"
          >
            {S.statusBar.sessions(running, all)}
          </button>
        }
        menuClass="w-80"
      >
        <div className="max-h-[60vh] overflow-y-auto">
          <p className="px-3 py-1.5 text-xs font-medium text-fg">{S.statusBar.listTitle}</p>
          {list.length === 0 ? (
            <p className="px-3 py-3 text-xs text-fg-muted">{S.statusBar.listEmpty}</p>
          ) : (
            list.map((row) => {
              // The row's half: a Session the user has opened is theirs to keep — mark and
              // x both — while an active one they never opened only rides the list while
              // the poll still reports it active; nothing about it is kept, so it gets
              // neither, and one click (which opens it) moves it into the opened half.
              const kept = opened.has(row.sessionId);
              const marked = kept && marks.has(row.sessionId);
              const runningRow = row.status !== "idle";
              const title = row.title ?? S.company.sessionList.untitledSession;
              const statusWord = runningRow ? S.statusBar.runningLabel : S.statusBar.idleLabel;
              return (
                <div key={row.sessionId} className="group flex items-center gap-2 px-2 py-1.5">
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      runningRow ? toneDot.busy : toneDot.muted
                    }`}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-xs text-fg hover:underline"
                    aria-label={`${title} · ${statusWord}`}
                    onClick={() => onOpenSession(row)}
                  >
                    {title}
                    <span className="ml-2 text-fg-muted">{workspaceLabel(row.workspace)}</span>
                  </button>
                  {marked && (
                    <Badge tone="attention" variant="soft">
                      {S.statusBar.markedIdle}
                    </Badge>
                  )}
                  {kept && (
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-fg/5 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                      aria-label={S.statusBar.remove}
                      data-tooltip={S.statusBar.removeHint}
                      onClick={() => onRemove(row.sessionId)}
                    >
                      <CloseIcon size={12} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Dropdown>
    </footer>
  );
}
