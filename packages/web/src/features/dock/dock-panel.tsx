/**
 * One dock surface (dock-state.ts owns the arrangement): a tab strip across the top and
 * the active tab's body below — or, while the open dock has no tabs, a centered picker
 * choosing what to open here. The chat page renders one per open dock — right and/or
 * bottom — or a single merged bottom surface below the desktop breakpoint.
 *
 * Panel tabs' bodies come from the page through `renderPanel` (they need the page's
 * session/stream state); terminal tabs' bodies are the pooled xterm views
 * (terminal-view-pool.tsx), adopted by DOM handoff so tab churn never reconnects a shell.
 * Every tab's body stays mounted while its tab is in the strip — switching tabs hides and
 * shows, so a panel keeps its scroll and drill-down state — except terminal views, which
 * the pool keeps only for shown terminals (an off-screen shell reattaches on return).
 *
 * The header carries the strip, a "+" menu (panels, a fresh shell, and any live shell no
 * conversation holds), a detach button while a terminal is shown, a move-to-other-edge
 * button, and the dock's × (hide — tabs stay; each tab's own always-visible × is what
 * removes). Tabs drag sideways to reorder; dragging a tab out of the strip brings up the
 * edge overlay (dock-drag.tsx) and dropping on the other edge moves that tab there.
 * Dragging the header itself moves the whole dock the same way. The boundary with the
 * chat content resizes the dock — the right dock through the shared side-panel width,
 * the bottom dock through its height ratio.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { ADD_ICON, CloseIcon, NAV_ICONS } from "../../components/ui/icons";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Dropdown } from "../../components/ui/dropdown";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { useCoarsePointer } from "../../lib/use-coarse-pointer";
import { toneDot } from "../../lib/tone";
import { useTerminalChrome } from "../terminal/terminal-appearance";
import {
  displayTitle,
  killTerminal,
  liveTerminals,
  subscribeTerminals,
} from "../terminal/terminal-list";
import {
  subscribeTerminalViewStates,
  terminalViewContainer,
  terminalViewState,
} from "../terminal/terminal-view-pool";
import type { TerminalInfo } from "../terminal/terminal-view";
import { createShellInDock, detachTerminal, openTerminalInDock } from "./dock-terminal";
import { DockDragOverlay, dockDropCandidate } from "./dock-drag";
import { panelGlyph, panelLabel } from "./panel-meta";
import {
  DOCK_MIN_HEIGHT_PX,
  DOCK_RATIO_MAX,
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
  unownedTerminals,
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

/** Window with a bottom pane / a right pane: the move-dock buttons. */
const PANEL_BOTTOM_ICON = "M4 5h16v14H4zM4 14h16";
const PANEL_RIGHT_ICON = "M4 5h16v14H4zM14 5v14";
/** Four corners pushed outward / pulled inward: the touch height toggle (see maximize). */
const MAXIMIZE_ICON = "M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5";
const RESTORE_ICON = "M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5";
/** Box with an arrow escaping to the top right: detach to its own window. */
const DETACH_ICON = "M14 4h6v6M20 4l-8 8M10 6H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5";

/** Small icon-sized header button shared by the dock's controls. */
function DockButton(props: {
  label: string;
  testId: string;
  onClick: () => void;
  children: ReactNode;
}) {
  // A 24px box is a comfortable mouse target and a poor finger one; the glyph inside keeps
  // its size either way, so only the box a finger has to land in grows.
  const coarsePointer = useCoarsePointer();
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      data-testid={props.testId}
      onClick={props.onClick}
      className={`flex ${coarsePointer ? "h-8 w-8" : "h-6 w-6"} shrink-0 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200`}
    >
      {props.children}
    </button>
  );
}

