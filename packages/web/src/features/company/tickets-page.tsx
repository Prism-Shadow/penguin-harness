/**
 * The ticket board: five columns in lifecycle order (shaping in ticket-board.ts), each with
 * its colour bar and count, a card per ticket — title, priority, due date (danger once
 * passed), the blocked badge, a muted line naming its parent, and its owner — a search box
 * and a blocked-only switch, drag-and-drop between columns that confirms the move (a move
 * into rejected asks for a one-line reason) before posting it, the create form, and the
 * tickets and files the server could not accept.
 * The whole card is the drag handle, and its title is the one click target: the title is a
 * text button that opens the detail dialog (the shell's one host renders it, so the board
 * stays where it is), the rest of the card is inert, and a drag never fires a click — so
 * dragging anywhere (the title included) moves the ticket while clicking the title opens it.
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
import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { useSearchParams } from "react-router";
import type {
  OrgChartResponse,
  OrgTicketItem,
  OrgTicketPriority,
  OrgTicketStatus,
  OrgTicketsResponse,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { toneDot, toneInk, toneStrip } from "../../lib/tone";
import { ICON_SIZE } from "../../lib/icon-scale";
import { useAuth } from "../../state/auth";
import { useCompany } from "../../state/company";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { Segmented } from "../../components/ui/segmented";
import { Modal } from "../../components/ui/modal";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { FieldLabel } from "../../components/ui/field";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CloseIcon } from "../../components/ui/icons";
import { Skeleton } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { OrgPage, useOrg } from "./org-layout";
import {
  BlockedBadge,
  INVALID_ICON,
  PrincipalChip,
  PriorityBadge,
  TitleButton,
  principalLabel,
} from "./shared";
import {
  TICKET_COLUMNS,
  allTickets,
  boardColumns,
  canMove,
  invalidTickets,
  isBlocked,
  isOverdue,
  isTicketSlug,
  isTicketStatus,
  moveNeedsReason,
} from "./ticket-board";
import { MoveTicketConfirm } from "./ticket-dialog";
import { dismissHint, hintKey, isHintDismissed } from "./page-hints";
import { agentPrincipal, splitPrincipalList } from "./principals";
import { dayKey } from "./calendar-geom";

/** Private drag payload type of a card move (never text/plain: a mis-aimed drop must not paste into a text field). */
const TICKET_DRAG_MIME = "application/x-penguin-ticket-id";
const PRIORITIES: readonly OrgTicketPriority[] = ["P0", "P1", "P2"];

/** Clock face (lucide): the due-date mark on a card. */
const DUE_ICON = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-14v5l3 2";

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

const columnClass =
  "flex min-h-[26rem] flex-col rounded-md border border-gray-200 bg-gray-50/60 transition-colors duration-150 dark:border-gray-800 dark:bg-gray-900/40";

