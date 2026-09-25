/**
 * The org chart's personnel dialogs. Hire a subordinate — in two sections: the Agent (an
 * existing one of the Project, or a new one: id, name, description, plugins defaulting to
 * agent-company and agent-development) and the position (title, duties, workspace, budget)
 * — the single-field edits, each showing the current value first: budget (a monthly cap,
 * typed in the reader's own currency and stored in USD, or unbounded) and reporting line
 * (anyone outside the employee's own subtree); and the desk renewal, which writes the
 * workspace and opens a fresh desk session in one confirm. Every single-field edit stops at
 * the shared ConfirmModal first (the confirmation names what the chart file will say), then
 * calls the API; the renewal is its own confirmation and needs no second one.
 */
import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import type { OrgEmployeeItem, OrgHireRequest } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import {
  avatarDataUrlFromImage,
  loadAvatarImage,
  releaseAvatarImage,
} from "../../lib/avatar-image";
import type { AvatarCrop } from "../../lib/avatar-image";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { formatMoney } from "../../lib/format";
import { useCompany } from "../../state/company";
import { agentDisplayName, useProject } from "../../state/project";
import { useTheme } from "../../state/theme";
import { Button, labelButtonClass } from "../../components/ui/button";
import { AvatarCropDialog } from "../../components/ui/avatar-crop-dialog";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Segmented } from "../../components/ui/segmented";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { FormPicker } from "../../components/ui/form-picker";
import { FieldError, FieldHint, FieldLabel } from "../../components/ui/field";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { PLUGIN_ICON } from "../../components/ui/icons";
import { SkillPickList } from "../skills/skill-pick-list";
import type { PickableItem } from "../skills/skill-pick-list";
import { addSkillNames, removeSkillNames, toggleSkillName } from "../skills/skill-selection";
import { OrgSection } from "./org-layout";
import { MoneyPerMonthInput } from "./shared";
import { fromStoredUsd, isBudgetText, toStoredUsd } from "./budget-input";
import { deskRenewPlan } from "./desk-renew";
import { EmployeeAvatar } from "./employee-avatar";
import { managerCandidates } from "./org-chart-tree";

/** The plugins a new employee starts with: the organization procedures and the development skills. */
const DEFAULT_EMPLOYEE_PLUGINS = ["agent-company", "agent-development"];

/** The "what it is now" line at the top of an edit dialog. */
function CurrentValue({ value }: { value: string }) {
  return (
    <p className="text-xs text-gray-500 dark:text-gray-400">
      {S.company.chart.currentValue(value)}
    </p>
  );
}

