/**
 * One dock surface (dock-state.ts owns the arrangement): a tab strip across the top and
 * the active tab's body below. The chat page renders one per visible dock — right and/or
 * bottom — or a single merged bottom surface below the desktop breakpoint.
 *
 * Panel tabs' bodies come from the page through `renderPanel` (they need the page's
 * session/stream state); terminal tabs' bodies are the pooled xterm views
 * (terminal-view-pool.tsx), adopted by DOM handoff so tab churn never reconnects a shell.
 * Every tab's body stays mounted while its tab is in the strip — switching tabs hides and
 * shows, so a panel keeps its scroll and drill-down state — except terminal views, which
 * the pool keeps only for shown terminals (an off-screen shell reattaches on return).
 *
 * The header carries the strip, a "+" menu (panels, a fresh shell, and any live shell
 * that has no tab yet), a detach button while a terminal is shown, a move-to-other-edge
 * button, and the dock's × (hide — tabs stay; each tab's own × is what removes). Tabs
 * drag sideways to reorder; dragging a tab out of the strip brings up the edge overlay
 * (dock-drag.tsx) and dropping on the other edge moves that tab there. Dragging the
 * header itself moves the whole dock the same way. The boundary with the chat content
 * resizes the dock — the right dock through the shared side-panel width, the bottom dock
 * through its height ratio.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { CloseIcon, NAV_ICONS } from "../../components/ui/icons";
import { Dropdown } from "../../components/ui/dropdown";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneDot } from "../../lib/tone";
import { useTerminalChrome } from "../terminal/terminal-appearance";
import {
  displayTitle,
  killTerminal,
  liveTerminals,
  subscribeTerminals,
} from "../terminal/terminal-list";
import { terminalViewContainer } from "../terminal/terminal-view-pool";
import type { TerminalInfo } from "../terminal/terminal-view";
import { createShellInDock } from "./dock-terminal";
import { DockDragOverlay, dockDropCandidate } from "./dock-drag";
import { panelGlyph, panelLabel } from "./panel-meta";
import {
  PANEL_KINDS,
  activateTab,
  addTerminalTab,
  bottomRatio,
  dockVersion,
  hideView,
  moveDock,
  moveTab,
  openPanel,
  removeTab,
  reorderDock,
  resetBottomRatio,
  setBottomRatio,
  subscribeDock,
  tabHome,
  tabKey,
  type DockPosition,
  type DockTab,
  type DockView,
  type PanelKind,
} from "./dock-state";
import {
  persistPanelWidth,
  resetPanelWidth,
  setPanelWidth,
  usePanelWidthValue,
} from "../chat/use-panel-width";
import { usePointerDrag } from "./use-pointer-drag";

/** Plus: the add-tab trigger. */
const ADD_ICON = "M12 5v14M5 12h14";
/** Window with a bottom pane / a right pane: the move-dock buttons. */
const PANEL_BOTTOM_ICON = "M4 5h16v14H4zM4 14h16";
const PANEL_RIGHT_ICON = "M4 5h16v14H4zM14 5v14";
/** Box with an arrow escaping to the top right: detach to its own window. */
const DETACH_ICON = "M14 4h6v6M20 4l-8 8M10 6H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5";

/** Small icon-sized header button shared by the dock's controls. */
function DockButton(props: {
  label: string;
  testId: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      data-testid={props.testId}
      onClick={props.onClick}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
    >
      {props.children}
    </button>
  );
}

/**
 * One tab in the strip: glyph + name + a hover-revealed ×. Two sibling buttons, not
 * nested — a button inside a button is invalid and unclickable. The × is an absolute
 * overlay, so it costs no width while tabs squeeze and never reflows the strip on hover.
 */
