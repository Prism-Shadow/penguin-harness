/**
 * Agent settings page "Schedule" tab: a table view over
 * agent_state/schedule/*.toml (status badge derived from run state; "next / last
 * fired" shown as two stacked rows) with the split create button at its head —
 * "Create with AI" describes the task to the Project's default agent in a new
 * conversation (AiCreateModal), "Set up manually" opens the shared form
 * (features/schedules/schedule-form-modal.tsx, also the panel's and the row menu's) —
 * and the everyday-schedule suggestions in place of an empty table.
 * Wrapping is controlled per column: compact cells (status, period, fire times,
 * queue, actions) are nowrap, long text cells (name, target) truncate with the
 * full value on hover, and the existing overflow-x-auto container takes over
 * below the table's min width.
 * Readable by any member; toggle/edit/delete are owner-only — PUT has whole-file
 * replace semantics, so toggling also resends every field and only flips `enabled`.
 *
 * Prompt-injection controls (usePromptInjection): the schedules.enabled switch, the
 * {{SCHEDULES}}-placeholder alert and the editable schedules.prompt section, mirroring the
 * Memory tab — owner-only, like the table edits. The prompt teaches the model to manage
 * task files itself; the toggle never stops the server from firing configured tasks.
 */
import { useCallback, useEffect, useState } from "react";
import type {
  ScheduleItem,
  SchedulesResponse,
  ScheduleStatus,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { useProject } from "../../state/project";
import { Badge, type BadgeTone } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { SettingsEmpty } from "../../components/ui/empty-state";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { AiCreateButton, AiCreateModal, CreateMenuButton } from "../ai-create";
import { ScheduleFormModal } from "../schedules/schedule-form-modal";
import { ScheduleSuggestions, scheduleExamples } from "../schedules/schedule-suggestions";
import { toggleBody } from "../schedules/schedule-upsert";
import { usePromptInjection } from "./prompt-injection-controls";
import { HelpFold } from "../../components/ui/help-fold";

/** Display status → badge tone. */
const STATUS_TONE: Record<ScheduleStatus, BadgeTone> = {
  active: "green",
  disabled: "gray",
  expired: "amber",
  done: "brand",
  missed: "amber",
  invalid: "red",
};

export function SchedulesTab({
  agentId,
  onConfigChanged,
}: {
  agentId: string;
  /** Config writes (toggle / prompt / placeholder insert) happen here directly, so the settings page must refetch its own copy — otherwise a later Prompt-tab save from stale data would silently revert them. */
  onConfigChanged?: () => void;
}) {
  const { currentProject, agents, reloadAgents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  // Prompt-injection controls follow the tab's existing gate: owner-only edits.
  const { applyConfig, toggleCard, alertStrip, promptSection } = usePromptInjection({
    agentId,
    feature: "schedules",
    strings: S.schedule.injection,
    canEdit: isOwner,
    onConfigChanged,
  });

  const [data, setData] = useState<SchedulesResponse | null>(null);
  // Tab-level error is only the initial list load failure; row/edit actions report via toast.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Form dialog: non-null means open (editing that row, or null for a new task).
  const [form, setForm] = useState<{ editing: ScheduleItem | null } | null>(null);
  // AI dialog: non-null means open, seeded with a suggestion's prompt or nothing.
  const [ai, setAi] = useState<{ initial: string } | null>(null);
  // Name of the task pending deletion confirmation (non-null shows the confirm modal).
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setData(null);
    setError(null);
    try {
      // The injection controls' state loads in parallel with the tab's own table.
      const [schedules, configView] = await Promise.all([
        api.listSchedules(projectId, agentId),
        api.getAgentConfig(projectId, agentId),
      ]);
      setData(schedules);
      applyConfig(configView.config);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, agentId, applyConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  /** After a create, update or delete: the table, and the agent card's schedule count. */
  const changed = () => {
    void load();
    void reloadAgents();
  };

  /** Toggle: whole-file-replace semantics — resend original fields, only flip enabled. */
  const toggle = async (item: ScheduleItem) => {
    if (!projectId) return;
    setBusy(true);
    try {
      await api.updateSchedule(projectId, agentId, item.name, toggleBody(item, !item.enabled));
      toastSuccess(S.agent.savedTakesEffect);
      await load();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Confirm modal's "Confirm": closes the modal after deletion; if the deleted task is currently being edited, close the form too. */
  const confirmRemove = async () => {
    if (!projectId || deleting === null) return;
    setBusy(true);
    try {
      await api.deleteSchedule(projectId, agentId, deleting);
      if (form?.editing?.name === deleting) setForm(null);
      changed();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  if (!projectId) return null;

  const schedules = data?.schedules ?? [];
  const invalidFiles = data?.invalidFiles ?? [];
  const openAi = (initial: string) => setAi({ initial });

  return (
    <div className="space-y-4">
      {/* Tab-level description: no title in the panel to anchor a "?" to (see help-fold.tsx). */}
      <HelpFold label={S.agent.tabSchedules}>
        {S.schedule.desc}
        {!isOwner && <span className="mt-1.5 block">{S.schedule.readOnlyHint}</span>}
      </HelpFold>

      {toggleCard}
      {alertStrip}

      {/* Create entry point at the head of the table, right-aligned (the skills tab's slot): the
          split button offers the AI path and the form; a member, who cannot write files here,
          still gets the AI path — asking the agent is a message, not a write. */}
      <div className="flex justify-end">
        {isOwner ? (
          <CreateMenuButton
            size="sm"
            label={S.schedule.newButton}
            onAi={() => openAi("")}
            onManual={() => setForm({ editing: null })}
          />
        ) : (
          <AiCreateButton size="sm" variant="primary" onClick={() => openAi("")} />
        )}
      </div>

      {data === null ? (
        <SkeletonList rows={4} />
      ) : schedules.length === 0 ? (
        <div className="space-y-4">
          <SettingsEmpty>{S.schedule.empty}</SettingsEmpty>
          {/* Nothing configured yet: the everyday schedules, each opening the AI dialog with its prompt filled in. */}
          <ScheduleSuggestions mode="agent" onPick={openAi} />
        </div>
      ) : (
        <div className="overflow-x-auto overflow-y-clip rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                <th className="whitespace-nowrap px-3 py-2.5">{S.common.name}</th>
                <th className="whitespace-nowrap px-3 py-2.5">{S.schedule.colStatus}</th>
                <th className="whitespace-nowrap px-3 py-2.5">{S.schedule.colPeriod}</th>
                <th className="whitespace-nowrap px-3 py-2.5">{S.schedule.colTarget}</th>
                <th className="whitespace-nowrap px-3 py-2.5">{S.schedule.colFireTimes}</th>
                <th className="whitespace-nowrap px-3 py-2.5">{S.schedule.colQueued}</th>
                {isOwner && <th className="px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {schedules.map((item) => (
                <tr
                  key={item.name}
                  className="border-b border-gray-100 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40"
                >
                  {/* Long text columns truncate with the full value on hover instead of wrapping. */}
                  <td className="max-w-40 truncate px-3 py-2 font-mono text-xs" title={item.name}>
                    {item.name}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {/* invalid reason is folded into the hover title. */}
                    <span title={item.invalidReason}>
                      <Badge tone={STATUS_TONE[item.status]}>
                        {S.schedule.statusNames[item.status] ?? item.status}
                      </Badge>
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                    {item.period !== undefined ? (
                      <span className="font-mono">{item.period}</span>
                    ) : (
                      S.schedule.once
                    )}
                  </td>
                  <td
                    className="max-w-36 truncate px-3 py-2 text-xs text-gray-500 dark:text-gray-400"
                    title={item.sessionId}
                  >
                    {item.sessionId !== undefined ? (
                      <span className="font-mono">{item.sessionId}</span>
                    ) : (
                      S.schedule.newSession
                    )}
                  </td>
                  {/* Deliberate two-line stack — top: next fire time; bottom: last fired time
                      (both show — when absent); nowrap keeps each line whole. */}
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    <span className="block text-gray-600 dark:text-gray-300">
                      {item.nextFireAt ? formatDateTime(item.nextFireAt) : "—"}
                    </span>
                    <span className="block text-gray-400 dark:text-gray-500">
                      {item.lastFiredAt ? formatDateTime(item.lastFiredAt) : "—"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {item.queued && <Badge tone="brand">{S.schedule.queued}</Badge>}
                  </td>
                  {isOwner && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void toggle(item)}
                      >
                        {item.enabled ? S.schedule.disable : S.schedule.enable}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setForm({ editing: item })}
                      >
                        {S.common.edit}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setDeleting(item.name)}
                      >
                        {S.common.delete}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {invalidFiles.length > 0 && (
        <div className="text-xs text-red-600 dark:text-red-400">
          <p className="font-medium">{S.schedule.invalidFiles}</p>
          <ul className="mt-0.5 space-y-0.5 font-mono">
            {invalidFiles.map((f) => (
              <li key={f.name}>
                {f.name}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {promptSection}

      {/* Shared create/edit form (the inline "Edit" buttons reuse it with the row prefilled). */}
      <ScheduleFormModal
        open={form !== null}
        agentId={agentId}
        editing={form?.editing ?? null}
        onClose={() => setForm(null)}
        onSaved={changed}
      />

      {/* "Create with AI": the task is described to the Project's default agent in a new
          conversation, with the tail naming this agent as the one the task is created for. */}
      <AiCreateModal
        open={ai !== null}
        onClose={() => setAi(null)}
        title={S.schedule.aiCreateTitle}
        description={S.schedule.aiCreateDesc}
        initialValue={ai?.initial ?? ""}
        examples={scheduleExamples("agent")}
        tail={S.schedule.aiCreateTail(agentId)}
        agents={agents}
      />

      {/* Delete confirmation (shared ConfirmModal, same pattern as Vault / Agent deletion). */}
      <ConfirmModal
        open={deleting !== null}
        title={S.schedule.deleteTitle}
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmRemove()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting !== null ? S.schedule.deleteConfirm(deleting) : ""}
        </p>
      </ConfirmModal>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
