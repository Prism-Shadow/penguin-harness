/**
 * The org chart's personnel dialogs. Hire a subordinate — in two sections: the Agent (an
 * existing one of the Project, or a new one: id, name, description, plugins defaulting to
 * agent-company and agent-development) and the position (the employee's name, title, duties,
 * workspace, budget); the employee's profile — the name the organization calls it, written on
 * Save, and its picture, written as it is picked; the single-field edits, each showing the
 * current value first: budget (a monthly cap, typed in the reader's own currency and stored in
 * USD, or unbounded), reporting line (anyone outside the employee's own subtree) and thinking
 * level; and the desk renewal, which writes the workspace and opens a fresh desk session in one
 * confirm. Hire and Save write at once: their button is live only once every required field is
 * filled and nothing typed is malformed (said under the field as it is typed), and Save only once
 * the value differs from the stored one. A hire asks first only when a new Agent's picked plugin
 * brings a stdio MCP server, showing the command it runs on this server. The renewal is its own
 * confirmation. Closing any of them with unsaved edits asks first.
 *
 * The thinking level is not the chart's: a desk reads it from the employee's Agent config at
 * every new model context, and a ticket session opens on it, so that config is what the edit
 * writes — the same write the development draft's picker makes. A level picked inside the desk
 * session pins only that session, which then no longer follows the config; the dialog says so
 * when the current desk is pinned.
 */
import { useEffect, useState, type ChangeEvent } from "react";

import type {
  AgentModelConfigDto,
  OrgEmployeeItem,
  OrgHireRequest,
  PluginItem,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  buttonClass,
  ConfirmModal,
  FieldError,
  FieldLabel,
  FormPicker,
  HiddenFileInput,
  ICONS,
  Input,
  Modal,
  RuledSection,
  Segmented,
  Select,
  Textarea,
  discardUnsaved,
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
import {
  avatarDataUrlFromImage,
  loadAvatarImage,
  releaseAvatarImage,
  type AvatarCrop,
} from "../../lib/avatar-image";

import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { formatMoney } from "../../lib/format";
import { useCompany } from "./company-state";
import { agentDisplayName, useProject } from "../../state/project";
import { useTheme } from "../../state/theme";
import { AvatarCropDialog } from "../../components/ui/avatar-crop-dialog";
import {
  SkillPickList,
  addSkillNames,
  removeSkillNames,
  toggleSkillName,
  type PickableItem,
} from "../skills";

import { StdioDisclosure, stdioServers } from "../plugins";
import { InfoFieldLabel, MoneyPerMonthInput } from "./shared";
import { fromStoredUsd, isBudgetText, toStoredUsd } from "./budget-input";
import { deskRenewPlan } from "./desk-renew";
import { EmployeeAvatar } from "./employee-avatar";
import { managerCandidates } from "./org-chart-tree";
import {
  SELECTABLE_THINKING_LEVELS,
  effectiveThinkingLevel,
  thinkingLevelLabel,
} from "../model-picker";

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

/** A library plugin as a picker row, keeping what the hire confirmation reads: its title and its MCP servers. */
type HirePluginItem = PickableItem & Pick<PluginItem, "title" | "titleZh" | "mcpServers">;

/** The hire form's fields, as typed. */
interface HireDraft {
  source: "existing" | "new";
  agentId: string;
  newId: string;
  newName: string;
  newDescription: string;
  plugins: string[];
  /** What the organization calls the employee; for a new Agent its name stands in when empty. */
  employeeName: string;
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
  const [library, setLibrary] = useState<HirePluginItem[] | null>(null);

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
}: Omit<HireDialogProps, "open"> & { library: HirePluginItem[] | null }) {
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
    employeeName: "",
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
      employeeName: d.employeeName.trim(),
      title: d.title.trim(),
      duties: d.duties.trim(),
      workspace: d.workspace.trim(),
      budget: d.budget.trim(),
    }),
  });
  const { source, agentId, newId, newName, newDescription, plugins } = form.draft;
  const { employeeName, title, duties, workspace, budget } = form.draft;
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Hiring waits on the confirmation a new Agent's stdio MCP server asks for: the command it runs on this server. */
  const [stdioConfirmOpen, setStdioConfirmOpen] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });

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

  /** The new Agent's picked plugins that carry a stdio MCP server: hiring runs their commands on this server. */
  const stdioSeeds =
    source === "new"
      ? (library ?? []).filter(
          (plugin) => plugins.includes(plugin.name) && stdioServers(plugin).length > 0,
        )
      : [];

  /** `confirmed`: the stdio confirmation was answered, or nothing picked asks for one. */
  const hire = async (confirmed = false) => {
    if (!valid || busy) return;
    // A new employee's plugin with a stdio MCP server runs a command on this server whenever a
    // session of the Agent starts: said, and confirmed, before the Agent is created.
    if (!confirmed && stdioSeeds.length > 0) {
      setStdioConfirmOpen(true);
      return;
    }
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
      setStdioConfirmOpen(false);
      onHired();
    } catch (e) {
      setStdioConfirmOpen(false);
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
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
            <Button
              size="sm"
              variant="primary"
              disabled={!valid || busy}
              onClick={() => void hire()}
            >
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
                        emptyHint={
                          library === null ? S.common.loading : S.company.chart.pluginsEmpty
                        }
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
                label={S.company.chart.employeeName}
                size="sm"
                value={employeeName}
                maxLength={64}
                hint={S.company.chart.employeeNameHireHint}
                onChange={(e) => form.patch({ employeeName: e.target.value })}
              />
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
      {/* Only a new Agent whose picked plugin brings a stdio MCP server asks before the hire: that
          server runs a command on this server whenever a session of the Agent starts, said here
          before the Agent is created, as Create Agent asks. Any other hire writes at once. The
          compact card has no title bar, so the body asks. */}
      <ConfirmModal
        open={stdioConfirmOpen}
        title={S.company.chart.hireStdioQuestion(hireName)}
        tone="primary"
        glyph={ICONS.terminalPrompt}
        confirmLabel={S.company.chart.hire}
        cancelLabel={S.common.cancel}
        busy={busy}
        onClose={() => (busy ? undefined : setStdioConfirmOpen(false))}
        onConfirm={() => void hire(true)}
      >
        <div className="space-y-3">
          <p className="text-sm font-medium">{S.company.chart.hireStdioQuestion(hireName)}</p>
          <StdioDisclosure plugins={stdioSeeds} />
        </div>
      </ConfirmModal>
    </>
  );
}