function DockTabButton(props: {
  tabId: string;
  label: string;
  title: string;
  glyph: ReactNode;
  active: boolean;
  /** Attention dot (e.g. a pending approval inside a subagent) shown beside the name. */
  badge: boolean;
  closeLabel: string;
  onSelect: () => void;
  onClose: () => void;
  /** Terminal tabs keep their id on the node for tests and the strip's drag targeting. */
  terminalId?: string;
}) {
  return (
    <div
      data-testid="dock-tab"
      data-tab-id={props.tabId}
      {...(props.terminalId !== undefined ? { "data-terminal-id": props.terminalId } : {})}
      data-active={props.active}
      className={`group relative flex h-6 min-w-10 max-w-40 items-center overflow-hidden rounded-md transition-colors duration-150 ${
        props.active
          ? "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      }`}
    >
      {/* No shrink-0: crowded tabs squeeze browser-style down to min-w-10 — the label
          clips hard (no ellipsis) so at the floor only the glyph stays readable. */}
      <button
        type="button"
        title={props.title}
        onClick={props.onSelect}
        className="flex h-full w-full min-w-0 items-center gap-1.5 px-2 text-left text-xs"
      >
        <span aria-hidden className="shrink-0">
          {props.glyph}
        </span>
        <span className="block w-full overflow-hidden whitespace-nowrap">{props.label}</span>
        {props.badge && (
          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot.attention}`} />
        )}
      </button>
      <button
        type="button"
        title={props.closeLabel}
        aria-label={`${props.closeLabel}: ${props.label}`}
        data-testid="dock-tab-close"
        onClick={props.onClose}
        className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded bg-gray-100 p-0.5 opacity-0 transition-opacity duration-150 hover:bg-gray-200 focus-visible:opacity-100 group-hover:opacity-100 dark:bg-gray-800 dark:hover:bg-gray-700"
      >
        <CloseIcon size={10} />
      </button>
    </div>
  );
}

/**
 * A terminal tab's body: adopts the shown terminal's pooled container. Only while shown —
 * the pool keeps views for shown terminals alone, so adopting an inactive tab's container
 * would hold an empty node.
 */
function TerminalBody({ id, active }: { id: string; active: boolean }) {
  const chrome = useTerminalChrome();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !active) return;
    const container = terminalViewContainer(id);
    body.appendChild(container);
    return () => {
      if (container.parentElement === body) body.removeChild(container);
    };
  }, [id, active]);
  return (
    <div
      ref={bodyRef}
      className={`flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-1 ${chrome.surface}`}
    />
  );
}

/** The strip label of a terminal tab: stable seq + live title, like a tmux status line. */
function terminalLabel(info: TerminalInfo | undefined, id: string, ordinal: number): string {
  if (!info) return `${ordinal}: ${id.slice(0, 6)}`;
  return `${info.seq ?? ordinal}: ${displayTitle(info.title) || info.name}`;
}

export interface DockPanelProps {
  view: DockView;
  /** The page's panel bodies (they need its session/stream state); null hides that kind from the add menu too. */
  renderPanel: (kind: PanelKind, active: boolean) => ReactNode;
  /** Attention dots per panel kind (the agents tab's pending-approval amber dot). */
  panelBadges?: Partial<Record<PanelKind, boolean>>;
  /** Whether the server serves the terminal API at all (an older runtime does not). */
  terminalSupported: boolean;
}

export function DockPanel({ view, renderPanel, panelBadges, terminalSupported }: DockPanelProps) {
  useSyncExternalStore(subscribeDock, dockVersion);
  const terminals = useSyncExternalStore(subscribeTerminals, liveTerminals);
  const terminalById = new Map(terminals.map((t) => [t.id, t]));
  const { position, merged, tabs, activeKey } = view;
  const horizontal = position === "bottom";
  const other: DockPosition = position === "right" ? "bottom" : "right";
  const [addOpen, setAddOpen] = useState(false);

  const activeTab = tabs.find((tab) => tabKey(tab) === activeKey) ?? null;

  // ---------------------------------------------------------------------------- selection

  const closeTab = useCallback((tab: DockTab) => {
    if (tab.kind === "terminal") {
      // The tab's × ends the shell itself (server-side), not just this view of it.
      void killTerminal(tab.terminalId);
    }
    removeTab(tabKey(tab));
  }, []);

  /**
   * Detach the shown terminal to its own /terminal window. The shell stays live (and
   * listed — multi-client attach); its tab leaves the strip.
   */
  const detach = useCallback(() => {
    if (activeTab?.kind !== "terminal") return;
    window.open(`/terminal?id=${encodeURIComponent(activeTab.terminalId)}`, "_blank", "noopener");
    removeTab(tabKey(activeTab));
  }, [activeTab]);

  // The shown tab keeps itself in view: with many tabs the strip scrolls, and a
  // half-clipped active tab reads as a stray × button at the strip's edge.
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (activeKey === null) return;
    stripRef.current
      ?.querySelector(`[data-tab-id="${CSS.escape(activeKey)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, tabs]);

  // Wheel over the strip scrolls it sideways (there is no vertical axis to scroll, and a
  // trackpad's deltaX works too). Native non-passive listener: React's synthetic onWheel
  // is passive, so preventDefault there cannot stop the page handling the event.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent): void => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0 || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += delta;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  // ------------------------------------------------------------------ header drag: move dock
  const [headerDrag, setHeaderDrag] = useState<{
    active: boolean;
    candidate: DockPosition | null;
  }>({ active: false, candidate: null });
  const clearHeaderDrag = () => setHeaderDrag({ active: false, candidate: null });

  const headerDragProps = usePointerDrag<object>({
    begin: (event) =>
      // The merged view spans both docks, so "move the dock" has no target of its own.
      merged || (event.target as HTMLElement).closest("button, [data-testid='dock-tab']")
        ? null
        : {},
    onMove: (event) =>
      setHeaderDrag({ active: true, candidate: dockDropCandidate(event.clientX, event.clientY) }),
    onEnd: (_payload, dragged) => {
      const candidate = headerDrag.candidate;
      clearHeaderDrag();
      if (dragged && candidate && candidate !== position) moveDock(position, candidate);
    },
    onCancel: clearHeaderDrag,
  });

  // --------------------------------------------------- tab drag: reorder or move to the other edge
  const [tabDrag, setTabDrag] = useState<{ active: boolean; candidate: DockPosition | null }>({
    active: false,
    candidate: null,
  });
  const clearTabDrag = () => setTabDrag({ active: false, candidate: null });

  const stripDragProps = usePointerDrag<{ id: string }>({
    threshold: 6,
    begin: (event) => {
      // Merged strips span both docks: a cross-dock reorder would silently move tabs
      // between docks, so the merged view keeps taps only (the buttons' own clicks).
      if (merged) return null;
      const target = event.target as HTMLElement;
      if (target.closest("[data-testid='dock-tab-close']")) return null;
      const id = target.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId;
      return id ? { id } : null;
    },
    onMove: (event, { id }) => {
      // Out of the strip (with a little slack): the gesture becomes "move to the other
      // edge" — the same overlay as moving a dock, with the preview showing the landing.
      const strip = event.currentTarget.getBoundingClientRect();
      if (event.clientY < strip.top - 20 || event.clientY > strip.bottom + 20) {
        setTabDrag({ active: true, candidate: dockDropCandidate(event.clientX, event.clientY) });
        return;
      }
      setTabDrag({ active: false, candidate: null });

      // Within the strip: live reorder against the other tabs' midpoints.
      const tabEls = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-tab-id]")];
      const currentIds = tabEls.map((el) => el.dataset.tabId as string);
      const others = tabEls.filter((el) => el.dataset.tabId !== id);
      let insertAt = others.length;
      for (let i = 0; i < others.length; i += 1) {
        const rect = others[i]!.getBoundingClientRect();
        if (event.clientX < rect.left + rect.width / 2) {
          insertAt = i;
          break;
        }
      }
      const nextIds = others.map((el) => el.dataset.tabId as string);
      nextIds.splice(insertAt, 0, id);
      if (nextIds.some((nextId, index) => nextId !== currentIds[index]))
        reorderDock(position, nextIds);
    },
    onEnd: ({ id }, dragged) => {
      const { active, candidate } = tabDrag;
      clearTabDrag();
      // A tap resolves to select here: pointer capture retargets the browser click to the
      // strip, so the tab's own click handler never fires from a mouse press.
      if (!dragged) {
        activateTab(id);
        return;
      }
      if (!active || !candidate || candidate === tabHome(id)) return;
      moveTab(id, candidate);
    },
    onCancel: clearTabDrag,
  });

  // ------------------------------------------------------------------------ boundary resize
  const [resizing, setResizing] = useState(false);
  const sideWidth = usePanelWidthValue();

  const resizerDragProps = usePointerDrag<object>({
    threshold: 0,
    begin: (event) => {
      event.preventDefault(); // no text selection while dragging the boundary
      setResizing(true);
      return {};
    },
    onMove: (event) => {
      const pane = event.currentTarget.closest("[data-testid='dock']")?.getBoundingClientRect();
      if (!pane) return;
      if (horizontal) {
        // The ratio's basis must match what the CSS percentage resolves against: the chat
        // page column ([data-dock-host]), whose direct child the bottom dock is.
        const host = document.querySelector("[data-dock-host]")?.getBoundingClientRect();
        if (!host || host.height === 0) return;
        setBottomRatio((pane.bottom - event.clientY) / host.height);
      } else {
        setPanelWidth(pane.right - event.clientX);
      }
    },
    onEnd: () => {
      setResizing(false);
      if (!horizontal) persistPanelWidth(); // once per drag, not per frame
    },
    onCancel: () => setResizing(false),
  });

  const onResizerDoubleClick = useCallback(
    () => (horizontal ? resetBottomRatio() : resetPanelWidth()),
    [horizontal],
  );

  // ------------------------------------------------------------------------------ add menu

  const openPanelHere = (kind: PanelKind): void => {
    setAddOpen(false);
    // The merged view has no edge of its own to insist on — the panel's remembered home
    // decides, which is also where it lands when the window widens back out.
    openPanel(kind, merged ? undefined : position);
  };

  /** Live shells that have no tab anywhere: offer to pull them into this dock. */
  const adoptable = terminals.filter((t) => tabHome(`terminal:${t.id}`) === null);

  const addMenu = (
    <Dropdown
      open={addOpen}
      setOpen={setAddOpen}
      portal={{ direction: "down", align: "right" }}
      menuClass="w-56"
      button={
        <DockButton label={S.dock.addTab} testId="dock-add" onClick={() => setAddOpen(!addOpen)}>
          <GlyphIcon d={ADD_ICON} size={ICON_SIZE.iconButton} />
        </DockButton>
      }
    >
      {PANEL_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          data-testid={`dock-add-${kind}`}
          onClick={() => openPanelHere(kind)}
          className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          <span className="shrink-0 text-gray-500 dark:text-gray-400">{panelGlyph(kind)}</span>
          <span className="min-w-0 truncate">{panelLabel(kind)}</span>
        </button>
      ))}
      {terminalSupported && (
        <>
          <div className="mx-2 my-1 border-t border-gray-100 dark:border-gray-800" />
          <button
            type="button"
            data-testid="dock-add-terminal"
            onClick={() => {
              setAddOpen(false);
              void createShellInDock(merged ? undefined : position);
            }}
            className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            <span className="shrink-0 text-gray-500 dark:text-gray-400">
              <GlyphIcon d={ADD_ICON} size={ICON_SIZE.iconButton} />
            </span>
            <span className="min-w-0 truncate">{S.terminal.newShell}</span>
          </button>
          {adoptable.map((terminal, index) => (
            <button
              key={terminal.id}
              type="button"
              data-testid="dock-add-shell"
              data-terminal-id={terminal.id}
              onClick={() => {
                setAddOpen(false);
                addTerminalTab(terminal.id, merged ? undefined : position);
              }}
              className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            >
              <span className="min-w-0 truncate">
                {terminalLabel(terminal, terminal.id, index + 1)}
              </span>
            </button>
          ))}
        </>
      )}
    </Dropdown>
  );

  // ------------------------------------------------------------------------------- render

  // First paint happens at width 0; `entered` flips a frame later. A node that MOUNTS at
  // its target width has no transition to run, so a fresh right dock would pop in.
  // Double rAF: the first can land in the same frame as the initial paint, and a 0→width
  // set within one frame is not a transition either. Height (bottom) stays unanimated on
  // purpose: each intermediate height would refit xterm's grid.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  const overlayActive = headerDrag.active || tabDrag.active;
  const overlayCandidate = headerDrag.active ? headerDrag.candidate : tabDrag.candidate;

  const terminalOrdinals = new Map<string, number>();
  tabs.forEach((tab) => {
    if (tab.kind === "terminal") terminalOrdinals.set(tab.terminalId, terminalOrdinals.size + 1);
  });

  const header = (
    <header
      data-testid="dock-header"
      {...headerDragProps}
      className={`flex shrink-0 items-center gap-2 border-b border-gray-200 px-2 py-1.5 text-xs dark:border-gray-800 ${
        merged ? "" : "cursor-grab select-none"
      }`}
    >
      {/* Tab strip: this dock's tabs, current one highlighted; drag sideways to reorder,
          drag out to move onto the other edge. Scrolls when the tabs outgrow the header. */}
      <div
        ref={stripRef}
        data-testid="dock-tab-strip"
        {...stripDragProps}
        className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const key = tabKey(tab);
          if (tab.kind === "panel") {
            return (
              <DockTabButton
                key={key}
                tabId={key}
                label={panelLabel(tab.panel)}
                title={panelLabel(tab.panel)}
                glyph={panelGlyph(tab.panel, ICON_SIZE.inlineGlyph)}
                active={key === activeKey}
                badge={panelBadges?.[tab.panel] === true}
                closeLabel={S.dock.closeTab}
                onSelect={() => activateTab(key)}
                onClose={() => closeTab(tab)}
              />
            );
          }
          const info = terminalById.get(tab.terminalId);
          const label = terminalLabel(
            info,
            tab.terminalId,
            terminalOrdinals.get(tab.terminalId) ?? 1,
          );
          return (
            <DockTabButton
              key={key}
              tabId={key}
              terminalId={tab.terminalId}
              label={label}
              title={info ? `${info.name} — ${info.cwd}` : label}
              glyph={<GlyphIcon d={NAV_ICONS.terminal} size={ICON_SIZE.inlineGlyph} />}
              active={key === activeKey}
              badge={false}
              closeLabel={S.terminal.killShell}
              onSelect={() => activateTab(key)}
              onClose={() => closeTab(tab)}
            />
          );
        })}
      </div>
      <span className="min-w-0 flex-1" />

      {/* Right-hand action cluster with uniform spacing, ending in close. */}
      <div className="flex shrink-0 items-center gap-1.5">
        {activeTab?.kind === "terminal" && (
          <DockButton label={S.terminal.detach} testId="dock-detach" onClick={detach}>
            <GlyphIcon d={DETACH_ICON} size={ICON_SIZE.rowLead} />
          </DockButton>
        )}
        {addMenu}
        {!merged && (
          <DockButton
            label={position === "right" ? S.dock.moveToBottom : S.dock.moveToRight}
            testId="dock-move"
            onClick={() => moveDock(position, other)}
          >
            <GlyphIcon
              d={position === "right" ? PANEL_BOTTOM_ICON : PANEL_RIGHT_ICON}
              size={ICON_SIZE.rowLead}
            />
          </DockButton>
        )}
        <DockButton label={S.dock.hideDock} testId="dock-close" onClick={() => hideView(view)}>
          <CloseIcon size={12} />
        </DockButton>
      </div>
    </header>
  );

  const bodies = (
    <div className="relative min-h-0 flex-1">
      {tabs.map((tab) => {
        const key = tabKey(tab);
        const active = key === activeKey;
        return (
          <div key={key} className={active ? "flex h-full min-h-0 flex-col" : "hidden"}>
            {tab.kind === "panel" ? (
              renderPanel(tab.panel, active)
            ) : (
              <TerminalBody id={tab.terminalId} active={active} />
            )}
          </div>
        );
      })}
    </div>
  );

  if (horizontal) {
    return (
      <div
        data-testid="dock"
        data-position="bottom"
        style={{ height: `${bottomRatio() * 100}%` }}
        className="relative flex min-h-[140px] max-h-[85%] w-full shrink-0 flex-col overflow-hidden border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950"
      >
        {/* The handle straddles the boundary as an overlay, costing no height. */}
        <div
          data-testid="dock-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label={S.dock.resize}
          title={S.dock.resize}
          {...resizerDragProps}
          onDoubleClick={onResizerDoubleClick}
          className={`absolute -top-[3px] left-0 right-0 z-20 h-1.5 cursor-ns-resize transition-colors duration-150 ${
            resizing ? "bg-sky-500/60" : "bg-transparent hover:bg-sky-500/40"
          }`}
        />
        {header}
        {bodies}
        {overlayActive && <DockDragOverlay candidate={overlayCandidate} />}
      </div>
    );
  }

  return (
    <>
      {/* A layout-sibling handle, not an overlay: it must cost the same width the panels'
          handles did, so the chat column measures alike whichever surface is open. */}
      <div
        data-testid="dock-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={S.dock.resize}
        title={S.dock.resize}
        {...resizerDragProps}
        onDoubleClick={onResizerDoubleClick}
        className={`w-1.5 shrink-0 cursor-col-resize transition-colors duration-150 ${
          resizing ? "bg-sky-500/60" : "bg-transparent hover:bg-sky-500/40"
        }`}
      />
      <div
        data-testid="dock"
        data-position="right"
        style={{ width: entered ? sideWidth : 0 }}
        className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 ${
          resizing ? "" : "transition-[width] duration-200"
        }`}
      >
        {/* Fixed-width content inside the clipping window: while the outer element
            animates through intermediate widths, the content must not reflow frame by
            frame — text would squeeze, and xterm would refit its grid on every one. */}
        <div style={{ width: sideWidth }} className="flex min-h-0 flex-1 flex-col">
          {header}
          {bodies}
        </div>
        {overlayActive && <DockDragOverlay candidate={overlayCandidate} />}
      </div>
    </>
  );
}
