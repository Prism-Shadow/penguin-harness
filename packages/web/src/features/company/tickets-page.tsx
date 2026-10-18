/**
 * The ticket board: five columns in lifecycle order (shaping in ticket-board.ts), each with
 * its colour bar and count, a card per ticket — title, priority, due date (danger once
 * passed), the blocked badge, a muted line naming its parent, and its owner — moving a card
 * between columns by dragging it, which confirms the move (a move into rejected asks for a
 * one-line reason) before posting it, the create form, and the tickets and files the server
 * could not accept.
 *
 * Above the columns sits one toolbar, and the page header keeps only what makes something new:
 * quick-filter chips (everything, the approval queue, blocked, overdue, mine) each carrying the
 * count it would leave on the board, the search box — `/` puts the caret in it — the priority
 * chips, the grouping and the sort. The chips are one at a time; a search or a chip narrows the
 * counts too, so a number never promises cards that are not there. `N` opens the create form and
 * Escape leaves select mode (or clears the search) — plain keys, only while this page is on
 * screen and no field has focus.
 *
 * Every column scrolls under its own fixed header and keeps its full height, so the five
 * columns stay side by side however long one of them grows, and a group heading sticks to the
 * top of its column while its cards pass under it.
 * The whole card is one button — the board's one exception to the company pages' rule against
 * whole-area click targets, and it holds no control of its own. A click anywhere on it (Enter
 * and Space too) opens the detail dialog in place (the shell's one host renders it, so the
 * board stays where it is). Dragging it moves it: a mouse or pen press that travels a few pixels
 * lifts the card, which follows the pointer and, released over another column, asks to move
 * there. A finger has to hold the card still for a moment before it lifts, so a finger that moves
 * scrolls the page as usual (ticket-press.ts, ticket-drag.ts). The dialog's move control is the
 * way to move a ticket without dragging. The create form's Create is live once a title is typed
 * and the slug, if any, keeps its rule; closing it with anything typed asks first.
 * The priority rides on the title's line, one size under it. What a card deliberately does
 * not carry is the session count, the cost and any live session status — those are the
 * dialog's, and a ticket is not the place to watch a session run.
 * The board is always on screen: a skeleton of it until the first fetch, the empty columns
 * as drop zones — with a one-line note above them while the organization has no tickets at
 * all, dismissible and repeated in the page's "?" — the board plus an error strip when a
 * refetch fails.
 * `?column=` / `?blocked=1` deep links arrive from the overview, and `?ticket=` is this
 * page's own: it opens the dialog on arrival and follows it while it is open, so a ticket
 * being read can be linked to and survives a reload. No other page writes it — the dialog is
 * shell state, not a route.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useSearchParams } from "react-router";
import type {
  OrgChartResponse,
  OrgTicketItem,
  OrgTicketPriority,
  OrgTicketStatus,
  OrgTicketsResponse,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  Chevron,
  Count,
  FieldLabel,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Input,
  Modal,
  Notice,
  SearchInput,
  Segmented,
  Select,
  Skeleton,
  Textarea,
  discardUnsaved,
  toastError,
  toastSuccess,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { bareKey, isTypingTarget } from "../../lib/shortcuts/page-keys";
import { toneDot, toneInk } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { useCompany } from "../../state/company";
import { OrgPage, useOrg } from "./org-layout";
import {
  BlockedBadge,
  INVALID_ICON,
  PrincipalChip,
  PriorityBadge,
  TitleButton,
  principalLabel,
  titledHint,
} from "./shared";
import {
  BOARD_QUICK_FILTERS,
  TICKET_COLUMNS,
  allTickets,
  boardColumns,
  boardCounts,
  canMove,
  groupTickets,
  invalidTickets,
  isBlocked,
  isOverdue,
  isTicketSlug,
  isTicketStatus,
  matchesTicketQuery,
  moveNeedsReason,
  ticketAgeDays,
} from "./ticket-board";
import type { BoardQuickFilter, TicketGroupBy, TicketSort } from "./ticket-board";
import { MoveTicketConfirm } from "./ticket-dialog";
import { dismissHint, hintKey, isHintDismissed } from "./page-hints";
import { agentPrincipal, splitPrincipalList } from "./principals";
import { dayKey } from "./calendar-geom";
import { TICKET_COLUMN_ATTR, useTicketBoardDrag } from "./ticket-drag";

const PRIORITIES: readonly OrgTicketPriority[] = ["P0", "P1", "P2"];

/** Group-by choices in toolbar order; mirrors TicketGroupBy. */
const GROUP_BY_VALUES: readonly TicketGroupBy[] = ["none", "owner", "priority", "parent"];

/** Sort choices in toolbar order; mirrors TicketSort. */
const SORT_VALUES: readonly TicketSort[] = ["priority", "due", "age"];

function readSort(value: string | null): TicketSort {
  return value === "due" || value === "age" ? value : "priority";
}

/**
 * The active quick filter off the query. `?blocked=1` and `?queue=approve` are the deep links the
 * overview has always written — they read as the chips of the same name, and writing the chip
 * back writes `?quick=`.
 */
function readQuick(params: URLSearchParams): BoardQuickFilter {
  const raw = params.get("quick");
  if (raw !== null && (BOARD_QUICK_FILTERS as readonly string[]).includes(raw)) {
    return raw as BoardQuickFilter;
  }
  if (params.get("blocked") === "1") return "blocked";
  if (params.get("queue") === "approve") return "queue";
  return "all";
}

