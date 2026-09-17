/**
 * The org chart: the reporting line as a top-down tree with the CEO at the top centre
 * (layout in org-chart-tree.ts), each node an employee card (chart-card.tsx). The card has
 * one menu and no other action: it opens the desk session, and holds the personnel actions
 * below that — hire a subordinate, set budget, change the reporting line, renew the desk (a
 * fresh desk session, and the workspace it runs in), leave. Every one of the personnel actions
 * confirms before it writes the chart file. The card owns when that menu is open (three
 * gestures reach it — see chart-card.tsx); this page only supplies the rows, against the
 * panel's own close, and bumps `viewEpoch` whenever the canvas moves the cards out from under
 * an open one.
 *
 * A card's state dot is NOT the chart's own `state`: that snapshot is re-read on organization
 * events, and a run ending publishes none of them, so an employee that finished would keep its
 * running dot until something unrelated moved. The dots read the session list's live statuses
 * instead (org-sessions.ts, liveEmployeeStates), falling back to the snapshot per employee.
 *
 * The drawing is a canvas, not a page section: the frame fills what is left of the window and
 * clips, and the whole tree is one absolutely positioned layer placed by a single transform,
 * so panning and zooming never re-layout a card. It opens fitted — the whole tree visible and
 * centred — and from there the wheel zooms around the cursor, a drag anywhere that is not a
 * control pans, and the header's − / + step around the frame's centre while the percent
 * readout goes back to the fit. The fit is re-taken as the drawing or the frame changes size
 * (a hire widens the tree, a sidebar collapse widens the frame) until the reader moves the
 * view themselves; from then on it is theirs, and only the percent button gives it back.
 * The arithmetic is in canvas-view.ts.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router";
import type { OrgChartResponse, OrgEmployeeItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk, toneStrip } from "../../lib/tone";
import { useCompany } from "../../state/company";
import { useLiveSessionStatuses } from "../../state/sessions";
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
import { usePointerDrag } from "../dock/use-pointer-drag";
import { OrgPage, OrgPageSkeleton, useOrg } from "./org-layout";
import { orgKey } from "./company-nav";
import { liveEmployeeStates } from "./org-sessions";
import { DESK_ICON } from "./channel-header";
import { CHART_DETACHED_LABEL_H, layoutOrgTree } from "./org-chart-tree";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampView,
  fitView,
  panBy,
  viewTransform,
  wheelZoomFactor,
  zoomAt,
} from "./canvas-view";
import type { CanvasSize, CanvasView } from "./canvas-view";
import { ChartCard, ChartLegend } from "./chart-card";
import { DeskRenewDialog, EmployeeEditDialog, HireDialog } from "./employee-dialogs";
import type { EmployeeEdit } from "./employee-dialogs";

/** Node-menu glyphs (24x24 line paths): the open door of a desk session, a plus person for hiring, a coin for budget, an arrow for the line, a refresh for a fresh desk, a door out for leaving. */
const MENU_ICONS = {
  openDesk: DESK_ICON,
  hire: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6",
  budget: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6",
  reportsTo: "M4 17V7l4 4 4-4v10M16 7h4v4m0-4-6 6",
  renewDesk: "M21 12a9 9 0 1 1-3-6.7M21 3v6h-6",
  leave: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
} as const;

/** The header's zoom buttons (24x24 line paths): a minus and a plus. */
const ZOOM_ICONS = { out: "M5 12h14", in: "M12 5v14M5 12h14" } as const;

/** The canvas never collapses below this, however little of the window the rows above it leave. */
const CANVAS_MIN_H = 240;
/** One arrow-key press, in frame pixels: the canvas has to be navigable without a pointer. */
const CANVAS_KEY_PAN = 48;

/**
 * A press that landed on a control is that control's own: the cards' kebabs must open their
 * menu rather than start a pan, and a press inside an open menu belongs to the menu.
 */
function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a, input, select, textarea") !== null;
}

/**
 * The lowest edge the canvas may reach: the inside of the scrolling column the page sits in,
 * its bottom padding kept. Measured rather than written as a `calc()` — what stands between
 * the window's top and the canvas is a title row plus however many notices the chart has
 * raised, which is not a height CSS can know. The window's edge is the fallback when the walk
 * finds no scroller, which only leaves the canvas one padding too tall.
 */
