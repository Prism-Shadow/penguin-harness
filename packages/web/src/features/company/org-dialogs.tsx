/**
 * Organization dialogs, invoked from the sidebar's organization switcher (and the empty
 * landing): create an organization — display name, the id (still required, generated from
 * that name by the field's own button), a one-sentence mission with three examples under it,
 * the Project it belongs to when the user has several, the model its sessions run on (the
 * Project default unless chosen), the company workspace (the organization's own directory
 * unless one is picked) and the CEO's monthly budget, which is the whole company's — and an
 * organization's settings: name, mission, model, workspace, timezone, working language,
 * approval mode, and pause / resume — the one lifecycle control there is, since an
 * organization is never deleted through the App. Pause / resume writes its own PATCH the
 * moment it is clicked; everything else is a draft until Save.
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
 */
import { useCallback, useEffect, useState } from "react";
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
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { useAuth } from "../../state/auth";
import { projectDisplayName, useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { FieldError, FieldHint, FieldLabel } from "../../components/ui/field";
import { Modal } from "../../components/ui/modal";
import { InfoPopover } from "../../components/ui/info-popover";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { ICON_GAP } from "../../lib/icon-scale";
import { modelLabel } from "../chat/model-select";
import { WorkspaceSelect } from "../chat/workspace-select";
import { sameModelRef } from "../models/model-grouping";
import { ErrorLine, OrgStatusPill } from "./shared";
import { ORG_EXAMPLES } from "./org-examples";
import { SemanticIdField } from "./semantic-id-field";
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
 * The CEO's monthly budget the dialog offers, in USD. It is the whole company's ceiling: the
 * chart's budgets are cumulative over an employee and its subordinates, and everyone reports
 * to the CEO. The server applies the same default when the field is left empty.
 */
const DEFAULT_CEO_BUDGET = "100";

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
 * The model field: "Project default" (named after the default when the list says which it
 * is) or one of the configured models. Options carry the row's index so the paired reference
 * is never flattened into one string; a stored model that is no longer configured is kept as
 * its own row rather than silently replaced.
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
  const index = value === null ? -1 : list.findIndex((m) => sameModelRef(m, value));
  const stale = value !== null && index === -1;
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
      {/* The "?" sits beside the field's own title (Select carries no info slot). */}
      <span className="mb-1 flex items-center gap-1">
        <FieldLabel block={false}>{S.company.modelField}</FieldLabel>
        <InfoPopover label={S.company.modelField}>{S.company.modelInfo}</InfoPopover>
      </span>
      <Select
        size="sm"
        aria-label={S.company.modelField}
        value={stale ? "stale" : index >= 0 ? String(index) : ""}
        disabled={disabled || loading}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "stale") return;
          const picked = v === "" ? undefined : list[Number(v)];
          onChange(
            picked === undefined ? null : { provider: picked.provider, modelId: picked.modelId },
          );
        }}
      >
        <option value="">{loading ? S.common.loading : defaultLabel}</option>
        {stale && <option value="stale">{value.modelId}</option>}
        {list.map((m, i) => (
          <option key={`${m.provider}:${m.modelId}`} value={String(i)}>
            {modelLabel(m)}
          </option>
        ))}
      </Select>
      {loadError !== null ? (
        <FieldError>{S.company.modelsLoadFailed}</FieldError>
      ) : (
        <FieldHint>{S.company.modelHint}</FieldHint>
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
      <span className="mb-1 flex items-center gap-1">
        <FieldLabel block={false}>{S.company.workspaceField}</FieldLabel>
        <InfoPopover label={S.company.workspaceField}>{S.company.workspaceInfo}</InfoPopover>
      </span>
      <WorkspaceSelect
        projectId={projectId}
        workspace={value}
        onChange={onChange}
        variant="form"
        fieldLabel={S.company.workspaceField}
        emptyLabel={S.company.workspaceEmpty}
        menuHint={S.company.workspaceMenuHint}
        clearLabel={S.company.workspaceClear}
      />
      <FieldHint>{S.company.workspaceHint}</FieldHint>
    </div>
  );
}