/**
 * One tab in the strip: glyph + name + an always-visible ×. Two sibling buttons, not
 * nested — a button inside a button is invalid and unclickable. The × has a reserved
 * slot of its own after the label, never overlapping it: crowded tabs shrink by
 * truncating the label (ellipsis) while the glyph and the × keep their width, so the
 * close target stays where the pointer expects it.
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
  const coarsePointer = useCoarsePointer();
  return (
    <div
      data-testid="dock-tab"
      data-tab-id={props.tabId}
      {...(props.terminalId !== undefined ? { "data-terminal-id": props.terminalId } : {})}
      data-active={props.active}
      className={`flex ${coarsePointer ? "h-8" : "h-6"} max-w-44 items-center rounded-md pr-0.5 transition-colors duration-150 ${
        props.active
          ? "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      }`}
    >
      <button
        type="button"
        title={props.title}
        onClick={props.onSelect}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 pr-1 text-left text-xs"
      >
        <span aria-hidden className="shrink-0">
          {props.glyph}
        </span>
        <span className="min-w-0 truncate">{props.label}</span>
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
        className={`flex ${coarsePointer ? "h-6 w-6" : "h-4 w-4"} shrink-0 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:bg-gray-200 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200`}
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
  // Machine-readable connection state on the body root, for tests and tooling — the
  // screen itself is the visible status.
  const viewState = useSyncExternalStore(subscribeTerminalViewStates, () =>
    terminalViewState(active ? id : null),
  );
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
      data-testid="dock-terminal-body"
      data-status={viewState.status}
      className={`flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-1 ${chrome.surface}`}
    />
  );
}

/** The strip label of a terminal tab: stable seq + live title, like a tmux status line. */
function terminalLabel(info: TerminalInfo | undefined, id: string, ordinal: number): string {
  if (!info) return `${ordinal}: ${id.slice(0, 6)}`;
  return `${info.seq ?? ordinal}: ${displayTitle(info.title) || info.name}`;
}

/**
 * The body of an open dock with no tabs: a centered choice list (Codex-style) — pick what
 * to open here. Every side element is a row; the terminal row adopts the newest shell no
 * conversation holds, or starts a fresh one, and names its hotkey.
 */
