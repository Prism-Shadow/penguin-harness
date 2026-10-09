/**
 * The activity workspace shell: a pinned header, a rail and a detail pane that fill the
 * viewport and scroll separately, so the page itself never scrolls.
 *
 * Height comes from the app shell, which hands a page a `min-h-0 flex-1 overflow-hidden`
 * main element; this fills it with `h-full` and each pane owns its own scrolling, which
 * is the same contract the chat page keeps. The divider follows the workspace file
 * browser's: a real `separator` that drags and also moves by keyboard, with its width
 * remembered only on release rather than on every frame.
 *
 * On the right, a thin icon rail opens one side panel at a time (the player, the agent
 * sessions) beside the work, the way Loom's right rail does, so the main panel stays the
 * only large thing on screen until an author asks for more. That panel has a divider of its
 * own, like Loom's split views, and can fill the whole workspace: the player is what an
 * author most needs to see large.
 *
 * Given the open section, the header also carries the Layout menu (layout-menu.tsx): named
 * arrangements of the rail, the side panel, the section, the player's map and the run log,
 * applied here through the same setters the rail and the panels use.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Chevron } from "../../components/ui/chevron";
import { ChipGroup } from "../../components/ui/chip-group";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CloseIcon } from "../../components/ui/icons";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import {
  SIDE_PANEL_MAX_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  clampSidePanelWidth,
  readSidePanel,
  readSidePanelExpanded,
  readSidePanelWidth,
  sidePanelFitsBeside,
  sidePanelWidthAfterKey,
  sidePanelWidthFor,
  writeSidePanel,
  writeSidePanelExpanded,
  writeSidePanelWidth,
  type StudioPanel,
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  clampRailWidth,
  railFitsBeside,
  railWidthAfterKey,
  railWidthFor,
  readRailCollapsed,
  readRailWidth,
  writeRailCollapsed,
  writeRailWidth,
  type WorkspaceSection,
} from "./workspace-model";
import { LayoutMenu } from "./layout-menu";
import { applyOrder, type LayoutPreset, type LayoutState } from "./layout-presets";
import { setMapVisible, setMapWidth, useMapVisible, useMapWidth } from "./map-prefs";
import { setShowReasoning, useShowReasoning } from "./run-log-prefs";
import { SidePanelFill } from "./side-panel-fill";
import type { PanelBadge } from "./panel-badges";
import { toneDot, toneSurface } from "../../lib/tone";

/** A chip's figure, or a dot while its run is in progress; the words go to a reader. */
function ChipBadge({ badge }: { badge: PanelBadge }) {
  return (
    <>
      {badge.text ? (
        <span
          aria-hidden
          className={`rounded-full px-1.5 text-[11px] leading-4 tabular-nums ${toneSurface[badge.tone]}`}
        >
          {badge.text}
        </span>
      ) : (
        <span
          aria-hidden
          className={`size-1.5 rounded-full motion-safe:animate-pulse ${toneDot[badge.tone]}`}
        />
      )}
      <span className="sr-only">{`, ${badge.label}`}</span>
    </>
  );
}

/** Four corners pointing out, and in: fill the workspace, and put the panel back. */
const EXPAND_ICON = "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5";
const RESTORE_ICON = "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5";

/** One entry of the right rail: its icon, and what its panel shows once opened. */
export interface StudioPanelEntry {
  key: StudioPanel;
  label: string;
  /** A stroke icon path in a 24-unit box. */
  icon: string;
  /** What the panel holds that needs the author, said on the chip. */
  badge?: PanelBadge | null;
  render: () => ReactNode;
}