function columnBottom(el: HTMLElement): number {
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowY === "auto" || style.overflowY === "scroll") {
      return node.getBoundingClientRect().bottom - (parseFloat(style.paddingBottom) || 0);
    }
  }
  return window.innerHeight;
}

export function OrgChartPage() {
  const { projectId, orgId, org } = useOrg();
  const navigate = useNavigate();
  const company = useCompany();
  const { currency } = useTheme();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.chart}` : S.nav.org.chart);
  const [chart, setChart] = useState<OrgChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hireFor, setHireFor] = useState<OrgEmployeeItem | null>(null);
  const [editFor, setEditFor] = useState<{ employee: OrgEmployeeItem; edit: EmployeeEdit } | null>(
    null,
  );
  const [renewFor, setRenewFor] = useState<OrgEmployeeItem | null>(null);
  const [leaveFor, setLeaveFor] = useState<OrgEmployeeItem | null>(null);
  const [busy, setBusy] = useState(false);
  /** The view the reader moved to; null follows the fit, which is what the chart opens at. */
  const [view, setView] = useState<CanvasView | null>(null);
  /**
   * Bumped by every move of the view. A card's menu is anchored at a viewport point, and a
   * pan or a zoom slides the card out from under it — neither a scroll nor a resize, so the
   * panel cannot notice on its own; the cards close theirs when this moves.
   */
  const [viewEpoch, setViewEpoch] = useState(0);
  const [frame, setFrame] = useState<CanvasSize>({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  /** The canvas frame, held as state rather than in a ref: it mounts only once the chart has arrived, and the listeners below attach to it. */
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      setChart(await api.getOrgChart(projectId, orgId));
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId]);
  // A run starting moves a state dot, a ticket change can attach a session to an employee, and
  // a budget event pauses one: reload on those, never on a timer. A run ENDING publishes
  // nothing at all, which is why the dots are drawn from the live statuses below rather than
  // from the state this response carries.
  const { runs, tickets, budget } = company.versions;
  useEffect(() => {
    void load();
  }, [load, runs, tickets, budget]);

  const layout = useMemo(
    () => (chart === null ? null : layoutOrgTree(chart.employees, chart.ceoAgentId)),
    [chart],
  );

  // The dots' states: the live session list first, the chart's own state for an employee whose
  // Sessions that list has not loaded. The ticket sessions come from the organization's own
  // snapshot, which is the only listing that says which employee is working which ticket.
  const liveStatuses = useLiveSessionStatuses();
  const orgSessions = company.orgSessions.get(orgKey(projectId, orgId));
  const employeeStates = useMemo(
    () => liveEmployeeStates(chart?.employees ?? [], orgSessions, liveStatuses),
    [chart, orgSessions, liveStatuses],
  );
  const drawing = useMemo<CanvasSize>(
    () => ({ width: layout?.width ?? 0, height: layout?.height ?? 0 }),
    [layout],
  );
  const fit = useMemo(() => fitView(frame, drawing), [frame, drawing]);
  const current = view ?? fit;
  const percent = Math.round(current.scale * 100);

  // The wheel listener and the pan gesture outlive the render that created them, so they read
  // the view and the two boxes it is clamped against from here rather than from their closure.
  const live = useRef({ view: current, frame, drawing });
  live.current = { view: current, frame, drawing };

  /** Every move of the view goes through here, so none of them can push the drawing off the frame. */
  const applyView = useCallback((next: CanvasView) => {
    setViewEpoch((n) => n + 1);
    setView(clampView(next, live.current.frame, live.current.drawing));
  }, []);

  /** −/+ and their keys step around the frame's centre: what the reader is looking at is what stays put. */
  const zoomStep = useCallback(
    (direction: 1 | -1) => {
      const { view: from, frame: box } = live.current;
      const centre = { x: box.width / 2, y: box.height / 2 };
      applyView(zoomAt(from, centre, direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP));
    },
    [applyView],
  );

  // The canvas fills the rest of the scrolling column, which has to be measured: see
  // columnBottom. Re-measured after every render as well as on a resize, because the notices
  // above the canvas come and go and each one moves its top edge without changing its own box,
  // which is a move no ResizeObserver reports.
  const measure = useCallback(() => {
    if (frameEl === null) return;
    const rect = frameEl.getBoundingClientRect();
    const height = Math.max(CANVAS_MIN_H, columnBottom(frameEl) - rect.top);
    setFrame((prev) =>
      Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - height) < 0.5
        ? prev
        : { width: rect.width, height },
    );
  }, [frameEl]);
  useLayoutEffect(measure);
  useEffect(() => {
    if (frameEl === null) return;
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    ro?.observe(frameEl);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [frameEl, measure]);

  // Wheel zooms around the cursor, and a trackpad pinch — which arrives as a ctrl+wheel —
  // needs no branch of its own. A native listener registered non-passive: React's synthetic
  // onWheel is passive, so a preventDefault there cannot stop the column scrolling instead.
  useEffect(() => {
    if (frameEl === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // clientLeft/clientTop take the frame's border off: the drawing layer is placed from the
      // inside of that border, and an anchor a border's width out drifts as the wheel repeats.
      const rect = frameEl.getBoundingClientRect();
      const pointer = {
        x: event.clientX - rect.left - frameEl.clientLeft,
        y: event.clientY - rect.top - frameEl.clientTop,
      };
      applyView(zoomAt(live.current.view, pointer, wheelZoomFactor(event.deltaY, event.deltaMode)));
    };
    frameEl.addEventListener("wheel", onWheel, { passive: false });
    return () => frameEl.removeEventListener("wheel", onWheel);
  }, [frameEl, applyView]);

  // Drag pans, from anywhere on the canvas that is not a control — the cards are inert, so
  // grabbing one is grabbing the canvas under it. Pointer capture, so a fast pull that leaves
  // the frame (or the window) keeps panning and still ends cleanly.
  const panDrag = usePointerDrag<{ x: number; y: number; view: CanvasView }>({
    threshold: 0,
    begin: (event) => {
      if (isInteractive(event.target)) return null;
      // The keyboard shortcuts act on the focused canvas, and a click is how a pointer user
      // gets there; Safari does not focus a tabindex'd div on its own.
      event.currentTarget.focus();
      setPanning(true);
      return { x: event.clientX, y: event.clientY, view: live.current.view };
    },
    onMove: (event, start) =>
      applyView(panBy(start.view, event.clientX - start.x, event.clientY - start.y)),
    onEnd: () => setPanning(false),
    onCancel: () => setPanning(false),
  });

  /** The canvas's own keys: zoom in, out, back to fit, and the arrows for a pan without a pointer. */
  const onCanvasKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // A key pressed on a card's kebab is the menu's business, not the canvas's.
    if (event.target !== event.currentTarget) return;
    const from = live.current.view;
    switch (event.key) {
      case "+":
      case "=":
        zoomStep(1);
        break;
      case "-":
      case "_":
        zoomStep(-1);
        break;
      case "0":
        setViewEpoch((n) => n + 1);
        setView(null);
        break;
      case "ArrowLeft":
        applyView(panBy(from, CANVAS_KEY_PAN, 0));
        break;
      case "ArrowRight":
        applyView(panBy(from, -CANVAS_KEY_PAN, 0));
        break;
      case "ArrowUp":
        applyView(panBy(from, 0, CANVAS_KEY_PAN));
        break;
      case "ArrowDown":
        applyView(panBy(from, 0, -CANVAS_KEY_PAN));
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const openDesk = async (employee: OrgEmployeeItem) => {
    try {
      const desk = await api.getOrgDesk(projectId, orgId, employee.agentId);
      // The call may have CREATED the desk: the sidebar's 工位 group has to learn its
      // Session id, or it cannot mark the row the shell is about to be on.
      if (desk.created) {
        void company.reloadOrgChart();
        void company.reloadOrgSessions();
      }
      navigate(`/chat/${desk.sessionId}`);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  const runLeave = async () => {
    if (leaveFor === null) return;
    setBusy(true);
    try {
      await api.leaveOrganization(projectId, orgId, leaveFor.agentId);
      toastSuccess(S.company.chart.left(leaveFor.name));
      setLeaveFor(null);
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
    close: () => void,
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
        close();
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

  /* Opening the desk sits first and apart: it is where the reader goes, while everything
     below it rewrites the chart file. `close` is the card's own panel dismissal — the card
     owns the menu, since only it sees the gesture that opened one. */
  const nodeMenu = (employee: OrgEmployeeItem, isCeo: boolean, close: () => void) => (
    <>
      {menuRow(close, MENU_ICONS.openDesk, S.company.openDesk, () => void openDesk(employee))}
      <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
      {menuRow(close, MENU_ICONS.hire, S.company.chart.hire, () => setHireFor(employee))}
      {menuRow(close, MENU_ICONS.budget, S.company.chart.setBudget, () =>
        setEditFor({ employee, edit: "budget" }),
      )}
      {!isCeo &&
        menuRow(close, MENU_ICONS.reportsTo, S.company.chart.changeReportsTo, () =>
          setEditFor({ employee, edit: "reportsTo" }),
        )}
      {menuRow(close, MENU_ICONS.renewDesk, S.company.chart.renewDesk, () => setRenewFor(employee))}
      <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
      {isCeo ? (
        <span className="block px-2.5 py-1.5 text-xs text-gray-400 dark:text-gray-500">
          {S.company.chart.ceoCannotLeave}
        </span>
      ) : (
        menuRow(close, MENU_ICONS.leave, S.company.chart.leave, () => setLeaveFor(employee), true)
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
        disabled={current.scale <= ZOOM_MIN}
        onClick={() => zoomStep(-1)}
      >
        <GlyphIcon d={ZOOM_ICONS.out} size={ICON_SIZE.iconButton} />
      </Button>
      <button
        type="button"
        title={S.company.chart.zoomFit}
        aria-label={`${S.company.chart.zoomFit} · ${percent}%`}
        onClick={() => {
          setViewEpoch((n) => n + 1);
          setView(null);
        }}
        className="min-w-11 rounded-md px-1 py-1 text-center text-xs text-gray-600 tabular-nums transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
      >
        {percent}%
      </button>
      <Button
        size="icon"
        variant="ghost"
        title={S.company.chart.zoomIn}
        aria-label={S.company.chart.zoomIn}
        disabled={current.scale >= ZOOM_MAX}
        onClick={() => zoomStep(1)}
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
          {/* The canvas: a clipping frame that fills the window, and one transformed layer
              inside it. `select-none` because a drag across the cards is a pan, not a
              selection; `touch-action: none` because it is a one-finger pan, not a scroll. */}
          <div
            ref={setFrameEl}
            role="group"
            aria-label={S.company.chart.canvas}
            tabIndex={0}
            onKeyDown={onCanvasKeyDown}
            {...panDrag}
            style={{ height: frame.height, touchAction: "none" }}
            className={`relative select-none overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60 outline-none focus-visible:border-gray-400 dark:border-gray-800 dark:bg-gray-900/40 dark:focus-visible:border-gray-600 ${
              panning ? "cursor-grabbing" : "cursor-grab"
            }`}
          >
            <div
              className="absolute top-0 left-0 origin-top-left"
              style={{
                width: layout.width,
                height: layout.height,
                transform: viewTransform(current),
              }}
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
                    state={employeeStates.get(employee.agentId) ?? employee.state}
                    currency={currency}
                    x={node.x}
                    y={node.y}
                    detached={node.detached}
                    viewEpoch={viewEpoch}
                    menu={(close) => nodeMenu(employee, isCeo, close)}
                  />
                );
              })}
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
      {renewFor !== null && (
        <DeskRenewDialog
          open
          projectId={projectId}
          orgId={orgId}
          employee={renewFor}
          onClose={() => setRenewFor(null)}
          onChartChanged={() => void load()}
          onRenewed={(sessionId) => {
            setRenewFor(null);
            void company.reloadOrgChart();
            void company.reloadOrgSessions();
            navigate(`/chat/${sessionId}`);
          }}
        />
      )}
      <ConfirmModal
        open={leaveFor !== null}
        title={S.company.chart.leave}
        tone="danger"
        confirmLabel={S.common.confirm}
        busy={busy}
        onClose={() => (busy ? undefined : setLeaveFor(null))}
        onConfirm={() => void runLeave()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {leaveFor === null ? "" : S.company.chart.leaveConfirm(leaveFor.name)}
        </p>
      </ConfirmModal>
    </OrgPage>
  );
}