export function TicketsPage() {
  const { projectId, orgId, org } = useOrg();
  const company = useCompany();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.tickets}` : S.nav.org.tickets);
  const [board, setBoard] = useState<OrgTicketsResponse | null>(null);
  const [chart, setChart] = useState<OrgChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockedOnly, setBlockedOnly] = useState(params.get("blocked") === "1");
  const [query, setQuery] = useState("");
  const [drag, setDrag] = useState<{ ticketId: string; from: OrgTicketStatus } | null>(null);
  const [dropOver, setDropOver] = useState<OrgTicketStatus | null>(null);
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

  const setQueryParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const openTicket = (ticketId: string) => company.openTicket(projectId, orgId, ticketId);

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
  useEffect(() => {
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
  }, [urlTicket, dialogTicket, projectId, orgId, openTicketInShell, setParams]);

  const confirmMove = async (reason: string) => {
    if (move === null) return;
    setBusy(true);
    try {
      await api.moveOrgTicket(projectId, orgId, move.ticket.ticketId, {
        status: move.to,
        ...(moveNeedsReason(move.to) ? { reason: reason.trim() } : {}),
      });
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

  const columnDrop = (status: OrgTicketStatus) => ({
    onDragOver: (e: ReactDragEvent) => {
      if (
        drag === null ||
        !e.dataTransfer.types.includes(TICKET_DRAG_MIME) ||
        !canMove(drag.from, status)
      )
        return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropOver !== status) setDropOver(status);
    },
    onDragLeave: (e: ReactDragEvent) => {
      const to = e.relatedTarget;
      if (to instanceof Node && e.currentTarget.contains(to)) return;
      setDropOver((prev) => (prev === status ? null : prev));
    },
    onDrop: (e: ReactDragEvent) => {
      if (drag === null || !canMove(drag.from, status) || board === null) return;
      e.preventDefault();
      const ticket = allTickets(board).find((t) => t.ticketId === drag.ticketId);
      setDrag(null);
      setDropOver(null);
      if (ticket === undefined) return;
      setMove({ ticket, to: status });
    },
  });

  /** A card: the title with its priority first (the title is the button that opens it), then what decides its urgency, then where it hangs and who holds it. */
  const card = (t: OrgTicketItem) => {
    const overdue = isOverdue(t.due, todayKey) && t.status !== "done" && t.status !== "rejected";
    return (
      <div
        key={t.ticketId}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(TICKET_DRAG_MIME, t.ticketId);
          e.dataTransfer.effectAllowed = "move";
          setDrag({ ticketId: t.ticketId, from: t.status });
        }}
        onDragEnd={() => {
          setDrag(null);
          setDropOver(null);
        }}
        title={`${t.title} · ${t.ticketId} · ${S.company.tickets.dragHint}`}
        className={`block w-full cursor-grab rounded-md border bg-white p-2.5 text-left text-xs transition-colors duration-150 hover:border-gray-300 dark:bg-gray-900 dark:hover:border-gray-600 ${
          t.invalid !== undefined
            ? "border-red-300 dark:border-red-800"
            : "border-gray-200 dark:border-gray-800"
        } ${drag?.ticketId === t.ticketId ? "opacity-50" : ""}`}
      >
        <div className="flex items-start gap-1.5">
          <TitleButton
            title={S.company.tickets.openTicket}
            className="line-clamp-2 flex-1 text-[13px] font-medium leading-snug text-gray-900 dark:text-gray-100"
            onClick={() => openTicket(t.ticketId)}
          >
            {t.title}
          </TitleButton>
          {/* The priority reads with the title and shares its line, a size under it; the line
              below carries what is time-bound — the due date and the blocked mark. */}
          <span className="mt-px shrink-0">
            <PriorityBadge priority={t.priority} />
          </span>
          {t.invalid !== undefined && (
            <span className={`mt-0.5 shrink-0 ${toneInk.danger}`} title={t.invalid}>
              <GlyphIcon d={INVALID_ICON} size={ICON_SIZE.inlineGlyph} />
              <span className="sr-only">{S.company.tickets.invalid}</span>
            </span>
          )}
        </div>
        {/* The time-bound line, drawn only when there is something on it: the priority has
            moved up to the title and an empty row would leave a gap under it. */}
        {(t.due !== undefined || isBlocked(t)) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            {t.due !== undefined && (
              <span
                className={`inline-flex items-center gap-1 font-mono tabular-nums ${overdue ? toneInk.danger : ""}`}
                title={overdue ? `${S.company.tickets.overdue} · ${t.due}` : S.company.tickets.due}
              >
                <GlyphIcon d={DUE_ICON} size={ICON_SIZE.inlineGlyph} />
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
          </div>
        )}
        {t.parent !== undefined && (
          <p
            className="mt-2 truncate text-[11px] text-gray-400 dark:text-gray-500"
            title={t.parent}
          >
            {S.company.tickets.parentLine(titles.get(t.parent) ?? t.parent)}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <span
            className="flex min-w-0 text-gray-700 dark:text-gray-200"
            title={`${S.company.tickets.owner} ${principalLabel(t.owner, names)}`}
          >
            <PrincipalChip principal={t.owner} names={names} size={ICON_SIZE.rowLead} />
          </span>
        </div>
      </div>
    );
  };

  const columns = board === null ? null : boardColumns(board, { blockedOnly, query, names });
  const narrowed = blockedOnly || query.trim() !== "";
  const invalids = board === null ? [] : invalidTickets(board);

  return (
    <OrgPage
      title={S.nav.org.tickets}
      info={S.company.tickets.info}
      wide
      actions={
        <>
          <div className="w-44">
            <Input
              size="sm"
              type="search"
              aria-label={S.company.tickets.searchPlaceholder}
              placeholder={S.company.tickets.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            {S.company.tickets.blockedOnly}
            <Switch
              checked={blockedOnly}
              onChange={(v) => {
                setBlockedOnly(v);
                setQueryParams({ blocked: v ? "1" : null });
              }}
            />
          </label>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            {S.company.tickets.create}
          </Button>
        </>
      }
    >
      {error !== null && (
        <div
          className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${toneStrip.danger}`}
        >
          <span>{S.company.tickets.loadFailed(error)}</span>
          <Button size="sm" onClick={() => void load()}>
            {S.common.retry}
          </Button>
        </div>
      )}

      {board !== null &&
        allTickets(board).length === 0 &&
        board.invalidFiles.length === 0 &&
        !hintDismissed && (
          <div
            className={`mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${toneStrip.muted}`}
          >
            <span className="min-w-0 flex-1">{S.company.tickets.emptyHint}</span>
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0"
              title={S.company.tickets.dismissHint}
              aria-label={S.company.tickets.dismissHint}
              onClick={() => {
                dismissHint(emptyHintKey);
                setHintDismissed(true);
              }}
            >
              <CloseIcon />
            </Button>
          </div>
        )}

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[50rem] grid-cols-5 gap-3">
          {columns === null
            ? TICKET_COLUMNS.map((status) => <ColumnSkeleton key={status} status={status} />)
            : columns.map((col) => (
                <div
                  key={col.status}
                  role="group"
                  aria-label={`${S.company.tickets.columns[col.status] ?? col.status} · ${col.tickets.length}`}
                  {...columnDrop(col.status)}
                  className={`${columnClass} ${
                    dropOver === col.status
                      ? "border-accent ring-1 ring-accent"
                      : highlightColumn === col.status && isTicketStatus(highlightColumn)
                        ? "border-gray-400 dark:border-gray-600"
                        : ""
                  }`}
                >
                  <div className={`h-1 rounded-t-md ${COLUMN_BAR[col.status]}`} />
                  <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                      {S.company.tickets.columns[col.status] ?? col.status}
                    </span>
                    <span className="rounded-full bg-gray-200/70 px-1.5 py-px text-[11px] font-medium tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {col.tickets.length}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                    {col.tickets.map(card)}
                    {col.tickets.length === 0 && (
                      <div
                        className={`flex min-h-20 flex-1 items-center justify-center rounded-md border border-dashed px-2 text-center text-[11px] ${
                          dropOver === col.status
                            ? "border-accent text-gray-600 dark:text-gray-300"
                            : "border-gray-300 text-gray-400 dark:border-gray-700 dark:text-gray-500"
                        }`}
                      >
                        {drag !== null && canMove(drag.from, col.status)
                          ? S.company.tickets.dropHere
                          : narrowed
                            ? S.company.tickets.searchNoMatch
                            : S.company.tickets.columnEmpty}
                      </div>
                    )}
                  </div>
                </div>
              ))}
        </div>
      </div>

      {(invalids.length > 0 || (board !== null && board.invalidFiles.length > 0)) && (
        <div className={`mt-2 rounded-md border px-3 py-2 text-xs ${toneStrip.danger}`}>
          {invalids.length > 0 && (
            <>
              <p className="mb-1 flex items-center gap-1.5 font-medium">
                <GlyphIcon d={INVALID_ICON} size={ICON_SIZE.inlineGlyph} />
                {S.company.tickets.invalidTickets}
              </p>
              <ul className="mb-2 space-y-0.5">
                {invalids.map((t) => (
                  <li key={t.ticketId} className="flex items-baseline">
                    <TitleButton
                      title={S.company.tickets.openTicket}
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
                <GlyphIcon d={INVALID_ICON} size={ICON_SIZE.inlineGlyph} />
                {S.company.tickets.invalidFiles}
              </p>
              <ul className="space-y-0.5 font-mono">
                {board.invalidFiles.map((f) => (
                  <li key={f.path}>
                    {f.path}: {f.error}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
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
              className="space-y-2 rounded-md border border-gray-200 bg-white p-2.5 dark:border-gray-800 dark:bg-gray-900"
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

function CreateTicketDialog({
  open,
  projectId,
  orgId,
  employees,
  tickets,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  orgId: string;
  employees: ReadonlyArray<{ agentId: string; name: string }>;
  tickets: readonly OrgTicketItem[];
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [goal, setGoal] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [owner, setOwner] = useState("");
  const [parent, setParent] = useState("");
  const [notify, setNotify] = useState("");
  const [priority, setPriority] = useState<OrgTicketPriority>("P1");
  const [due, setDue] = useState("");
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const [slugError, setSlugError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setSlug("");
    setGoal("");
    setAcceptance("");
    setOwner("");
    setParent("");
    setNotify("");
    setPriority("P1");
    setDue("");
    setTitleError(undefined);
    setSlugError(undefined);
  }, [open]);

  const submit = async () => {
    if (!title.trim()) {
      setTitleError(S.common.requiredField);
      return;
    }
    if (slug.trim() !== "" && !isTicketSlug(slug.trim())) {
      setSlugError(S.company.tickets.slugInvalid);
      return;
    }
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
      onCreated(detail.ticketId);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={S.company.tickets.createTitle}
      onClose={onClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit()}>
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
          error={titleError}
          autoFocus
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Input
          size="sm"
          label={S.company.tickets.slug}
          value={slug}
          hint={S.company.tickets.slugHint}
          error={slugError}
          className="font-mono"
          onChange={(e) => {
            const next = e.target.value;
            setSlug(next);
            // The rule is short and the box is small: say so while it is typed, not on submit.
            setSlugError(
              next.trim() === "" || isTicketSlug(next.trim())
                ? undefined
                : S.company.tickets.slugInvalid,
            );
          }}
        />
        <Textarea
          size="sm"
          label={S.company.tickets.goal}
          rows={3}
          value={goal}
          hint={S.company.tickets.goalHint}
          onChange={(e) => setGoal(e.target.value)}
        />
        <Textarea
          size="sm"
          label={S.company.tickets.acceptance}
          rows={3}
          value={acceptance}
          hint={S.company.tickets.acceptanceHint}
          onChange={(e) => setAcceptance(e.target.value)}
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Select
            size="sm"
            label={S.company.tickets.owner}
            value={owner}
            hint={S.company.tickets.ownerSelfHint}
            onChange={(e) => setOwner(e.target.value)}
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
            onChange={(e) => setParent(e.target.value)}
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
              onChange={setPriority}
              cols={3}
            />
          </div>
          <Input
            size="sm"
            label={S.company.tickets.due}
            type="date"
            value={due}
            className="font-mono"
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
        <Input
          size="sm"
          label={S.company.tickets.notify}
          value={notify}
          hint={S.company.tickets.notifyHint}
          className="font-mono"
          onChange={(e) => setNotify(e.target.value)}
        />
      </div>
    </Modal>
  );
}
