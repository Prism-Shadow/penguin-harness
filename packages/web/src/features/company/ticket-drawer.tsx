/**
 * A ticket's detail, in a right-hand drawer over the board. The header names the ticket
 * (status, priority, id with a copy button, cost); the blocked strip says why and on whom
 * it waits; then the sections in reading order — the summary fields (owner, parent, notify,
 * due, initiator, created), the goal, the acceptance criteria, the progress timeline
 * (session references open the conversation), the contributing sessions (open one, start
 * another, attach an existing one), the child tickets with the rolled-up cost, and the
 * result. Each editable section edits in place with its own save / cancel; the footer holds
 * the block / unblock and move actions. Saves confirm first, like every organization write.
 */
import { useCallback, useEffect, useState } from "react";
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
import { toneInk, toneStrip } from "../../lib/tone";
import { useSessions } from "../../state/sessions";
import { useTheme } from "../../state/theme";
import { Drawer } from "../../components/ui/drawer";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Segmented } from "../../components/ui/segmented";
import { FieldLabel } from "../../components/ui/field";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Modal } from "../../components/ui/modal";
import { Skeleton } from "../../components/ui/skeleton";
import { CopyButton, ROW_COPY_CLASS } from "../../components/ui/copy-button";
import { SessionActivityIcon } from "../../components/ui/session-activity-icon";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { Md } from "../chat/md";
import { OrgSection } from "./org-layout";
import { BlockedBadge, PrincipalChip, PriorityBadge, TicketStatusBadge } from "./shared";
import { agentPrincipal, splitPrincipalList } from "./principals";
import { orgRowActivity } from "./org-sessions";
import { TICKET_COLUMNS, isBlocked, isOverdue, ticketCreatedDate } from "./ticket-board";
import { dayKey } from "./calendar-geom";

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

