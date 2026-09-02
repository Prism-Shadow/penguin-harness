/**
 * The org chart: the reporting line as a top-down tree with the CEO at the top centre
 * (layout in org-chart-tree.ts), each node an employee card (chart-card.tsx). Clicking a
 * card opens the employee's desk session; the card's menu holds the personnel actions —
 * hire a subordinate, set budget, change the reporting line, set the workspace, a new desk
 * session, leave — every one of which confirms before it writes the chart file.
 *
 * The drawing centres itself when narrower than the page and scrolls sideways when wider.
 * A wide chart opens shrunk to fit the page's width; the header's zoom control steps
 * between 60% and 120%, and its readout puts the chart back to fit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { OrgChartResponse, OrgEmployeeItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk, toneStrip } from "../../lib/tone";
import { useCompany } from "../../state/company";
import { useTheme } from "../../state/theme";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { toastError, toastSuccess } from "../../components/ui/toast";
import {
  overflowMenuDangerClass,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../../components/ui/session-row-menu";
import { FOLDER_ICON } from "../../components/ui/group-list";
import { OrgPage, OrgPageSkeleton, useOrg } from "./org-layout";
import { CHART_DETACHED_LABEL_H, layoutOrgTree } from "./org-chart-tree";
import { ZOOM_MAX, ZOOM_MIN, fitZoom, stepZoom } from "./chart-view";
import { ChartCard, ChartLegend } from "./chart-card";
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

/** The header's zoom buttons (24x24 line paths): a minus and a plus. */
const ZOOM_ICONS = { out: "M5 12h14", in: "M12 5v14M5 12h14" } as const;

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
  /** The chosen zoom; null is fit-to-width, the default. */
  const [zoom, setZoom] = useState<number | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);

  // The frame's width decides the fit zoom; a ResizeObserver keeps it current through
  // sidebar collapses and window resizes. A callback ref, because the frame mounts only
  // once the chart has arrived.
  const observer = useRef<ResizeObserver | null>(null);
  const frameRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (el === null) return;
    setFrameWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setFrameWidth(width);
    });
    ro.observe(el);
    observer.current = ro;
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);

  const load = useCallback(async () => {
    try {
      setChart(await api.getOrgChart(projectId, orgId));
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId]);
  // A run starting or ending moves a state dot, a ticket change can attach a session to an
  // employee, and a budget event pauses one: reload on those, never on a timer.
  const { runs, tickets, budget } = company.versions;
  useEffect(() => {
    void load();
  }, [load, runs, tickets, budget]);

  const layout = useMemo(
    () => (chart === null ? null : layoutOrgTree(chart.employees, chart.ceoAgentId)),
    [chart],
  );
  const scale = layout === null ? 1 : (zoom ?? fitZoom(frameWidth, layout.width));
  const percent = Math.round(scale * 100);

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
  if (chart === null || layout === null) {
    return (
      <OrgPage title={S.nav.org.chart} info={S.company.chart.info}>
        <OrgPageSkeleton />
      </OrgPage>
    );
  }

  const byId = new Map(chart.employees.map((e) => [e.agentId, e]));

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

  const nodeMenu = (employee: OrgEmployeeItem, isCeo: boolean) => (
    <>
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
    </>
  );

  const zoomControl = (
    <div className="flex items-center" role="group" aria-label={S.company.chart.zoom}>
      <Button
        size="icon"
        variant="ghost"
        title={S.company.chart.zoomOut}
        aria-label={S.company.chart.zoomOut}
        disabled={scale <= ZOOM_MIN}
        onClick={() => setZoom(stepZoom(scale, -1))}
      >
        <GlyphIcon d={ZOOM_ICONS.out} size={ICON_SIZE.iconButton} />
      </Button>
      <button
        type="button"
        title={S.company.chart.zoomFit}
        aria-label={`${S.company.chart.zoomFit} · ${percent}%`}
        onClick={() => setZoom(null)}
        className="min-w-11 rounded-md px-1 py-1 text-center text-xs text-gray-600 tabular-nums transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
      >
        {percent}%
      </button>
      <Button
        size="icon"
        variant="ghost"
        title={S.company.chart.zoomIn}
        aria-label={S.company.chart.zoomIn}
        disabled={scale >= ZOOM_MAX}
        onClick={() => setZoom(stepZoom(scale, 1))}
      >
        <GlyphIcon d={ZOOM_ICONS.in} size={ICON_SIZE.iconButton} />
      </Button>
    </div>
  );

  return (
    <OrgPage
      title={S.nav.org.chart}
      info={S.company.chart.info}
      wide
      {...(layout.nodes.length > 0 ? { actions: zoomControl } : {})}
    >
      {/* A refresh that failed while a chart is on screen: say so above it, keep the chart. */}
      {error !== null && (
        <div
          className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-xs ${toneStrip.danger}`}
        >
          <span>{S.company.chart.refreshFailed(error)}</span>
          <Button size="sm" onClick={() => void load()}>
            {S.common.retry}
          </Button>
        </div>
      )}
      {layout.detached.length > 0 && (
        <div className={`mb-3 rounded-md border px-3 py-1.5 text-xs ${toneStrip.attention}`}>
          {S.company.chart.detachedNotice(layout.detached.length)}
        </div>
      )}
      {layout.nodes.length === 0 ? (
        <EmptyState title={S.company.chart.empty} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <ChartLegend />
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              {S.company.chart.employeeCount(chart.employees.length)}
            </span>
          </div>
          <div ref={frameRef} className="overflow-x-auto pb-3">
            {/* The scaled box takes the drawing's on-screen size, so `mx-auto` centres it when the frame is wider and the frame scrolls when it is not. */}
            <div
              className="mx-auto"
              style={{ width: layout.width * scale, height: layout.height * scale }}
            >
              <div
                className="relative origin-top-left"
                style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}
              >
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
                {layout.detachedTop !== null && (
                  <p
                    className={`absolute right-0 left-0 text-center text-[11px] font-medium ${toneInk.danger}`}
                    style={{ top: layout.detachedTop - CHART_DETACHED_LABEL_H }}
                  >
                    {S.company.chart.detached}
                  </p>
                )}
                {layout.nodes.map((node) => {
                  const employee = byId.get(node.id);
                  if (employee === undefined) return null;
                  const isCeo = employee.agentId === chart.ceoAgentId;
                  return (
                    <ChartCard
                      key={node.id}
                      employee={employee}
                      isCeo={isCeo}
                      currency={currency}
                      x={node.x}
                      y={node.y}
                      detached={node.detached}
                      menuOpen={menuFor === node.id}
                      setMenuOpen={(open) => setMenuFor(open ? node.id : null)}
                      menu={nodeMenu(employee, isCeo)}
                      onOpen={() => void openDesk(employee)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

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