/** Which single-field edit a dialog performs. */
export type EmployeeEdit = "budget" | "reportsTo" | "thinkingLevel";

/** What the thinking-level edit reads before it offers anything: the Agent's own level ("" = none), what that resolves to, and the desk's pin ("" = none). */
interface ThinkingLevelReading {
  own: string;
  effective: string;
  pinned: string;
}

/** A level as the reader sees it: the tier's name, the raw value for anything unknown. */
const levelName = (level: string): string =>
  thinkingLevelLabel(S.chat.thinkingLevelNames, level) ?? level;

/** Where the menu starts for a level in effect: that level, or the default tier for one the menu does not offer ("none"). */
const menuLevel = (effective: string): string =>
  (SELECTABLE_THINKING_LEVELS as readonly string[]).includes(effective) ? effective : "medium";

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
  /** The thinking-level edit's reading; null while it loads (or for the other edits). */
  const [levels, setLevels] = useState<ThinkingLevelReading | null>(null);
  /** The thinking-level edit before its reading has landed: nothing to offer, edit or save yet. */
  const reading = edit === "thinkingLevel" && levels === null;
  /**
   * What the field opens with: the stored budget in the reader's currency, the current manager,
   * or the level in effect once it has been read.
   */
  const opening =
    edit === "budget"
      ? fromStoredUsd(employee.budget, currency)
      : edit === "thinkingLevel"
        ? levels === null
          ? ""
          : menuLevel(levels.effective)
        : (employee.reportsTo ?? managers[0]?.agentId ?? "");
  const [value, setValue] = useState(opening);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (edit === null) return;
    setValue(opening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, employee]);

  // The thinking level lives in the Agent's config, the Project default stands in for an Agent
  // without one, and the desk Session may carry a pin of its own: all three are read before
  // anything is offered. Only the config is required; the other two degrade to "unknown".
  useEffect(() => {
    if (edit !== "thinkingLevel") return;
    setLevels(null);
    let cancelled = false;
    const deskId = employee.desk?.sessionId;
    Promise.all([
      api.getAgentConfig(projectId, employee.agentId),
      api.getChatDefaults(projectId).catch(() => null),
      deskId === undefined ? null : api.getSession(deskId).catch(() => null),
    ]).then(
      ([config, defaults, desk]) => {
        if (cancelled) return;
        const own = config.config.model?.thinkingLevel ?? "";
        const effective = effectiveThinkingLevel(own, defaults?.thinkingLevel);
        const pin = desk?.session.thinkingLevel ?? "";
        setLevels({
          own,
          effective,
          pinned: thinkingLevelLabel(S.chat.thinkingLevelNames, pin) === null ? "" : pin,
        });
        setValue(menuLevel(effective));
      },
      (e: unknown) => {
        if (cancelled) return;
        toastError(apiErrorText(e));
        onClose();
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, employee, projectId]);

  /** The field holds an edit; a closed dialog, or a level still being read, holds none. */
  const dirty = edit !== null && !reading && value.trim() !== opening.trim();
  useUnsavedChanges(dirty, { scope: EMPLOYEE_EDIT_SCOPE, discard: () => setValue(opening) });
  const requestClose = useGuardedClose(onClose, EMPLOYEE_EDIT_SCOPE, { locked: busy });
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
      : edit === "thinkingLevel"
        ? S.company.chart.thinkingLevelTitle(employee.name)
        : S.company.chart.reportsToTitle(employee.name);

  const save = async () => {
    if (edit === null || reading || !dirty || problem !== undefined || busy) return;
    setBusy(true);
    try {
      if (edit === "thinkingLevel") {
        // The PUT carries only this key: the server merges it into the YAML, nothing else moves.
        await api.putAgentConfig(projectId, employee.agentId, {
          config: { model: { thinkingLevel: value as AgentModelConfigDto["thinkingLevel"] } },
        });
        toastSuccess(S.common.saved);
      } else {
        await api.patchOrgEmployee(
          projectId,
          orgId,
          employee.agentId,
          edit === "budget" ? { budget: toStoredUsd(value, currency) } : { reportsTo: value },
        );
        toastSuccess(S.company.chart.saved);
      }
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
              disabled={busy || reading || !dirty || problem !== undefined}
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
        {edit === "thinkingLevel" && (
          <div className="space-y-3">
            <CurrentValue
              value={
                levels === null
                  ? "…"
                  : levels.own === ""
                    ? S.company.chart.thinkingLevelDefault(levelName(levels.effective))
                    : levelName(levels.own)
              }
            />
            <div>
              <InfoFieldLabel
                label={S.chat.thinkingLevel}
                info={S.company.chart.thinkingLevelInfo}
              />
              <Select
                size="sm"
                aria-label={S.chat.thinkingLevel}
                value={value}
                disabled={levels === null}
                onChange={(e) => setValue(e.target.value)}
              >
                {SELECTABLE_THINKING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {levelName(level)}
                  </option>
                ))}
              </Select>
            </div>
            {levels !== null && levels.pinned !== "" && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {S.company.chart.thinkingLevelPinned(levelName(levels.pinned))}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

/**
 * What the organization calls an employee, and what it looks like: the chart entry's `name`
 * and the picture in the organization's `avatars/`. Both are the organization's, not the
 * Agent's — the same Agent may be someone else elsewhere. The picture is written as it is
 * picked (the picker re-encodes it to fit, like a person's own): direct manipulation, with
 * nothing to review first. The name is typed, so it waits for Save, live only while the trimmed
 * name differs from the stored one; closing with an unsaved name asks first, and nothing closes
 * the dialog while a write is in flight.
 */
interface EmployeeProfileDialogProps {
  open: boolean;
  projectId: string;
  orgId: string;
  employee: OrgEmployeeItem;
  onClose: () => void;
  /** The name or the picture was written: the caller re-reads the chart. */
  onChanged: () => void;
}

export function EmployeeProfileDialog({ open, ...props }: EmployeeProfileDialogProps) {
  // Mounted only while open, so every opening starts from the stored name; a re-read of the
  // chart, which a picture write triggers, leaves a name still being typed alone.
  return open ? <EmployeeProfileForm key={props.employee.agentId} {...props} /> : null;
}

function EmployeeProfileForm({
  projectId,
  orgId,
  employee,
  onClose,
  onChanged,
}: Omit<EmployeeProfileDialogProps, "open">) {
  /** The typed name against the stored one; trimmed before comparing, as Save stores it. */
  const form = useFormDraft(employee.givenName ?? "", { normalize: (value) => value.trim() });
  const name = form.draft;
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });

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

  const save = () => {
    if (!form.dirty || busy) return;
    void run(
      () =>
        api.patchOrgEmployee(projectId, orgId, employee.agentId, {
          name: name.trim() === "" ? null : name.trim(),
        }),
      () => {
        toastSuccess(S.company.chart.saved);
        onClose();
      },
    );
  };

  return (
    <Modal
      open
      title={S.company.chart.profileTitle(employee.name)}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={busy || !form.dirty} onClick={save}>
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
            className={`shrink-0 ${buttonClass("secondary", "sm")} ${busy ? "pointer-events-none opacity-60" : ""}`}
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
            form.setDraft(e.target.value);
            setError(undefined);
          }}
        />
      </div>
    </Modal>
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
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
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
      // Saved: forget the form now, not at unmount. The page opens the new desk session next, and
      // the leave guard would hold that over a form with nothing left unsaved.
      discardUnsaved(form.scope);
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