export function HireDialog({
  open,
  projectId,
  orgId,
  manager,
  employees,
  onClose,
  onHired,
}: {
  open: boolean;
  projectId: string;
  orgId: string;
  /** The employee the new hire reports to. */
  manager: OrgEmployeeItem;
  employees: readonly OrgEmployeeItem[];
  onClose: () => void;
  onHired: () => void;
}) {
  const { agents } = useProject();
  const { currency } = useTheme();
  const company = useCompany();
  const [source, setSource] = useState<"existing" | "new">("existing");
  const [agentId, setAgentId] = useState("");
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  /** What the organization calls the employee; for a new Agent its name stands in when empty. */
  const [employeeName, setEmployeeName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [plugins, setPlugins] = useState<string[]>(DEFAULT_EMPLOYEE_PLUGINS);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [library, setLibrary] = useState<PickableItem[] | null>(null);
  const [title, setTitle] = useState("");
  const [duties, setDuties] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [budget, setBudget] = useState("");
  const [errors, setErrors] = useState<{ agent?: string; title?: string; budget?: string }>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Agents of the Project not yet in the organization. */
  const employed = new Set(employees.map((e) => e.agentId));
  const candidates = agents.filter((a) => !employed.has(a.agentId));

  useEffect(() => {
    if (!open) return;
    setSource(candidates.length > 0 ? "existing" : "new");
    setAgentId(candidates[0]?.agentId ?? "");
    setNewId("");
    setNewName("");
    setEmployeeName("");
    setNewDescription("");
    setPlugins(DEFAULT_EMPLOYEE_PLUGINS);
    setTitle("");
    setDuties("");
    setWorkspace("");
    setBudget("");
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The plugin library is fetched the first time the dialog opens, for the picker.
  useEffect(() => {
    if (!open || library !== null) return;
    let cancelled = false;
    void api
      .getPluginLibrary()
      .then((res) => {
        if (cancelled) return;
        setLibrary(
          res.groups.flatMap((g) => g.plugins.map((p) => ({ ...p, fallbackIcon: PLUGIN_ICON }))),
        );
      })
      .catch(() => {
        if (!cancelled) setLibrary([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, library]);

  const picked = agents.find((a) => a.agentId === agentId);
  // Left empty, the server partitions the shared workspace by Agent id, so the placeholder
  // shows the directory this hire will actually get rather than the root, which is nobody's desk.
  const hireAgentId = (source === "existing" ? agentId : newId.trim()) || ".";
  const hireName =
    source === "existing"
      ? picked !== undefined
        ? agentDisplayName(picked)
        : agentId
      : newName.trim() || newId.trim();

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (source === "existing") {
      if (!agentId) next.agent = S.common.requiredField;
    } else if (!newId.trim()) {
      next.agent = S.common.requiredField;
    } else if (!SEMANTIC_ID_PATTERN.test(newId.trim())) {
      next.agent = S.company.chart.agentIdHint;
    }
    if (!title.trim()) next.title = S.common.requiredField;
    if (!isBudgetText(budget)) next.budget = S.company.chart.budgetHint;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const hire = async () => {
    setBusy(true);
    try {
      // The box speaks the reader's currency; the chart file holds USD.
      const budgetUsd = toStoredUsd(budget, currency);
      const body: OrgHireRequest = {
        ...(employeeName.trim() ? { name: employeeName.trim() } : {}),
        title: title.trim(),
        reportsTo: manager.agentId,
        ...(source === "existing"
          ? { agentId }
          : {
              newAgent: {
                agentId: newId.trim(),
                ...(newName.trim() ? { name: newName.trim() } : {}),
                ...(newDescription.trim() ? { description: newDescription.trim() } : {}),
                plugins,
              },
            }),
        ...(workspace.trim() ? { workspace: workspace.trim() } : {}),
        ...(budgetUsd !== null ? { budget: budgetUsd } : {}),
        ...(duties.trim() ? { duties: duties.trim() } : {}),
      };
      await api.hireOrgEmployee(projectId, orgId, body);
      // The hire opened the newcomer's desk session: re-read the organization's sessions so
      // the sidebar's 工位 row carries its real id straight away, rather than a row that
      // cannot be opened or bound until some later event happens to refresh the cache.
      void company.reloadOrgSessions();
      toastSuccess(S.company.chart.hired(hireName));
      setConfirmOpen(false);
      onHired();
    } catch (e) {
      setConfirmOpen(false);
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        title={S.company.chart.hireTitle(manager.name)}
        onClose={onClose}
        widthClass="sm:max-w-lg"
        footer={
          <>
            <Button size="sm" onClick={onClose} disabled={busy}>
              {S.common.cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => {
                if (validate()) setConfirmOpen(true);
              }}
            >
              {S.company.chart.hire}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <OrgSection title={S.company.chart.hireAgentSection}>
            <div className="space-y-3">
              <div>
                <FieldLabel>{S.company.chart.hireSource}</FieldLabel>
                <Segmented
                  options={[
                    { value: "existing" as const, label: S.company.chart.hireExisting },
                    { value: "new" as const, label: S.company.chart.hireNew },
                  ]}
                  value={source}
                  onChange={setSource}
                  cols={2}
                />
              </div>
              {source === "existing" ? (
                <Select
                  size="sm"
                  label={S.company.chart.agent}
                  required
                  value={agentId}
                  hint={S.company.chart.agentHint}
                  {...(errors.agent !== undefined ? { error: errors.agent } : {})}
                  onChange={(e) => {
                    setAgentId(e.target.value);
                    setErrors((p) => ({ ...p, agent: undefined }));
                  }}
                >
                  {candidates.length === 0 ? (
                    <option value="">{S.company.chart.noAgentsLeft}</option>
                  ) : (
                    candidates.map((a) => (
                      <option key={a.agentId} value={a.agentId}>
                        {agentDisplayName(a)} ({a.agentId})
                      </option>
                    ))
                  )}
                </Select>
              ) : (
                <>
                  <Input
                    label={S.company.chart.agentId}
                    required
                    size="sm"
                    value={newId}
                    className="font-mono"
                    hint={S.company.chart.agentIdHint}
                    {...(errors.agent !== undefined ? { error: errors.agent } : {})}
                    onChange={(e) => {
                      setNewId(e.target.value);
                      setErrors((p) => ({ ...p, agent: undefined }));
                    }}
                  />
                  <Input
                    label={S.company.chart.agentName}
                    size="sm"
                    value={newName}
                    hint={S.company.chart.agentNameHint}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <Textarea
                    label={S.company.chart.agentDescription}
                    size="sm"
                    rows={2}
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                  />
                  <div>
                    <FieldLabel>{S.company.chart.plugins}</FieldLabel>
                    <FormPicker
                      open={pluginsOpen}
                      setOpen={setPluginsOpen}
                      label={
                        plugins.length === 0
                          ? S.company.chart.pluginsPlaceholder
                          : S.company.chart.pluginsPicked(plugins.length)
                      }
                      muted={plugins.length === 0}
                      title={S.company.chart.plugins}
                      ariaLabel={S.company.chart.plugins}
                      disabled={busy}
                      menuClass="w-[26rem]"
                    >
                      <SkillPickList
                        skills={library ?? []}
                        selected={plugins}
                        onToggle={(name) => setPlugins((prev) => toggleSkillName(prev, name))}
                        onSelectAll={(names) => setPlugins((prev) => addSkillNames(prev, names))}
                        onSelectNone={(names) =>
                          setPlugins((prev) => removeSkillNames(prev, names))
                        }
                        emptyHint={
                          library === null ? S.common.loading : S.company.chart.pluginsEmpty
                        }
                        searchPlaceholder={S.plugins.searchPlaceholder}
                      />
                    </FormPicker>
                    <FieldHint>{S.company.chart.pluginsHint}</FieldHint>
                  </div>
                </>
              )}
            </div>
          </OrgSection>
          <OrgSection title={S.company.chart.hirePositionSection}>
            <div className="space-y-3">
              <Input
                label={S.company.chart.employeeName}
                size="sm"
                value={employeeName}
                maxLength={64}
                hint={S.company.chart.employeeNameHireHint}
                onChange={(e) => setEmployeeName(e.target.value)}
              />
              <Input
                label={S.company.chart.employeeTitle}
                required
                size="sm"
                value={title}
                placeholder={S.company.chart.employeeTitlePlaceholder}
                {...(errors.title !== undefined ? { error: errors.title } : {})}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setErrors((p) => ({ ...p, title: undefined }));
                }}
              />
              <Textarea
                label={S.company.chart.duties}
                size="sm"
                rows={2}
                value={duties}
                hint={S.company.chart.dutiesHint}
                onChange={(e) => setDuties(e.target.value)}
              />
              <Input
                label={S.company.chart.workspace}
                size="sm"
                value={workspace}
                className="font-mono"
                hint={S.company.chart.hireWorkspaceHint}
                placeholder={hireAgentId}
                onChange={(e) => setWorkspace(e.target.value)}
              />
              <MoneyPerMonthInput
                label={S.company.chart.budget}
                currency={currency}
                value={budget}
                placeholder={S.company.chart.budgetPlaceholder}
                hint={S.company.chart.budgetHint}
                {...(errors.budget !== undefined ? { error: errors.budget } : {})}
                onChange={(text) => {
                  setBudget(text);
                  setErrors((p) => ({ ...p, budget: undefined }));
                }}
              />
            </div>
          </OrgSection>
        </div>
      </Modal>
      <ConfirmModal
        open={confirmOpen}
        title={S.company.chart.hire}
        tone="primary"
        confirmLabel={S.common.confirm}
        busy={busy}
        onClose={() => (busy ? undefined : setConfirmOpen(false))}
        onConfirm={() => void hire()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.company.chart.hireConfirm(hireName, manager.name)}
        </p>
      </ConfirmModal>
    </>
  );
}

/** Which single-field edit a dialog performs. */
export type EmployeeEdit = "budget" | "reportsTo";

export function EmployeeEditDialog({
  edit,
  projectId,
  orgId,
  employee,
  employees,
  onClose,
  onSaved,
}: {
  /** Null closes the dialog. */
  edit: EmployeeEdit | null;
  projectId: string;
  orgId: string;
  employee: OrgEmployeeItem;
  employees: readonly OrgEmployeeItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { currency } = useTheme();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const managers = managerCandidates(employees, employee.agentId);

  useEffect(() => {
    if (edit === null) return;
    setError(undefined);
    setValue(
      edit === "budget"
        ? fromStoredUsd(employee.budget, currency)
        : (employee.reportsTo ?? managers[0]?.agentId ?? ""),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, employee]);

  const managerName = (id: string) => employees.find((e) => e.agentId === id)?.name ?? id;
  const title =
    edit === "budget"
      ? S.company.chart.budgetTitle(employee.name)
      : S.company.chart.reportsToTitle(employee.name);
  /** What the confirmation names: the typed amount as it will be stored, read back in the reader's currency. */
  const budgetLabel = (raw: string) => {
    const usd = toStoredUsd(raw, currency);
    return usd === null ? S.company.noBudget : formatMoney(usd, currency);
  };
  const confirmText =
    edit === "budget"
      ? S.company.chart.budgetConfirm(employee.name, budgetLabel(value))
      : S.company.chart.reportsToConfirm(employee.name, managerName(value));

  const validate = (): boolean => {
    if (edit === "budget" && !isBudgetText(value)) {
      setError(S.company.chart.budgetHint);
      return false;
    }
    if (edit === "reportsTo" && !managers.some((m) => m.agentId === value)) {
      setError(S.company.chart.reportsToCycle);
      return false;
    }
    return true;
  };

  const save = async () => {
    if (edit === null) return;
    setBusy(true);
    try {
      await api.patchOrgEmployee(
        projectId,
        orgId,
        employee.agentId,
        edit === "budget" ? { budget: toStoredUsd(value, currency) } : { reportsTo: value },
      );
      toastSuccess(S.company.chart.saved);
      setConfirmOpen(false);
      onSaved();
    } catch (e) {
      setConfirmOpen(false);
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={edit !== null}
        title={title}
        onClose={onClose}
        footer={
          <>
            <Button size="sm" onClick={onClose} disabled={busy}>
              {S.common.cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => {
                if (validate()) setConfirmOpen(true);
              }}
            >
              {S.common.save}
            </Button>
          </>
        }
      >
        {edit === "budget" && (
          <div className="space-y-3">
            <CurrentValue
              value={
                employee.budget === undefined
                  ? S.company.noBudget
                  : formatMoney(employee.budget, currency)
              }
            />
            <MoneyPerMonthInput
              label={S.company.chart.budget}
              currency={currency}
              value={value}
              placeholder={S.company.chart.budgetPlaceholder}
              hint={S.company.chart.budgetHint}
              {...(error !== undefined ? { error } : {})}
              autoFocus
              onChange={(text) => {
                setValue(text);
                setError(undefined);
              }}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || value.trim() === ""}
                onClick={() => {
                  setValue("");
                  setError(undefined);
                }}
              >
                {S.company.chart.clearBudget}
              </Button>
            </div>
          </div>
        )}
        {edit === "reportsTo" && (
          <div className="space-y-3">
            <CurrentValue
              value={employee.reportsTo === null ? "—" : managerName(employee.reportsTo)}
            />
            <div>
              <Select
                size="sm"
                label={S.company.chart.manager}
                value={value}
                hint={S.company.chart.reportsToHint}
                {...(error !== undefined ? { error } : {})}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(undefined);
                }}
              >
                {managers.map((m) => (
                  <option key={m.agentId} value={m.agentId}>
                    {m.name} · {m.title}
                  </option>
                ))}
              </Select>
              {managers.length === 0 && <FieldError>{S.company.chart.reportsToCycle}</FieldError>}
            </div>
          </div>
        )}
      </Modal>
      <ConfirmModal
        open={confirmOpen}
        title={title}
        tone="primary"
        confirmLabel={S.common.save}
        busy={busy}
        onClose={() => (busy ? undefined : setConfirmOpen(false))}
        onConfirm={() => void save()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{confirmText}</p>
      </ConfirmModal>
    </>
  );
}

/**
 * The desk renewal: one confirm that both re-points the workspace and opens a fresh desk
 * session.
 *
 * The two were separate menu rows, but the pair a reader wants is "give this employee a
 * different working directory, then start its desk over there" — a workspace change reaches
 * the employee at its next desk session anyway. The field is prefilled with the current spec,
 * so confirming without touching it is the plain renewal (desk-renew.ts decides); a changed
 * spec is written first and its 400 lands under the field, leaving the desk alone. A renewal
 * that fails after the chart was already rewritten keeps the dialog open and asks the page to
 * reload, so what is on screen never disagrees with the file.
 */
/**
 * What the organization calls an employee, and what it looks like: the chart entry's `name`
 * and the picture in the organization's `avatars/`. Both are the organization's, not the
 * Agent's — the same Agent may be someone else elsewhere. The picture is written as it is
 * picked (the picker re-encodes it to fit, like a person's own); the name on Save.
 */
export function EmployeeProfileDialog({
  open,
  projectId,
  orgId,
  employee,
  onClose,
  onChanged,
}: {
  open: boolean;
  projectId: string;
  orgId: string;
  employee: OrgEmployeeItem;
  onClose: () => void;
  /** The name or the picture was written: the caller re-reads the chart. */
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(employee.givenName ?? "");
    setError(undefined);
  }, [open, employee]);

  const run = async (work: () => Promise<unknown>, done?: () => void) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      onChanged();
      done?.();
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** The picked image, decoded and waiting for its crop to be chosen. */
  const [cropping, setCropping] = useState<HTMLImageElement | null>(null);
  const endCrop = () => {
    if (cropping !== null) releaseAvatarImage(cropping);
    setCropping(null);
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file === undefined) return;
    setError(undefined);
    loadAvatarImage(file).then(setCropping, () => setError(S.profile.avatarUnreadable));
  };

  const onCropped = (crop: AvatarCrop) => {
    const image = cropping;
    if (image === null) return;
    void run(async () => {
      const dataUrl = avatarDataUrlFromImage(image, crop);
      if (dataUrl === null) throw new Error(S.profile.avatarTooLarge);
      await api.putOrgEmployeeAvatar(projectId, orgId, employee.agentId, dataUrl);
    }).finally(endCrop);
  };

  const save = () =>
    run(
      () =>
        api.patchOrgEmployee(projectId, orgId, employee.agentId, {
          name: name.trim() === "" ? null : name.trim(),
        }),
      () => {
        toastSuccess(S.company.chart.saved);
        onClose();
      },
    );

  return (
    <Modal
      open={open}
      title={S.company.chart.profileTitle(employee.name)}
      onClose={() => (busy ? undefined : onClose())}
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || name.trim() === (employee.givenName ?? "")}
            onClick={() => void save()}
          >
            {S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <EmployeeAvatar
            id={employee.agentId}
            name={employee.name}
            size={48}
            className="rounded-lg"
          />
          <label
            className={`shrink-0 ${labelButtonClass("secondary", "sm")} ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            <HiddenFileInput
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={onPickFile}
            />
            {S.profile.changeAvatar}
          </label>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            disabled={busy || employee.avatarRev === undefined}
            onClick={() =>
              void run(() => api.putOrgEmployeeAvatar(projectId, orgId, employee.agentId, null))
            }
          >
            {S.profile.restoreDefault}
          </Button>
        </div>
        <AvatarCropDialog image={cropping} busy={busy} onCancel={endCrop} onConfirm={onCropped} />
        <Input
          label={S.company.chart.employeeName}
          size="sm"
          value={name}
          maxLength={64}
          disabled={busy}
          placeholder={employee.agentId}
          hint={S.company.chart.employeeNameHint(employee.agentId)}
          {...(error !== undefined ? { error } : {})}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
        />
      </div>
    </Modal>
  );
}

export function DeskRenewDialog({
  open,
  projectId,
  orgId,
  employee,
  onClose,
  onChartChanged,
  onRenewed,
}: {
  open: boolean;
  projectId: string;
  orgId: string;
  employee: OrgEmployeeItem;
  onClose: () => void;
  /** The workspace patch went through: the chart file changed and the page has to re-read it. */
  onChartChanged: () => void;
  /** Both writes went through; carries the new desk session's id. */
  onRenewed: (sessionId: string) => void;
}) {
  const [workspace, setWorkspace] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWorkspace(employee.workspace);
    setError(undefined);
  }, [open, employee]);

  const confirm = async () => {
    const plan = deskRenewPlan(employee.workspace, workspace);
    if (!plan.valid) {
      setError(S.common.requiredField);
      return;
    }
    setBusy(true);
    let patched = false;
    try {
      if (plan.workspace !== null) {
        await api.patchOrgEmployee(projectId, orgId, employee.agentId, {
          workspace: plan.workspace,
        });
        patched = true;
      }
    } catch (e) {
      // A refused workspace is the field's own error, not a toast: the reader has to see it
      // beside the box they must fix. Its code is the server's; anything else is its message.
      setError(
        e instanceof ApiError && e.code === "invalid_workspace"
          ? S.company.chart.workspaceInvalid
          : apiErrorText(e),
      );
      setBusy(false);
      return;
    }
    try {
      const desk = await api.renewOrgDesk(projectId, orgId, employee.agentId);
      toastSuccess(S.company.chart.renewed);
      onRenewed(desk.sessionId);
    } catch (e) {
      toastError(apiErrorText(e));
      if (patched) onChartChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={S.company.chart.renewDeskTitle(employee.name)}
      onClose={() => (busy ? undefined : onClose())}
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void confirm()}>
            {S.company.chart.renewDesk}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* This dialog is its own confirmation, so what it will do stays on screen instead of
            hiding behind a "?" the reader would have to open before deciding. */}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {S.company.chart.renewDeskExplain}
        </p>
        <Input
          label={S.company.chart.workspace}
          required
          size="sm"
          value={workspace}
          className="font-mono"
          placeholder="."
          hint={S.company.chart.workspaceHint}
          {...(error !== undefined ? { error } : {})}
          autoFocus
          onChange={(e) => {
            setWorkspace(e.target.value);
            setError(undefined);
          }}
        />
      </div>
    </Modal>
  );
}
