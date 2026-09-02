/**
 * The org chart: the reporting line as a tree with the CEO at the root (layout in
 * org-chart-tree.ts, the subagent topology's algorithm), each node an employee — avatar,
 * name, title, live state dot, this period's spend against its budget, the workspace tail.
 * Clicking a node opens the employee's desk session; the node's menu holds the personnel
 * actions (hire a subordinate, set budget, change the reporting line, set the workspace, a
 * new desk session, leave), every one of which confirms before it writes the chart file.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { OrgChartResponse, OrgEmployeeItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatMoney } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import { useCompany } from "../../state/company";
import { useTheme } from "../../state/theme";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Dropdown } from "../../components/ui/dropdown";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { EmptyState } from "../../components/ui/empty-state";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { toastError, toastSuccess } from "../../components/ui/toast";
import {
  ELLIPSIS_ICON,
  overflowMenuDangerClass,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../../components/ui/session-row-menu";
import { FOLDER_ICON } from "../../components/ui/group-list";
import { OrgPage, OrgPageSkeleton, useOrg } from "./org-layout";
import { BudgetBar, EmployeeStateDot, INVALID_ICON } from "./shared";
import { budgetTone } from "./finance-tree";
import {
  CHART_NODE_H,
  CHART_NODE_W,
  buildChartTree,
  layoutChart,
  workspaceTail,
} from "./org-chart-tree";
import { EmployeeEditDialog, HireDialog } from "./employee-dialogs";
import type { EmployeeEdit } from "./employee-dialogs";

/** Node-menu glyphs (24x24 line paths): a plus person for hiring, a coin for budget, an arrow for the line, a folder for the workspace, a refresh for the desk, a door for leaving. */
const MENU_ICONS = {
  hire: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6",
  budget: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6",
  reportsTo: "M4 17V7l4 4 4-4v10M16 7h4v4m0-4-6 6",
  workspace: FOLDER_ICON,
  renewDesk: "M21 12a9 9 0 1 1-3-6.7M21 3v6h-6",
  leave: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
} as const;