function readGroupBy(value: string | null): TicketGroupBy {
  return value === "owner" || value === "priority" || value === "parent" ? value : "none";
}

/** localStorage key for collapsed columns and groups (org-scoped inside one shared object). */
const COLLAPSE_KEY = "tickets.collapsed.v1";

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Where an approval moves a card, and where a rejection sends it back to. */
function approveTarget(status: OrgTicketStatus): OrgTicketStatus {
  return status === "review" ? "done" : "in_progress";
}

function rejectTarget(status: OrgTicketStatus): OrgTicketStatus {
  return status === "review" ? "in_progress" : "rejected";
}

/**
 * The colour bar atop each column. Proposed is neutral, in-progress takes the accent (it is
 * the column being worked, not a judgement), review waits on a person (attention), done is
 * finished well (success), rejected is danger.
 */
const COLUMN_BAR: Record<OrgTicketStatus, string> = {
  proposed: "bg-gray-300 dark:bg-gray-600",
  in_progress: "bg-accent",
  review: toneDot.attention,
  done: toneDot.success,
  rejected: toneDot.danger,
};

/**
 * A column: full height, and no taller than the viewport — a long column scrolls under its own
 * header instead of pushing its neighbours off the screen, so the five of them stay side by side
 * whatever the work looks like. The height is capped against the viewport minus what the shell,
 * the page header and the toolbar take.
 */
const columnClass =
  "flex min-h-[26rem] max-h-[calc(100vh-17rem)] flex-col overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60 transition-colors duration-150 dark:border-gray-800 dark:bg-gray-900/40";

/** The hairline down a card's edge, by priority — the tone recedes as the priority drops. */
const PRIORITY_ACCENT: Record<OrgTicketPriority, string> = {
  P0: toneDot.danger,
  P1: toneDot.attention,
  P2: toneDot.muted,
};

