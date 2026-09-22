/**
 * A ticket's detail, as the dialog every company surface opens in place — the board, the
 * finance ledger, the overview's inbox and a channel's ticket reference all put the same
 * window on screen instead of carrying the reader to another page. The shell state says which
 * ticket is open (state/company.tsx) and `TicketDialogHost`, mounted once by the organization
 * layout, is what renders it.
 *
 * The header names the ticket with its priority chip on the same line, and carries the back
 * control while a parent or a child has been followed from inside the dialog. The body holds,
 * in reading order, the identity line (status, the blocked mark, the id with a copy button,
 * this ticket's cost and the total), the blocked strip saying why and on whom it waits, the
 * header fields (the one owner, parent, notify, due, created), the goal, the acceptance
 * criteria, the progress prose with its one-line append, the result, and under them three
 * disclosures folded on every visit: the child tickets with the total cost, the ticket's own
 * sessions, and the operation history, newest first. Each editable section edits in place with
 * its own save / cancel; the footer holds the block / unblock and move actions. Saves confirm
 * first, like every organization write.
 *
 * The parent, a child and a ticket session are each opened by clicking their title — a text
 * button that underlines on hover and names its destination in its tooltip — while the rest of
 * their row stays inert, so the controls and marks beside a title are never a click target.
 * A parent or a child swaps the dialog's own ticket. Only a session leaves the page, since a
 * conversation has no in-place form: it opens as the full conversation page and joins the
 * company sidebar's Temporary group (temp-session.ts).
 * A session's live status is not drawn: a ticket reports its own work, not what a session is
 * doing this second.
 */
import { Fragment, useCallback, useEffect, useId, useState } from "react";
import { useNavigate } from "react-router";
import type {
  OrgEmployeeItem,
  OrgTicketDetail,
  OrgTicketItem,
  OrgTicketPriority,
  OrgTicketStatus,
  OrgTicketUpdateRequest,
} from "@prismshadow/penguin-server/api";
import type { ReactNode } from "react";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatMoney } from "../../lib/format";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { toneInk, toneStrip } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { useCompany } from "../../state/company";
import { useProject } from "../../state/project";
import { useTheme } from "../../state/theme";
import { Button } from "../../components/ui/button";
import { Chevron } from "../../components/ui/chevron";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Segmented } from "../../components/ui/segmented";
import { FieldLabel } from "../../components/ui/field";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { CloseButton } from "../../components/ui/icons";
import { Modal } from "../../components/ui/modal";
import { Skeleton } from "../../components/ui/skeleton";
import { CopyButton, ROW_COPY_CLASS } from "../../components/ui/copy-button";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { Md } from "../chat/md";
import { OrgSection } from "./org-layout";
import {
  BlockedBadge,
  PrincipalChip,
  PriorityBadge,
  TicketStatusBadge,
  TitleButton,
  principalLabel,
} from "./shared";
import { agentPrincipal, splitPrincipalList } from "./principals";
import {
  TICKET_COLUMNS,
  allTickets,
  isBlocked,
  isOverdue,
  moveNeedsReason,
  ticketCreatedDate,
} from "./ticket-board";
import { ticketHistoryRows, ticketSummaryCounts } from "./ticket-history";
import { dayKey } from "./calendar-geom";
import { orgKey } from "./company-nav";
import { deskRows } from "./org-sessions";
import { chatPath, openTempSession } from "./temp-session";

const PRIORITIES: readonly OrgTicketPriority[] = ["P0", "P1", "P2"];

/** The sections that edit in place; one at a time, so a save always names what it rewrites. */
type Section = "summary" | "goal" | "acceptance" | "result";

interface SummaryDraft {
  title: string;
  owner: string;
  parent: string;
  notify: string;
  priority: OrgTicketPriority;
  due: string;
}

/**
 * The one mount of the ticket dialog, rendered by the organization layout beside the routed
 * page. Every surface opens a ticket by naming it in the shell state and this follows, so a
 * detail is read where the reader already is — no page switch, and the dialog survives one.
 */
