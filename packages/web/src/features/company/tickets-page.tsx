/**
 * The ticket board: five vertical columns in lifecycle order (shaping in ticket-board.ts),
 * a card per ticket — title, owner, priority, due, parent, contributing sessions with a
 * running mark, cost, the blocked badge — a blocked-only filter, drag-and-drop between
 * columns that confirms the move (a move into rejected asks for a one-line reason) before
 * posting it, the detail drawer, the create form, and the files that failed to parse.
 * `?column=` / `?blocked=1` / `?ticket=` deep links arrive from the overview.
 */
import { useCallback, useEffect, useState } from "react";
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
import { formatMoney } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { toneInk, toneStrip } from "../../lib/tone";
import { ICON_SIZE } from "../../lib/icon-scale";
import { useCompany } from "../../state/company";
import { useTheme } from "../../state/theme";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { SessionActivityIcon } from "../../components/ui/session-activity-icon";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { OrgPage, OrgPageSkeleton, useOrg } from "./org-layout";
import { BlockedBadge, INVALID_ICON, PriorityBadge } from "./shared";
import {
  allTickets,
  boardColumns,
  canMove,
  isBlocked,
  isTicketStatus,
  moveNeedsReason,
} from "./ticket-board";
import { TicketDrawer } from "./ticket-drawer";
import { agentPrincipal, principalAgentId, splitPrincipalList } from "./principals";

/** Private drag payload type of a card move (never text/plain: a mis-aimed drop must not paste into a text field). */
const TICKET_DRAG_MIME = "application/x-penguin-ticket-id";
const PRIORITIES: readonly OrgTicketPriority[] = ["P0", "P1", "P2"];

const columnClass =
  "flex min-h-[24rem] w-64 shrink-0 flex-col rounded-md border border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-900/40";