export function TicketDrawer({
  projectId,
  orgId,
  ticketId,
  employees,
  tickets,
  version,
  onClose,
  onChanged,
  onOpenTicket,
  onMove,
}: {
  projectId: string;
  orgId: string;
  /** Null closes the drawer. */
  ticketId: string | null;
  employees: readonly OrgEmployeeItem[];
  /** Every ticket of the board (the parent picker, the child list's titles). */
  tickets: readonly OrgTicketItem[];
  /** Bumped by the board when the ticket may have changed under the drawer. */
  version: number;
  onClose: () => void;
  onChanged: () => void;
  /** Jump to another ticket (a child, the parent) inside the same drawer. */
  onOpenTicket: (ticketId: string) => void;
  /** Hand a move to the board's confirm flow (the same dialog a drag-and-drop goes through). */
  onMove: (ticket: OrgTicketItem, to: OrgTicketStatus) => void;
}) {
  const navigate = useNavigate();
  const { currency } = useTheme();
  const { sessions } = useSessions();
  const [detail, setDetail] = useState<OrgTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Section | null>(null);
  const [summaryDraft, setSummaryDraft] = useState<SummaryDraft | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [pendingSave, setPendingSave] = useState<OrgTicketUpdateRequest | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmUnblock, setConfirmUnblock] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [blockBy, setBlockBy] = useState("");
  const [progressText, setProgressText] = useState("");
  const [attachId, setAttachId] = useState("");
  const [moveTarget, setMoveTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const names = new Map(employees.map((e) => [e.agentId, e.name]));
  const titles = new Map(tickets.map((t) => [t.ticketId, t.title]));

  const load = useCallback(async () => {
    if (ticketId === null) return;
    try {
      setDetail(await api.getOrgTicket(projectId, orgId, ticketId));
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId, ticketId]);
  // Another ticket: start blank. A version bump on the same ticket refetches in place, so a
  // board event under an open drawer never flashes the skeleton or drops an edit in progress.
  useEffect(() => {
    setDetail(null);
    setError(null);
    setEditing(null);
    setMoveTarget("");
  }, [ticketId]);
  useEffect(() => {
    void load();
  }, [load, version]);

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
        owner: detail.owner ?? "",
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
      if (d.owner !== (detail.owner ?? "")) body.owner = d.owner === "" ? null : d.owner;
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

  const attachable = sessions.filter((s) => !(detail?.sessions ?? []).includes(s.sessionId));
  const children = (detail?.children ?? []).map(
    (id) => tickets.find((t) => t.ticketId === id) ?? { ticketId: id, title: id },
  );
  const blocked = detail !== null && isBlocked(detail);
  const todayKey = dayKey(Date.now());
  const created = detail === null ? null : ticketCreatedDate(detail.ticketId);

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

  const row = (label: string, value: ReactNode) => (
    <>
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="min-w-0 text-gray-800 dark:text-gray-100">{value}</dd>
    </>
  );

  return (
    <Drawer
      open={ticketId !== null}
      side="right"
      title={detail?.title ?? S.company.tickets.detail}
      onClose={onClose}
      widthClass="max-w-2xl"
    >
      <div className="flex min-h-full flex-col">
        <div className="flex-1 space-y-5 px-4 py-4">
          {error !== null && detail === null ? (
            <div
              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${toneStrip.danger}`}
            >
              <span>{error}</span>
              <Button size="sm" onClick={() => void load()}>
                {S.common.retry}
              </Button>
            </div>
          ) : detail === null ? (
            <div className="space-y-4">
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
              {/* Identity line: status, priority, the blocked mark, the id with its copy, the cost. */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <TicketStatusBadge status={detail.status} />
                <PriorityBadge priority={detail.priority} />
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
                    <span className="inline-flex items-center gap-1">
                      {S.company.tickets.blockedBy}:{" "}
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
                      detail.owner !== undefined ? (
                        <PrincipalChip principal={detail.owner} names={names} />
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">
                          {S.company.tickets.noOwner}
                        </span>
                      ),
                    )}
                    {row(
                      S.company.tickets.parent,
                      detail.parent !== undefined ? (
                        <button
                          type="button"
                          className="text-left hover:underline"
                          title={detail.parent}
                          onClick={() => onOpenTicket(detail.parent!)}
                        >
                          {titles.get(detail.parent) ?? detail.parent}
                        </button>
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
                        <span className="flex flex-wrap gap-x-3 gap-y-1">
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
                    {row(
                      S.company.tickets.initiator,
                      <PrincipalChip principal={detail.initiator} names={names} />,
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

              {/* Progress timeline, oldest first, plus the one-line append. */}
              <OrgSection title={S.company.tickets.progress}>
                {detail.progress.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {S.company.tickets.progressEmpty}
                  </p>
                ) : (
                  <ol className="space-y-2.5 border-l border-gray-200 pl-3 dark:border-gray-800">
                    {detail.progress.map((p, i) => (
                      <li key={`${p.time}-${i}`} className="relative text-sm">
                        <span
                          aria-hidden
                          className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full border-2 border-white bg-gray-300 dark:border-gray-900 dark:bg-gray-600"
                        />
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                          <span className="font-mono tabular-nums">{formatDateTime(p.time)}</span>
                          <PrincipalChip principal={p.by} names={names} />
                          {p.sessionId !== undefined && (
                            <button
                              type="button"
                              className={`${toneInk.busy} hover:underline`}
                              onClick={() => navigate(`/chat/${p.sessionId}`)}
                            >
                              {S.company.tickets.openSession}
                            </button>
                          )}
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap text-gray-800 dark:text-gray-100">
                          {p.text}
                        </p>
                      </li>
                    ))}
                  </ol>
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

              {/* Contributing sessions: open one, start another, attach an existing one. */}
              <OrgSection
                title={`${S.company.tickets.sessions} · ${S.company.tickets.sessionsCount(detail.sessionItems.length)}`}
                actions={
                  <Button size="sm" disabled={busy} onClick={() => setConfirmStart(true)}>
                    {S.company.tickets.startSession}
                  </Button>
                }
              >
                {detail.sessionItems.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">{S.common.none}</p>
                ) : (
                  <ul className="space-y-0.5">
                    {detail.sessionItems.map((s) => {
                      const activity = orgRowActivity(s.status);
                      return (
                        <li key={s.sessionId}>
                          <button
                            type="button"
                            onClick={() => navigate(`/chat/${s.sessionId}`)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800"
                          >
                            <PrincipalChip principal={agentPrincipal(s.agentId)} names={names} />
                            <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">
                              {s.title ?? s.sessionId}
                            </span>
                            {activity !== null && <SessionActivityIcon activity={activity} />}
                            {s.lastActiveAt !== undefined && (
                              <span className="shrink-0 font-mono text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                                {formatDateTime(s.lastActiveAt)}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Select
                      size="sm"
                      aria-label={S.company.tickets.attachSession}
                      value={attachId}
                      onChange={(e) => setAttachId(e.target.value)}
                    >
                      <option value="">{S.company.tickets.attachPick}</option>
                      {attachable.map((s) => (
                        <option key={s.sessionId} value={s.sessionId}>
                          {(s.title ?? S.company.sessionList.untitledSession) + ` · ${s.agentId}`}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    disabled={busy || attachId === ""}
                    onClick={() =>
                      void run(async () => {
                        await api.attachOrgTicket(projectId, orgId, detail.ticketId, {
                          sessionId: attachId,
                        });
                        setAttachId("");
                      }, S.company.tickets.attached)
                    }
                  >
                    {S.company.tickets.attachSession}
                  </Button>
                </div>
              </OrgSection>

              {/* Children and the rolled-up cost. */}
              <OrgSection
                title={`${S.company.tickets.children} · ${S.company.tickets.rolledUpCost} ${formatMoney(detail.rolledUpCost, currency)}`}
              >
                {children.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {S.company.tickets.childrenEmpty}
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {children.map((c) => (
                      <li key={c.ticketId}>
                        <button
                          type="button"
                          onClick={() => onOpenTicket(c.ticketId)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <span className="min-w-0 flex-1 truncate">{c.title}</span>
                          {"priority" in c && <PriorityBadge priority={c.priority} />}
                          {"status" in c && <TicketStatusBadge status={c.status} />}
                          {"cost" in c && (
                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                              {formatMoney(c.cost, currency)}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </OrgSection>

              <OrgSection title={S.company.tickets.result} actions={sectionActions("result")}>
                {textSection("result", detail.result, S.company.tickets.noResult)}
              </OrgSection>
            </>
          )}
        </div>

        {/* Footer: block / unblock on the left, the move on the right. */}
        {detail !== null && (
          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
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
                  if (to !== undefined) onMove(detail, to);
                }}
              >
                {S.company.tickets.move}
              </Button>
            </div>
          </div>
        )}
      </div>

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
        open={confirmStart}
        title={S.company.tickets.startSession}
        tone="primary"
        confirmLabel={S.common.confirm}
        busy={busy}
        onClose={() => (busy ? undefined : setConfirmStart(false))}
        onConfirm={() => {
          if (detail === null) return;
          setConfirmStart(false);
          void run(async () => {
            const res = await api.startOrgTicket(projectId, orgId, detail.ticketId);
            navigate(`/chat/${res.sessionId}`);
          }, S.company.tickets.started);
        }}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.company.tickets.startSessionConfirm(detail?.title ?? "")}
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
            <Button onClick={() => setBlockOpen(false)} disabled={busy}>
              {S.common.cancel}
            </Button>
            <Button
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
    </Drawer>
  );
}
