/**
 * One scheduled task, in full: what a row of the Project-wide list cannot show — the whole
 * prompt, the exact window it runs in, the Session it is bound to, the model and Workspace a
 * new Session would open with, and, for a file that failed to parse, the reason.
 *
 * The row click is the way in (the Project list has one row per task and no room for the
 * prompt); editing is the way out — Edit hands the task to the shared form
 * (schedule-form-modal.tsx), which is the only place a task is written, so this dialog never
 * duplicates the form's rules. Fire-now, enable/disable and delete stay here, owner-only like
 * every other write: toggling goes through the same whole-file-replace semantics the settings
 * tab uses (resends every field with `enabled` flipped — toggleBody), firing is an extra run
 * that never consumes the schedule (fireSchedule, errors mapped by fireErrorText).
 */
import { useState } from "react";
import type {
  ProjectScheduleItem,
  ScheduleItem,
  ScheduleStatus,
} from "@prismshadow/penguin-server/api";
import {
  Badge,
  Button,
  ConfirmModal,
  Modal,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import type { BadgeStyle } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { describeInstant, describePeriod } from "./schedule-describe";
import { autoPauseReasonOf } from "./schedule-panel-state";
import { fireErrorText, shortSession } from "./schedule-fire";
import { toggleBody } from "./schedule-upsert";

/** Display status → badge, the same mapping the page's table and the settings tab use. */
const STATUS_BADGE: Record<ScheduleStatus | "auto_paused", BadgeStyle> = {
  active: { tone: "success" },
  disabled: { tone: "neutral" },
  expired: { tone: "attention" },
  done: { tone: "neutral", variant: "solid" },
  missed: { tone: "attention" },
  invalid: { tone: "danger" },
  auto_paused: { tone: "attention" },
};

/** One label/value line of the definition list. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5">
      <span className="w-24 shrink-0 text-xs text-fg-muted">{label}</span>
      <span className="min-w-0 flex-1 break-words text-xs">{children}</span>
    </div>
  );
}

/** The plan in everyday words, the same wording the page's Plan column uses. */
function planOf(item: ScheduleItem, locale: "zh" | "en"): string {
  return item.period === undefined
    ? S.schedule.human.once(describeInstant(item.startAt, locale, new Date()))
    : describePeriod(item.period, item.nextFireAt ?? item.startAt, locale);
}

export function ScheduleDetailDialog({
  item,
  onClose,
  onEdit,
  onChanged,
}: {
  /** The task on screen; null keeps the dialog unmounted (Modal is controlled by the caller). */
  item: ProjectScheduleItem | null;
  onClose: () => void;
  /** Opens the shared form on this task. The caller closes this dialog first, so the two never stack. */
  onEdit: (item: ProjectScheduleItem) => void;
  /** After a write: the list is re-read (the store's own refresh), so the row and the marks agree. */
  onChanged: () => void;
}) {
  const { currentProject } = useProject();
  const { locale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (item === null) return null;
  const projectId = currentProject?.projectId ?? null;
  // Same gate as the settings tab and the dock panel: a member reads, the owner writes.
  const canEdit = currentProject?.role === "owner" && projectId !== null;

  const toggle = async () => {
    if (projectId === null) return;
    setBusy(true);
    try {
      await api.updateSchedule(projectId, item.agentId, item.name, toggleBody(item, !item.enabled));
      toastSuccess(item.enabled ? S.schedule.toastDisabled : S.schedule.toastEnabled);
      onChanged();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Fire once now: an extra run (queued when the target is busy), then re-read so the last-fired time agrees. */
  const fire = async () => {
    if (projectId === null) return;
    setBusy(true);
    try {
      const fired = await api.fireSchedule(projectId, item.agentId, item.name);
      const short = shortSession(fired.sessionId);
      toastSuccess(fired.queued ? S.schedule.toastQueued(short) : S.schedule.toastFired(short));
      onChanged();
    } catch (e) {
      toastError(fireErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (projectId === null) return;
    setBusy(true);
    try {
      await api.deleteSchedule(projectId, item.agentId, item.name);
      setConfirmingDelete(false);
      onChanged();
      onClose();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open
        title={`${S.schedulesPage.detailTitle} · ${item.name}`}
        onClose={onClose}
        widthClass="sm:max-w-xl"
        footer={
          <>
            {canEdit && (
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                {S.common.delete}
              </Button>
            )}
            <div className="grow" />
            {canEdit && (
              <Button
                size="sm"
                disabled={busy || item.status === "invalid"}
                title={item.status === "invalid" ? S.schedule.fireInvalidHint : undefined}
                onClick={() => void fire()}
              >
                {S.schedule.fireNow}
              </Button>
            )}
            {canEdit && (
              <Button size="sm" disabled={busy} onClick={() => void toggle()}>
                {item.enabled ? S.schedule.disable : S.schedule.enable}
              </Button>
            )}
            <Button
              size="sm"
              variant={canEdit ? "primary" : "secondary"}
              disabled={busy}
              onClick={canEdit ? () => onEdit(item) : onClose}
            >
              {canEdit ? S.common.edit : S.common.close}
            </Button>
          </>
        }
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge {...STATUS_BADGE[item.status]}>
              {S.schedule.statusNames[item.status] ?? item.status}
            </Badge>
            {item.queued && <Badge variant="solid">{S.schedule.queued}</Badge>}
            <span className="font-mono text-xs text-fg-muted">{item.agentId}</span>
          </div>

          <div className="mt-3 divide-y divide-line-muted border-y border-line-muted">
            <Row label={S.schedulesPage.detailAgent}>{item.agentId}</Row>
            <Row label={S.schedule.colPeriod}>
              {planOf(item, locale)}
              {item.period !== undefined && (
                <span className="ml-2 font-mono text-fg-muted">{item.period}</span>
              )}
            </Row>
            <Row label={S.schedule.colTarget}>
              {item.sessionId === undefined ? (
                S.schedule.newSession
              ) : (
                <span className="font-mono">{item.sessionId}</span>
              )}
            </Row>
            <Row label={S.schedule.colFireTimes}>
              <span className="block">
                {S.schedulesPage.colNext}:{" "}
                {item.nextFireAt === undefined ? "—" : formatDateTime(item.nextFireAt)}
              </span>
              <span className="block text-fg-muted">
                {S.schedulesPage.colLast}:{" "}
                {item.lastFiredAt === undefined ? "—" : formatDateTime(item.lastFiredAt)}
              </span>
            </Row>
            <Row label={S.schedulesPage.detailStart}>{formatDateTime(item.startAt)}</Row>
            {item.endAt !== undefined && (
              <Row label={S.schedulesPage.detailEnd}>{formatDateTime(item.endAt)}</Row>
            )}
            {item.workspace !== undefined && (
              <Row label={S.schedulesPage.detailWorkspace}>
                <span className="font-mono">{item.workspace}</span>
              </Row>
            )}
            {item.modelId !== undefined && (
              <Row label={S.schedulesPage.detailModel}>
                <span className="font-mono">
                  {item.provider === undefined ? item.modelId : `${item.provider}/${item.modelId}`}
                </span>
              </Row>
            )}
            {item.invalidReason !== undefined && (
              <Row label={S.schedule.statusNames.invalid ?? item.status}>
                <span className="text-red-600 dark:text-red-400">{item.invalidReason}</span>
              </Row>
            )}
            {autoPauseReasonOf(item) !== undefined && (
              <Row label={S.schedule.statusNames.auto_paused ?? item.status}>
                <span className="text-amber-600 dark:text-amber-400">
                  {autoPauseReasonOf(item)}
                </span>
              </Row>
            )}
          </div>

          <p className="mt-3 text-xs text-fg-muted">{S.schedulesPage.detailPrompt}</p>
          {/* The prompt is the task: shown whole, scrolled rather than truncated, and selectable
              so it can be copied out (a long prompt is not edited here — Edit is). */}
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-control-well p-3 font-mono text-xs">
            {item.prompt}
          </pre>

          {canEdit && (
            <p className="mt-3 text-xs text-fg-muted">{S.schedulesPage.detailEditHint}</p>
          )}
          {!canEdit && <p className="mt-3 text-xs text-fg-muted">{S.schedule.readOnlyHint}</p>}
        </div>
      </Modal>

      <ConfirmModal
        open={confirmingDelete}
        title={S.schedule.deleteTitle}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
        busy={busy}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void remove()}
      >
        {S.schedule.deleteConfirm(item.name)}
      </ConfirmModal>
    </>
  );
}