export function OrgChartPage() {
  const { projectId, orgId, org } = useOrg();
  const navigate = useNavigate();
  const company = useCompany();
  const { currency } = useTheme();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.chart}` : S.nav.org.chart);
  const [chart, setChart] = useState<OrgChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [hireFor, setHireFor] = useState<OrgEmployeeItem | null>(null);
  const [editFor, setEditFor] = useState<{ employee: OrgEmployeeItem; edit: EmployeeEdit } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<{
    kind: "renew" | "leave";
    employee: OrgEmployeeItem;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setChart(await api.getOrgChart(projectId, orgId));
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId]);
  const { runs, budget } = company.versions;
  useEffect(() => {
    void load();
  }, [load, runs, budget]);

  const openDesk = async (employee: OrgEmployeeItem) => {
    try {
      const desk = await api.getOrgDesk(projectId, orgId, employee.agentId);
      navigate(`/chat/${desk.sessionId}`);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  const runConfirmed = async () => {
    if (confirm === null) return;
    setBusy(true);
    try {
      if (confirm.kind === "renew") {
        const desk = await api.renewOrgDesk(projectId, orgId, confirm.employee.agentId);
        toastSuccess(S.company.chart.renewed);
        setConfirm(null);
        navigate(`/chat/${desk.sessionId}`);
        return;
      }
      await api.leaveOrganization(projectId, orgId, confirm.employee.agentId);
      toastSuccess(S.company.chart.left(confirm.employee.name));
      setConfirm(null);
      void load();
      void company.reloadOrganizations();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (error !== null && chart === null) {
    return (
      <OrgPage title={S.nav.org.chart} info={S.company.chart.info}>
        <EmptyState
          title={error}
          action={<Button onClick={() => void load()}>{S.common.retry}</Button>}
        />
      </OrgPage>
    );
  }
  if (chart === null) {
    return (
      <OrgPage title={S.nav.org.chart} info={S.company.chart.info}>
        <OrgPageSkeleton />
      </OrgPage>
    );
  }

  const byId = new Map(chart.employees.map((e) => [e.agentId, e]));
  const { nodes, orphans } = buildChartTree(chart.employees, chart.ceoAgentId);
  const layout = layoutChart(nodes);

  const menuRow = (
    icon: string,
    label: string,
    onClick: () => void,
    danger = false,
    disabled = false,
  ) => (
    <button
      type="button"
      className={danger ? overflowMenuDangerClass : overflowMenuRowClass}
      disabled={disabled}
      onClick={() => {
        setMenuFor(null);
        onClick();
      }}
    >
      {danger ? (
        <span className="shrink-0">
          <GlyphIcon d={icon} size={ICON_SIZE.inlineGlyph} />
        </span>
      ) : (
        overflowMenuGlyph(icon)
      )}
      {label}
    </button>
  );

  const renderNode = (employee: OrgEmployeeItem, x: number, y: number) => {
    const isCeo = employee.agentId === chart.ceoAgentId;
    const tone = budgetTone(employee.spend.ratio);
    const spend =
      employee.budget === undefined
        ? formatMoney(employee.spend.cumulative, currency)
        : S.company.spendOfBudget(
            formatMoney(employee.spend.cumulative, currency),
            formatMoney(employee.budget, currency),
          );
    return (
      <div
        key={employee.agentId}
        style={{ left: x, top: y, width: CHART_NODE_W, height: CHART_NODE_H }}
        className={`absolute flex items-stretch rounded-md border bg-white dark:bg-gray-900 ${
          employee.invalid !== undefined
            ? "border-red-300 dark:border-red-800"
            : "border-gray-200 dark:border-gray-700"
        }`}
      >
        <button
          type="button"
          title={
            employee.invalid !== undefined
              ? `${employee.name} · ${employee.invalid}`
              : `${employee.name} · ${S.company.openDesk}`
          }
          onClick={() => void openDesk(employee)}
          className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-l-md px-2 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/60"
        >
          <span className="flex w-full min-w-0 items-center gap-1.5">
            <AgentAvatar
              id={employee.agentId}
              name={employee.name}
              size={18}
              className="shrink-0 rounded"
            />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-800 dark:text-gray-200">
              {employee.name}
            </span>
            {isCeo && <Badge tone="brand">{S.company.ceo}</Badge>}
            <EmployeeStateDot state={employee.state} />
          </span>
          <span className="flex w-full min-w-0 items-center gap-1.5 pl-[24px] text-[11px] text-gray-500 dark:text-gray-400">
            <span className="min-w-0 truncate">{employee.title}</span>
            <span className={`shrink-0 tabular-nums ${tone === "muted" ? "" : toneInk[tone]}`}>
              {spend}
            </span>
          </span>
          <span className="flex w-full min-w-0 items-center gap-1 pl-[24px] font-mono text-[10px] text-gray-400 dark:text-gray-500">
            <GlyphIcon d={FOLDER_ICON} size={10} />
            <span
              className="min-w-0 truncate"
              title={employee.resolvedWorkspace ?? employee.workspace}
            >
              {workspaceTail(employee.workspace)}
            </span>
            {employee.invalid !== undefined && (
              <span className={`ml-auto shrink-0 ${toneInk.danger}`} title={employee.invalid}>
                <GlyphIcon d={INVALID_ICON} size={10} />
                <span className="sr-only">{S.company.chart.invalidEntry}</span>
              </span>
            )}
          </span>
        </button>
        {/* The node menu: the personnel actions, in the overflow-menu style of the session rows. */}
        <Dropdown
          open={menuFor === employee.agentId}
          setOpen={(v) => setMenuFor(v ? employee.agentId : null)}
          portal={{ direction: "down", align: "right" }}
          menuClass="w-44"
          className="flex shrink-0 items-center"
          button={
            <button
              type="button"
              title={S.company.chart.nodeMenu}
              aria-label={`${employee.name} · ${S.company.chart.nodeMenu}`}
              aria-haspopup="menu"
              aria-expanded={menuFor === employee.agentId}
              onClick={() => setMenuFor(menuFor === employee.agentId ? null : employee.agentId)}
              className="flex h-full w-7 items-center justify-center rounded-r-md text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <GlyphIcon d={ELLIPSIS_ICON} size={ICON_SIZE.groupHeaderAction} filled />
            </button>
          }
        >
          {menuRow(MENU_ICONS.hire, S.company.chart.hire, () => setHireFor(employee))}
          {menuRow(MENU_ICONS.budget, S.company.chart.setBudget, () =>
            setEditFor({ employee, edit: "budget" }),
          )}
          {!isCeo &&
            menuRow(MENU_ICONS.reportsTo, S.company.chart.changeReportsTo, () =>
              setEditFor({ employee, edit: "reportsTo" }),
            )}
          {menuRow(MENU_ICONS.workspace, S.company.chart.setWorkspace, () =>
            setEditFor({ employee, edit: "workspace" }),
          )}
          {menuRow(MENU_ICONS.renewDesk, S.company.chart.renewDesk, () =>
            setConfirm({ kind: "renew", employee }),
          )}
          <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
          {isCeo ? (
            <span className="block px-2.5 py-1.5 text-xs text-gray-400 dark:text-gray-500">
              {S.company.chart.ceoCannotLeave}
            </span>
          ) : (
            menuRow(
              MENU_ICONS.leave,
              S.company.chart.leave,
              () => setConfirm({ kind: "leave", employee }),
              true,
            )
          )}
        </Dropdown>
      </div>
    );
  };

  return (
    <OrgPage title={S.nav.org.chart} info={S.company.chart.info} wide>
      {nodes.length === 0 ? (
        <EmptyState title={S.company.chart.empty} />
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="relative" style={{ width: layout.width, height: layout.height }}>
            <svg
              width={layout.width}
              height={layout.height}
              className="absolute inset-0 text-gray-300 dark:text-gray-700"
              aria-hidden
            >
              {layout.edges.map((edge) => (
                <path
                  key={`${edge.fromId}>${edge.toId}`}
                  d={edge.path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              ))}
            </svg>
            {layout.nodes.map(({ node, x, y }) => {
              const employee = byId.get(node.id);
              return employee === undefined ? null : renderNode(employee, x, y);
            })}
          </div>
        </div>
      )}
      {orphans.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className={`text-xs ${toneInk.danger}`}>{S.company.chart.invalidEntry}</p>
          <div className="relative flex flex-wrap gap-3">
            {orphans.map((id) => {
              const employee = byId.get(id);
              return employee === undefined ? null : (
                <div
                  key={id}
                  className="relative"
                  style={{ width: CHART_NODE_W, height: CHART_NODE_H }}
                >
                  {renderNode(employee, 0, 0)}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* The CEO's own budget bar under the chart: the whole organization's spend. */}
      {(() => {
        const ceo = byId.get(chart.ceoAgentId);
        return ceo === undefined ? null : (
          <div className="mt-4 max-w-md">
            <BudgetBar
              cost={ceo.spend.cumulative}
              currency={currency}
              {...(ceo.budget !== undefined ? { budget: ceo.budget } : {})}
              {...(ceo.spend.ratio !== undefined ? { ratio: ceo.spend.ratio } : {})}
            />
          </div>
        );
      })()}

      {hireFor !== null && (
        <HireDialog
          open
          projectId={projectId}
          orgId={orgId}
          manager={hireFor}
          employees={chart.employees}
          onClose={() => setHireFor(null)}
          onHired={() => {
            setHireFor(null);
            void load();
            void company.reloadOrganizations();
          }}
        />
      )}
      {editFor !== null && (
        <EmployeeEditDialog
          edit={editFor.edit}
          projectId={projectId}
          orgId={orgId}
          employee={editFor.employee}
          employees={chart.employees}
          onClose={() => setEditFor(null)}
          onSaved={() => {
            setEditFor(null);
            void load();
          }}
        />
      )}
      <ConfirmModal
        open={confirm !== null}
        title={confirm?.kind === "leave" ? S.company.chart.leave : S.company.chart.renewDesk}
        tone={confirm?.kind === "leave" ? "danger" : "primary"}
        confirmLabel={S.common.confirm}
        busy={busy}
        onClose={() => (busy ? undefined : setConfirm(null))}
        onConfirm={() => void runConfirmed()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {confirm === null
            ? ""
            : confirm.kind === "leave"
              ? S.company.chart.leaveConfirm(confirm.employee.name)
              : S.company.chart.renewDeskConfirm(confirm.employee.name)}
        </p>
      </ConfirmModal>
    </OrgPage>
  );
}
