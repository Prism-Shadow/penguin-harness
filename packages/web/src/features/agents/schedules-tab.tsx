/**
 * Agent settings page "Schedule" tab: a table view over
 * agent_state/schedule/*.toml (status badge derived from run state; "next / last
 * fired" shown as two stacked rows) plus a shared create/edit modal form.
 * Wrapping is controlled per column: compact cells (status, period, fire times,
 * queue, actions) are nowrap, long text cells (name, target) truncate with the
 * full value on hover, and the existing overflow-x-auto container takes over
 * below the table's min width.
 * Readable by any member; toggle/edit/delete are owner-only — PUT has whole-file
 * replace semantics, so toggling also resends every field and only flips `enabled`.
 * startAt/endAt use datetime-local inputs (local timezone), converted to ISO 8601 on
 * submit; the "new Session each run" mode can also pick a Model — always a complete
 * (provider, modelId) pair, since provider is never inferred; omitting it entirely falls
 * back to the Project default. Mutual exclusivity with sessionId is validated server-side.
 *
 * Prompt-injection controls (usePromptInjection): the schedules.enabled switch, the
 * {{SCHEDULES}}-placeholder alert and the editable schedules.prompt section, mirroring the
 * Memory tab — owner-only, like the table edits. The prompt teaches the model to manage
 * task files itself; the toggle never stops the server from firing configured tasks.
 */
import { useCallback, useEffect, useState } from "react";
import type {
  ModelInfo,
  ModelRefDto,
  ScheduleItem,
  SchedulesResponse,
  ScheduleStatus,
  ScheduleUpsertRequest,
  SessionInfo,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { useProject } from "../../state/project";
import { Badge, type BadgeTone } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { SettingsEmpty } from "../../components/ui/empty-state";
import { SkeletonList } from "../../components/ui/skeleton";
import { FormPicker } from "../../components/ui/form-picker";
import { FieldError, FieldHint, FieldLabel } from "../../components/ui/field";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { ModelSelect, PickerList } from "../chat/model-select";
import { WorkspaceSelect } from "../chat/workspace-select";
import { sameModelRef } from "../models/model-grouping";
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

/** ISO → datetime-local input value (local timezone, minute precision); returns "" when missing/invalid. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Stored schedule fields → a model reference. A reference is always the complete
 * (provider, model_id) pair, since provider is never inferred: the DTO types the two
 * fields independently, so this guard is what keeps the form and the upsert body from
 * ever assembling half a reference. A file that sets only one half is rejected by the
 * server when parsed (it surfaces under invalidFiles, never as a listed row), so in
 * practice this returns null only when the schedule uses the Project's default model.
 */
const itemModelRef = (item: Pick<ScheduleItem, "provider" | "modelId">): ModelRefDto | null =>
  item.modelId && item.provider ? { provider: item.provider, modelId: item.modelId } : null;

/** Modal form state (shared by create/edit): non-null editing means editing that task (name locked). */
interface FormState {
  editing: string | null;
  name: string;
  prompt: string;
  enabled: boolean;
  /** datetime-local input value (converted to ISO on submit). */
  startAt: string;
  endAt: string;
  period: string;
  target: "new" | "session";
  sessionId: string;
  workspace: string;
  /** Model for the new-Session mode (null = Project default, provider and modelId both omitted). */
  model: ModelRefDto | null;
}

const EMPTY_FORM: FormState = {
  editing: null,
  name: "",
  prompt: "",
  enabled: true,
  startAt: "",
  endAt: "",
  period: "",
  target: "new",
  sessionId: "",
  workspace: "",
  model: null,
};

/** Case-insensitive match of a Session by its title and its id (mirrors filterAgents in agent-handoff.ts). */
function filterSessions(sessions: SessionInfo[], query: string): SessionInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter(
    (s) => s.sessionId.toLowerCase().includes(q) || (s.title ?? "").toLowerCase().includes(q),
  );
}

/**
 * Searchable Session picker for the bind-to-Session mode: the shared FormPicker (same
 * trigger look as ModelSelect/WorkspaceSelect) whose panel is the shared PickerList (search
 * box + keyboard nav). The Agent's full Session list is fetched once when the picker first
 * opens — un-paged, mirroring how the form one-shots getModels — so search covers every
 * Session rather than only the sidebar's loaded active page. The stored value is still the
 * plain sessionId; the trigger resolves it to the Session's title for display.
 */