function DockPicker({
  choose,
  chooseTerminal,
  terminalSupported,
  horizontal,
}: {
  choose: (kind: PanelKind) => void;
  chooseTerminal: () => void;
  terminalSupported: boolean;
  /** The bottom (and merged) surface lays its choices out in a row, the right one as a list. */
  horizontal: boolean;
}) {
  const rowClass =
    "flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100";
  const row = (kind: PanelKind) => (
    <button
      key={kind}
      type="button"
      data-testid={`dock-pick-${kind}`}
      onClick={() => choose(kind)}
      className={rowClass}
    >
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{panelGlyph(kind)}</span>
      <span className="min-w-0 truncate">{panelLabel(kind)}</span>
    </button>
  );
  return (
    <div
      data-testid="dock-picker"
      className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4"
    >
      <div
        className={
          horizontal
            ? "flex max-w-full flex-wrap items-center justify-center gap-1"
            : "flex w-60 flex-col gap-0.5"
        }
      >
        {row("agents")}
        {terminalSupported && (
          <button
            type="button"
            data-testid="dock-pick-terminal"
            onClick={chooseTerminal}
            className={rowClass}
          >
            <span className="shrink-0 text-gray-500 dark:text-gray-400">
              <GlyphIcon d={NAV_ICONS.terminal} size={ICON_SIZE.iconButton} />
            </span>
            <span className="min-w-0 flex-1 truncate">{S.terminal.title}</span>
            <kbd className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
              Ctrl+`
            </kbd>
          </button>
        )}
        {row("workspace")}
        {row("memory")}
        {row("trace")}
        {row("messaging")}
      </div>
    </div>
  );
}

export interface DockPanelProps {
  view: DockView;
  /** The page's panel bodies (they need its session/stream state); null hides that kind from the add menu too. */
  renderPanel: (kind: PanelKind, active: boolean) => ReactNode;
  /** Attention dots per panel kind (the agents tab's pending-approval amber dot). */
  panelBadges?: Partial<Record<PanelKind, boolean>>;
  /** Whether the server serves the terminal API at all (an older runtime does not). */
  terminalSupported: boolean;
  /** False only while the dock collapses on its way out (use-dock-mount keeps it mounted). */
  open?: boolean;
  /** Whether mounting plays the expand transition (false for instant changes — scope switches, moves). */
  animateEntrance?: boolean;
}

export function DockPanel({
  view,
  renderPanel,
  panelBadges,
  terminalSupported,
  open = true,
  animateEntrance = true,
}: DockPanelProps) {
  useSyncExternalStore(subscribeDock, dockVersion);
  const terminals = useSyncExternalStore(subscribeTerminals, liveTerminals);
  const terminalById = new Map(terminals.map((t) => [t.id, t]));
  const { position, merged, tabs, activeKey } = view;
  const horizontal = position === "bottom";
  const other: DockPosition = position === "right" ? "bottom" : "right";
  const [addOpen, setAddOpen] = useState(false);

  const activeTab = tabs.find((tab) => tabKey(tab) === activeKey) ?? null;

  // ---------------------------------------------------------------------------- selection

  // A terminal tab's × ends the shell itself (server-side) — an easy mis-click next to
  // the tab, so it confirms first. Panel tabs close directly: nothing is lost.
  const [confirmKill, setConfirmKill] = useState<{ id: string; label: string } | null>(null);
  const closeTab = useCallback((tab: DockTab, label: string) => {
    if (tab.kind === "terminal") {
      setConfirmKill({ id: tab.terminalId, label });
      return;
    }
    removeTab(tabKey(tab));
  }, []);
  const killConfirmed = useCallback(() => {
    if (!confirmKill) return;
    void killTerminal(confirmKill.id);
    removeTab(`terminal:${confirmKill.id}`);
    setConfirmKill(null);
  }, [confirmKill]);

  /**
   * Detach the shown terminal to its own /terminal window. The shell stays live (and
   * listed — multi-client attach); its tab leaves the strip, and closing the window puts
   * it back where it was (dock-terminal.ts owns the round trip).
   */
  const detach = useCallback(() => {
    if (activeTab?.kind !== "terminal") return;
    const home = merged ? (tabHome(tabKey(activeTab)) ?? "bottom") : position;
    detachTerminal(activeTab.terminalId, home);
  }, [activeTab, merged, position]);

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
  // The dock's own root node. The RIGHT dock's resize handle is a layout SIBLING of it
  // (it must cost real width), so the handle's events cannot `closest()` their way to the
  // dock — the ref is how both handles reach the box they resize.
  const rootRef = useRef<HTMLDivElement | null>(null);

  const resizerDragProps = usePointerDrag<object>({
    threshold: 0,
    begin: (event) => {
      event.preventDefault(); // no text selection while dragging the boundary
      setResizing(true);
      return {};
    },
    onMove: (event) => {
      const pane = rootRef.current?.getBoundingClientRect();
      if (!pane) return;
      if (horizontal) {
        // The ratio's basis is the chat page column ([data-dock-host]), the same box the
        // rendered height is computed from below.
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

  // The bottom dock's height in PIXELS: ratio × the measured chat column, with the same
  // clamps the drag applies. Pixels rather than a CSS percentage so the expand/collapse
  // transition interpolates cleanly to 0 and the INNER content can sit at the settled
  // height while the outer box animates past it (no reflow mid-transition; xterm would
  // refit its grid on every intermediate height).
  // Lazy initial measurement: on every mount but the app's very first commit the host is
  // already in the DOM, so the first paint uses the real height — a 0 start would make
  // the height jump 0→target one commit later, which the transition class turns into an
  // unasked-for slide (and an instant mount is exactly the case that must not slide).
  // On the first commit the host is not attached yet; that mount is the animated initial
  // restore, whose entrance starts at 0 by design.
  const [hostHeight, setHostHeight] = useState(() => {
    const host = document.querySelector("[data-dock-host]");
    return host instanceof HTMLElement ? host.getBoundingClientRect().height : 0;
  });
  useLayoutEffect(() => {
    if (!horizontal) return;
    const host = document.querySelector("[data-dock-host]");
    if (!(host instanceof HTMLElement)) return;
    const measure = () => setHostHeight(host.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [horizontal]);
  const bottomHeight = Math.round(
    Math.min(DOCK_RATIO_MAX * hostHeight, Math.max(DOCK_MIN_HEIGHT_PX, bottomRatio() * hostHeight)),
  );

  const onResizerDoubleClick = useCallback(
    () => (horizontal ? resetBottomRatio() : resetPanelWidth()),
    [horizontal],
  );

  // ------------------------------------------------------------------- touch height toggle

  // The bottom dock's height is set by dragging its top boundary — a 4px line, which is a
  // mouse target and not a finger one. On touch the same two heights a user actually wants
  // (as much as the dock can take, and back to where it was) get a button. The remembered
  // height is per mount on purpose: the ratio itself is persisted, so a dock left maximised
  // restores to the shared default rather than to a height from another session.
  const coarsePointer = useCoarsePointer();
  const restoreRatio = useRef<number | null>(null);
  const maximized = bottomRatio() >= DOCK_RATIO_MAX;
  const toggleMaximized = useCallback(() => {
    if (bottomRatio() >= DOCK_RATIO_MAX) {
      const previous = restoreRatio.current;
      if (previous === null) resetBottomRatio();
      else setBottomRatio(previous);
      return;
    }
    restoreRatio.current = bottomRatio();
    setBottomRatio(DOCK_RATIO_MAX);
  }, []);

  // ------------------------------------------------------------------------------ add menu

  const openPanelHere = (kind: PanelKind): void => {
    setAddOpen(false);
    // The merged view has no edge of its own to insist on — the panel's existing tab (or
    // the right-dock default) decides, which is also where it lands when the window
    // widens back out.
    openPanel(kind, merged ? undefined : position);
  };

  /** Live shells no conversation holds: offer to pull them into this dock. */
  const adoptableIds = new Set(unownedTerminals(terminals.map((t) => t.id)));
  const adoptable = terminals.filter((t) => adoptableIds.has(t.id));

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

  // First paint happens at size 0; `entered` flips a frame later so the expand really
  // transitions — a node that MOUNTS at its target size has no transition to run. Double
  // rAF: the first can land in the same frame as the initial paint, and a 0→size set
  // within one frame is not a transition either. An instant mount (scope switch, a moved
  // tab's target dock) starts entered instead and paints at full size straight away.
  const [entered, setEntered] = useState(!animateEntrance);
  useEffect(() => {
    if (entered) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                onClose={() => closeTab(tab, panelLabel(tab.panel))}
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
              onClose={() => closeTab(tab, label)}
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
        {!merged && tabs.length > 0 && (
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
        {horizontal && coarsePointer && tabs.length > 0 && (
          <DockButton
            label={maximized ? S.dock.restore : S.dock.maximize}
            testId="dock-maximize"
            onClick={toggleMaximized}
          >
            <GlyphIcon d={maximized ? RESTORE_ICON : MAXIMIZE_ICON} size={ICON_SIZE.rowLead} />
          </DockButton>
        )}
        <DockButton label={S.dock.hideDock} testId="dock-close" onClick={() => hideView(view)}>
          <CloseIcon size={12} />
        </DockButton>
      </div>
    </header>
  );

  const bodies =
    tabs.length === 0 ? (
      // An open dock with nothing in it yet: the picker chooses what this dock opens.
      <DockPicker
        choose={(kind) => openPanel(kind, merged ? undefined : position)}
        chooseTerminal={() => void openTerminalInDock(merged ? undefined : position)}
        terminalSupported={terminalSupported}
        horizontal={horizontal}
      />
    ) : (
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

  const killConfirm = (
    <ConfirmModal
      open={confirmKill !== null}
      title={S.dock.killConfirmTitle}
      onClose={() => setConfirmKill(null)}
      onConfirm={killConfirmed}
      confirmLabel={S.terminal.killShell}
    >
      {confirmKill !== null && (
        <p className="break-words text-sm text-gray-600 dark:text-gray-300">
          {S.dock.killConfirmBody(confirmKill.label)}
        </p>
      )}
    </ConfirmModal>
  );

  if (horizontal) {
    return (
      <div
        ref={rootRef}
        data-testid="dock"
        data-position="bottom"
        // Collapsed to 0 while closing/entering; the border belongs to the open state
        // only — with border-box sizing a collapsed dock would still paint its 1px,
        // leaving a hairline where nothing is.
        style={{ height: open && entered ? bottomHeight : 0 }}
        inert={!open}
        className={`relative flex w-full shrink-0 flex-col overflow-hidden bg-white dark:bg-gray-950 ${
          open ? "border-t border-gray-200 dark:border-gray-800" : ""
        } ${resizing ? "" : "transition-[height] duration-200"}`}
      >
        {/* The handle straddles the boundary as an overlay, costing no height. Only while
            open — a collapsing dock must not keep a grabbable edge behind. */}
        {open && (
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
        )}
        {/* Content fixed at the settled height inside the clipping window: while the
            outer box animates through intermediate heights, nothing reflows — xterm
            keeps its grid, panels keep their layout — the surface just slides. */}
        <div style={{ height: bottomHeight }} className="flex min-h-0 shrink-0 flex-col">
          {header}
          {bodies}
        </div>
        {overlayActive && <DockDragOverlay candidate={overlayCandidate} />}
        {killConfirm}
      </div>
    );
  }

  return (
    <>
      {/* A layout-sibling handle, not an overlay: it must cost real width so the chat
          column measures the same under every surface. Only while open — a collapsing
          dock must not leave a bare strip behind. */}
      {open && (
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
      )}
      <div
        ref={rootRef}
        data-testid="dock"
        data-position="right"
        // The border belongs to the open state only (see the bottom branch's note).
        style={{ width: open && entered ? sideWidth : 0 }}
        inert={!open}
        className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-white dark:bg-gray-950 ${
          open ? "border-l border-gray-200 dark:border-gray-800" : ""
        } ${resizing ? "" : "transition-[width] duration-200"}`}
      >
        {/* Fixed-width content inside the clipping window: while the outer element
            animates through intermediate widths, the content must not reflow frame by
            frame — text would squeeze, and xterm would refit its grid on every one. */}
        <div style={{ width: sideWidth }} className="flex min-h-0 flex-1 flex-col">
          {header}
          {bodies}
        </div>
        {overlayActive && <DockDragOverlay candidate={overlayCandidate} />}
        {killConfirm}
      </div>
    </>
  );
}
