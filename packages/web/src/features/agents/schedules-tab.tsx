/**
 * Agent settings page "Schedule" tab: a table view over
 * agent_state/schedule/*.toml (status badge derived from run state; "next / last
 * fired" shown as two stacked rows) plus a shared create/edit modal form.
 * Readable by any member; toggle/edit/delete are owner-only — PUT has whole-file
 * replace semantics, so toggling also resends every field and only flips `enabled`.
 * startAt/endAt use datetime-local inputs (local timezone), converted to ISO 8601 on
 * submit; the "new Session each run" mode can also pick a Model — always a complete
 * (provider, modelId) pair, since provider is never inferred; omitting it entirely falls
 * back to the Project default. Mutual exclusivity with sessionId is validated server-side.
 */
import { useCallback, useEffect, useState } from "react";
import type {
  ModelInfo,
  ModelRefDto,
  ScheduleItem,
  SchedulesResponse,
  ScheduleStatus,
  ScheduleUpsertRequest,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { formatDateTime } from "../../lib/format";
import { useProject } from "../../state/project";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { Badge, type BadgeTone } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Modal } from "../../components/ui/modal";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";

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
 * Model reference ↔ native select option value: encoded as a JSON array
 * ([provider, modelId]), used only as a transient DOM-value serialization —
 * it never enters storage or requests; the persisted/submitted data still keeps
 * provider and modelId as two separate fields (no concatenation anywhere in the
 * pipeline). "" means the Project default.
 */
const modelOptionValue = (ref: ModelRefDto): string => JSON.stringify([ref.provider, ref.modelId]);

const parseModelOption = (v: string): ModelRefDto | null => {
  if (!v) return null;
  const [provider, modelId] = JSON.parse(v) as [string, string];
  return { provider, modelId };
};

/** Display label for a model option: upstream id + provider name (shown side by side, not a composite id). */
const modelOptionLabel = (ref: ModelRefDto): string =>
  `${ref.modelId} · ${providerInfo(ref.provider)?.label ?? ref.provider}`;

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

export function SchedulesTab({ agentId }: { agentId: string }) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";

  const [data, setData] = useState<SchedulesResponse | null>(null);
  // Tab-level error is only the initial list load failure; row/edit actions report via toast.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Modal form: non-null means open (EMPTY_FORM for create / prefilled row for edit).
  const [form, setForm] = useState<FormState | null>(null);
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

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setData(null);
    setError(null);
    try {
      setData(await api.listSchedules(projectId, agentId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : S.common.unknownError);
    }
  }, [projectId, agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!projectId || !isOwner) return;
    api
      .getModels(projectId)
      .then((res) => setModels(res.models))
      .catch(() => setModels([]));
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
      ...(form.target === "new" && form.model
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
    } catch (e) {
      // A 400 (validated with the same rules as hand-written files) isn't tied to one field — show it under the modal form.
      setFormError(e instanceof ApiError ? e.message : S.common.unknownError);
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
      toastError(e instanceof ApiError ? e.message : S.common.unknownError);
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
      model: itemModelRef(item),
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
    } catch (e) {
      toastError(e instanceof ApiError ? e.message : S.common.unknownError);
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
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.schedule.desc}</p>
        {!isOwner && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{S.schedule.readOnlyHint}</p>
        )}
      </div>

      {data === null ? (
        <SkeletonList rows={4} />
      ) : schedules.length === 0 ? (
        // Plain-text empty state (settings area doesn't use the penguin-icon EmptyState, keeps the same gray level as the table area).
        <p className="py-2 text-xs text-gray-400 dark:text-gray-500">{S.schedule.empty}</p>
      ) : (
        <div className="overflow-x-auto overflow-y-clip rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                <th className="px-3 py-2.5">{S.common.name}</th>
                <th className="px-3 py-2.5">{S.schedule.colStatus}</th>
                <th className="px-3 py-2.5">{S.schedule.colPeriod}</th>
                <th className="px-3 py-2.5">{S.schedule.colTarget}</th>
                <th className="px-3 py-2.5">{S.schedule.colFireTimes}</th>
                <th className="px-3 py-2.5">{S.schedule.colQueued}</th>
                {isOwner && <th className="px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {schedules.map((item) => (
                <tr
                  key={item.name}
                  className="border-b border-gray-100 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40"
                >
                  <td className="px-3 py-2 font-mono text-xs">{item.name}</td>
                  <td className="px-3 py-2">
                    {/* invalid reason is folded into the hover title. */}
                    <span title={item.invalidReason}>
                      <Badge tone={STATUS_TONE[item.status]}>
                        {S.schedule.statusNames[item.status] ?? item.status}
                      </Badge>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
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
                  {/* Top row: next fire time; bottom row: last fired time (both show — when absent). */}
                  <td className="px-3 py-2 text-xs">
                    <span className="block text-gray-600 dark:text-gray-300">
                      {item.nextFireAt ? formatDateTime(item.nextFireAt) : "—"}
                    </span>
                    <span className="block text-gray-400 dark:text-gray-500">
                      {item.lastFiredAt ? formatDateTime(item.lastFiredAt) : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
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
        <Button size="sm" variant="primary" disabled={busy} onClick={() => openForm(EMPTY_FORM)}>
          {S.schedule.addTitle}
        </Button>
      )}

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
                <Input
                  size="sm"
                  label={S.schedule.sessionId}
                  error={fieldErrors.sessionId}
                  value={form.sessionId}
                  onChange={(e) => set({ sessionId: e.target.value })}
                  className="font-mono"
                  autoComplete="off"
                />
              ) : (
                <>
                  <Select
                    size="sm"
                    label={S.schedule.model}
                    value={form.model ? modelOptionValue(form.model) : ""}
                    onChange={(e) => set({ model: parseModelOption(e.target.value) })}
                  >
                    <option value="">{S.schedule.modelDefault}</option>
                    {/* When the prefilled pair is no longer in the model config (the entry was
                        renamed or deleted), add an extra option so it isn't displayed as
                        "Project default". */}
                    {form.model &&
                      !models.some(
                        (m) =>
                          m.modelId === form.model!.modelId && m.provider === form.model!.provider,
                      ) && (
                        <option value={modelOptionValue(form.model)}>
                          {modelOptionLabel(form.model)}
                        </option>
                      )}
                    {models.map((m) => (
                      <option
                        key={`${m.provider}:${m.modelId}`}
                        value={modelOptionValue({ provider: m.provider, modelId: m.modelId })}
                      >
                        {modelOptionLabel({ provider: m.provider, modelId: m.modelId })}
                      </option>
                    ))}
                  </Select>
                  <Input
                    size="sm"
                    label={S.schedule.workspace}
                    value={form.workspace}
                    onChange={(e) => set({ workspace: e.target.value })}
                    className="font-mono"
                    autoComplete="off"
                  />
                </>
              )}
            </div>
            <Textarea
              label={S.schedule.prompt}
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

      {/* Delete confirmation (same pattern as Vault / Agent deletion: Modal + cancel/danger-confirm). */}
      <Modal
        open={deleting !== null}
        title={S.schedule.deleteTitle}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>{S.common.cancel}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void confirmRemove()}>
              {S.common.confirm}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting !== null ? S.schedule.deleteConfirm(deleting) : ""}
        </p>
      </Modal>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