export function TicketsPage() {
  const { projectId, orgId, org } = useOrg();
  const company = useCompany();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.tickets}` : S.nav.org.tickets);
  const [board, setBoard] = useState<OrgTicketsResponse | null>(null);
  const [chart, setChart] = useState<OrgChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quick, setQuick] = useState<BoardQuickFilter>(() => readQuick(params));
  const [sort, setSort] = useState<TicketSort>(() => readSort(params.get("sort")));
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [groupBy, setGroupBy] = useState<TicketGroupBy>(() => readGroupBy(params.get("group")));
  const [priFilter, setPriFilter] = useState<readonly OrgTicketPriority[]>(() => {
    const raw = params.get("pri");
    if (raw === null || raw === "") return [];
    return raw
      .split(",")
      .filter((p): p is OrgTicketPriority => p === "P0" || p === "P1" || p === "P2");
  });
  const queueOnly = quick === "queue";
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const isCollapsed = (section: string): boolean => collapsed[`${orgId}:${section}`] === true;
  const toggleCollapsed = (section: string) => {
    const key = `${orgId}:${section}`;
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        // Private mode: the fold lasts the visit.
      }
      return next;
    });
  };
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkNote, setBulkNote] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSelect = (ticketId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  };
  const [move, setMove] = useState<{ ticket: OrgTicketItem; to: OrgTicketStatus } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const highlightColumn = params.get("column");
  // The empty-board note goes away for good once read; the page's "?" carries the same
  // sentence. The key holds the organization, so switching to another one — which does not
  // unmount this page — re-reads the dismissal instead of carrying the last answer over.
  const emptyHintKey = hintKey(user?.userId ?? null, projectId, orgId, "tickets");
  const [hintDismissed, setHintDismissed] = useState(() => isHintDismissed(emptyHintKey));
  useEffect(() => {
    setHintDismissed(isHintDismissed(emptyHintKey));
  }, [emptyHintKey]);

  const load = useCallback(async () => {
    try {
      const [b, c] = await Promise.all([
        api.listOrgTickets(projectId, orgId),
        api.getOrgChart(projectId, orgId),
      ]);
      setBoard(b);
      setChart(c);
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId]);
  const { tickets: ticketsVersion, runs } = company.versions;
  useEffect(() => {
    void load();
  }, [load, ticketsVersion, runs]);

  const employees = chart?.employees ?? [];
  const names = new Map(employees.map((e) => [e.agentId, e.name]));
  const titles = new Map(
    (board === null ? [] : allTickets(board)).map((t) => [t.ticketId, t.title]),
  );
  const todayKey = dayKey(Date.now());
  /** The reader's own principal, spelled as the organization files spell it (`user:<id>`). */
  const me = user ? `user:${user.userId}` : undefined;

  /**
   * Two plain keys while the board is on screen: `/` puts the caret in the search box, `N` opens
   * the create form (bareKey — a chord belongs to the shortcut registry, and Escape is the
   * browser's own way out of a field). Both stand aside for a field being typed in and for a
   * dialog already open — a keystroke aimed at the detail dialog must not also rebuild the
   * board behind it. Escape leaves select mode, then a search, and goes no further.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = bareKey(e);
      if (key === "Escape") {
        if (selectMode) {
          setSelectMode(false);
          setSelected(new Set());
        } else if (query !== "" && !isTypingTarget(e.target)) {
          setQuery("");
        }
        return;
      }
      if (key === null || isTypingTarget(document.activeElement)) return;
      if (company.ticketDialog !== null || createOpen) return;
      if (key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (key === "n" || key === "N") {
        e.preventDefault();
        setCreateOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createOpen, query, selectMode, company]);

  const setQueryParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const openTicket = (ticketId: string) => company.openTicket(projectId, orgId, ticketId);
  const drag = useTicketBoardDrag({
    onOpen: (ticket) => openTicket(ticket.ticketId),
    onDrop: (ticket, to) => setMove({ ticket, to }),
  });
  const { lifted, dropOver } = drag;

  // `?ticket=` and the open dialog, kept in step in both directions: the query opens the
  // dialog on arrival (a deep link, a reload), and the dialog writes itself back into the
  // query as it moves and clears it when it closes. One effect rather than two, and one ref
  // holding the value last read or written — two effects writing to each other would chase
  // one round trip behind and reopen a ticket the reader had just left.
  const urlTicket = params.get("ticket");
  const openDialog = company.ticketDialog;
  const dialogTicket =
    openDialog !== null && openDialog.projectId === projectId && openDialog.orgId === orgId
      ? openDialog.ticketId
      : null;
  const syncedTicket = useRef<string | null>(null);
  const { openTicket: openTicketInShell } = company;
  const routedPath = location.pathname;
  useEffect(() => {
    // The browser has already left this page: a click that closes the dialog and navigates
    // (opening a ticket session) is rendered first with the dialog closed and this page still
    // mounted, since the router commits its new location in a transition. Writing the query now
    // would resolve against this page's stale location and replace the new history entry with
    // the board — the navigation would silently land back here.
    if (window.location.pathname !== routedPath) return;
    if (urlTicket !== syncedTicket.current) {
      syncedTicket.current = urlTicket;
      if (urlTicket !== null) {
        openTicketInShell(projectId, orgId, urlTicket);
        return;
      }
    }
    if (dialogTicket === urlTicket) return;
    syncedTicket.current = dialogTicket;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (dialogTicket === null) next.delete("ticket");
        else next.set("ticket", dialogTicket);
        return next;
      },
      { replace: true },
    );
  }, [urlTicket, dialogTicket, projectId, orgId, openTicketInShell, setParams, routedPath]);

  const confirmMove = async (reason: string, note?: string) => {
    if (move === null) return;
    setBusy(true);
    try {
      await api.moveOrgTicket(projectId, orgId, move.ticket.ticketId, {
        status: move.to,
        ...(moveNeedsReason(move.to) ? { reason: reason.trim() } : {}),
      });
      const trimmed = (note ?? "").trim();
      if (trimmed !== "") {
        await api.progressOrgTicket(projectId, orgId, move.ticket.ticketId, {
          text: trimmed,
        });
      }
      toastSuccess(S.company.tickets.moved);
      setMove(null);
      // One signal for a ticket written here: this board, the open dialog and the
      // organization summaries all refetch off it.
      company.ticketsChanged();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Bulk bar: one target, owner and note applied to every selected card, in order. */
  const applyBulk = async () => {
    if (selected.size === 0 || bulkBusy) return;
    if (bulkTarget === "" && bulkOwner === "" && bulkNote.trim() === "") return;
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    for (const id of selected) {
      try {
        if (bulkNote.trim() !== "") {
          await api.progressOrgTicket(projectId, orgId, id, { text: bulkNote.trim() });
        }
        if (bulkTarget !== "") {
          const to = bulkTarget as OrgTicketStatus;
          await api.moveOrgTicket(projectId, orgId, id, {
            status: to,
            ...(moveNeedsReason(to) ? { reason: bulkNote.trim() } : {}),
          });
        }
        if (bulkOwner !== "") {
          await api.updateOrgTicket(projectId, orgId, id, { owner: bulkOwner });
        }
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    setBulkTarget("");
    setBulkOwner("");
    setBulkNote("");
    if (failed === 0) toastSuccess(S.company.tickets.bulkDone(ok));
    else toastError(S.company.tickets.bulkPartial(ok, failed));
    company.ticketsChanged();
  };

  /** A card's face: the title with its priority first, then what decides its urgency, then where it hangs and who holds it. */
  const cardBody = (t: OrgTicketItem) => {
    const overdue = isOverdue(t.due, todayKey) && t.status !== "done" && t.status !== "rejected";
    const age =
      t.status === "proposed" || t.status === "review" ? ticketAgeDays(t.ticketId, todayKey) : null;
    const showAge = age !== null && age >= 1;
    return (
      <>
        <span className="flex items-start gap-1.5">
          <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug text-gray-900 dark:text-gray-100">
            {t.title}
          </span>
          {/* The priority reads with the title and shares its line, a size under it; the line
              below carries what is time-bound — the due date and the blocked mark. */}
          <span className="mt-px shrink-0">
            <PriorityBadge priority={t.priority} />
          </span>
          {t.invalid !== undefined && (
            <span className={`mt-0.5 shrink-0 ${toneInk.danger}`} data-tooltip={t.invalid}>
              <GlyphIcon d={INVALID_ICON} size={ICON_SIZE.inlineGlyph} />
              <span className="sr-only">{S.company.tickets.invalid}</span>
            </span>
          )}
        </span>
        {/* The time-bound line, drawn only when there is something on it: the priority has
            moved up to the title and an empty row would leave a gap under it. */}
        {(t.due !== undefined || isBlocked(t) || showAge) && (
          <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            {showAge && (
              <span
                className="inline-flex items-center gap-1 font-mono tabular-nums"
                data-tooltip={S.company.tickets.ageHint}
              >
                <GlyphIcon d={ICONS.clockCompact} size={ICON_SIZE.inlineGlyph} />
                {S.company.tickets.ageDays(age ?? 0)}
              </span>
            )}
            {t.due !== undefined && (
              <span
                className={`inline-flex items-center gap-1 font-mono tabular-nums ${overdue ? toneInk.danger : ""}`}
                data-tooltip={
                  overdue ? `${S.company.tickets.overdue} · ${t.due}` : S.company.tickets.due
                }
                data-tooltip-extra={overdue}
              >
                <GlyphIcon d={ICONS.clockCompact} size={ICON_SIZE.inlineGlyph} />
                {t.due}
                {overdue && <span className="sr-only">{S.company.tickets.overdue}</span>}
              </span>
            )}
            {isBlocked(t) && (
              <span className="ml-auto">
                <BlockedBadge
                  reason={t.blocked ?? ""}
                  {...(t.blockedBy !== undefined ? { by: t.blockedBy } : {})}
                />
              </span>
            )}
          </span>
        )}
        {t.parent !== undefined && (
          <span
            className="mt-2 block truncate text-xs text-gray-400 dark:text-gray-500"
            data-tooltip={titledHint(titles.get(t.parent), t.parent)}
            data-tooltip-content="text"
          >
            {S.company.tickets.parentLine(titles.get(t.parent) ?? t.parent)}
          </span>
        )}
        <span className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span
            className="flex min-w-0 text-gray-700 dark:text-gray-200"
            data-tooltip={`${S.company.tickets.owner} ${principalLabel(t.owner, names)}`}
          >
            <PrincipalChip principal={t.owner} names={names} size={ICON_SIZE.rowLead} />
          </span>
        </span>
      </>
    );
  };

  /**
   * The card's frame: a hairline box whose edge and shadow answer the pointer — the board's way
   * of saying the whole face is one target, without moving the card (a hover that shifts what
   * is under the cursor is the kind of tween this codebase keeps off surfaces). Danger-edged
   * when the server flagged the ticket, and opaque in both themes so a card passing under a
   * sticky group heading is covered rather than blended through.
   */
  const cardFrame = (t: OrgTicketItem) =>
    `relative block w-full overflow-hidden rounded-lg border bg-white p-3 pl-3.5 text-left text-xs transition-[border-color,box-shadow] duration-150 hover:shadow-sm dark:bg-gray-900 ${
      t.invalid !== undefined
        ? "border-red-300 dark:border-red-800"
        : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700"
    }`;

  /**
   * A card: one button over the whole face. Unselectable and without the platform's long-press
   * callout, so dragging it never selects its words and holding it on a touch screen never raises
   * a menu; dimmed in place while its ghost is being carried. In select mode the whole face
   * toggles a visual checkbox instead (dragging is off); in queue mode an approval row hangs
   * under the button, outside it — a button holds no control of its own.
   */
  const card = (t: OrgTicketItem) => {
    const isSel = selected.has(t.ticketId);
    const showActions =
      queueOnly && !selectMode && (t.status === "proposed" || t.status === "review");
    return (
      <Fragment key={t.ticketId}>
        {/* In select mode the face toggles the checkbox; otherwise the drag machine's
            props own the press AND the click that opens the ticket. The onClick must ride
            inside the spread below — a separate onClick after it would shadow the
            machine's opener with undefined and no card would ever open (this exact
            regression shipped in board v1). */}
        <button
          type="button"
          data-ticket-card={t.ticketId}
          data-tooltip={`${t.title} · ${t.ticketId} · ${S.company.tickets.dragHint}`}
          {...(selectMode
            ? { "aria-pressed": isSel, onClick: () => toggleSelect(t.ticketId) }
            : drag.cardProps(t))}
          className={`${cardFrame(t)} cursor-pointer select-none [-webkit-touch-callout:none] ${
            lifted?.ticket.ticketId === t.ticketId ? "opacity-40" : ""
          }${isSel ? " border-accent ring-1 ring-accent" : ""}`}
        >
          {/* What to reach for first, before a word is read: a hairline down the card's edge,
              the priority's own tone. It is a mark next to the priority badge, never the only
              carrier of it. */}
          <span
            aria-hidden
            className={`absolute inset-y-0 left-0 w-0.5 ${PRIORITY_ACCENT[t.priority] ?? toneDot.muted}`}
          />
          {selectMode ? (
            <span className="flex items-start gap-2">
              <span
                aria-hidden
                className={`mt-0.5 h-4 w-4 shrink-0 rounded border ${
                  isSel ? "border-accent bg-accent" : "border-gray-300 dark:border-gray-600"
                }`}
              />
              <span className="sr-only">
                {isSel ? S.company.tickets.unselect : S.company.tickets.select}
              </span>
              <span className="min-w-0 flex-1">{cardBody(t)}</span>
            </span>
          ) : (
            cardBody(t)
          )}
        </button>
        {showActions && (
          <span className="mt-1 flex gap-1.5">
            <Button
              size="sm"
              variant="primary"
              onClick={() => setMove({ ticket: t, to: approveTarget(t.status) })}
            >
              {S.company.tickets.approve}
            </Button>
            <Button size="sm" onClick={() => setMove({ ticket: t, to: rejectTarget(t.status) })}>
              {S.company.tickets.reject}
            </Button>
          </span>
        )}
      </Fragment>
    );
  };

  const columns =
    board === null
      ? null
      : boardColumns(board, {
          query,
          names,
          priorities: priFilter,
          quick,
          todayKey,
          ...(me !== undefined ? { me } : {}),
          sort,
        });
  const visibleColumns =
    columns === null
      ? null
      : queueOnly
        ? columns.filter((c) => c.status === "proposed" || c.status === "review")
        : columns;
  /** The chips' counts, over what the search box and the priority chips already left. */
  const searched =
    board === null
      ? []
      : allTickets(board).filter(
          (t) =>
            (priFilter.length === 0 || priFilter.includes(t.priority)) &&
            matchesTicketQuery(t, query, names),
        );
  const counts = boardCounts(searched, { todayKey, ...(me !== undefined ? { me } : {}) });
  const narrowed = quick !== "all" || query.trim() !== "" || priFilter.length > 0;
  const invalids = board === null ? [] : invalidTickets(board);

  return (
    <OrgPage
      title={S.nav.org.tickets}
      info={S.company.tickets.info}
      wide
      actions={
        <>
          <Button
            size="sm"
            variant={selectMode ? "primary" : "secondary"}
            aria-pressed={selectMode}
            data-tooltip={S.company.tickets.selectHint}
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
          >
            {S.company.tickets.select}
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            {S.company.tickets.create}
          </Button>
        </>
      }
    >
      {error !== null && (
        <Notice
          tone="danger"
          role="alert"
          className="mb-3"
          retry={{ label: S.common.retry, onClick: () => void load() }}
        >
          {S.company.tickets.loadFailed(error)}
        </Notice>
      )}

      {board !== null &&
        allTickets(board).length === 0 &&
        board.invalidFiles.length === 0 &&
        !hintDismissed && (
          <Notice
            tone="neutral"
            className="mb-3"
            dismiss={{
              ariaLabel: S.company.tickets.dismissHint,
              onClick: () => {
                dismissHint(emptyHintKey);
                setHintDismissed(true);
              },
            }}
          >
            {S.company.tickets.emptyHint}
          </Notice>
        )}

      {/* One toolbar over the board. The quick chips come first because they are the question a
          reader arrives with ("what is waiting on me?"); each carries the count it would leave,
          so a chip that would show nothing says so before it is pressed. The rest — search,
          priorities, grouping, sort — narrow or reshape what the chips left. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white/70 px-2 py-1.5 dark:border-gray-800 dark:bg-gray-900/50">
        <span
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label={S.company.tickets.quickFilter}
        >
          {BOARD_QUICK_FILTERS.map((q) => {
            // "Mine" needs a signed-in reader to mean anything.
            if (q === "mine" && me === undefined) return null;
            const n =
              q === "all"
                ? counts.total
                : q === "queue"
                  ? counts.queue
                  : q === "blocked"
                    ? counts.blocked
                    : q === "overdue"
                      ? counts.overdue
                      : counts.mine;
            const on = quick === q;
            return (
              <Button
                key={q}
                size="sm"
                variant={on ? "primary" : "secondary"}
                aria-pressed={on}
                title={S.company.tickets.quickHint[q] ?? ""}
                onClick={() => {
                  setQuick(q);
                  // The two legacy deep-link params fold into `quick` once a chip is pressed.
                  setQueryParams({ quick: q === "all" ? null : q, blocked: null, queue: null });
                }}
              >
                {S.company.tickets.quick[q] ?? q}
                <Count n={n} />
              </Button>
            );
          })}
        </span>
        <span aria-hidden className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
        <SearchInput
          ref={searchRef}
          size="sm"
          icon
          className="w-44 min-w-36 flex-1"
          aria-label={S.company.tickets.searchPlaceholder}
          placeholder={S.company.tickets.searchPlaceholder}
          value={query}
          onChange={setQuery}
        />
        <span
          className="flex items-center gap-1"
          role="group"
          aria-label={S.company.tickets.priority}
        >
          {PRIORITIES.map((p) => {
            const on = priFilter.includes(p);
            return (
              <Button
                key={p}
                size="sm"
                variant={on ? "primary" : "secondary"}
                aria-pressed={on}
                onClick={() => {
                  const next = on ? priFilter.filter((x) => x !== p) : [...priFilter, p];
                  setPriFilter(next);
                  setQueryParams({ pri: next.length === 0 ? null : next.join(",") });
                }}
              >
                {p}
              </Button>
            );
          })}
        </span>
        <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
          {S.company.tickets.sort}
          <Select
            size="sm"
            className="min-w-[7rem]"
            value={sort}
            aria-label={S.company.tickets.sortHint}
            onChange={(e) => {
              const next = readSort(e.target.value);
              setSort(next);
              setQueryParams({ sort: next === "priority" ? null : next });
            }}
          >
            {SORT_VALUES.map((v) => (
              <option key={v} value={v}>
                {S.company.tickets.sortBy[v] ?? v}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
          {S.company.tickets.group}
          <Select
            size="sm"
            className="min-w-[7rem]"
            value={groupBy}
            aria-label={S.company.tickets.group}
            onChange={(e) => {
              const next = readGroupBy(e.target.value);
              setGroupBy(next);
              setQueryParams({ group: next === "none" ? null : next });
            }}
          >
            {GROUP_BY_VALUES.map((v) => (
              <option key={v} value={v}>
                {S.company.tickets.groupByName[v] ?? v}
              </option>
            ))}
          </Select>
        </label>
        {narrowed && (
          <Button
            size="sm"
            onClick={() => {
              setQuick("all");
              setQuery("");
              setPriFilter([]);
              setQueryParams({ quick: null, blocked: null, queue: null, pri: null });
            }}
          >
            {S.company.tickets.clearFilters}
          </Button>
        )}
      </div>

      {/* A column never narrows past a readable card: with no room for five of them the board
          scrolls sideways rather than squeezing the titles down to a few characters. */}
      <div ref={drag.boardRef} className="overflow-x-auto pb-2">
        <div
          className={`grid gap-3 ${
            queueOnly
              ? "grid-cols-[repeat(2,minmax(20rem,1fr))]"
              : "grid-cols-[repeat(5,minmax(15rem,1fr))]"
          }`}
        >
          {visibleColumns === null
            ? TICKET_COLUMNS.map((status) => <ColumnSkeleton key={status} status={status} />)
            : visibleColumns.map((col) => {
                const shut = isCollapsed(`col:${col.status}`);
                const visibleIds = col.tickets.map((t) => t.ticketId);
                const allSel = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
                const toggleColumn = () => toggleCollapsed(`col:${col.status}`);
                const toggleAll = () => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (allSel) {
                      for (const id of visibleIds) next.delete(id);
                    } else {
                      for (const id of visibleIds) next.add(id);
                    }
                    return next;
                  });
                };
                const groups =
                  groupBy === "none"
                    ? null
                    : groupTickets(col.tickets, groupBy, {
                        names,
                        titles,
                        sort,
                      });
                return (
                  <div
                    key={col.status}
                    role="group"
                    aria-label={`${S.company.tickets.columns[col.status] ?? col.status} · ${col.tickets.length}`}
                    {...{ [TICKET_COLUMN_ATTR]: col.status }}
                    className={`${columnClass} ${
                      dropOver === col.status
                        ? "border-accent ring-1 ring-accent"
                        : highlightColumn === col.status && isTicketStatus(highlightColumn)
                          ? "border-gray-400 dark:border-gray-600"
                          : ""
                    }`}
                  >
                    <div className={`h-1 rounded-t-md ${COLUMN_BAR[col.status]}`} />
                    <div className="flex items-center gap-2 px-2.5 py-2">
                      <button
                        type="button"
                        onClick={toggleColumn}
                        aria-expanded={!shut}
                        aria-label={shut ? S.company.tickets.expand : S.company.tickets.collapse}
                        className="rounded text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
                      >
                        <Chevron open={!shut} size={ICON_SIZE.chevronDense} />
                      </button>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700 dark:text-gray-200">
                        {S.company.tickets.columns[col.status] ?? col.status}
                      </span>
                      {selectMode && col.tickets.length > 0 && (
                        <button
                          type="button"
                          onClick={toggleAll}
                          className="shrink-0 text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
                        >
                          {allSel ? S.company.tickets.deselectAll : S.company.tickets.selectAll}
                        </button>
                      )}
                      <Count n={col.tickets.length} />
                    </div>
                    {!shut && (
                      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                        {groups === null
                          ? col.tickets.map(card)
                          : groups.map((g) => {
                              const gkey = `group:${col.status}:${g.key === "" ? "(none)" : g.key}`;
                              const gshut = isCollapsed(gkey);
                              return (
                                <div key={g.key === "" ? "(none)" : g.key}>
                                  {/* The heading holds at the top of the column while its own cards
                                    pass under it — an opaque band, or the card behind shows
                                    through the label. */}
                                  <button
                                    type="button"
                                    onClick={() => toggleCollapsed(gkey)}
                                    aria-expanded={!gshut}
                                    className="sticky top-0 z-[1] flex w-full items-center gap-1.5 rounded bg-gray-50 px-1 py-1 text-left text-xs text-gray-600 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                                  >
                                    <Chevron open={!gshut} size={ICON_SIZE.chevronDense} />
                                    <span className="min-w-0 flex-1 truncate font-medium">
                                      {g.label === "" ? S.company.tickets.noGroup : g.label}
                                    </span>
                                    <Count n={g.tickets.length} />
                                  </button>
                                  {!gshut && g.tickets.map(card)}
                                </div>
                              );
                            })}
                        {col.tickets.length === 0 && (
                          <div
                            className={`flex min-h-20 flex-1 items-center justify-center rounded-md border border-dashed px-2 text-center text-xs ${
                              dropOver === col.status
                                ? "border-accent text-gray-600 dark:text-gray-300"
                                : "border-gray-300 text-gray-400 dark:border-gray-700 dark:text-gray-500"
                            }`}
                          >
                            {lifted !== null && canMove(lifted.ticket.status, col.status)
                              ? S.company.tickets.dropHere
                              : narrowed
                                ? S.company.tickets.searchNoMatch
                                : S.company.tickets.columnEmpty}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="sticky bottom-2 z-10 mt-2 flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
            {S.company.tickets.selectedCount(selected.size)}
          </span>
          {/* A dropdown's trigger fills its host, and its panel takes the trigger's width — so
              each one is hosted in a box of its own. Left as a bare flex child the trigger fills
              the whole bar, one dropdown to a row, and its choices ellipsise. */}
          <span className="w-40 shrink-0">
            <Select
              value={bulkTarget}
              onChange={(e) => setBulkTarget(e.target.value)}
              aria-label={S.company.tickets.bulkMoveTo}
            >
              <option value="">{S.company.tickets.bulkMoveTo}</option>
              {TICKET_COLUMNS.map((s) => (
                <option key={s} value={s}>
                  {S.company.tickets.columns[s] ?? s}
                </option>
              ))}
            </Select>
          </span>
          <span className="w-44 shrink-0">
            <Select
              value={bulkOwner}
              onChange={(e) => setBulkOwner(e.target.value)}
              aria-label={S.company.tickets.bulkAssignTo}
            >
              <option value="">{S.company.tickets.bulkAssignTo}</option>
              {employees.map((e) => (
                <option key={e.agentId} value={`agent:${e.agentId}`}>
                  {e.name}
                </option>
              ))}
            </Select>
          </span>
          <Input
            size="sm"
            className="min-w-44 flex-1"
            placeholder={S.company.tickets.bulkNote}
            aria-label={S.company.tickets.bulkNote}
            value={bulkNote}
            onChange={(e) => setBulkNote(e.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            title={
              bulkTarget === "rejected" && bulkNote.trim() === ""
                ? S.company.tickets.bulkRejectHint
                : ""
            }
            disabled={
              bulkBusy ||
              (bulkTarget === "" && bulkOwner === "" && bulkNote.trim() === "") ||
              (bulkTarget === "rejected" && bulkNote.trim() === "")
            }
            onClick={() => void applyBulk()}
          >
            {S.company.tickets.bulkApply}
          </Button>
          <Button size="sm" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
            {S.company.tickets.bulkClear}
          </Button>
          {/* The one combination the bar refuses, said where the button is: rejected takes a
              reason, and the note field above is where it goes. */}
          {bulkTarget === "rejected" && bulkNote.trim() === "" && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {S.company.tickets.bulkRejectHint}
            </span>
          )}
        </div>
      )}

      {(invalids.length > 0 || (board !== null && board.invalidFiles.length > 0)) && (
        <Notice tone="danger" className="mt-2">
          {invalids.length > 0 && (
            <>
              <p className="mb-1 flex items-center gap-1.5 font-medium">
                <span data-slot="icon" className="shrink-0">
                  <GlyphIcon d={INVALID_ICON} size={ICON_SIZE.inlineGlyph} />
                </span>
                {S.company.tickets.invalidTickets}
              </p>
              <ul className="mb-2 space-y-1">
                {invalids.map((t) => (
                  <li key={t.ticketId} className="flex items-baseline">
                    <TitleButton
                      className="shrink-0 font-mono"
                      onClick={() => openTicket(t.ticketId)}
                    >
                      {t.ticketId}
                    </TitleButton>
                    <span className="min-w-0">: {t.invalid}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {board !== null && board.invalidFiles.length > 0 && (
            <>
              <p className="mb-1 flex items-center gap-1.5 font-medium">
                <span data-slot="icon" className="shrink-0">
                  <GlyphIcon d={INVALID_ICON} size={ICON_SIZE.inlineGlyph} />
                </span>
                {S.company.tickets.invalidFiles}
              </p>
              <ul className="space-y-1 font-mono">
                {board.invalidFiles.map((f) => (
                  <li key={f.path}>
                    {f.path}: {f.error}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Notice>
      )}

      {/* The lifted card's ghost: the card's own face at its own width, following the
          pointer above everything else and never under it — the column hit test reads through
          it. The pointer's moves write its position straight to the element. */}
      {lifted !== null &&
        createPortal(
          <div
            ref={drag.ghostRef}
            aria-hidden
            style={{ width: lifted.width, transform: drag.ghostTransform() }}
            className="pointer-events-none fixed left-0 top-0 z-[60]"
          >
            <div className={`${cardFrame(lifted.ticket)} rotate-1 shadow-lg ring-1 ring-accent`}>
              {cardBody(lifted.ticket)}
            </div>
          </div>,
          document.body,
        )}

      {/* Move confirmation: the target column, and a reason when the target is rejected —
          the same dialog the detail's own move goes through. */}
      <MoveTicketConfirm
        move={move === null ? null : { title: move.ticket.title, to: move.to }}
        busy={busy}
        onClose={() => (busy ? undefined : setMove(null))}
        onConfirm={(reason) => void confirmMove(reason)}
      />

      <CreateTicketDialog
        open={createOpen}
        projectId={projectId}
        orgId={orgId}
        employees={employees.map((e) => ({ agentId: e.agentId, name: e.name }))}
        tickets={board === null ? [] : allTickets(board)}
        onClose={() => setCreateOpen(false)}
        onCreated={(ticketId) => {
          setCreateOpen(false);
          company.ticketsChanged();
          openTicket(ticketId);
        }}
      />
    </OrgPage>
  );
}

/** A column while the first fetch is out: the bar and header in place, two card-shaped placeholders. */
function ColumnSkeleton({ status }: { status: OrgTicketStatus }) {
  return (
    <div className={columnClass}>
      <div className={`h-1 rounded-t-md ${COLUMN_BAR[status]}`} />
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
          {S.company.tickets.columns[status] ?? status}
        </span>
        <Skeleton className="h-4 w-6 rounded-full" />
      </div>
      <div className="flex flex-col gap-2 px-2 pb-2">
        {Array.from(
          { length: status === "proposed" || status === "in_progress" ? 2 : 1 },
          (_, i) => (
            <div
              key={i}
              className="space-y-2 rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
            >
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

interface CreateTicketDialogProps {
  open: boolean;
  projectId: string;
  orgId: string;
  employees: ReadonlyArray<{ agentId: string; name: string }>;
  tickets: readonly OrgTicketItem[];
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}

/** The create form, mounted per opening. Exported for test/company-dialogs-guard.test.ts. */
export function CreateTicketDialog({ open, ...props }: CreateTicketDialogProps) {
  // Mounted only while open, so every opening starts blank.
  return open ? <CreateTicketForm {...props} /> : null;
}

function CreateTicketForm({
  projectId,
  orgId,
  employees,
  tickets,
  onClose,
  onCreated,
}: Omit<CreateTicketDialogProps, "open">) {
  const form = useFormDraft(
    {
      title: "",
      slug: "",
      goal: "",
      acceptance: "",
      owner: "",
      parent: "",
      notify: "",
      priority: "P1" as OrgTicketPriority,
      due: "",
    },
    {
      normalize: (d) => ({
        ...d,
        title: d.title.trim(),
        slug: d.slug.trim(),
        goal: d.goal.trim(),
        acceptance: d.acceptance.trim(),
        notify: d.notify.trim(),
      }),
    },
  );
  const { title, slug, goal, acceptance, owner, parent, notify, priority, due } = form.draft;
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  // The rule sits behind the "?", so a slug that breaks it says so as it is typed.
  const slugBroken = slug.trim() !== "" && !isTicketSlug(slug.trim());
  const valid = title.trim() !== "" && !slugBroken;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const detail = await api.createOrgTicket(projectId, orgId, {
        title: title.trim(),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        ...(goal.trim() ? { goal: goal.trim() } : {}),
        ...(acceptance.trim() ? { acceptanceCriteria: acceptance.trim() } : {}),
        ...(owner ? { owner } : {}),
        ...(parent ? { parent } : {}),
        ...(notify.trim() ? { notify: splitPrincipalList(notify) } : {}),
        priority,
        ...(due ? { due } : {}),
      });
      toastSuccess(S.company.tickets.created);
      // Saved: forget the form now, not at unmount. The board opens the new ticket next, and the
      // leave guard would hold that over a form with nothing left unsaved.
      discardUnsaved(form.scope);
      onCreated(detail.ticketId);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={S.company.tickets.createTitle}
      onClose={requestClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !valid}
            onClick={() => void submit()}
          >
            {S.common.create}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          size="sm"
          label={S.company.tickets.ticketTitle}
          required
          value={title}
          autoFocus
          onChange={(e) => form.patch({ title: e.target.value })}
        />
        <Input
          size="sm"
          label={S.company.tickets.slug}
          value={slug}
          info={S.company.tickets.slugHint}
          {...(slugBroken ? { error: S.company.tickets.slugInvalid } : {})}
          className="font-mono"
          onChange={(e) => form.patch({ slug: e.target.value })}
        />
        <Textarea
          size="sm"
          label={S.company.tickets.goal}
          rows={3}
          value={goal}
          info={S.company.tickets.goalHint}
          onChange={(e) => form.patch({ goal: e.target.value })}
        />
        <Textarea
          size="sm"
          label={S.company.tickets.acceptance}
          rows={3}
          value={acceptance}
          info={S.company.tickets.acceptanceHint}
          onChange={(e) => form.patch({ acceptance: e.target.value })}
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Select
            size="sm"
            label={S.company.tickets.owner}
            value={owner}
            onChange={(e) => form.patch({ owner: e.target.value })}
          >
            <option value="">{S.company.tickets.ownerSelf}</option>
            {employees.map((e) => (
              <option key={e.agentId} value={agentPrincipal(e.agentId)}>
                {e.name}
              </option>
            ))}
          </Select>
          <Select
            size="sm"
            label={S.company.tickets.parent}
            value={parent}
            onChange={(e) => form.patch({ parent: e.target.value })}
          >
            <option value="">{S.company.tickets.noParent}</option>
            {tickets.map((t) => (
              <option key={t.ticketId} value={t.ticketId}>
                {t.title}
              </option>
            ))}
          </Select>
          <div>
            <FieldLabel>{S.company.tickets.priority}</FieldLabel>
            <Segmented
              options={PRIORITIES.map((p) => ({ value: p, label: p }))}
              value={priority}
              onChange={(next) => form.patch({ priority: next })}
              cols={3}
            />
          </div>
          <Input
            size="sm"
            label={S.company.tickets.due}
            type="date"
            value={due}
            className="font-mono"
            onChange={(e) => form.patch({ due: e.target.value })}
          />
        </div>
        <Input
          size="sm"
          label={S.company.tickets.notify}
          value={notify}
          hint={S.company.tickets.notifyHint}
          info={S.company.tickets.notifyInfo}
          className="font-mono"
          onChange={(e) => form.patch({ notify: e.target.value })}
        />
      </div>
    </Modal>
  );
}