function SessionSelect({
  projectId,
  agentId,
  value,
  onChange,
}: {
  projectId: string;
  agentId: string;
  value: string;
  onChange: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);

  // Load lazily on first open, then keep the snapshot; a failed fetch degrades to an empty
  // list (the user can still see the currently-bound id on the trigger and cancel out).
  useEffect(() => {
    if (!open || sessions !== null) return;
    let cancelled = false;
    api
      .listSessions(projectId, agentId)
      .then((res) => {
        if (!cancelled) setSessions(res.sessions);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessions, projectId, agentId]);

  const selected = sessions?.find((s) => s.sessionId === value) ?? null;
  const label = selected
    ? (selected.title ?? S.chat.defaultSessionTitle)
    : value || S.schedule.chooseSession;

  return (
    <FormPicker
      open={open}
      setOpen={setOpen}
      label={label}
      muted={!value}
      title={value ? `${S.schedule.sessionId}：${value}` : S.schedule.chooseSession}
      ariaLabel={S.schedule.chooseSession}
      ariaHaspopup="listbox"
      menuClass="w-80 origin-top-left"
    >
      {sessions === null ? (
        <p className="px-3 py-2 text-xs text-gray-400">{S.common.loading}</p>
      ) : sessions.length === 0 ? (
        <p className="px-3 py-2 text-xs text-gray-400">{S.schedule.sessionEmpty}</p>
      ) : (
        <PickerList
          items={filterSessions(sessions, query)}
          itemKey={(s) => s.sessionId}
          isCurrent={(s) => s.sessionId === value}
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder={S.schedule.sessionSearch}
          emptyText={S.schedule.sessionNoMatch}
          onPick={(s) => {
            onChange(s.sessionId);
            setOpen(false);
          }}
          renderRow={(s) => (
            <>
              <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">
                {s.title ?? S.chat.defaultSessionTitle}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500">
                {s.sessionId.slice(-6)}
              </span>
            </>
          )}
        />
      )}
    </FormPicker>
  );
}

export function SchedulesTab({
  agentId,
  onConfigChanged,
}: {
  agentId: string;
  /** Config writes (toggle / prompt / placeholder insert) happen here directly, so the settings page must refetch its own copy — otherwise a later Prompt-tab save from stale data would silently revert them. */
  onConfigChanged?: () => void;
}) {
  const { currentProject, reloadAgents } = useProject();
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
  // Modal form: non-null means open (EMPTY_FORM for create / prefilled row for edit).
  const [form, setForm] = useState<FormState | null>(null);
  // The form as opened — an edit submit with nothing changed reports "no changes" instead of rewriting the file.
  const [initialForm, setInitialForm] = useState<FormState | null>(null);
  // Per-field required errors sit next to their input; formError holds a submit rejection that isn't attributable to one field.
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    prompt?: string;
    startAt?: string;
    sessionId?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Name of the task pending deletion confirmation (non-null shows the confirm modal).
  const [deleting, setDeleting] = useState<string | null>(null);
  // Model dropdown data (needed only for owners); load failure doesn't block the form — falling back to "Project default" is fine.
  const [models, setModels] = useState<ModelInfo[]>([]);
  // The Project default model reference, kept so ModelSelect can mark it and so the form can
  // treat "the default is selected" as "follow the default" (omit the model from the body).
  const [defaultModel, setDefaultModel] = useState<ModelRefDto | null>(null);

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

  useEffect(() => {
    if (!projectId || !isOwner) return;
    api
      .getModels(projectId)
      .then((res) => {
        setModels(res.models);
        setDefaultModel(res.defaultModel ?? null);
      })
      .catch(() => {
        setModels([]);
        setDefaultModel(null);
      });
  }, [projectId, isOwner]);

  const set = (patch: Partial<FormState>) => {
    setFieldErrors((p) => (p.name || p.prompt || p.startAt || p.sessionId ? {} : p));
    setFormError((p) => (p ? null : p));
    setForm((prev) => (prev === null ? prev : { ...prev, ...patch }));
  };

  const openForm = (next: FormState) => {
    setFieldErrors({});
    setFormError(null);
    setForm(next);
    setInitialForm(next);
  };

  const submit = async () => {
    if (!projectId || form === null) return;
    setFormError(null);
    const name = form.editing ?? form.name.trim();
    // sessionId is required in bind-to-Session mode — leaving it blank would silently downgrade to "new Session", changing the user's intended choice.
    const next: { name?: string; prompt?: string; startAt?: string; sessionId?: string } = {};
    if (!name) next.name = S.common.requiredField;
    if (!form.prompt.trim()) next.prompt = S.common.requiredField;
    if (!form.startAt) next.startAt = S.common.requiredField;
    if (form.target === "session" && !form.sessionId.trim())
      next.sessionId = S.common.requiredField;
    if (next.name || next.prompt || next.startAt || next.sessionId) {
      setFieldErrors(next);
      return;
    }
    setFieldErrors({});
    // Editing with nothing changed: report it instead of rewriting the same file (both
    // sides are FormState built by openForm, so a field-wise JSON compare is exact).
    if (form.editing !== null && JSON.stringify(form) === JSON.stringify(initialForm)) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    // Empty-string keys are always omitted; target is one of two choices — sessionId is
    // sent only when binding to a Session, and workspace plus the model reference
    // (modelId + provider pair) only when creating a new Session.
    const body: ScheduleUpsertRequest = {
      prompt: form.prompt,
      enabled: form.enabled,
      startAt: new Date(form.startAt).toISOString(),
      ...(form.period.trim() ? { period: form.period.trim() } : {}),
      ...(form.endAt ? { endAt: new Date(form.endAt).toISOString() } : {}),
      ...(form.target === "session" && form.sessionId.trim()
        ? { sessionId: form.sessionId.trim() }
        : {}),
      ...(form.target === "new" && form.workspace.trim()
        ? { workspace: form.workspace.trim() }
        : {}),
      // Model is sent only when it differs from the Project default: selecting the default
      // (or leaving it) means "follow the Project default", stored by omitting the pair —
      // so a later change to the default keeps flowing through (matches the header note).
      ...(form.target === "new" && form.model && !sameModelRef(defaultModel, form.model)
        ? { modelId: form.model.modelId, provider: form.model.provider }
        : {}),
    };
    setBusy(true);
    try {
      if (form.editing !== null) await api.updateSchedule(projectId, agentId, form.editing, body);
      else await api.createSchedule(projectId, agentId, { name, ...body });
      setForm(null);
      toastSuccess(S.common.saved);
      await load();
      // A created schedule moves the agent card's count; refresh the list provider too.
      void reloadAgents();
    } catch (e) {
      // A 400 (validated with the same rules as hand-written files) isn't tied to one field — show it under the modal form.
      setFormError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Toggle: whole-file-replace semantics — resend original fields, only flip enabled. */
  const toggle = async (item: ScheduleItem) => {
    if (!projectId) return;
    setBusy(true);
    const model = itemModelRef(item);
    try {
      await api.updateSchedule(projectId, agentId, item.name, {
        prompt: item.prompt,
        enabled: !item.enabled,
        startAt: item.startAt,
        ...(item.period !== undefined ? { period: item.period } : {}),
        ...(item.endAt !== undefined ? { endAt: item.endAt } : {}),
        ...(item.sessionId !== undefined ? { sessionId: item.sessionId } : {}),
        ...(item.workspace !== undefined ? { workspace: item.workspace } : {}),
        // Model reference is resent as a whole pair or not at all — never half of one.
        ...(model ? { modelId: model.modelId, provider: model.provider } : {}),
      });
      toastSuccess(S.common.saved);
      await load();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Edit: prefill this row into the modal form (submits via PUT; the model reference is prefilled only as a complete pair). */
  const startEdit = (item: ScheduleItem) => {
    openForm({
      editing: item.name,
      name: item.name,
      prompt: item.prompt,
      enabled: item.enabled,
      startAt: toLocalInput(item.startAt),
      endAt: toLocalInput(item.endAt),
      period: item.period ?? "",
      target: item.sessionId ? "session" : "new",
      sessionId: item.sessionId ?? "",
      workspace: item.workspace ?? "",
      // A schedule that follows the Project default stores no model; show the current
      // default in the picker (ModelSelect has no null state), which the submit body then
      // treats as "follow default" again and omits.
      model: itemModelRef(item) ?? defaultModel,
    });
  };

  /** Confirm modal's "Confirm": closes the modal after deletion; if the deleted task is currently being edited, close the form too. */
  const confirmRemove = async () => {
    if (!projectId || deleting === null) return;
    setBusy(true);
    try {
      await api.deleteSchedule(projectId, agentId, deleting);
      if (form?.editing === deleting) setForm(null);
      await load();
      // The agent card's schedule count changed; refresh the list provider too.
      void reloadAgents();
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

  return (
    <div className="space-y-4">
      {/* Tab-level description: no title in the panel to anchor a "?" to (see help-fold.tsx). */}
      <HelpFold label={S.agent.tabSchedules}>
        {S.schedule.desc}
        {!isOwner && <span className="mt-1.5 block">{S.schedule.readOnlyHint}</span>}
      </HelpFold>

      {toggleCard}
      {alertStrip}

      {data === null ? (
        <SkeletonList rows={4} />
      ) : schedules.length === 0 ? (
        <SettingsEmpty>{S.schedule.empty}</SettingsEmpty>
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
                        onClick={() => startEdit(item)}
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

      {/* Create entry point (owner): the form lives in a modal; the inline "Edit" button reuses the same modal. */}
      {isOwner && data !== null && (
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() => openForm({ ...EMPTY_FORM, model: defaultModel })}
        >
          {S.schedule.addTitle}
        </Button>
      )}

      {promptSection}

      {/* Shared create/edit modal form. */}
      <Modal
        open={form !== null}
        title={form?.editing != null ? S.schedule.editTitle(form.editing) : S.schedule.addTitle}
        onClose={() => setForm(null)}
        widthClass="sm:max-w-lg"
        footer={
          <>
            <Button onClick={() => setForm(null)}>{S.common.cancel}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void submit()}>
              {form?.editing != null ? S.common.save : S.common.create}
            </Button>
          </>
        }
      >
        {form !== null && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input
                size="sm"
                label={S.common.name}
                required
                hint={S.schedule.nameHint}
                error={fieldErrors.name}
                value={form.name}
                disabled={form.editing !== null}
                onChange={(e) => set({ name: e.target.value })}
                className="font-mono"
                placeholder="daily_report"
                autoComplete="off"
              />
              <Input
                size="sm"
                label={S.schedule.period}
                value={form.period}
                onChange={(e) => set({ period: e.target.value })}
                className="font-mono"
                placeholder={S.schedule.periodPlaceholder}
                autoComplete="off"
              />
              <Input
                size="sm"
                label={S.schedule.startAt}
                required
                type="datetime-local"
                error={fieldErrors.startAt}
                value={form.startAt}
                onChange={(e) => set({ startAt: e.target.value })}
                className="font-mono"
              />
              <Input
                size="sm"
                label={S.schedule.endAt}
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => set({ endAt: e.target.value })}
                className="font-mono"
              />
              <Select
                size="sm"
                label={S.schedule.target}
                value={form.target}
                onChange={(e) => set({ target: e.target.value as FormState["target"] })}
              >
                <option value="new">{S.schedule.targetNew}</option>
                <option value="session">{S.schedule.targetSession}</option>
              </Select>
              {form.target === "session" ? (
                // Searchable Session picker (dropdown), replacing the raw id text input: the
                // schedule binds to an existing conversation, and typing its id by hand was
                // both error-prone and unsearchable.
                <div>
                  <FieldLabel required>{S.schedule.sessionId}</FieldLabel>
                  {projectId && (
                    <SessionSelect
                      projectId={projectId}
                      agentId={agentId}
                      value={form.sessionId}
                      onChange={(sessionId) => set({ sessionId })}
                    />
                  )}
                  {fieldErrors.sessionId && <FieldError>{fieldErrors.sessionId}</FieldError>}
                </div>
              ) : (
                // New-Session mode: Model and Workspace use the same form-variant pickers as
                // the Project default-settings dialog (ModelSelect / WorkspaceSelect), so the
                // two surfaces read identically.
                <>
                  <div>
                    <FieldLabel>{S.schedule.model}</FieldLabel>
                    {models.length > 0 ? (
                      <ModelSelect
                        models={models}
                        value={form.model}
                        {...(defaultModel ? { defaultModel } : {})}
                        onChange={(ref) => set({ model: ref })}
                        disabled={busy}
                        variant="form"
                      />
                    ) : (
                      <p className="text-xs text-gray-400">{S.schedule.modelDefault}</p>
                    )}
                  </div>
                  <div>
                    <FieldLabel>{S.schedule.workspace}</FieldLabel>
                    <WorkspaceSelect
                      projectId={projectId ?? ""}
                      workspace={form.workspace}
                      onChange={(workspace) => set({ workspace })}
                      variant="form"
                    />
                    <FieldHint>{S.chat.workspaceHintShort}</FieldHint>
                  </div>
                </>
              )}
            </div>
            <Textarea
              label={S.schedule.prompt}
              required
              size="sm"
              rows={4}
              error={fieldErrors.prompt}
              value={form.prompt}
              onChange={(e) => set({ prompt: e.target.value })}
            />
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => set({ enabled: e.target.checked })}
              />
              {S.schedule.enabled}
            </label>
            {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
          </div>
        )}
      </Modal>

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
