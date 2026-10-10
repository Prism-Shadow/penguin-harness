/**
 * The org chart's personnel dialogs. Hire a subordinate — in two sections: the Agent (an
 * existing one of the Project, or a new one: id, name, description, plugins defaulting to
 * agent-company and agent-development) and the position (title, duties, workspace, budget)
 * — the single-field edits, each showing the current value first: budget (a monthly cap,
 * typed in the reader's own currency and stored in USD, or unbounded) and reporting line
 * (anyone outside the employee's own subtree); and the desk renewal, which writes the
 * workspace and opens a fresh desk session in one confirm. Hire and Save write at once: their
 * button is live only once every required field is filled and nothing typed is malformed (said
 * under the field as it is typed), and Save only once the value differs from the stored one.
 * The renewal is its own confirmation. Closing any of them with unsaved edits asks first.
 */
import { useEffect, useState } from "react";
import type { OrgEmployeeItem, OrgHireRequest } from "@prismshadow/penguin-server/api";
import {
  Button,
  FieldError,
  FieldLabel,
  FormPicker,
  ICONS,
  Input,
  Modal,
  RuledSection,
  Segmented,
  Select,
  Textarea,
  toastError,
  toastSuccess,
  useFormDraft,
  useGuardedClose,
  useUnsavedChanges,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { closeUnlessBusy } from "../../lib/busy-close";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { formatMoney } from "../../lib/format";
import { useCompany } from "../../state/company";
import { agentDisplayName, useProject } from "../../state/project";
import { useTheme } from "../../state/theme";
import { SkillPickList } from "../skills/skill-pick-list";
import type { PickableItem } from "../skills/skill-pick-list";
import { addSkillNames, removeSkillNames, toggleSkillName } from "../skills/skill-selection";
import { InfoFieldLabel, MoneyPerMonthInput } from "./shared";
import { fromStoredUsd, isBudgetText, toStoredUsd } from "./budget-input";
import { deskRenewPlan } from "./desk-renew";
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

/** The hire form's fields, as typed. */
interface HireDraft {
  source: "existing" | "new";
  agentId: string;
  newId: string;
  newName: string;
  newDescription: string;
  plugins: string[];
  title: string;
  duties: string;
  workspace: string;
  budget: string;
}

interface HireDialogProps {
  open: boolean;
  projectId: string;
  orgId: string;
  /** The employee the new hire reports to. */
  manager: OrgEmployeeItem;
  employees: readonly OrgEmployeeItem[];
  onClose: () => void;
  onHired: () => void;
}

export function HireDialog({ open, ...props }: HireDialogProps) {
  const [library, setLibrary] = useState<PickableItem[] | null>(null);

  // The plugin library is fetched the first time the dialog opens, for the picker.
  useEffect(() => {
    if (!open || library !== null) return;
    let cancelled = false;
    void api
      .getPluginLibrary()
      .then((res) => {
        if (cancelled) return;
        setLibrary(
          res.groups.flatMap((g) => g.plugins.map((p) => ({ ...p, fallbackIcon: ICONS.puzzle }))),
        );
      })
      .catch(() => {
        if (!cancelled) setLibrary([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, library]);

  // The form is mounted only while the dialog is open, so every opening starts blank.
  return open ? <HireForm {...props} library={library} /> : null;
}

function HireForm({
  projectId,
  orgId,
  manager,
  employees,
  onClose,
  onHired,
  library,
}: Omit<HireDialogProps, "open"> & { library: PickableItem[] | null }) {
  const { agents } = useProject();
  const { currency } = useTheme();
  const company = useCompany();

  /** Agents of the Project not yet in the organization. */
  const employed = new Set(employees.map((e) => e.agentId));
  const candidates = agents.filter((a) => !employed.has(a.agentId));

  // Where the form opens: an existing Agent when there is one to pick, else a new one.
  const [opening] = useState<HireDraft>(() => ({
    source: candidates.length > 0 ? "existing" : "new",
    agentId: candidates[0]?.agentId ?? "",
    newId: "",
    newName: "",
    newDescription: "",
    plugins: DEFAULT_EMPLOYEE_PLUGINS,
    title: "",
    duties: "",
    workspace: "",
    budget: "",
  }));
  const form = useFormDraft(opening, {
    normalize: (d) => ({
      ...d,
      newId: d.newId.trim(),
      newName: d.newName.trim(),
      newDescription: d.newDescription.trim(),
      plugins: [...d.plugins].sort(),
      title: d.title.trim(),
      duties: d.duties.trim(),
      workspace: d.workspace.trim(),
      budget: d.budget.trim(),
    }),
  });
  const { source, agentId, newId, newName, newDescription, plugins } = form.draft;
  const { title, duties, workspace, budget } = form.draft;
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(...closeUnlessBusy(busy, onClose, form.scope));

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

  // Malformed values are said under their fields as they are typed; an empty required field is
  // marked by its asterisk and holds Hire until it is filled.
  const idBroken = newId.trim() !== "" && !SEMANTIC_ID_PATTERN.test(newId.trim());
  const budgetBroken = !isBudgetText(budget);
  const valid =
    (source === "existing" ? agentId !== "" : newId.trim() !== "" && !idBroken) &&
    title.trim() !== "" &&
    !budgetBroken;

  const hire = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      // The box speaks the reader's currency; the chart file holds USD.
      const budgetUsd = toStoredUsd(budget, currency);
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
        ...(budgetUsd !== null ? { budget: budgetUsd } : {}),
        ...(duties.trim() ? { duties: duties.trim() } : {}),
      };
      await api.hireOrgEmployee(projectId, orgId, body);
      // The hire opened the newcomer's desk session: re-read the organization's sessions so
      // the sidebar's 工位 row carries its real id straight away, rather than a row that
      // cannot be opened or bound until some later event happens to refresh the cache.
      void company.reloadOrgSessions();
      toastSuccess(S.company.chart.hired(hireName));
      onHired();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={S.company.chart.hireTitle(manager.name)}
      onClose={requestClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={!valid || busy} onClick={() => void hire()}>
            {S.company.chart.hire}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <RuledSection level={3} title={S.company.chart.hireAgentSection}>
          <div className="space-y-3">
            <div>
              <FieldLabel>{S.company.chart.hireSource}</FieldLabel>
              <Segmented
                options={[
                  { value: "existing" as const, label: S.company.chart.hireExisting },
                  { value: "new" as const, label: S.company.chart.hireNew },
                ]}
                value={source}
                onChange={(next) => form.patch({ source: next })}
                cols={2}
              />
            </div>
            {source === "existing" ? (
              <div>
                <InfoFieldLabel
                  label={S.company.chart.agent}
                  info={S.company.chart.agentHint}
                  required
                />
                <Select
                  size="sm"
                  aria-label={S.company.chart.agent}
                  required
                  value={agentId}
                  onChange={(e) => form.patch({ agentId: e.target.value })}
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
              </div>
            ) : (
              <>
                <Input
                  label={S.company.chart.agentId}
                  required
                  size="sm"
                  value={newId}
                  className="font-mono"
                  hint={S.company.chart.agentIdHint}
                  {...(idBroken ? { error: S.company.chart.agentIdHint } : {})}
                  onChange={(e) => form.patch({ newId: e.target.value })}
                />
                <Input
                  label={S.company.chart.agentName}
                  size="sm"
                  value={newName}
                  info={S.company.chart.agentNameHint}
                  onChange={(e) => form.patch({ newName: e.target.value })}
                />
                <Textarea
                  label={S.company.chart.agentDescription}
                  size="sm"
                  rows={2}
                  value={newDescription}
                  onChange={(e) => form.patch({ newDescription: e.target.value })}
                />
                <div>
                  <InfoFieldLabel
                    label={S.company.chart.plugins}
                    info={S.company.chart.pluginsHint}
                  />
                  <FormPicker
                    open={pluginsOpen}
                    setOpen={setPluginsOpen}
                    label={
                      plugins.length === 0
                        ? S.company.chart.pluginsPlaceholder
                        : S.company.chart.pluginsPicked(plugins.length)
                    }
                    muted={plugins.length === 0}
                    ariaLabel={S.company.chart.plugins}
                    disabled={busy}
                    menuClass="w-[26rem]"
                  >
                    <SkillPickList
                      skills={library ?? []}
                      selected={plugins}
                      onToggle={(name) => form.patch({ plugins: toggleSkillName(plugins, name) })}
                      onSelectAll={(names) =>
                        form.patch({ plugins: addSkillNames(plugins, names) })
                      }
                      onSelectNone={(names) =>
                        form.patch({ plugins: removeSkillNames(plugins, names) })
                      }
                      emptyHint={library === null ? S.common.loading : S.company.chart.pluginsEmpty}
                      searchPlaceholder={S.plugins.searchPlaceholder}
                    />
                  </FormPicker>
                </div>
              </>
            )}
          </div>
        </RuledSection>
        <RuledSection level={3} title={S.company.chart.hirePositionSection}>
          <div className="space-y-3">
            <Input
              label={S.company.chart.employeeTitle}
              required
              size="sm"
              value={title}
              placeholder={S.company.chart.employeeTitlePlaceholder}
              onChange={(e) => form.patch({ title: e.target.value })}
            />
            <Textarea
              label={S.company.chart.duties}
              size="sm"
              rows={2}
              value={duties}
              info={S.company.chart.dutiesHint}
              onChange={(e) => form.patch({ duties: e.target.value })}
            />
            <Input
              label={S.company.chart.workspace}
              size="sm"
              value={workspace}
              className="font-mono"
              hint={S.company.chart.workspaceHint}
              placeholder={hireAgentId}
              onChange={(e) => form.patch({ workspace: e.target.value })}
            />
            <MoneyPerMonthInput
              label={S.company.chart.budget}
              currency={currency}
              value={budget}
              placeholder={S.company.noBudget}
              info={S.company.chart.budgetHint}
              {...(budgetBroken ? { error: S.company.chart.budgetHint } : {})}
              onChange={(text) => form.patch({ budget: text })}
            />
          </div>
        </RuledSection>
      </div>
    </Modal>
  );
}

/** Which single-field edit a dialog performs. */
export type EmployeeEdit = "budget" | "reportsTo";

/** The single-field edit's typing: what its close asks about. */
const EMPLOYEE_EDIT_SCOPE = "employee-edit";

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
  const managers = managerCandidates(employees, employee.agentId);
  /** What the field opens with: the stored budget in the reader's currency, or the current manager. */
  const opening =
    edit === "budget"
      ? fromStoredUsd(employee.budget, currency)
      : (employee.reportsTo ?? managers[0]?.agentId ?? "");
  const [value, setValue] = useState(opening);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (edit === null) return;
    setValue(opening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, employee]);

  /** The field holds an edit; a closed dialog holds none. */
  const dirty = edit !== null && value.trim() !== opening.trim();
  useUnsavedChanges(dirty, { scope: EMPLOYEE_EDIT_SCOPE, discard: () => setValue(opening) });
  const requestClose = useGuardedClose(...closeUnlessBusy(busy, onClose, EMPLOYEE_EDIT_SCOPE));
  /** What is wrong with the value as it stands; said under the field once it has been edited. */
  const problem =
    edit === "budget" && !isBudgetText(value)
      ? S.company.chart.budgetHint
      : edit === "reportsTo" && !managers.some((m) => m.agentId === value)
        ? S.company.chart.reportsToCycle
        : undefined;
  const shownProblem = dirty ? problem : undefined;

  const managerName = (id: string) => employees.find((e) => e.agentId === id)?.name ?? id;
  const title =
    edit === "budget"
      ? S.company.chart.budgetTitle(employee.name)
      : S.company.chart.reportsToTitle(employee.name);

  const save = async () => {
    if (edit === null || !dirty || problem !== undefined || busy) return;
    setBusy(true);
    try {
      await api.patchOrgEmployee(
        projectId,
        orgId,
        employee.agentId,
        edit === "budget" ? { budget: toStoredUsd(value, currency) } : { reportsTo: value },
      );
      toastSuccess(S.company.chart.saved);
      onSaved();
    } catch (e) {
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
        onClose={requestClose}
        footer={
          <>
            <Button size="sm" onClick={requestClose} disabled={busy}>
              {S.common.cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !dirty || problem !== undefined}
              onClick={() => void save()}
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
              placeholder={S.company.noBudget}
              info={S.company.chart.budgetHint}
              {...(shownProblem !== undefined ? { error: shownProblem } : {})}
              autoFocus
              onChange={setValue}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || value.trim() === ""}
                onClick={() => setValue("")}
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
              <InfoFieldLabel
                label={S.company.chart.manager}
                info={S.company.chart.reportsToHint}
                required
              />
              <Select
                size="sm"
                aria-label={S.company.chart.manager}
                required
                value={value}
                {...(shownProblem !== undefined ? { error: shownProblem } : {})}
                onChange={(e) => setValue(e.target.value)}
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
interface DeskRenewDialogProps {
  open: boolean;
  projectId: string;
  orgId: string;
  employee: OrgEmployeeItem;
  onClose: () => void;
  /** The workspace patch went through: the chart file changed and the page has to re-read it. */
  onChartChanged: () => void;
  /** Both writes went through; carries the new desk session's id. */
  onRenewed: (sessionId: string) => void;
}

export function DeskRenewDialog({ open, ...props }: DeskRenewDialogProps) {
  // Mounted only while open, so the field starts from the current spec every time.
  return open ? <DeskRenewForm {...props} /> : null;
}

/**
 * The renewal is valid untouched (a plain renewal), so its button waits only for a non-empty
 * field; a changed workspace is an edit, which a close asks about.
 */
function DeskRenewForm({
  projectId,
  orgId,
  employee,
  onClose,
  onChartChanged,
  onRenewed,
}: Omit<DeskRenewDialogProps, "open">) {
  const form = useFormDraft(employee.workspace, { normalize: (value) => value.trim() });
  const workspace = form.draft;
  /** What the server refused about the workspace; cleared by the next keystroke. */
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(...closeUnlessBusy(busy, onClose, form.scope));
  const plan = deskRenewPlan(employee.workspace, workspace);

  const confirm = async () => {
    if (!plan.valid || busy) return;
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
      open
      title={S.company.chart.renewDeskTitle(employee.name)}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !plan.valid}
            onClick={() => void confirm()}
          >
            {S.company.chart.renewDesk}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* What confirming does sits behind the field's "?": the title and the button already
            say a new desk session opens, and the only field is the workspace it writes. */}
        <Input
          label={S.company.chart.workspace}
          required
          size="sm"
          value={workspace}
          className="font-mono"
          placeholder="."
          hint={S.company.chart.workspaceHint}
          info={S.company.chart.renewDeskExplain}
          {...(error !== undefined ? { error } : {})}
          autoFocus
          onChange={(e) => {
            form.setDraft(e.target.value);
            setError(undefined);
          }}
        />
      </div>
    </Modal>
  );
}
