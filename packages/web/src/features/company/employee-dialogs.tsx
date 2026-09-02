/**
 * The org chart's personnel dialogs. Hire a subordinate — in two sections: the Agent (an
 * existing one of the Project, or a new one: id, name, description, plugins defaulting to
 * agent-company and agent-development) and the position (title, duties, workspace, budget)
 * — and the single-field edits, each showing the current value first: budget (a number, or
 * unbounded), reporting line (anyone outside the employee's own subtree), workspace. Every
 * write stops at the shared ConfirmModal first (the confirmation names what the chart file
 * will say), then calls the API.
 */
import { useEffect, useState } from "react";
import type { OrgEmployeeItem, OrgHireRequest } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { formatMoney } from "../../lib/format";
import { agentDisplayName, useProject } from "../../state/project";
import { useTheme } from "../../state/theme";
import { Button } from "../../components/ui/button";
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
  const [source, setSource] = useState<"existing" | "new">("existing");
  const [agentId, setAgentId] = useState("");
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
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
    if (budget.trim() !== "" && !(Number(budget) >= 0)) next.budget = S.company.chart.budgetHint;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const hire = async () => {
    setBusy(true);
    try {
      const body: OrgHireRequest = {
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
        ...(budget.trim() !== "" ? { budget: Number(budget) } : {}),
        ...(duties.trim() ? { duties: duties.trim() } : {}),
      };
      await api.hireOrgEmployee(projectId, orgId, body);
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
            <Button onClick={onClose} disabled={busy}>
              {S.common.cancel}
            </Button>
            <Button
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
                hint={S.company.chart.workspaceHint}
                placeholder="."
                onChange={(e) => setWorkspace(e.target.value)}
              />
              <Input
                label={S.company.chart.budget}
                size="sm"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={budget}
                placeholder={S.company.chart.budgetPlaceholder}
                hint={S.company.chart.budgetHint}
                {...(errors.budget !== undefined ? { error: errors.budget } : {})}
                onChange={(e) => {
                  setBudget(e.target.value);
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
export type EmployeeEdit = "budget" | "reportsTo" | "workspace";

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
        ? employee.budget === undefined
          ? ""
          : String(employee.budget)
        : edit === "reportsTo"
          ? (employee.reportsTo ?? managers[0]?.agentId ?? "")
          : employee.workspace,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, employee]);

  const managerName = (id: string) => employees.find((e) => e.agentId === id)?.name ?? id;
  const title =
    edit === "budget"
      ? S.company.chart.budgetTitle(employee.name)
      : edit === "reportsTo"
        ? S.company.chart.reportsToTitle(employee.name)
        : S.company.chart.workspaceTitle(employee.name);
  const budgetLabel = (raw: string) =>
    raw.trim() === "" ? S.company.noBudget : formatMoney(Number(raw), currency);
  const confirmText =
    edit === "budget"
      ? S.company.chart.budgetConfirm(employee.name, budgetLabel(value))
      : edit === "reportsTo"
        ? S.company.chart.reportsToConfirm(employee.name, managerName(value))
        : S.company.chart.workspaceConfirm(employee.name, value.trim());

  const validate = (): boolean => {
    if (edit === "budget" && value.trim() !== "" && !(Number(value) >= 0)) {
      setError(S.company.chart.budgetHint);
      return false;
    }
    if (edit === "reportsTo" && !managers.some((m) => m.agentId === value)) {
      setError(S.company.chart.reportsToCycle);
      return false;
    }
    if (edit === "workspace" && value.trim() === "") {
      setError(S.common.requiredField);
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
        edit === "budget"
          ? { budget: value.trim() === "" ? null : Number(value) }
          : edit === "reportsTo"
            ? { reportsTo: value }
            : { workspace: value.trim() },
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
            <Button onClick={onClose} disabled={busy}>
              {S.common.cancel}
            </Button>
            <Button
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
            <Input
              label={S.company.chart.budget}
              size="sm"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={value}
              placeholder={S.company.chart.budgetPlaceholder}
              hint={S.company.chart.budgetHint}
              {...(error !== undefined ? { error } : {})}
              autoFocus
              onChange={(e) => {
                setValue(e.target.value);
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
        {edit === "workspace" && (
          <div className="space-y-3">
            <CurrentValue value={employee.workspace} />
            <Input
              label={S.company.chart.workspace}
              size="sm"
              value={value}
              className="font-mono"
              placeholder="."
              hint={S.company.chart.workspaceHint}
              {...(error !== undefined ? { error } : {})}
              autoFocus
              onChange={(e) => {
                setValue(e.target.value);
                setError(undefined);
              }}
            />
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