/**
 * The three example missions under the mission field. A click takes the mission whole (the
 * click asks for THIS mission) and the display name only while the name is still empty, so
 * an example never overwrites what someone typed; the id is left to the generate button
 * beside it. One line each — the mission is long enough that a card of it would push the
 * rest of the form off the dialog, so the row carries the names and the tooltips carry what
 * each one actually says.
 */
function MissionExamples({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (example: { name: string; mission: string }) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {ORG_EXAMPLES.map((example) => {
        const copy = S.company.missionExamples[example.id];
        return (
          <button
            key={example.id}
            type="button"
            title={`${copy.mission}\n${S.company.missionExampleHint}`}
            disabled={disabled}
            onClick={() => onPick(copy)}
            className="min-w-0 flex-1 truncate rounded-md border border-gray-200 px-2 py-1 text-left text-[11px] text-gray-600 transition-colors duration-150 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            {copy.name}
          </button>
        );
      })}
    </div>
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
  const [projectId, setProjectId] = useState("");
  const [orgId, setOrgId] = useState("");
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [modelRef, setModelRef] = useState<ModelRefDto | null>(null);
  const [workspace, setWorkspace] = useState("");
  const [ceoBudget, setCeoBudget] = useState(DEFAULT_CEO_BUDGET);
  const [idError, setIdError] = useState<string | undefined>(undefined);
  const [missionError, setMissionError] = useState<string | undefined>(undefined);
  const [budgetError, setBudgetError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  /** A stored draft was put back into the fields: the notice above them says so and offers to drop it. */
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
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
    setCeoBudget(draft.ceoBudget === "" ? DEFAULT_CEO_BUDGET : draft.ceoBudget);
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
    if (budget !== "" && !(Number(budget) >= 0)) {
      setBudgetError(S.company.ceoBudgetHint);
      bad = true;
    }
    if (bad || !projectId) return;
    setBusy(true);
    setFormError(null);
    try {
      // An omitted budget is the server's own default (100 USD a month).
      const body: OrganizationCreateRequest = {
        orgId: id,
        mission: mission.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(workspace.trim() ? { workspace: workspace.trim() } : {}),
        ...(modelRef !== null ? { model: modelRef } : {}),
        ...(budget !== "" ? { ceoBudget: Number(budget) } : {}),
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
            <Button onClick={dropDraft} disabled={busy} className="mr-auto">
              {S.company.clearDraft}
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
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
          hint={S.company.displayNameHint}
          autoFocus
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <SemanticIdField
          projectId={projectId}
          kind="org"
          label={S.company.orgId}
          hint={S.company.orgIdHint}
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
          hint={S.company.missionHint}
          placeholder={S.company.missionPlaceholder}
          disabled={busy}
          onChange={(e) => {
            setMission(e.target.value);
            setMissionError(undefined);
          }}
        />
        <MissionExamples
          disabled={busy}
          onPick={(example) => {
            setMission(example.mission);
            setMissionError(undefined);
            if (name.trim() === "") setName(example.name);
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
        <Input
          label={S.company.ceoBudget}
          size="sm"
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={ceoBudget}
          hint={S.company.ceoBudgetHint}
          {...(budgetError !== undefined ? { error: budgetError } : {})}
          disabled={busy}
          onChange={(e) => {
            setCeoBudget(e.target.value);
            setBudgetError(undefined);
          }}
        />
        {formError !== null && <ErrorLine message={formError} onRetry={() => void submit()} />}
      </div>
    </Modal>
  );
}

export function OrganizationSettingsDialog({
  open,
  projectId,
  orgId,
  onClose,
  onChanged,
}: {
  open: boolean;
  projectId: string;
  orgId: string;
  onClose: () => void;
  /** Settings were written (name, mission, status …): the caller refreshes the list. */
  onChanged: () => void;
}) {
  /** Stored settings as loaded on open (null until then) — the no-change baseline. */
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [timezone, setTimezone] = useState("");
  const [language, setLanguage] = useState<OrgLanguage>(DEFAULT_ORG_LANGUAGE);
  const [approvalMode, setApprovalMode] = useState<OrgApprovalMode>("allow-all");
  const [modelRef, setModelRef] = useState<ModelRefDto | null>(null);
  const [workspace, setWorkspace] = useState("");
  const [busy, setBusy] = useState(false);
  const { models, error: modelsError } = useProjectModels(projectId, open);

  const adopt = (next: OrganizationSettings) => {
    setSettings(next);
    setName(next.name);
    setMission(next.mission);
    setTimezone(next.timezone);
    setLanguage(next.language ?? DEFAULT_ORG_LANGUAGE);
    setApprovalMode(next.approvalMode);
    setModelRef(next.model ?? null);
    setWorkspace(next.workspace ?? "");
  };

  const load = useCallback(() => {
    let cancelled = false;
    setSettings(null);
    setLoadError(null);
    void api
      .getOrganization(projectId, orgId)
      .then((detail) => {
        if (!cancelled) adopt(detail.settings);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, orgId]);

  useEffect(() => {
    if (!open) return;
    return load();
  }, [open, load]);

  const patch = async (body: OrganizationPatchRequest) => {
    setBusy(true);
    try {
      adopt(await api.patchOrganization(projectId, orgId, body));
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
    if (settings === null) return;
    const body: OrganizationPatchRequest = {};
    if (name.trim() && name.trim() !== settings.name) body.name = name.trim();
    if (mission.trim() && mission.trim() !== settings.mission) body.mission = mission.trim();
    if (timezone.trim() && timezone.trim() !== settings.timezone) body.timezone = timezone.trim();
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
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    void patch(body).then((ok) => {
      if (ok) onClose();
    });
  };

  const hydrated = settings !== null;
  const paused = settings?.status === "paused";
  return (
    <Modal
      open={open}
      title={S.company.settingsTitle}
      onClose={onClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button variant="primary" disabled={!hydrated || busy} onClick={save}>
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
          value={name}
          disabled={!hydrated || busy}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          label={S.company.mission}
          size="sm"
          rows={3}
          value={mission}
          disabled={!hydrated || busy}
          hint={S.company.missionHint}
          onChange={(e) => setMission(e.target.value)}
        />
        <ModelField
          models={models}
          loadError={modelsError}
          value={modelRef}
          onChange={setModelRef}
          disabled={!hydrated || busy}
        />
        <WorkspaceField projectId={projectId} value={workspace} onChange={setWorkspace} />
        <Input
          label={S.company.timezone}
          size="sm"
          value={timezone}
          disabled={!hydrated || busy}
          hint={S.company.timezoneHint}
          className="font-mono"
          onChange={(e) => setTimezone(e.target.value)}
        />
        <div>
          {/* The "?" sits beside the field's own title (Select carries no info slot). */}
          <span className="mb-1 flex items-center gap-1">
            <FieldLabel block={false}>{S.company.language}</FieldLabel>
            <InfoPopover label={S.company.language}>{S.company.languageInfo}</InfoPopover>
          </span>
          <Select
            size="sm"
            aria-label={S.company.language}
            value={language}
            disabled={!hydrated || busy}
            onChange={(e) => setLanguage(e.target.value as OrgLanguage)}
          >
            {ORG_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {S.company.languages[l]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          {/* The "?" sits beside the field's own title (Select carries no info slot). */}
          <span className="mb-1 flex items-center gap-1">
            <FieldLabel block={false}>{S.company.approvalMode}</FieldLabel>
            <InfoPopover label={S.company.approvalMode}>{S.company.approvalModeInfo}</InfoPopover>
          </span>
          <Select
            size="sm"
            aria-label={S.company.approvalMode}
            value={approvalMode}
            disabled={!hydrated || busy}
            onChange={(e) => setApprovalMode(e.target.value as OrgApprovalMode)}
          >
            {APPROVAL_MODES.map((m) => (
              <option key={m} value={m}>
                {S.company.approvalModes[m] ?? m}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </Modal>
  );
}