export function ActivityWorkspace({
  header,
  notices,
  rail,
  panels = [],
  showPanel = null,
  layout,
  children,
}: {
  header: ReactNode;
  /** Banners that belong to the whole activity, under the header and above the panes. */
  notices?: ReactNode;
  /**
   * Given a way to dismiss itself, for the narrow layout where the rail covers the work
   * and a choice should hand the workspace back.
   */
  rail: (dismiss: () => void) => ReactNode;
  /** The panels the right rail offers; none leaves the rail out. */
  panels?: readonly StudioPanelEntry[];
  /**
   * A panel the page wants in front, as when a run it just started should be followed.
   * `at` distinguishes a second request for the same panel from the first.
   */
  showPanel?: { key: StudioPanel; at: number } | null;
  /** The open section and a way to open another, which turns on the Layout menu. */
  layout?: { section: WorkspaceSection; onSection: (section: WorkspaceSection) => void };
  children: ReactNode;
}) {
  const [panel, setPanel] = useState<StudioPanel | null>(() => readSidePanel());
  useEffect(() => {
    if (!showPanel) return;
    setPanel(showPanel.key);
    writeSidePanel(showPanel.key);
  }, [showPanel]);
  const openPanel = panels.find((entry) => entry.key === panel) ?? null;
  const [panelWidth, setPanelWidth] = useState(() => readSidePanelWidth());
  const [expanded, setExpanded] = useState(() => readSidePanelExpanded());
  const [panelDragging, setPanelDragging] = useState(false);
  const endPanelDrag = useRef<(() => void) | null>(null);
  const [panelBody, setPanelBody] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(() => readRailWidth());
  const [collapsed, setCollapsed] = useState(() => readRailCollapsed());
  const [dragging, setDragging] = useState(false);
  const [available, setAvailable] = useState(0);
  // On a workspace too narrow to hold both, the rail is a menu over the work rather than
  // a column beside it, so it starts shut and is never remembered that way: a phone
  // should not decide how the rail opens on a desktop.
  const [narrowOpen, setNarrowOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const endDrag = useRef<(() => void) | null>(null);

  // The rail gives way on a narrow window rather than squeezing the editor past the
  // point where it can show two previews side by side.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setAvailable(body.clientWidth);
    measure();
    // Both, deliberately. The observer catches the width changing without the window
    // doing so — a sidebar collapsing, a dock opening — and the window listener catches
    // the window itself, which is the case a quiet or unsupported observer would miss.
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(body);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  // The side panel takes its width before the tree is measured against what is left, so
  // opening the player never pushes the tree into its narrow, menu-over-the-work form.
  // A panel that fills the workspace lies over the work, which keeps its own layout under it.
  const sideBeside = sidePanelFitsBeside(available);
  const panelApplied = sidePanelWidthFor(panelWidth, available);
  const panelInline = !!openPanel && sideBeside && !expanded;
  const reserved = panelInline ? panelApplied : 0;
  const beside = railFitsBeside(available > 0 ? available - reserved : available);
  const open = beside ? !collapsed : narrowOpen;
  const applied = !open
    ? 0
    : beside
      ? railWidthFor(width, available - reserved)
      : available - reserved;

  // A drag that never sees its pointerup — the system claiming a touch gesture, or this
  // workspace unmounting mid-drag — would otherwise leave the move listener installed.
  useEffect(
    () => () => {
      endDrag.current?.();
      endPanelDrag.current?.();
    },
    [],
  );

  // Opening the rail on a narrow workspace is a temporary answer to having no room for
  // both. Once there is room the answer no longer applies, and keeping it would cover
  // the editor the next time the window narrows.
  useEffect(() => {
    if (beside) setNarrowOpen(false);
  }, [beside]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    if (!body) return;
    // A second pointer on the divider before the first lets go would otherwise strand
    // the first drag's listeners, which keep moving the rail and are never removed.
    endDrag.current?.();
    event.preventDefault();
    setDragging(true);
    const left = body.getBoundingClientRect().left;
    const move = (point: PointerEvent) => setWidth(clampRailWidth(point.clientX - left));
    const release = () => {
      setDragging(false);
      endDrag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", release);
    };
    const done = (point: PointerEvent) => {
      const next = clampRailWidth(point.clientX - left);
      setWidth(next);
      writeRailWidth(next);
      release();
    };
    // A cancelled drag keeps the width the pointer last reached, which is what is on
    // screen; only the listeners go.
    endDrag.current = release;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", release);
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Step from the width on screen, not the remembered one: a narrow window may be
    // showing less than was stored, and starting from the stored value would move the
    // remembered number without moving the rail.
    const next = railWidthAfterKey(applied, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    setWidth(next);
    writeRailWidth(next);
  }

  // The panel's divider: the same drag as the rail's, measured from the workspace's right
  // edge because the panel sits on that side.
  const onPanelPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    if (!body) return;
    endPanelDrag.current?.();
    event.preventDefault();
    setPanelDragging(true);
    const box = body.getBoundingClientRect();
    const widthAt = (point: PointerEvent) =>
      sidePanelWidthFor(box.right - point.clientX, box.width);
    const move = (point: PointerEvent) => setPanelWidth(widthAt(point));
    const release = () => {
      setPanelDragging(false);
      endPanelDrag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", release);
    };
    const done = (point: PointerEvent) => {
      const next = widthAt(point);
      setPanelWidth(next);
      writeSidePanelWidth(next);
      release();
    };
    endPanelDrag.current = release;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", release);
  }, []);

  function onPanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const next = sidePanelWidthAfterKey(panelApplied, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    const fitted = sidePanelWidthFor(next, available);
    setPanelWidth(fitted);
    writeSidePanelWidth(fitted);
  }

  function toggleExpanded() {
    setExpanded((current) => {
      writeSidePanelExpanded(!current);
      return !current;
    });
  }

  function choosePanel(key: StudioPanel) {
    const next = panel === key ? null : key;
    setPanel(next);
    writeSidePanel(next);
  }

  const mapVisible = useMapVisible();
  const mapWidth = useMapWidth();
  const [showReasoning] = useShowReasoning();
  const layoutState: LayoutState | null = layout
    ? {
        railWidth: width,
        railCollapsed: collapsed,
        sidePanel: panel,
        sidePanelWidth: panelWidth,
        section: layout.section,
        mapWidth,
        mapVisible,
        showReasoning,
      }
    : null;

  function applyLayout(preset: LayoutPreset) {
    for (const write of applyOrder(preset.state)) {
      if (write.kind === "railCollapsed") {
        setCollapsed(write.value);
        writeRailCollapsed(write.value);
        // On a narrow workspace the rail is a menu over the work; an open layout opens it.
        if (!beside) setNarrowOpen(!write.value);
      } else if (write.kind === "railWidth") {
        setWidth(write.value);
        writeRailWidth(write.value);
      } else if (write.kind === "sidePanel") {
        setPanel(write.value);
        writeSidePanel(write.value);
      } else if (write.kind === "sidePanelWidth") {
        setPanelWidth(write.value);
        writeSidePanelWidth(write.value);
        // A layout that sizes the panel means it beside the work.
        setExpanded(false);
        writeSidePanelExpanded(false);
      } else if (write.kind === "mapVisible") setMapVisible(write.value);
      else if (write.kind === "mapWidth") setMapWidth(write.value);
      else if (write.kind === "showReasoning") setShowReasoning(write.value);
      else layout?.onSection(write.value);
    }
  }

  function toggle() {
    if (!beside) {
      setNarrowOpen((current) => !current);
      return;
    }
    setCollapsed((current) => {
      writeRailCollapsed(!current);
      return !current;
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-950">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
        {header}
        {layoutState && <LayoutMenu state={layoutState} onApply={applyLayout} />}
        {panels.length > 0 && (
          <ChipGroup<StudioPanel | "">
            label={S.activities.studioPanels.rail}
            value={panel ?? ""}
            onChange={(key) => {
              if (key !== "") choosePanel(key);
            }}
            chipClassName="inline-flex items-center gap-1.5"
            options={panels.map((entry) => ({
              value: entry.key,
              label: (
                <>
                  <GlyphIcon d={entry.icon} size={14} />
                  <span className="hidden sm:inline">{entry.label}</span>
                  <span className="sr-only sm:hidden">{entry.label}</span>
                  {entry.badge && <ChipBadge badge={entry.badge} />}
                </>
              ),
            }))}
          />
        )}
      </div>
      {notices && (
        <div className="shrink-0 space-y-2 border-b border-gray-200 px-4 py-2 empty:hidden dark:border-gray-800">
          {notices}
        </div>
      )}
      <div ref={bodyRef} className="relative flex min-h-0 flex-1">
        <div
          style={open ? { width: `${applied}px` } : undefined}
          className={`flex min-h-0 shrink-0 flex-col border-gray-200 dark:border-gray-800 ${
            open ? "" : "w-auto border-r"
          }`}
        >
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1.5 dark:border-gray-800">
            {open && (
              <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium">
                {S.activities.workspaceRail}
              </span>
            )}
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? S.activities.railCollapse : S.activities.railExpand}
              title={open ? S.activities.railCollapse : S.activities.railExpand}
              onClick={toggle}
              className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <Chevron
                open={false}
                size={ICON_SIZE.chevronDense}
                className={`text-gray-500 ${open ? "rotate-180" : ""}`}
              />
            </button>
          </div>
          {open && rail(() => setNarrowOpen(false))}
        </div>
        {open && beside && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={S.activities.railWidth}
            aria-valuenow={applied}
            aria-valuemin={RAIL_MIN_WIDTH}
            aria-valuemax={RAIL_MAX_WIDTH}
            title={S.activities.railWidth}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
            className={`w-1.5 shrink-0 cursor-col-resize outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400/60 ${
              dragging
                ? "bg-gray-300 dark:bg-gray-600"
                : "bg-transparent hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          />
        )}
        {/* Too narrow for both, and the rail is open: the rail has the workspace. */}
        {(beside || !open) && children}
        {panelInline && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={S.activities.studioPanels.width}
            aria-valuenow={panelApplied}
            aria-valuemin={SIDE_PANEL_MIN_WIDTH}
            aria-valuemax={SIDE_PANEL_MAX_WIDTH}
            title={S.activities.studioPanels.width}
            tabIndex={0}
            onPointerDown={onPanelPointerDown}
            onKeyDown={onPanelKeyDown}
            className={`w-1.5 shrink-0 cursor-col-resize outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400/60 ${
              panelDragging
                ? "bg-gray-300 dark:bg-gray-600"
                : "bg-transparent hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          />
        )}
        {/* While dragging, the player's frame would swallow the pointer; a cover keeps it. */}
        {(dragging || panelDragging) && <div className="absolute inset-0 z-50 cursor-col-resize" />}
        {openPanel && (
          <aside
            aria-label={openPanel.label}
            // Expanded, it fills the workspace; too narrow to sit beside the work, it covers
            // the editor from the right.
            style={
              expanded
                ? undefined
                : {
                    width: `${sideBeside ? panelApplied : clampSidePanelWidth(panelWidth)}px`,
                    ...(sideBeside ? {} : { right: 0 }),
                  }
            }
            className={`flex min-h-0 max-w-full shrink-0 flex-col border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 ${
              expanded
                ? "absolute inset-0 z-40"
                : sideBeside
                  ? "border-l"
                  : "absolute inset-y-0 z-40 border-l shadow-lg"
            }`}
          >
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-gray-200 px-3 dark:border-gray-800">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{openPanel.label}</h2>
              <button
                type="button"
                aria-pressed={expanded}
                aria-label={
                  expanded ? S.activities.studioPanels.restore : S.activities.studioPanels.expand
                }
                title={
                  expanded ? S.activities.studioPanels.restore : S.activities.studioPanels.expand
                }
                onClick={toggleExpanded}
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <GlyphIcon d={expanded ? RESTORE_ICON : EXPAND_ICON} size={14} />
              </button>
              <button
                type="button"
                aria-label={S.activities.studioPanels.close}
                title={S.activities.studioPanels.close}
                onClick={() => choosePanel(openPanel.key)}
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <CloseIcon />
              </button>
            </div>
            <div ref={setPanelBody} className="min-h-0 flex-1 overflow-y-auto">
              <SidePanelFill.Provider value={{ expanded, body: panelBody }}>
                {openPanel.render()}
              </SidePanelFill.Provider>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