export function TicketDialogHost() {
  const company = useCompany();
  const target = company.ticketDialog;
  if (target === null) return null;
  return (
    <TicketDialog
      projectId={target.projectId}
      orgId={target.orgId}
      ticketId={target.ticketId}
      canGoBack={company.ticketBackDepth > 0}
      onBack={company.backTicket}
      onClose={company.closeTicket}
      onOpenTicket={(ticketId) => company.openTicket(target.projectId, target.orgId, ticketId)}
      onChanged={company.ticketsChanged}
    />
  );
}

function TicketDialog({
  projectId,
  orgId,
  ticketId,
  canGoBack,
  onBack,
  onClose,
  onChanged,
  onOpenTicket,
}: {
  projectId: string;
  orgId: string;
  ticketId: string;
  /** A parent or a child was followed to get here, so the header offers the way back. */
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  /** A write landed: the surfaces listing tickets refetch off the shell's version. */
  onChanged: () => void;
  /** Swap the dialog's ticket for another (a child, the parent). */
  onOpenTicket: (ticketId: string) => void;
}) {
  const navigate = useNavigate();
  const company = useCompany();
  const { setCurrentAgentId } = useProject();
  const { currency } = useTheme();
  const { user } = useAuth();
  const me = user?.userId ?? null;
  const [detail, setDetail] = useState<OrgTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The organization's board and roster: the parent picker, the child titles, the owner options. */
  const [tickets, setTickets] = useState<readonly OrgTicketItem[]>([]);
  const [employees, setEmployees] = useState<readonly OrgEmployeeItem[]>([]);
  /**
   * The organization whose board and roster are on hand, set once that fetch settles — resolved
   * or failed. Settled rather than succeeded: when it fails the ids are all this dialog has, and
   * waiting for names that are never coming would hold the skeleton open forever.
   */
  const [contextOrg, setContextOrg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Section | null>(null);
  const [summaryDraft, setSummaryDraft] = useState<SummaryDraft | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [pendingSave, setPendingSave] = useState<OrgTicketUpdateRequest | null>(null);
  const [confirmUnblock, setConfirmUnblock] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [blockBy, setBlockBy] = useState("");
  const [progressText, setProgressText] = useState("");
  const [moveTarget, setMoveTarget] = useState("");
  const [pendingMove, setPendingMove] = useState<OrgTicketStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const names = new Map(employees.map((e) => [e.agentId, e.name]));
  const titles = new Map(tickets.map((t) => [t.ticketId, t.title]));
  /** Whether the board and roster on hand are this organization's, so the fields can read names. */
  const contextReady = contextOrg === `${projectId}/${orgId}`;
  const { tickets: ticketsVersion, runs: runsVersion } = company.versions;

  const load = useCallback(async () => {
    try {
      setDetail(await api.getOrgTicket(projectId, orgId, ticketId));
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId, ticketId]);
  // Another ticket: start blank. A version bump on the same ticket refetches in place, so a
  // board event under an open dialog never flashes the skeleton or drops an edit in progress.
  useEffect(() => {
    setDetail(null);
    setError(null);
    setEditing(null);
    setMoveTarget("");
  }, [ticketId]);
  useEffect(() => {
    void load();
  }, [load, ticketsVersion, runsVersion]);

  // The board and the roster the fields read against. Still best effort — a failure opens the
  // dialog anyway, on the ids — but the first reveal waits for it: the owner, the parent, the
  // children and every history line read an id until it lands and a name afterwards, and the
  // two are different lengths, so showing the detail first reflows the whole panel under the
  // reader. A later version bump refetches in place and never re-hides what is on screen.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [board, chart] = await Promise.all([
          api.listOrgTickets(projectId, orgId),
          api.getOrgChart(projectId, orgId),
        ]);
        if (cancelled) return;
        setTickets(allTickets(board));
        setEmployees(chart.employees);
      } catch {
        // The detail itself is what the dialog is for; it carries its own error strip.
      } finally {
        if (!cancelled) setContextOrg(`${projectId}/${orgId}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, orgId, ticketsVersion]);

  const run = async (work: () => Promise<void>, done?: string) => {
    setBusy(true);
    try {
      await work();
      if (done !== undefined) toastSuccess(done);
      await load();
      onChanged();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (section: Section) => {
    if (detail === null) return;
    if (section === "summary") {
      setSummaryDraft({
        title: detail.title,
        owner: detail.owner,
        parent: detail.parent ?? "",
        notify: detail.notify.join(", "),
        priority: detail.priority,
        due: detail.due ?? "",
      });
    } else {
      setTextDraft(
        section === "goal"
          ? detail.goal
          : section === "acceptance"
            ? detail.acceptanceCriteria
            : detail.result,
      );
    }
    setEditing(section);
  };

  /** What the open section changed, as the update body; nothing changed → a toast, no dialog. */
  const requestSave = () => {
    if (detail === null || editing === null) return;
    const body: OrgTicketUpdateRequest = {};
    if (editing === "summary" && summaryDraft !== null) {
      const d = summaryDraft;
      if (d.title.trim() && d.title.trim() !== detail.title) body.title = d.title.trim();
      // A ticket always has an owner: an empty box is no change, never a clearing.
      if (d.owner !== "" && d.owner !== detail.owner) body.owner = d.owner;
      if (d.parent !== (detail.parent ?? "")) body.parent = d.parent === "" ? null : d.parent;
      const notify = splitPrincipalList(d.notify);
      if (notify.join(",") !== detail.notify.join(",")) body.notify = notify;
      if (d.priority !== detail.priority) body.priority = d.priority;
      if (d.due !== (detail.due ?? "")) body.due = d.due === "" ? null : d.due;
    } else if (editing === "goal" && textDraft !== detail.goal) {
      body.goal = textDraft;
    } else if (editing === "acceptance" && textDraft !== detail.acceptanceCriteria) {
      body.acceptanceCriteria = textDraft;
    } else if (editing === "result" && textDraft !== detail.result) {
      body.result = textDraft;
    }
    if (Object.keys(body).length === 0) {
      toastInfo(S.common.noChangesToSave);
      setEditing(null);
      return;
    }
    setPendingSave(body);
  };

  const commitSave = () => {
    if (detail === null || pendingSave === null) return;
    const body = pendingSave;
    setPendingSave(null);
    void run(async () => {
      await api.updateOrgTicket(projectId, orgId, detail.ticketId, body);
      setEditing(null);
    }, S.company.tickets.saved);
  };

  const addProgress = () => {
    if (detail === null || !progressText.trim() || busy) return;
    void run(async () => {
      await api.progressOrgTicket(projectId, orgId, detail.ticketId, {
        text: progressText.trim(),
      });
      setProgressText("");
    });
  };

  /** The move the footer asked for, once its confirmation (a reason, when rejecting) is answered. */
  const commitMove = (reason: string) => {
    if (detail === null || pendingMove === null) return;
    const to = pendingMove;
    setPendingMove(null);
    void run(async () => {
      await api.moveOrgTicket(projectId, orgId, detail.ticketId, {
        status: to,
        ...(moveNeedsReason(to) ? { reason: reason.trim() } : {}),
      });
      setMoveTarget("");
    }, S.company.tickets.moved);
  };

  const children = (detail?.children ?? []).map(
    (id) => tickets.find((t) => t.ticketId === id) ?? { ticketId: id, title: id },
  );
  const blocked = detail !== null && isBlocked(detail);
  const todayKey = dayKey(Date.now());
  const created = detail === null ? null : ticketCreatedDate(detail.ticketId);
  const counts = detail === null ? null : ticketSummaryCounts(detail);
  const history = detail === null ? [] : ticketHistoryRows(detail.history);
  /** A history line's principal: the employee's name, "you" for the reader, else the user id. */
  const historyPrincipal = (principal: string) =>
    me !== null && principal === `user:${me}`
      ? S.company.channels.you
      : principalLabel(principal, names);
  /**
   * The owner picker's options. Employees first; a ticket owned by a person keeps that owner
   * on the list, so opening the form does not silently reassign it to the first employee.
   */
  const ownerOptions = [
    ...employees.map((e) => ({ value: agentPrincipal(e.agentId), label: e.name })),
    ...(detail !== null && !employees.some((e) => agentPrincipal(e.agentId) === detail.owner)
      ? [{ value: detail.owner, label: principalLabel(detail.owner, names) }]
      : []),
  ];

  /** A section's trailing controls: an edit button at rest, cancel / save while it is open. */
  const sectionActions = (section: Section) =>
    editing === section ? (
      <>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
          {S.common.cancel}
        </Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={requestSave}>
          {S.common.save}
        </Button>
      </>
    ) : (
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || editing !== null}
        onClick={() => startEdit(section)}
      >
        {S.common.edit}
      </Button>
    );

  /** A Markdown body, or its "nothing here yet" line; a textarea while the section is open. */
  const textSection = (section: Exclude<Section, "summary">, text: string, empty: string) =>
    editing === section ? (
      <Textarea
        size="sm"
        rows={6}
        aria-label={S.company.tickets[section]}
        value={textDraft}
        autoFocus
        onChange={(e) => setTextDraft(e.target.value)}
      />
    ) : text.trim() === "" ? (
      <p className="text-xs text-gray-400 dark:text-gray-500">{empty}</p>
    ) : (
      <div className="md-body text-sm leading-relaxed text-gray-800 dark:text-gray-100">
        <Md text={text} />
      </div>
    );

  /**
   * Opens a ticket session: the one way out of the dialog. The session goes to the top of the
   * company sidebar's Temporary group (a desk session keeps its desk row instead) and the
   * conversation opens as its full page. The current Agent follows it, as a desk row's does.
   */
  const openSession = (session: { sessionId: string; agentId: string; title?: string }) => {
    const desks = deskRows(company.orgChart, company.orgSessions.get(orgKey(projectId, orgId)));
    openTempSession(
      me,
      projectId,
      orgId,
      { sessionId: session.sessionId, agentId: session.agentId, title: session.title ?? "" },
      desks.map((d) => d.sessionId),
    );
    if (session.agentId !== "") setCurrentAgentId(session.agentId);
    onClose();
    navigate(chatPath(session.sessionId));
  };

  /** One field of the summary grid: every row is one line tall, so labels and values line up down the column. */
  const row = (label: string, value: ReactNode) => (
    <>
      <dt className="whitespace-nowrap text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-gray-800 dark:text-gray-100">
        {value}
      </dd>
    </>
  );

  return (
    // Headerless and bare: the header below carries the back control and the priority chip
    // beside the title, and the body owns its own scroller so the footer stays on screen.
    <Modal
      open
      title={detail?.title ?? S.company.tickets.detail}
      onClose={onClose}
      headerless
      bare
      widthClass="sm:max-w-3xl"
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          {canGoBack && (
            <Button size="sm" variant="ghost" onClick={onBack}>
              {S.company.tickets.back}
            </Button>
          )}
          {/* The priority sits on the title's line, one size under it: it is read with the
              title, and a chip of its own line would push the ticket's first words down. */}
          <h2 className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold">
            <span className="min-w-0 truncate">{detail?.title ?? S.company.tickets.detail}</span>
            {detail !== null && (
              <span className="shrink-0">
                <PriorityBadge priority={detail.priority} />
              </span>
            )}
          </h2>
          <CloseButton onClose={onClose} />
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
          {error !== null && detail === null ? (
            <div
              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${toneStrip.danger}`}
            >
              <span>{error}</span>
              <Button size="sm" onClick={() => void load()}>
                {S.common.retry}
              </Button>
            </div>
          ) : detail === null || !contextReady ? (
            <div className="space-y-5">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-10 rounded-full" />
                <Skeleton className="h-5 w-40" />
              </div>
              <Skeleton className="h-28" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : (
            <>
              {/* Identity line: status, the blocked mark, the id with its copy, the cost. */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <TicketStatusBadge status={detail.status} />
                {blocked && (
                  <BlockedBadge
                    reason={detail.blocked ?? ""}
                    {...(detail.blockedBy !== undefined ? { by: detail.blockedBy } : {})}
                  />
                )}
                <span className="inline-flex items-center gap-0.5 font-mono">
                  {detail.ticketId}
                  <CopyButton
                    text={detail.ticketId}
                    label={S.company.tickets.copyId}
                    className={ROW_COPY_CLASS}
                  />
                </span>
                <span className="ml-auto tabular-nums">
                  {S.company.tickets.cost}{" "}
                  <span className="font-medium text-gray-700 dark:text-gray-200">
                    {formatMoney(detail.cost, currency)}
                  </span>
                  {" · "}
                  {S.company.tickets.rolledUpCost}{" "}
                  <span className="font-medium text-gray-700 dark:text-gray-200">
                    {formatMoney(detail.rolledUpCost, currency)}
                  </span>
                </span>
              </div>
              {detail.invalid !== undefined && (
                <div className={`rounded-md border px-3 py-2 text-xs ${toneStrip.danger}`}>
                  {detail.invalid}
                </div>
              )}
              {blocked && (
                <div
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs ${toneStrip.attention}`}
                >
                  <span>
                    <span className="font-medium">{S.company.tickets.blockedReason}:</span>{" "}
                    {detail.blocked}
                  </span>
                  {detail.blockedBy !== undefined && (
                    <span className="inline-flex items-center gap-1.5">
                      <span>{S.company.tickets.blockedBy}:</span>
                      <PrincipalChip principal={detail.blockedBy} names={names} />
                    </span>
                  )}
                </div>
              )}

              {/* Summary: the header fields as a definition list, a form while editing. */}
              <OrgSection title={S.company.tickets.summary} actions={sectionActions("summary")}>
                {editing === "summary" && summaryDraft !== null ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <Input
                        size="sm"
                        label={S.company.tickets.ticketTitle}
                        required
                        value={summaryDraft.title}
                        onChange={(e) =>
                          setSummaryDraft({ ...summaryDraft, title: e.target.value })
                        }
                      />
                    </div>
                    <Select
                      size="sm"
                      label={S.company.tickets.owner}
                      value={summaryDraft.owner}
                      onChange={(e) => setSummaryDraft({ ...summaryDraft, owner: e.target.value })}
                    >
                      {ownerOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    <Select
                      size="sm"
                      label={S.company.tickets.parent}
                      value={summaryDraft.parent}
                      onChange={(e) => setSummaryDraft({ ...summaryDraft, parent: e.target.value })}
                    >
                      <option value="">{S.company.tickets.noParent}</option>
                      {tickets
                        .filter((t) => t.ticketId !== detail.ticketId)
                        .map((t) => (
                          <option key={t.ticketId} value={t.ticketId}>
                            {t.title}
                          </option>
                        ))}
                    </Select>
                    <div>
                      <FieldLabel>{S.company.tickets.priority}</FieldLabel>
                      <Segmented
                        options={PRIORITIES.map((p) => ({ value: p, label: p }))}
                        value={summaryDraft.priority}
                        onChange={(priority) => setSummaryDraft({ ...summaryDraft, priority })}
                        cols={3}
                      />
                    </div>
                    <Input
                      size="sm"
                      label={S.company.tickets.due}
                      type="date"
                      value={summaryDraft.due}
                      className="font-mono"
                      onChange={(e) => setSummaryDraft({ ...summaryDraft, due: e.target.value })}
                    />
                    <div className="md:col-span-2">
                      <Input
                        size="sm"
                        label={S.company.tickets.notify}
                        value={summaryDraft.notify}
                        hint={S.company.tickets.notifyHint}
                        className="font-mono"
                        onChange={(e) =>
                          setSummaryDraft({ ...summaryDraft, notify: e.target.value })
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                    {row(
                      S.company.tickets.owner,
                      <PrincipalChip principal={detail.owner} names={names} />,
                    )}
                    {row(
                      S.company.tickets.parent,
                      detail.parent !== undefined ? (
                        <TitleButton
                          title={`${S.company.tickets.openTicket} · ${detail.parent}`}
                          className="truncate"
                          onClick={() => onOpenTicket(detail.parent!)}
                        >
                          {titles.get(detail.parent) ?? detail.parent}
                        </TitleButton>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">
                          {S.company.tickets.noParent}
                        </span>
                      ),
                    )}
                    {row(
                      S.company.tickets.notify,
                      detail.notify.length === 0 ? (
                        <span className="text-gray-400 dark:text-gray-500">{S.common.none}</span>
                      ) : (
                        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                          {detail.notify.map((p) => (
                            <PrincipalChip key={p} principal={p} names={names} />
                          ))}
                        </span>
                      ),
                    )}
                    {row(
                      S.company.tickets.due,
                      detail.due !== undefined ? (
                        <span
                          className={`font-mono tabular-nums ${
                            isOverdue(detail.due, todayKey) &&
                            detail.status !== "done" &&
                            detail.status !== "rejected"
                              ? toneInk.danger
                              : ""
                          }`}
                        >
                          {detail.due}
                          {isOverdue(detail.due, todayKey) &&
                            detail.status !== "done" &&
                            detail.status !== "rejected" &&
                            ` · ${S.company.tickets.overdue}`}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">
                          {S.company.tickets.noDue}
                        </span>
                      ),
                    )}
                    {created !== null &&
                      row(
                        S.common.created,
                        <span className="font-mono tabular-nums">{created}</span>,
                      )}
                  </dl>
                )}
              </OrgSection>

              <OrgSection title={S.company.tickets.goal} actions={sectionActions("goal")}>
                {textSection("goal", detail.goal, S.company.tickets.noGoal)}
              </OrgSection>

              <OrgSection
                title={S.company.tickets.acceptance}
                actions={sectionActions("acceptance")}
              >
                {textSection(
                  "acceptance",
                  detail.acceptanceCriteria,
                  S.company.tickets.noAcceptance,
                )}
              </OrgSection>

              {/* Progress: the sentences as written, oldest first, plus the one-line append.
                  Who wrote one and when is a history entry, not a chip on the sentence; the
                  bullets are md-compact so a one-line note reads as a line, not a paragraph. */}
              <OrgSection title={S.company.tickets.progress}>
                {detail.progress.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {S.company.tickets.progressEmpty}
                  </p>
                ) : (
                  <ul className="md-body md-compact list-disc pl-5 text-sm text-gray-800 marker:text-gray-400 dark:text-gray-100 dark:marker:text-gray-500">
                    {detail.progress.map((p, i) => (
                      <li key={`${i}-${p}`}>
                        <Md text={p} />
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      size="sm"
                      aria-label={S.company.tickets.addProgress}
                      placeholder={S.company.tickets.progressPlaceholder}
                      value={progressText}
                      onChange={(e) => setProgressText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) addProgress();
                      }}
                    />
                  </div>
                  <Button size="sm" disabled={busy || !progressText.trim()} onClick={addProgress}>
                    {S.company.tickets.addProgress}
                  </Button>
                </div>
              </OrgSection>

              <OrgSection title={S.company.tickets.result} actions={sectionActions("result")}>
                {textSection("result", detail.result, S.company.tickets.noResult)}
              </OrgSection>

              {/* The child tickets, folded: a plain list, each opened by clicking its title. */}
              <Fold
                title={S.company.tickets.children}
                summary={
                  counts === null || counts.childrenEmpty
                    ? S.common.none
                    : `${counts.children} · ${S.company.tickets.rolledUpCost} ${formatMoney(detail.rolledUpCost, currency)}`
                }
              >
                {children.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {S.company.tickets.childrenEmpty}
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {children.map((c) => (
                      <li key={c.ticketId} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                        <span className="flex min-w-0 flex-1">
                          <TitleButton
                            title={`${S.company.tickets.openTicket} · ${c.ticketId}`}
                            className="truncate"
                            onClick={() => onOpenTicket(c.ticketId)}
                          >
                            {c.title}
                          </TitleButton>
                        </span>
                        {"status" in c && <TicketStatusBadge status={c.status} />}
                        {"owner" in c && (
                          <span className="shrink-0 text-xs text-gray-600 dark:text-gray-300">
                            <PrincipalChip principal={c.owner} names={names} />
                          </span>
                        )}
                        {"cost" in c && (
                          <span
                            className="shrink-0 font-mono text-[11px] tabular-nums text-gray-400 dark:text-gray-500"
                            title={S.company.tickets.cost}
                          >
                            {formatMoney(c.cost, currency)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Fold>

              {/* The sessions this ticket was worked in, folded, each opened by clicking its
                  title. They are opened from here and nowhere else: starting one and attaching
                  one belong to the owner's desk and to the CLI, not to a reader of the board. */}
              <Fold
                title={S.company.tickets.sessions}
                summary={
                  counts === null || counts.sessionsEmpty
                    ? S.common.none
                    : S.company.tickets.sessionsCount(counts.sessions)
                }
              >
                {detail.sessionItems.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">{S.common.none}</p>
                ) : (
                  <ul className="space-y-0.5">
                    {detail.sessionItems.map((s) => (
                      <li key={s.sessionId} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                        <PrincipalChip principal={agentPrincipal(s.agentId)} names={names} />
                        <span className="flex min-w-0 flex-1">
                          {s.agentId === "" ? (
                            // The ticket still names a session whose row is gone (its Agent
                            // was deleted, say): the server answers it with no Agent, and
                            // there is nothing to open, so it is plain text and never
                            // becomes a Temporary entry.
                            <span
                              className="truncate text-gray-400 dark:text-gray-500"
                              title={s.sessionId}
                            >
                              {s.title ?? s.sessionId}
                            </span>
                          ) : (
                            <TitleButton
                              title={S.company.tickets.openSession}
                              className="truncate text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
                              onClick={() => openSession(s)}
                            >
                              {s.title ?? s.sessionId}
                            </TitleButton>
                          )}
                        </span>
                        {s.lastActiveAt !== undefined && (
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                            {formatDateTime(s.lastActiveAt)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Fold>

              {/* Every write the ticket file recorded, newest first. */}
              <Fold
                title={S.company.tickets.history}
                summary={history.length === 0 ? S.common.none : `${history.length}`}
              >
                {history.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {S.company.tickets.historyEmpty}
                  </p>
                ) : (
                  <ol className="space-y-1.5 text-xs">
                    {history.map((h) => {
                      const parts: ReactNode[] = [
                        // A ticket converted from the format that predates the history has no
                        // time on its first entry; the line then starts with who did it.
                        ...(h.at === ""
                          ? []
                          : [
                              <span
                                key="at"
                                className="shrink-0 font-mono tabular-nums text-gray-400 dark:text-gray-500"
                                title={h.at}
                              >
                                {formatDateTime(h.at)}
                              </span>,
                            ]),
                        <span key="by" className="text-gray-700 dark:text-gray-200">
                          {historyPrincipal(h.by)}
                        </span>,
                        <span key="action" className="text-gray-500 dark:text-gray-400">
                          {S.company.tickets.historyActions[h.action] ?? h.action}
                        </span>,
                      ];
                      return (
                        <li
                          key={h.key}
                          className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-gray-600 dark:text-gray-300"
                        >
                          {parts.map((part, i) => (
                            <Fragment key={i}>
                              {i > 0 && (
                                <span aria-hidden className="text-gray-300 dark:text-gray-600">
                                  ·
                                </span>
                              )}
                              {part}
                            </Fragment>
                          ))}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Fold>
            </>
          )}
        </div>

        {/* Footer: block / unblock on the left, the move on the right. */}
        {detail !== null && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
            {blocked ? (
              <Button size="sm" disabled={busy} onClick={() => setConfirmUnblock(true)}>
                {S.company.tickets.unblock}
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => setBlockOpen(true)}>
                {S.company.tickets.block}
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <div className="w-36">
                <Select
                  size="sm"
                  aria-label={S.company.tickets.moveTitle}
                  value={moveTarget}
                  onChange={(e) => setMoveTarget(e.target.value)}
                >
                  <option value="">{S.company.tickets.moveTo}</option>
                  {TICKET_COLUMNS.filter((s) => s !== detail.status).map((s) => (
                    <option key={s} value={s}>
                      {S.company.tickets.columns[s] ?? s}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                size="sm"
                variant="primary"
                disabled={busy || moveTarget === ""}
                onClick={() => {
                  const to = TICKET_COLUMNS.find((s) => s === moveTarget);
                  if (to !== undefined) setPendingMove(to);
                }}
              >
                {S.company.tickets.move}
              </Button>
            </div>
          </div>
        )}
      </div>

      <MoveTicketConfirm
        move={
          detail === null || pendingMove === null ? null : { title: detail.title, to: pendingMove }
        }
        busy={busy}
        onClose={() => (busy ? undefined : setPendingMove(null))}
        onConfirm={commitMove}
      />
      <ConfirmModal
        open={pendingSave !== null}
        title={S.common.confirmSaveTitle}
        tone="primary"
        confirmLabel={S.common.save}
        busy={busy}
        onClose={() => (busy ? undefined : setPendingSave(null))}
        onConfirm={commitSave}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.company.tickets.saveConfirm(detail?.title ?? "")}
        </p>
      </ConfirmModal>
      <ConfirmModal
        open={confirmUnblock}
        title={S.company.tickets.unblock}
        tone="primary"
        confirmLabel={S.common.confirm}
        busy={busy}
        onClose={() => (busy ? undefined : setConfirmUnblock(false))}
        onConfirm={() => {
          if (detail === null) return;
          setConfirmUnblock(false);
          void run(async () => {
            await api.unblockOrgTicket(projectId, orgId, detail.ticketId);
          });
        }}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.company.tickets.unblockConfirm(detail?.title ?? "")}
        </p>
      </ConfirmModal>
      <Modal
        open={blockOpen}
        title={S.company.tickets.blockTitle}
        onClose={() => setBlockOpen(false)}
        footer={
          <>
            <Button size="sm" onClick={() => setBlockOpen(false)} disabled={busy}>
              {S.common.cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !blockReason.trim()}
              onClick={() => {
                if (detail === null) return;
                setBlockOpen(false);
                void run(async () => {
                  await api.blockOrgTicket(projectId, orgId, detail.ticketId, {
                    reason: blockReason.trim(),
                    ...(blockBy.trim() ? { by: blockBy.trim() } : {}),
                  });
                  setBlockReason("");
                  setBlockBy("");
                });
              }}
            >
              {S.company.tickets.block}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            size="sm"
            label={S.company.tickets.blockedReason}
            required
            value={blockReason}
            hint={S.company.tickets.blockReasonHint}
            autoFocus
            onChange={(e) => setBlockReason(e.target.value)}
          />
          <Input
            size="sm"
            label={S.company.tickets.blockedBy}
            value={blockBy}
            hint={S.company.tickets.blockByHint}
            className="font-mono"
            onChange={(e) => setBlockBy(e.target.value)}
          />
        </div>
      </Modal>
    </Modal>
  );
}

/**
 * The confirmation every move goes through, wherever the move was asked for — a card dragged
 * on the board and the dialog's footer — so a card dropped in a column and a ticket moved
 * from its detail ask the same question. Moving into rejected also asks for the one-line
 * reason that is recorded under the ticket's result; the box empties whenever a new move is
 * proposed, so yesterday's wording cannot ride along.
 */
export function MoveTicketConfirm({
  move,
  busy,
  onClose,
  onConfirm,
}: {
  /** The move waiting for an answer, or null when none is. */
  move: { title: string; to: OrgTicketStatus } | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  // Emptied on the move itself, never on the object carrying it: the callers build that inline,
  // so a dependency on its identity would clear the box on every keystroke's render.
  const movedTitle = move?.title ?? null;
  const movedTo = move?.to ?? null;
  useEffect(() => {
    setReason("");
  }, [movedTitle, movedTo]);
  const needsReason = move !== null && moveNeedsReason(move.to);
  return (
    <ConfirmModal
      open={move !== null}
      title={S.company.tickets.moveTitle}
      tone={move?.to === "rejected" ? "danger" : "primary"}
      confirmLabel={S.common.confirm}
      confirmDisabled={needsReason && reason.trim() === ""}
      busy={busy}
      onClose={onClose}
      onConfirm={() => onConfirm(reason)}
    >
      <div className="space-y-2">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {move !== null
            ? S.company.tickets.moveConfirm(
                move.title,
                S.company.tickets.columns[move.to] ?? move.to,
              )
            : ""}
        </p>
        {needsReason && (
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
  );
}

/**
 * A section of the dialog that is folded on every visit: the ruled header of `OrgSection`
 * with the app's one collapse chevron in front of it, and what it holds after it — a count,
 * a count and a cost — so a reader decides from the closed row whether to open it. The panel
 * stays in the DOM and is `hidden` while collapsed — the WAI-ARIA disclosure pattern, so
 * `aria-controls` always resolves — and nothing is persisted: what hangs off a ticket is
 * looked up, not tracked.
 */
function Fold({
  title,
  summary,
  children,
}: {
  title: string;
  /** What the closed row reports: the counts, or "none" when there is nothing inside. */
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <section className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center ${ICON_GAP.row} border-b border-gray-200 pb-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 transition-colors duration-150 hover:text-gray-800 dark:border-gray-800 dark:text-gray-400 dark:hover:text-gray-200`}
      >
        <Chevron open={open} size={ICON_SIZE.chevronDense} />
        <span className="min-w-0 truncate">{title}</span>
        <span className="min-w-0 truncate font-normal normal-case tracking-normal text-gray-400 dark:text-gray-500">
          · {summary}
        </span>
      </button>
      <div id={panelId} hidden={!open} className="mt-3 space-y-4">
        {children}
      </div>
    </section>
  );
}
