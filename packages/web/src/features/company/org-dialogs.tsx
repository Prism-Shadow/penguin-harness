/**
 * Organization dialogs, invoked from the sidebar's organization switcher (and the empty
 * landing): create an organization — display name, the id (still required, generated from
 * that name by the field's own button), a one-sentence mission, the Project it belongs to
 * when the user has several, the model its sessions run on (the Project default unless
 * chosen), the company workspace (the organization's own directory unless one is picked) and
 * the CEO's monthly budget, which is the whole company's and is typed in the currency the
 * reader reads money in but stored in USD — and an organization's
 * settings: name, mission, model, workspace, timezone, working language, approval mode, and
 * pause / resume — the one lifecycle control there is, since an organization is never deleted
 * through the App. Pause / resume writes its own PATCH the moment it is clicked; everything
 * else is a draft until Save, which is live once a field differs from what is stored and none
 * of the required ones is empty. Closing the settings with unsaved edits asks first.
 *
 * What the create dialog holds is kept as a draft (org-draft.ts) per user and Project, so an
 * accidental close, a reload or a switch back to development mode does not cost the mission
 * someone spent minutes writing; it is restored on reopen and dropped on a successful create
 * or an explicit "clear draft". A caller that opens the dialog from a proposal (the empty
 * landing's cards) passes that proposal as `initial`: it fills the name and the mission over
 * whatever the draft held, and is then written through to the draft exactly as typed text is.
 *
 * Failures stay inside the dialog: a rejected id lands under the id field, anything else in
 * a strip above the footer, and a settings load that fails offers its retry in place — the
 * fields never sit disabled behind a toast that has already gone.
 *
 * `useOrganizationCreated` is the other half of creating one: what every host of the create
 * dialog does once it succeeds — adopt the organization as the shell's current one, then open
 * where the creation leads.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type {
  ModelRefDto,
  ModelsResponse,
  OrgApprovalMode,
  OrgLanguage,
  OrganizationCreateRequest,
  OrganizationDetail,
  OrganizationPatchRequest,
  OrganizationSettings,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  FieldError,
  ICON_GAP,
  InfoPopover,
  Input,
  Modal,
  Select,
  Textarea,
  toastError,
  toastSuccess,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { closeUnlessBusy } from "../../lib/busy-close";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { useAuth } from "../../state/auth";
import { useCompany } from "../../state/company";
import { projectDisplayName, useProject } from "../../state/project";
import { useTheme } from "../../state/theme";
import { ModelCatalogSelect, modelLabel } from "../chat/model-select";
import { WorkspaceSelect } from "../chat/workspace-select";
import { sameModelRef } from "../models/model-grouping";
import { ErrorLine, InfoFieldLabel, MoneyPerMonthInput, OrgStatusPill } from "./shared";
import { orgCreatedTarget } from "./company-nav";
import { fromStoredUsd, isBudgetText, toStoredUsd } from "./budget-input";
import { SemanticIdField } from "../semantic-id/semantic-id-field";
import {
  EMPTY_ORG_DRAFT,
  clearOrgDraft,
  hasContent,
  loadOrgDraft,
  orgDraftKey,
  saveOrgDraft,
} from "./org-draft";

const APPROVAL_MODES: readonly OrgApprovalMode[] = ["allow-all", "read-only", "deny-all"];

/**
 * The working languages an organization can be set to. An organization written before the
 * field existed carries none, which the server reads as English — so does this dialog, or
 * saving an unrelated field would silently re-declare the language.
 */
const ORG_LANGUAGES: readonly OrgLanguage[] = ["zh", "en"];
const DEFAULT_ORG_LANGUAGE: OrgLanguage = "en";

/**
 * The CEO's monthly budget the dialog offers, in USD — the field shows it in the reader's own
 * currency. It is the whole company's ceiling: the chart's budgets are cumulative over an
 * employee and its subordinates, and everyone reports to the CEO. The server applies the same
 * default when the field is left empty.
 */
const DEFAULT_CEO_BUDGET_USD = 100;

/** The error codes that are about the id the user typed; every other failure is the form's. */
const ID_ERROR_CODES = new Set(["org_exists", "invalid_org_id"]);

