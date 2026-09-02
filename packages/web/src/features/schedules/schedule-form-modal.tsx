/**
 * The create / edit form of a scheduled task, shared by the Agent settings Schedule tab, the
 * chat dock's scheduled-tasks panel and the Session row menu's "Set up manually". startAt /
 * endAt are datetime-local inputs (local timezone) converted to ISO 8601 on submit; the
 * "new Session each run" mode can also pick a Model — always a complete (provider, modelId)
 * pair, since provider is never inferred; omitting it entirely follows the Project default —
 * and a Workspace. `lockedSessionId` pins the target to one Session: the target picker becomes
 * a read-only line and the new-Session fields stay hidden. Mutual exclusivity of sessionId
 * with workspace / model is validated server-side.
 *
 * Mounted fresh on every open (like AiCreateModal), so the form starts from its `editing` item
 * or from an empty form each time. Writes are owner-only server-side; a member's submit shows
 * the rejection under the form.
 */
import { useEffect, useState } from "react";
import type {
  ModelInfo,
  ModelRefDto,
  ScheduleItem,
  ScheduleUpsertRequest,
  SessionInfo,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Modal } from "../../components/ui/modal";
import { FormPicker } from "../../components/ui/form-picker";
import { FieldError, FieldHint, FieldLabel } from "../../components/ui/field";
import { toastInfo, toastSuccess } from "../../components/ui/toast";
import { ModelSelect, PickerList } from "../chat/model-select";
import { WorkspaceSelect } from "../chat/workspace-select";
import { sameModelRef } from "../models/model-grouping";
import { itemModelRef } from "./schedule-upsert";

/** ISO → datetime-local input value (local timezone, minute precision); returns "" when missing/invalid. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Form state (shared by create/edit): non-null editing means editing that task (name locked). */
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

export interface ScheduleFormModalProps {
  open: boolean;
  agentId: string;
  /** The task being edited — its fields prefill the form and its name is locked; null creates a new task. */
  editing: ScheduleItem | null;
  /** Pins the target to this Session (see the module header). */
  lockedSessionId?: string;
  onClose: () => void;
  /** After a successful create or update; the dialog has already closed. */
  onSaved: () => void;
}

export function ScheduleFormModal(props: ScheduleFormModalProps) {
  // Mounted only while open, so the form starts fresh every time.
  return props.open ? <ScheduleFormDialog {...props} /> : null;
}

/** The form as it opens: the edited task's fields, or an empty form — pinned when a Session is locked. */
function initialForm(editing: ScheduleItem | null, lockedSessionId: string | undefined): FormState {
  const pinned =
    lockedSessionId !== undefined ? { target: "session" as const, sessionId: lockedSessionId } : {};
  if (editing === null) return { ...EMPTY_FORM, ...pinned };
  return {
    editing: editing.name,
    name: editing.name,
    prompt: editing.prompt,
    enabled: editing.enabled,
    startAt: toLocalInput(editing.startAt),
    endAt: toLocalInput(editing.endAt),
    period: editing.period ?? "",
    target: editing.sessionId ? "session" : "new",
    sessionId: editing.sessionId ?? "",
    workspace: editing.workspace ?? "",
    // A schedule that follows the Project default stores no model; the default takes its
    // place in the picker once the model list arrives (ModelSelect has no null state).
    model: itemModelRef(editing),
    ...pinned,
  };
}

function ScheduleFormDialog({
  open,
  agentId,
  editing,
  lockedSessionId,
  onClose,
  onSaved,
}: ScheduleFormModalProps) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const [form, setForm] = useState<FormState>(() => initialForm(editing, lockedSessionId));
  // The form as opened — an edit submit with nothing changed reports "no changes" instead of rewriting the file.
  const [opened, setOpened] = useState<FormState>(form);
  // Per-field required errors sit next to their input; formError holds a submit rejection that isn't attributable to one field.
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    prompt?: string;
    startAt?: string;
    sessionId?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Model dropdown data; a load failure doesn't block the form — falling back to "Project default" is fine.
  const [models, setModels] = useState<ModelInfo[]>([]);
  // The Project default model reference, kept so ModelSelect can mark it and so the form can
  // treat "the default is selected" as "follow the default" (omit the model from the body).
  const [defaultModel, setDefaultModel] = useState<ModelRefDto | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .getModels(projectId)
      .then((res) => {
        if (cancelled) return;
        setModels(res.models);
        const def = res.defaultModel ?? null;
        setDefaultModel(def);
        // A form that follows the default shows the default in the picker; the submit body
        // treats a selected default as "follow the default" again and omits it. The opening
        // snapshot moves with the form, so an untouched edit still reports "no changes".
        if (def) {
          const seed = (f: FormState) => (f.model === null ? { ...f, model: def } : f);
          setForm(seed);
          setOpened(seed);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setModels([]);
        setDefaultModel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const set = (patch: Partial<FormState>) => {
    setFieldErrors((p) => (p.name || p.prompt || p.startAt || p.sessionId ? {} : p));
    setFormError((p) => (p ? null : p));
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const submit = async () => {
    if (!projectId) return;
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
    // sides are FormState built the same way, so a field-wise JSON compare is exact).
    if (form.editing !== null && JSON.stringify(form) === JSON.stringify(opened)) {
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
      // so a later change to the default keeps flowing through.
      ...(form.target === "new" && form.model && !sameModelRef(defaultModel, form.model)
        ? { modelId: form.model.modelId, provider: form.model.provider }
        : {}),
    };
    setBusy(true);
    try {
      if (form.editing !== null) await api.updateSchedule(projectId, agentId, form.editing, body);
      else await api.createSchedule(projectId, agentId, { name, ...body });
      toastSuccess(S.agent.savedTakesEffect);
      onClose();
      onSaved();
    } catch (e) {
      // A 400 (validated with the same rules as hand-written files) isn't tied to one field — show it under the form.
      setFormError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!projectId) return null;

  return (
    <Modal
      open={open}
      title={form.editing !== null ? S.schedule.editTitle(form.editing) : S.schedule.addTitle}
      onClose={onClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {form.editing !== null ? S.common.save : S.common.create}
          </Button>
        </>
      }
    >
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
          {lockedSessionId !== undefined ? (
            // Pinned to one Session: the target is a fact of where the form was opened — shown, not chosen.
            <div>
              <FieldLabel>{S.schedule.target}</FieldLabel>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                {S.schedule.targetThisSession}
                <span className="ml-1.5 font-mono text-[11px] text-gray-400 dark:text-gray-500">
                  {lockedSessionId.slice(-6)}
                </span>
              </p>
            </div>
          ) : (
            <>
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
                // Searchable Session picker (dropdown): the schedule binds to an existing
                // conversation, and typing its id by hand was both error-prone and unsearchable.
                <div>
                  <FieldLabel required>{S.schedule.sessionId}</FieldLabel>
                  <SessionSelect
                    projectId={projectId}
                    agentId={agentId}
                    value={form.sessionId}
                    onChange={(sessionId) => set({ sessionId })}
                  />
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
                      projectId={projectId}
                      workspace={form.workspace}
                      onChange={(workspace) => set({ workspace })}
                      variant="form"
                    />
                    <FieldHint>{S.chat.workspaceHintShort}</FieldHint>
                  </div>
                </>
              )}
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
    </Modal>
  );
}
