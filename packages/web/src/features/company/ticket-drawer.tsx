/**
 * A ticket's detail, in a right-hand drawer over the board: the header fields as a form
 * (owner, parent, notify, priority, due; the blocked reason and who it waits on with a
 * one-click unblock), the goal / acceptance criteria / result editors, the progress
 * timeline (session references open the conversation), the contributing sessions (open one,
 * start another, attach an existing one), the child tickets and the rolled-up cost. Saves
 * confirm first, like every organization write.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type {
  OrgEmployeeItem,
  OrgTicketDetail,
  OrgTicketItem,
  OrgTicketPriority,
  OrgTicketUpdateRequest,
} from "@prismshadow/penguin-server/api";
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
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Modal } from "../../components/ui/modal";
import { Skeleton } from "../../components/ui/skeleton";
import { SessionActivityIcon } from "../../components/ui/session-activity-icon";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { OrgSection } from "./org-layout";
import { BlockedBadge, PrincipalChip, PriorityBadge, TicketStatusBadge } from "./shared";
import { agentPrincipal, splitPrincipalList } from "./principals";
import { orgRowActivity } from "./org-sessions";

const PRIORITIES: readonly OrgTicketPriority[] = ["P0", "P1", "P2"];

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
}) {
  const navigate = useNavigate();
  const { currency } = useTheme();
  const { sessions } = useSessions();
  const [detail, setDetail] = useState<OrgTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    title: string;
    owner: string;
    parent: string;
    notify: string;
    priority: OrgTicketPriority;
    due: string;
    goal: string;
    acceptanceCriteria: string;
    result: string;
  } | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmUnblock, setConfirmUnblock] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [blockBy, setBlockBy] = useState("");
  const [progressText, setProgressText] = useState("");
  const [attachId, setAttachId] = useState("");
  const [busy, setBusy] = useState(false);
  const names = new Map(employees.map((e) => [e.agentId, e.name]));

  const load = useCallback(async () => {
    if (ticketId === null) return;
    try {
      const d = await api.getOrgTicket(projectId, orgId, ticketId);
      setDetail(d);
      setDraft({
        title: d.title,
        owner: d.owner ?? "",
        parent: d.parent ?? "",
        notify: d.notify.join(", "),
        priority: d.priority,
        due: d.due ?? "",
        goal: d.goal,
        acceptanceCriteria: d.acceptanceCriteria,
        result: d.result,
      });
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId, ticketId]);
  useEffect(() => {
    setDetail(null);
    setDraft(null);
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

  const save = () => {
    if (detail === null || draft === null || ticketId === null) return;
    const body: OrgTicketUpdateRequest = {};
    if (draft.title.trim() && draft.title.trim() !== detail.title) body.title = draft.title.trim();
    if (draft.owner !== (detail.owner ?? "")) body.owner = draft.owner === "" ? null : draft.owner;
    if (draft.parent !== (detail.parent ?? ""))
      body.parent = draft.parent === "" ? null : draft.parent;
    const notify = splitPrincipalList(draft.notify);
    if (notify.join(",") !== detail.notify.join(",")) body.notify = notify;
    if (draft.priority !== detail.priority) body.priority = draft.priority;
    if (draft.due !== (detail.due ?? "")) body.due = draft.due === "" ? null : draft.due;
    if (draft.goal !== detail.goal) body.goal = draft.goal;
    if (draft.acceptanceCriteria !== detail.acceptanceCriteria)
      body.acceptanceCriteria = draft.acceptanceCriteria;
    if (draft.result !== detail.result) body.result = draft.result;
    setConfirmSave(false);
    if (Object.keys(body).length === 0) return;
    void run(async () => {
      await api.updateOrgTicket(projectId, orgId, ticketId, body);
    }, S.company.tickets.saved);
  };

  const attachable = sessions.filter((s) => !(detail?.sessions ?? []).includes(s.sessionId));
  const children = (detail?.children ?? []).map(
    (id) => tickets.find((t) => t.ticketId === id) ?? { ticketId: id, title: id },
  );

  return (
    <Drawer
      open={ticketId !== null}
      side="right"
      title={detail?.title ?? S.company.tickets.detail}
      onClose={onClose}
      widthClass="max-w-2xl"
    >
      <div className="space-y-5 px-4 py-4">
        {error !== null && detail === null ? (
          <div className={`rounded-md border px-3 py-2 text-xs ${toneStrip.danger}`}>{error}</div>
        ) : detail === null || draft === null ? (
          <div className="space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-32" />
          </div>
        ) : (
          <>
            {/* Identity line: id, status, priority, blocked, cost. */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-mono">{detail.ticketId}</span>
              <TicketStatusBadge status={detail.status} />
              <PriorityBadge priority={detail.priority} />
              {detail.blocked !== undefined && detail.blocked !== "" && (
                <BlockedBadge
                  reason={detail.blocked}
                  {...(detail.blockedBy !== undefined ? { by: detail.blockedBy } : {})}
                />
              )}
              <span className="ml-auto tabular-nums">
                {S.company.tickets.cost} {formatMoney(detail.cost, currency)} ·{" "}
                {S.company.tickets.rolledUpCost} {formatMoney(detail.rolledUpCost, currency)}
              </span>
            </div>
            {detail.invalid !== undefined && (
              <div className={`rounded-md border px-3 py-2 text-xs ${toneStrip.danger}`}>
                {detail.invalid}
              </div>
            )}

            {/* Blocked strip: the reason, who it waits on, and the one-click unblock. */}
            {detail.blocked !== undefined && detail.blocked !== "" ? (
              <div
                className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs ${toneStrip.attention}`}
              >
                <span className="font-medium">{S.company.tickets.blockedReason}:</span>
                <span className="min-w-0 flex-1">{detail.blocked}</span>
                {detail.blockedBy !== undefined && (
                  <span>
                    {S.company.tickets.blockedBy}:{" "}
                    <PrincipalChip principal={detail.blockedBy} names={names} />
                  </span>
                )}
                <Button size="sm" disabled={busy} onClick={() => setConfirmUnblock(true)}>
                  {S.company.tickets.unblock}
                </Button>
              </div>
            ) : (
              <div>
                <Button size="sm" disabled={busy} onClick={() => setBlockOpen(true)}>
                  {S.company.tickets.block}
                </Button>
              </div>
            )}

            {/* Header fields as a form. */}
            <OrgSection
              title={S.company.tickets.edit}
              actions={
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => setConfirmSave(true)}
                >
                  {S.common.save}
                </Button>
              }
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Input
                    size="sm"
                    label={S.company.tickets.ticketTitle}
                    required
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                </div>
                <Select
                  size="sm"
                  label={S.company.tickets.owner}
                  value={draft.owner}
                  onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
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
                  value={draft.parent}
                  onChange={(e) => setDraft({ ...draft, parent: e.target.value })}
                >
                  <option value="">{S.company.tickets.noParent}</option>
                  {tickets
                    .filter((t) => t.ticketId !== detail.ticketId)
                    .map((t) => (
                      <option key={t.ticketId} value={t.ticketId}>
                        {t.ticketId} · {t.title}
                      </option>
                    ))}
                </Select>
                <Select
                  size="sm"
                  label={S.company.tickets.priority}
                  value={draft.priority}
                  onChange={(e) =>
                    setDraft({ ...draft, priority: e.target.value as OrgTicketPriority })
                  }
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
                  value={draft.due}
                  className="font-mono"
                  onChange={(e) => setDraft({ ...draft, due: e.target.value })}
                />
                <div className="md:col-span-2">
                  <Input
                    size="sm"
                    label={S.company.tickets.notify}
                    value={draft.notify}
                    hint={S.company.tickets.notifyHint}
                    className="font-mono"
                    onChange={(e) => setDraft({ ...draft, notify: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2 text-xs text-gray-500 dark:text-gray-400">
                  {S.company.tickets.initiator}:{" "}
                  <PrincipalChip principal={detail.initiator} names={names} />
                </div>
              </div>
              <div className="mt-3 space-y-3">
                <Textarea
                  size="sm"
                  label={S.company.tickets.goal}
                  rows={4}
                  value={draft.goal}
                  hint={S.company.tickets.goalHint}
                  onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
                />
                <Textarea
                  size="sm"
                  label={S.company.tickets.acceptance}
                  rows={4}
                  value={draft.acceptanceCriteria}
                  hint={S.company.tickets.acceptanceHint}
                  onChange={(e) => setDraft({ ...draft, acceptanceCriteria: e.target.value })}
                />
                <Textarea
                  size="sm"
                  label={S.company.tickets.result}
                  rows={3}
                  value={draft.result}
                  onChange={(e) => setDraft({ ...draft, result: e.target.value })}
                />
              </div>
            </OrgSection>

            {/* Contributing sessions. */}
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
                <ul className="space-y-1">
                  {detail.sessionItems.map((s) => {
                    const activity = orgRowActivity(s.status);
                    return (
                      <li key={s.sessionId}>
                        <button
                          type="button"
                          onClick={() => navigate(`/chat/${s.sessionId}`)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <PrincipalChip principal={agentPrincipal(s.agentId)} names={names} />
                          <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">
                            {s.title ?? s.sessionId}
                          </span>
                          {activity !== null && <SessionActivityIcon activity={activity} />}
                          {s.lastActiveAt !== undefined && (
                            <span className="shrink-0 text-[11px] text-gray-400">
                              {formatDateTime(s.lastActiveAt)}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-2 flex items-center gap-2">
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

            {/* Progress timeline. */}
            <OrgSection title={S.company.tickets.progress}>
              {detail.progress.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {S.company.tickets.progressEmpty}
                </p>
              ) : (
                <ol className="space-y-2 border-l border-gray-200 pl-3 dark:border-gray-800">
                  {detail.progress.map((p, i) => (
                    <li key={`${p.time}-${i}`} className="text-sm">
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
                      <p className="mt-0.5 whitespace-pre-wrap">{p.text}</p>
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-2 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    size="sm"
                    aria-label={S.company.tickets.addProgress}
                    placeholder={S.company.tickets.progressPlaceholder}
                    value={progressText}
                    onChange={(e) => setProgressText(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.nativeEvent.isComposing &&
                        progressText.trim() &&
                        !busy
                      ) {
                        void run(async () => {
                          await api.progressOrgTicket(projectId, orgId, detail.ticketId, {
                            text: progressText.trim(),
                          });
                          setProgressText("");
                        });
                      }
                    }}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={busy || !progressText.trim()}
                  onClick={() =>
                    void run(async () => {
                      await api.progressOrgTicket(projectId, orgId, detail.ticketId, {
                        text: progressText.trim(),
                      });
                      setProgressText("");
                    })
                  }
                >
                  {S.company.tickets.addProgress}
                </Button>
              </div>
            </OrgSection>

            {/* Children and the rolled-up cost. */}
            <OrgSection
              title={`${S.company.tickets.children} · ${formatMoney(detail.rolledUpCost, currency)}`}
            >
              {children.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {S.company.tickets.childrenEmpty}
                </p>
              ) : (
                <ul className="space-y-1">
                  {children.map((c) => (
                    <li key={c.ticketId}>
                      <button
                        type="button"
                        onClick={() => onOpenTicket(c.ticketId)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        <span className="font-mono text-xs text-gray-400">{c.ticketId}</span>
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        {"status" in c && <TicketStatusBadge status={c.status} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {detail.parent !== undefined && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {S.company.tickets.parent}:{" "}
                  <button
                    type="button"
                    className="font-mono underline"
                    onClick={() => onOpenTicket(detail.parent!)}
                  >
                    {detail.parent}
                  </button>
                </p>
              )}
            </OrgSection>
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmSave}
        title={S.common.confirmSaveTitle}
        tone="primary"
        confirmLabel={S.common.save}
        busy={busy}
        onClose={() => (busy ? undefined : setConfirmSave(false))}
        onConfirm={save}
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