/** The Project's configured models, loaded once per open; null until they arrive, with the failure kept beside them. */
function useProjectModels(projectId: string, open: boolean) {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setModels(null);
    setError(null);
    api
      .getModels(projectId)
      .then((res) => {
        if (!cancelled) setModels(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);
  return { models, error };
}

/**
 * The model field: the App's own model picker (ModelCatalogSelect in its form shape — the same
 * searchable, grouped, key-configured-first dialog the chat composer and the Project's
 * default-model setting open), with this field's two extra states around it.
 *
 * Empty is a choice here, not a gap: it means "follow the Project's default", and the trigger
 * says so itself, naming that default when the list says which model it is. The panel offers
 * models only, so the way back to empty is the field's own control under the trigger once a
 * model is picked. A stored model that is no longer configured is kept rather than
 * silently replaced — the trigger names the id as stored, with a line underneath saying the
 * Project no longer lists it.
 */
function ModelField({
  models,
  loadError,
  value,
  onChange,
  disabled,
}: {
  models: ModelsResponse | null;
  loadError: string | null;
  value: ModelRefDto | null;
  onChange: (ref: ModelRefDto | null) => void;
  disabled: boolean;
}) {
  const list = models?.models ?? [];
  // Only once the list has actually arrived: an empty list is also what "still loading" and
  // "could not be read" look like, and neither is evidence that the stored model is gone.
  const stale = models !== null && value !== null && !list.some((m) => sameModelRef(m, value));
  const defaultInfo =
    models?.defaultModel === undefined
      ? undefined
      : list.find((m) => sameModelRef(m, models.defaultModel));
  const defaultLabel =
    defaultInfo !== undefined
      ? S.company.modelProjectDefaultNamed(modelLabel(defaultInfo))
      : S.company.modelProjectDefault;
  const loading = models === null && loadError === null;
  return (
    <div>
      <InfoFieldLabel label={S.company.modelField} info={S.company.modelInfo} />
      <ModelCatalogSelect
        models={list}
        value={value}
        {...(models?.defaultModel !== undefined ? { defaultModel: models.defaultModel } : {})}
        onChange={onChange}
        disabled={disabled || loading}
        variant="form"
        emptyLabel={loading ? S.common.loading : defaultLabel}
      />
      {loadError !== null ? (
        <FieldError>{S.company.modelsLoadFailed}</FieldError>
      ) : value === null ? null : (
        <span className="mt-1 flex flex-wrap items-baseline gap-x-2">
          {stale && (
            <span className="text-xs text-gray-500 dark:text-gray-500">{S.company.modelStale}</span>
          )}
          {/* The way back to the Project default, as the action that carries it out. */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="whitespace-nowrap text-xs text-gray-500 underline decoration-gray-300 underline-offset-2 transition-colors duration-150 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {S.company.modelClear}
          </button>
        </span>
      )}
    </div>
  );
}

/** The company workspace: the chat draft's directory browser in its form shape; empty means the organization's own directory. */
function WorkspaceField({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: string;
  onChange: (path: string) => void;
}) {
  return (
    <div>
      <InfoFieldLabel label={S.company.workspaceField} info={S.company.workspaceInfo} />
      <WorkspaceSelect
        projectId={projectId}
        workspace={value}
        onChange={onChange}
        variant="form"
        fieldLabel={S.company.workspaceField}
        emptyLabel={S.company.workspaceEmpty}
        clearLabel={S.company.workspaceClear}
      />
    </div>
  );
}

/**
 * What a host of the create dialog does with a creation, in one place because all four of
 * them — the switcher's menu, the empty sidebar, the empty landing and the "organization is
 * gone" page — owe the shell the same two things.
 *
 * The new organization becomes the shell's current one BEFORE the navigation: creation opens
 * the CEO's desk session, which lives at `/chat/:sessionId` and is therefore not one of the
 * organization's own routes — and those routes are the only other thing that announces which
 * organization the shell is inside. Without this the sidebar would go on listing the previous
 * organization's channels and desks around the conversation the new one just opened.
 *
 * The organization list is refreshed first, and awaited: `setCurrentOrg` only says which key
 * is open, and the switcher's label, the status dot and the page header all read the summary
 * out of that list. A key the list does not hold yet would leave the shell naming nothing for
 * as long as the refresh takes, and the settled-list check that forgets deleted organizations
 * reads the same list.
 */
export function useOrganizationCreated(): (detail: OrganizationDetail) => Promise<void> {
  const navigate = useNavigate();
  const { reloadOrganizations, setCurrentOrg } = useCompany();
  return useCallback(
    async (detail: OrganizationDetail) => {
      await reloadOrganizations();
      const target = orgCreatedTarget(detail);
      setCurrentOrg(target.key);
      navigate(target.path);
    },
    [navigate, reloadOrganizations, setCurrentOrg],
  );
}

export function CreateOrganizationDialog({
  open,
  initial,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** A proposal the dialog opens filled in with (the empty landing's cards); the id is still generated. */
  initial?: { name: string; mission: string };
  onClose: () => void;
  onCreated: (detail: OrganizationDetail) => void;
}) {
  const { projects, currentProject } = useProject();
  const { user } = useAuth();
  const { currency } = useTheme();
  const [projectId, setProjectId] = useState("");
  const [orgId, setOrgId] = useState("");
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [modelRef, setModelRef] = useState<ModelRefDto | null>(null);
  const [workspace, setWorkspace] = useState("");
  const [ceoBudget, setCeoBudget] = useState(() => fromStoredUsd(DEFAULT_CEO_BUDGET_USD, currency));
  const [idError, setIdError] = useState<string | undefined>(undefined);
  const [missionError, setMissionError] = useState<string | undefined>(undefined);
  const [budgetError, setBudgetError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  /** A stored draft was put back into the fields: the notice above them says so and offers to drop it. */
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  /** "Clear draft" awaiting confirmation: it empties every field and the stored draft. */
  const [confirmClear, setConfirmClear] = useState(false);
  const { models, error: modelsError } = useProjectModels(projectId, open);

  // The Project the organization is being created in: the current one on open, changeable
  // below when the user has several.
  useEffect(() => {
    if (!open) return;
    setProjectId(currentProject?.projectId ?? projects[0]?.projectId ?? "");
  }, [open, currentProject, projects]);

  /** The draft's key; null before the target Project is known (nothing to store against). */
  const draftKey = projectId === "" ? null : orgDraftKey(user?.userId ?? null, projectId);

  const resetForm = (draft = EMPTY_ORG_DRAFT) => {
    setOrgId(draft.orgId);
    setName(draft.name);
    setMission(draft.mission);
    setModelRef(draft.model);
    setWorkspace(draft.workspace);
    setCeoBudget(
      draft.ceoBudget === "" ? fromStoredUsd(DEFAULT_CEO_BUDGET_USD, currency) : draft.ceoBudget,
    );
    setIdError(undefined);
    setMissionError(undefined);
    setBudgetError(undefined);
    setFormError(null);
  };

  // Restore on open, and again when the target Project changes: a draft belongs to the
  // Project it was aimed at, since its Workspace and model are that Project's. This also
  // subsumes the old "switching Projects drops the model pick" rule.
  //
  // A proposal outranks the draft's own name and mission — the click asked for THIS one — and
  // the notice above the fields is then not the truth about what is on screen, so it stays
  // down. The two texts are the effect's dependencies rather than the object holding them: a
  // caller building it inline would otherwise reset the form on every render.
  const initialName = initial?.name ?? null;
  const initialMission = initial?.mission ?? null;
  useEffect(() => {
    if (!open) return;
    const draft = draftKey === null ? null : loadOrgDraft(draftKey);
    const base = draft ?? EMPTY_ORG_DRAFT;
    resetForm(
      initialMission === null
        ? base
        : { ...base, name: initialName ?? base.name, mission: initialMission },
    );
    setRestored(draft !== null && initialMission === null);
    // resetForm is a plain setter bundle; re-running on its identity would reset on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftKey, initialName, initialMission]);

  // Every edit is written straight through: the draft exists for the close nobody meant.
  useEffect(() => {
    if (!open || draftKey === null) return;
    saveOrgDraft(draftKey, { orgId, name, mission, workspace, model: modelRef, ceoBudget });
  }, [open, draftKey, orgId, name, mission, workspace, modelRef, ceoBudget]);

  /** Whether there is anything in the form a "clear draft" would remove. */
  const draftContent = hasContent({
    orgId,
    name,
    mission,
    workspace,
    model: modelRef,
    ceoBudget,
  });

  const dropDraft = () => {
    if (draftKey !== null) clearOrgDraft(draftKey);
    setRestored(false);
    resetForm();
  };

  const submit = async () => {
    const id = orgId.trim();
    const budget = ceoBudget.trim();
    let bad = false;
    if (!id) {
      setIdError(S.common.requiredField);
      bad = true;
    } else if (!SEMANTIC_ID_PATTERN.test(id)) {
      setIdError(S.company.orgIdHint);
      bad = true;
    }
    if (!mission.trim()) {
      setMissionError(S.common.requiredField);
      bad = true;
    }
    if (!isBudgetText(budget)) {
      setBudgetError(S.company.ceoBudgetHint);
      bad = true;
    }
    if (bad || !projectId) return;
    setBusy(true);
    setFormError(null);
    try {
      // An omitted budget is the server's own default (100 USD a month); what was typed is in
      // the reader's currency and goes out in USD, which is what the chart file holds.
      const ceoBudgetUsd = toStoredUsd(budget, currency);
      const body: OrganizationCreateRequest = {
        orgId: id,
        mission: mission.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(workspace.trim() ? { workspace: workspace.trim() } : {}),
        ...(modelRef !== null ? { model: modelRef } : {}),
        ...(ceoBudgetUsd !== null ? { ceoBudget: ceoBudgetUsd } : {}),
      };
      const detail = await api.createOrganization(projectId, body);
      // The draft did its job: what it held is now an organization.
      if (draftKey !== null) clearOrgDraft(draftKey);
      setRestored(false);
      toastSuccess(S.company.createdOpeningCeo);
      onCreated(detail);
    } catch (e) {
      const text = apiErrorText(e);
      if (e instanceof ApiError && ID_ERROR_CODES.has(e.code)) setIdError(text);
      else setFormError(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={S.company.createTitle}
      onClose={busy ? () => undefined : onClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          {/* Dropping the draft is a form action, not a dialog verdict: it sits away from
              Cancel / Create so a click on it can never be mistaken for either. */}
          {draftContent && (
            <Button
              size="sm"
              onClick={() => setConfirmClear(true)}
              disabled={busy}
              className="mr-auto"
            >
              {S.company.clearDraft}
            </Button>
          )}
          <Button size="sm" onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? S.company.creating : S.common.create}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {restored && (
          <p className="rounded-md bg-gray-100 px-2.5 py-1.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {S.company.draftRestored}
          </p>
        )}
        {projects.length > 1 && (
          <Select
            size="sm"
            label={S.project.switcher}
            required
            value={projectId}
            disabled={busy}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {projectDisplayName(p)}
              </option>
            ))}
          </Select>
        )}
        {/* The name comes first and the id is derived from it: an id is the harder half to
            invent, and naming the thing is where anyone starts anyway. */}
        <Input
          label={S.company.displayName}
          size="sm"
          value={name}
          info={S.company.displayNameHint}
          autoFocus
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <SemanticIdField
          projectId={projectId}
          kind="org"
          label={S.company.orgId}
          hint={S.company.orgIdHint}
          info={S.company.orgIdInfo}
          value={orgId}
          source={name.trim() || mission}
          error={idError}
          disabled={busy}
          onChange={(id) => {
            setOrgId(id);
            setIdError(undefined);
          }}
        />
        <Textarea
          label={S.company.mission}
          required
          size="sm"
          rows={3}
          value={mission}
          error={missionError}
          info={S.company.missionHint}
          placeholder={S.company.missionPlaceholder}
          disabled={busy}
          onChange={(e) => {
            setMission(e.target.value);
            setMissionError(undefined);
          }}
        />
        <ModelField
          models={models}
          loadError={modelsError}
          value={modelRef}
          onChange={setModelRef}
          disabled={busy}
        />
        <WorkspaceField projectId={projectId} value={workspace} onChange={setWorkspace} />
        <MoneyPerMonthInput
          label={S.company.ceoBudget}
          currency={currency}
          value={ceoBudget}
          info={S.company.ceoBudgetHint}
          {...(budgetError !== undefined ? { error: budgetError } : {})}
          disabled={busy}
          onChange={(text) => {
            setCeoBudget(text);
            setBudgetError(undefined);
          }}
        />
        {formError !== null && <ErrorLine message={formError} onRetry={() => void submit()} />}
      </div>
      <ConfirmModal
        open={confirmClear}
        title={S.company.clearDraft}
        confirmLabel={S.company.clearDraftConfirmLabel}
        cancelLabel={S.common.cancel}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          dropDraft();
        }}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.company.clearDraftConfirm}</p>
      </ConfirmModal>
    </Modal>
  );
}

interface OrganizationSettingsProps {
  open: boolean;
  projectId: string;
  orgId: string;
  onClose: () => void;
  /** Settings were written (name, mission, status …): the caller refreshes the list. */
  onChanged: () => void;
  /** The organization was deleted: the caller refreshes the list and leaves its pages. */
  onDeleted?: () => void;
}

/** The settings form's fields, as typed. */
interface OrgSettingsDraft {
  name: string;
  mission: string;
  timezone: string;
  language: OrgLanguage;
  approvalMode: OrgApprovalMode;
  modelRef: ModelRefDto | null;
  workspace: string;
}

/** What the stored settings open the form as (empty fields until they are read). */
function orgSettingsDraft(settings: OrganizationSettings | null): OrgSettingsDraft {
  return {
    name: settings?.name ?? "",
    mission: settings?.mission ?? "",
    timezone: settings?.timezone ?? "",
    language: settings?.language ?? DEFAULT_ORG_LANGUAGE,
    approvalMode: settings?.approvalMode ?? "allow-all",
    modelRef: settings?.model ?? null,
    workspace: settings?.workspace ?? "",
  };
}

/** A draft as a save compares it: text trimmed, the model as its paired reference alone. */
const normalizedOrgDraft = (d: OrgSettingsDraft) => ({
  ...d,
  name: d.name.trim(),
  mission: d.mission.trim(),
  timezone: d.timezone.trim(),
  workspace: d.workspace.trim(),
  modelRef:
    d.modelRef === null ? null : { provider: d.modelRef.provider, modelId: d.modelRef.modelId },
});

export function OrganizationSettingsDialog(props: OrganizationSettingsProps) {
  // Mounted only while open, so every opening reads the stored settings afresh.
  return props.open ? <OrganizationSettingsForm {...props} /> : null;
}

function OrganizationSettingsForm({
  projectId,
  orgId,
  onClose,
  onChanged,
  onDeleted,
}: OrganizationSettingsProps) {
  /** Stored settings as loaded on open (null until then) — the form's baseline. */
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const form = useFormDraft(orgSettingsDraft(settings), { normalize: normalizedOrgDraft });
  const { name, mission, timezone, language, approvalMode, modelRef, workspace } = form.draft;
  const [busy, setBusy] = useState(false);
  /** The delete confirmation, and what has been typed into it (the id, to mean it). */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typedId, setTypedId] = useState("");
  const { models, error: modelsError } = useProjectModels(projectId, true);
  const requestClose = useGuardedClose(...closeUnlessBusy(busy, onClose, form.scope));
  /** The organization always has a name, a mission and a timezone: an emptied one holds Save. */
  const valid = name.trim() !== "" && mission.trim() !== "" && timezone.trim() !== "";

  const doDelete = async () => {
    setBusy(true);
    try {
      await api.deleteOrganization(projectId, orgId);
      setConfirmDelete(false);
      toastSuccess(S.company.deleted(orgId));
      onClose();
      onDeleted?.();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const load = useCallback(() => {
    let cancelled = false;
    setSettings(null);
    setLoadError(null);
    void api
      .getOrganization(projectId, orgId)
      .then((detail) => {
        if (!cancelled) setSettings(detail.settings);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, orgId]);

  useEffect(() => load(), [load]);

  /**
   * One PATCH; the answer becomes the stored settings. The pause / resume writes through here
   * alone, and the typed fields beside it keep their edits against the new baseline.
   */
  const patch = async (body: OrganizationPatchRequest) => {
    setBusy(true);
    try {
      setSettings(await api.patchOrganization(projectId, orgId, body));
      toastSuccess(S.common.saved);
      onChanged();
      return true;
    } catch (e) {
      toastError(apiErrorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (settings === null || !form.dirty || !valid) return;
    const body: OrganizationPatchRequest = {};
    if (name.trim() !== settings.name) body.name = name.trim();
    if (mission.trim() !== settings.mission) body.mission = mission.trim();
    if (timezone.trim() !== settings.timezone) body.timezone = timezone.trim();
    if (language !== (settings.language ?? DEFAULT_ORG_LANGUAGE)) body.language = language;
    if (approvalMode !== settings.approvalMode) body.approvalMode = approvalMode;
    // Clearing sends null: the organization returns to the Project default / its own directory.
    const storedModel = settings.model ?? null;
    if (!(storedModel === null && modelRef === null) && !sameModelRef(storedModel, modelRef)) {
      body.model = modelRef;
    }
    const nextWorkspace = workspace.trim();
    if (nextWorkspace !== (settings.workspace ?? "")) {
      body.workspace = nextWorkspace === "" ? null : nextWorkspace;
    }
    void patch(body).then((ok) => {
      if (ok) onClose();
    });
  };

  const hydrated = settings !== null;
  const paused = settings?.status === "paused";
  return (
    <Modal
      open
      title={S.company.settingsTitle}
      onClose={requestClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!hydrated || busy || !form.dirty || !valid}
            onClick={save}
          >
            {S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {loadError !== null && (
          <ErrorLine message={S.company.settingsLoadFailed} detail={loadError} onRetry={load} />
        )}
        {/* Status row: the pause / resume is immediate (its own PATCH), not part of Save —
              stopping an organization is a decision, not a draft. */}
        <div className="flex items-center justify-between gap-3">
          <span
            className={`flex items-center ${ICON_GAP.row} text-xs font-semibold text-gray-600 dark:text-gray-400`}
          >
            {S.company.status}
            <InfoPopover label={S.company.status}>{S.company.pauseInfo}</InfoPopover>
          </span>
          <span className="flex items-center gap-2">
            {settings !== null && <OrgStatusPill org={settings} />}
            <Button
              size="sm"
              disabled={!hydrated || busy}
              onClick={() => void patch({ status: paused ? "active" : "paused" })}
            >
              {paused ? S.company.resume : S.company.pause}
            </Button>
          </span>
        </div>
        <Input
          label={S.company.displayName}
          size="sm"
          required
          value={name}
          disabled={!hydrated || busy}
          onChange={(e) => form.patch({ name: e.target.value })}
        />
        <Textarea
          label={S.company.mission}
          size="sm"
          rows={3}
          required
          value={mission}
          disabled={!hydrated || busy}
          info={S.company.missionHint}
          onChange={(e) => form.patch({ mission: e.target.value })}
        />
        <ModelField
          models={models}
          loadError={modelsError}
          value={modelRef}
          onChange={(next) => form.patch({ modelRef: next })}
          disabled={!hydrated || busy}
        />
        <WorkspaceField
          projectId={projectId}
          value={workspace}
          onChange={(next) => form.patch({ workspace: next })}
        />
        <Input
          label={S.company.timezone}
          size="sm"
          required
          value={timezone}
          disabled={!hydrated || busy}
          hint={S.company.timezoneHint}
          info={S.company.timezoneInfo}
          className="font-mono"
          onChange={(e) => form.patch({ timezone: e.target.value })}
        />
        <div>
          <InfoFieldLabel label={S.company.language} info={S.company.languageInfo} />
          <Select
            size="sm"
            aria-label={S.company.language}
            value={language}
            disabled={!hydrated || busy}
            onChange={(e) => form.patch({ language: e.target.value as OrgLanguage })}
          >
            {ORG_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {S.company.languages[l]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <InfoFieldLabel label={S.company.approvalMode} info={S.company.approvalModeInfo} />
          <Select
            size="sm"
            aria-label={S.company.approvalMode}
            value={approvalMode}
            disabled={!hydrated || busy}
            onChange={(e) => form.patch({ approvalMode: e.target.value as OrgApprovalMode })}
          >
            {APPROVAL_MODES.map((m) => (
              <option key={m} value={m}>
                {S.company.approvalModes[m] ?? m}
              </option>
            ))}
          </Select>
        </div>
        {/* Deleting is its own decision, below everything Save writes: immediate, confirmed by
              typing the id, and refused by the server for anyone but the Project's owner. */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-3 dark:border-gray-800">
          <span
            className={`flex min-w-0 items-center ${ICON_GAP.row} text-xs font-semibold text-gray-600 dark:text-gray-400`}
          >
            {S.company.deleteOrg}
            <InfoPopover label={S.company.deleteOrg}>{S.company.deleteOrgDesc}</InfoPopover>
          </span>
          <Button
            size="sm"
            variant="danger"
            disabled={!hydrated || busy}
            onClick={() => {
              setTypedId("");
              setConfirmDelete(true);
            }}
          >
            {S.common.delete}
          </Button>
        </div>
      </div>
      <ConfirmModal
        open={confirmDelete}
        title={S.company.deleteOrg}
        busy={busy}
        confirmDisabled={typedId.trim() !== orgId}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.company.deleteOrgConfirm}</p>
        <Input
          size="sm"
          className="mt-3 font-mono"
          aria-label={S.company.deleteOrgTypeId(orgId)}
          placeholder={orgId}
          value={typedId}
          hint={S.company.deleteOrgTypeId(orgId)}
          onChange={(e) => setTypedId(e.target.value)}
        />
      </ConfirmModal>
    </Modal>
  );
}