export function TicketsPage() {
  const { projectId, orgId, org } = useOrg();
  const company = useCompany();
  const { currency } = useTheme();
  const [params, setParams] = useSearchParams();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.tickets}` : S.nav.org.tickets);
  const [board, setBoard] = useState<OrgTicketsResponse | null>(null);
  const [chart, setChart] = useState<OrgChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockedOnly, setBlockedOnly] = useState(params.get("blocked") === "1");
  const [drawerVersion, setDrawerVersion] = useState(0);
  const [drag, setDrag] = useState<{ ticketId: string; from: OrgTicketStatus } | null>(null);
  const [dropOver, setDropOver] = useState<OrgTicketStatus | null>(null);
  const [move, setMove] = useState<{ ticket: OrgTicketItem; to: OrgTicketStatus } | null>(null);
  const [reason, setReason] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const openTicketId = params.get("ticket");
  const highlightColumn = params.get("column");

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
    setDrawerVersion((v) => v + 1);
  }, [load, ticketsVersion, runs]);

  const employees = chart?.employees ?? [];
  const names = new Map(employees.map((e) => [e.agentId, e.name]));

  const setQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const openTicket = (ticketId: string | null) => setQuery({ ticket: ticketId });

  const confirmMove = async () => {
    if (move === null) return;
    setBusy(true);
    try {
      await api.moveOrgTicket(projectId, orgId, move.ticket.ticketId, {
        status: move.to,
        ...(moveNeedsReason(move.to) ? { reason: reason.trim() } : {}),
      });
      toastSuccess(S.company.tickets.moved);
      setMove(null);
      setReason("");
      void load();
      void company.reloadOrganizations();
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
      setReason("");
      setMove({ ticket, to: status });
    },
  });

  if (error !== null && board === null) {
    return (
      <OrgPage title={S.nav.org.tickets} info={S.company.tickets.info}>
        <EmptyState
          title={error}
          action={<Button onClick={() => void load()}>{S.common.retry}</Button>}
        />
      </OrgPage>
    );
  }
  if (board === null || chart === null) {
    return (
      <OrgPage title={S.nav.org.tickets} info={S.company.tickets.info}>
        <OrgPageSkeleton />
      </OrgPage>
    );
  }

  const columns = boardColumns(board, { blockedOnly });
  const total = allTickets(board).length;

  const card = (t: OrgTicketItem) => {
    const ownerId = t.owner === undefined ? null : principalAgentId(t.owner);
    return (
      <button
        key={t.ticketId}
        type="button"
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
        onClick={() => openTicket(t.ticketId)}
        title={`${t.ticketId} · ${S.company.tickets.dragHint}`}
        className={`block w-full cursor-grab rounded-md border bg-white p-2 text-left text-xs transition-colors duration-150 hover:border-gray-300 dark:bg-gray-900 dark:hover:border-gray-600 ${
          t.invalid !== undefined
            ? "border-red-300 dark:border-red-800"
            : "border-gray-200 dark:border-gray-800"
        } ${drag?.ticketId === t.ticketId ? "opacity-50" : ""}`}
      >
        <p className="mb-1 flex items-start gap-1.5">
          <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-gray-900 dark:text-gray-100">
            {t.title}
          </span>
          {t.invalid !== undefined && (
            <span className={`shrink-0 ${toneInk.danger}`} title={S.company.tickets.invalid}>
              <GlyphIcon d={INVALID_ICON} size={ICON_SIZE.inlineGlyph} />
              <span className="sr-only">{S.company.tickets.invalid}</span>
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-gray-500 dark:text-gray-400">
          {ownerId !== null ? (
            <span className="inline-flex items-center gap-1" title={names.get(ownerId) ?? ownerId}>
              <AgentAvatar
                id={ownerId}
                name={names.get(ownerId) ?? ownerId}
                size={ICON_SIZE.rowLead}
                className="rounded"
              />
              <span className="max-w-24 truncate">{names.get(ownerId) ?? ownerId}</span>
            </span>
          ) : (
            <span className="text-gray-400">{S.company.tickets.noOwner}</span>
          )}
          <PriorityBadge priority={t.priority} />
          {t.due !== undefined && <span className="font-mono tabular-nums">{t.due}</span>}
          {t.parent !== undefined && (
            <span
              className="font-mono text-gray-400"
              title={`${S.company.tickets.parent} ${t.parent}`}
            >
              ↑ {t.parent}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1">
            {S.company.tickets.sessionsCount(t.sessions.length)}
            {t.running && <SessionActivityIcon activity="running" size={11} />}
          </span>
          <span className="tabular-nums">{formatMoney(t.cost, currency)}</span>
          {isBlocked(t) && (
            <span className="ml-auto">
              <BlockedBadge
                reason={t.blocked ?? ""}
                {...(t.blockedBy !== undefined ? { by: t.blockedBy } : {})}
              />
            </span>
          )}
        </div>
      </button>
    );
  };

  return (
    <OrgPage
      title={S.nav.org.tickets}
      info={S.company.tickets.info}
      wide
      actions={
        <>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            {S.company.tickets.blockedOnly}
            <Switch
              checked={blockedOnly}
              onChange={(v) => {
                setBlockedOnly(v);
                setQuery({ blocked: v ? "1" : null });
              }}
            />
          </label>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            {S.company.tickets.create}
          </Button>
        </>
      }
    >
      {total === 0 && board.invalidFiles.length === 0 ? (
        <EmptyState
          title={S.company.tickets.empty}
          description={S.company.tickets.emptyHint}
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              {S.company.tickets.create}
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex min-w-max gap-3">
            {columns.map((col) => (
              <div
                key={col.status}
                {...columnDrop(col.status)}
                className={`${columnClass} ${
                  dropOver === col.status
                    ? "border-[var(--accent-bg)] ring-1 ring-[var(--accent-bg)]"
                    : highlightColumn === col.status && isTicketStatus(highlightColumn)
                      ? "border-gray-400 dark:border-gray-600"
                      : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-2.5 py-2 dark:border-gray-800">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {S.company.tickets.columns[col.status] ?? col.status}
                  </span>
                  <span className="text-[11px] tabular-nums text-gray-400">
                    {col.tickets.length}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-2">
                  {col.tickets.length === 0 ? (
                    <p className="py-4 text-center text-[11px] text-gray-400 dark:text-gray-600">
                      {S.company.tickets.columnEmpty}
                    </p>
                  ) : (
                    col.tickets.map(card)
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {board.invalidFiles.length > 0 && (
        <div className={`mt-4 rounded-md border px-3 py-2 text-xs ${toneStrip.danger}`}>
          <p className="mb-1 font-medium">{S.company.tickets.invalidFiles}</p>
          <ul className="space-y-0.5 font-mono">
            {board.invalidFiles.map((f) => (
              <li key={f.path}>
                {f.path}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <TicketDrawer
        projectId={projectId}
        orgId={orgId}
        ticketId={openTicketId}
        employees={employees}
        tickets={allTickets(board)}
        version={drawerVersion}
        onClose={() => openTicket(null)}
        onChanged={() => {
          void load();
          void company.reloadOrganizations();
        }}
        onOpenTicket={openTicket}
      />

      {/* Move confirmation: the target column, and a reason when the target is rejected. */}
      <ConfirmModal
        open={move !== null}
        title={S.company.tickets.moveTitle}
        tone={move?.to === "rejected" ? "danger" : "primary"}
        confirmLabel={S.common.confirm}
        confirmDisabled={move !== null && moveNeedsReason(move.to) && reason.trim() === ""}
        busy={busy}
        onClose={() => (busy ? undefined : setMove(null))}
        onConfirm={() => void confirmMove()}
      >
        <div className="space-y-2">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {move !== null
              ? S.company.tickets.moveConfirm(
                  move.ticket.title,
                  S.company.tickets.columns[move.to] ?? move.to,
                )
              : ""}
          </p>
          {move !== null && moveNeedsReason(move.to) && (
            <Input
              size="sm"
              label={S.company.tickets.rejectReason}
              required
              value={reason}
              hint={S.company.tickets.rejectReasonHint}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </div>
      </ConfirmModal>

      <CreateTicketDialog
        open={createOpen}
        projectId={projectId}
        orgId={orgId}
        employees={employees.map((e) => ({ agentId: e.agentId, name: e.name }))}
        tickets={allTickets(board)}
        onClose={() => setCreateOpen(false)}
        onCreated={(ticketId) => {
          setCreateOpen(false);
          void load();
          void company.reloadOrganizations();
          openTicket(ticketId);
        }}
      />
    </OrgPage>
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
  const [goal, setGoal] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [owner, setOwner] = useState("");
  const [parent, setParent] = useState("");
  const [notify, setNotify] = useState("");
  const [priority, setPriority] = useState<OrgTicketPriority>("P1");
  const [due, setDue] = useState("");
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setGoal("");
    setAcceptance("");
    setOwner("");
    setParent("");
    setNotify("");
    setPriority("P1");
    setDue("");
    setTitleError(undefined);
  }, [open]);

  const submit = async () => {
    if (!title.trim()) {
      setTitleError(S.common.requiredField);
      return;
    }
    setBusy(true);
    try {
      const detail = await api.createOrgTicket(projectId, orgId, {
        title: title.trim(),
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
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
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
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">{S.company.tickets.noOwner}</option>
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
                {t.ticketId} · {t.title}
              </option>
            ))}
          </Select>
          <Select
            size="sm"
            label={S.company.tickets.priority}
            value={priority}
            onChange={(e) => setPriority(e.target.value as OrgTicketPriority)}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
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
