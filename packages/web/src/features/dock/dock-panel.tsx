/**
 * One dock surface (dock-state.ts owns the arrangement): a tab strip across the top and
 * the active tab's body below — or, while the open dock has no tabs, a centered picker
 * choosing what to open here. The chat page renders one per open dock — right and/or
 * bottom — or a single merged bottom surface below the desktop breakpoint.
 *
 * The drawing is the UI package's (`DockFrame`, `DockTabs`, `DockPicker`); this container
 * binds it to the dock store, the terminal list and the panel registry.
 *
 * Panel tabs' bodies are the registry's (panel-registry.ts: the page registers one definition
 * per panel, body included, and this surface never names a panel itself), each wrapped in the
 * provider that tells it about its own tab (panel-context.tsx). A tab whose id has no definition
 * registered — a plugin's panel before the plugin loads — shows a placeholder saying so and keeps
 * its × until the definition arrives. Terminal tabs' bodies are the pooled xterm views
 * (terminal-view-pool.tsx), adopted by DOM handoff so tab churn never reconnects a shell.
 * Every tab's body stays mounted while its tab is in the strip — switching tabs hides and
 * shows, and so does hiding the whole dock (which renders at zero size rather than
 * unmounting), so a panel keeps its scroll, its drill-down and its unsaved text — except
 * terminal views, which the pool keeps only for shown terminals (an off-screen shell
 * reattaches on return).
 *
 * The header carries the strip, a "+" menu (panels, a fresh shell, and any live shell no
 * conversation holds), a detach button while a terminal is shown, a move-to-other-edge
 * button, a fullscreen toggle, and the dock's × (hide — tabs and everything their bodies hold
 * stay; each tab's own always-visible × is what removes). Tabs drag sideways to reorder;
 * dragging a tab out of the strip brings up the edge overlay (dock-drag.tsx) and dropping on
 * the other edge moves that tab there. Dragging the header itself moves the whole dock the same
 * way. The boundary with the chat content resizes the dock — the right dock through the shared
 * side-panel width, the bottom dock through its height ratio.
 *
 * FULLSCREEN lays the surface over the whole window (the store says which surface, if any; the
 * frame draws it, keeping the dock's own box in the flow so nothing underneath reflows). The
 * strip, the "+" menu and the detach button keep working; what has no meaning with the surface
 * covering everything is put away — the move button, the header drag, dragging a tab out to the
 * other edge, the resize handle. The header's toggle (now corners in) and a round button floating
 * at the window's corner are the ways back, and the store drops fullscreen by itself when the surface stops qualifying (hidden, emptied, or
 * the other dock brought forward). Esc is left alone: the terminal, the editor and web pages each
 * own it.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CloseIcon,
  ConfirmModal,
  DockFrame,
  DockHeaderButton,
  DockPicker,
  DockTabs,
  Dropdown,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Menu,
  MenuItem,
  MenuSeparator,
  ResizeHandle,
  usePointerDrag,
} from "@prismshadow/penguin-ui";
import type { DockPickerChoice, DockTabItem } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { NAV_ICONS } from "../../lib/nav-icons";
import { chordKeys } from "../../components/ui/chord-kbd";
import { useDisplayedBinding, useShortcutLabel } from "../../lib/shortcuts/use-keymap";
import { useCoarsePointer } from "../../lib/use-coarse-pointer";
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
  subscribeTerminalCloseRequests,
} from "../terminal/terminal-view-pool";
import type { TerminalInfo } from "../terminal/terminal-view";
import { confirmClose } from "./close-guard";
import { createShellInDock, detachTerminal, openTerminalInDock } from "./dock-terminal";
import { DockDragOverlay, dockDropCandidate } from "./dock-drag";
import { DockPanelProvider } from "./panel-context";
import type { DockPanelHandle } from "./panel-context";
import { panelGlyph, panelLabel } from "./panel-meta";
import { dockPanelDefinition, useDockPanels } from "./panel-registry";
import type { DockPanelDefinition, PanelId } from "./panel-registry";
import {
  DOCK_MIN_HEIGHT_PX,
  DOCK_RATIO_MAX,
  activateTab,
  addTerminalTab,
  bottomRatio,
  dockVersion,
  fullscreenDock,
  hideView,
  moveDock,
  moveTab,
  openPanel,
  removeTab,
  reorderDock,
  resetBottomRatio,
  setBottomRatio,
  setDockFullscreen,
  subscribeDock,
  tabHome,
  tabKey,
  unownedTerminals,
  type DockPosition,
  type DockTab,
  type DockView,
} from "./dock-state";
import {
  persistPanelWidth,
  resetPanelWidth,
  setPanelWidth,
  usePanelWidthValue,
} from "../chat/use-panel-width";

/**
 * The picker's leading rows, each shown only where the registry offers it: the agents, then the
 * terminal between them, then the built-in browser — what a conversation most often opens. Every
 * other offered panel follows in registry order, which is where a plugin's panel lands.
 */
const PICKER_LEAD: readonly PanelId[] = ["agents", "builtin-browser"];

/**
 * A terminal tab's body: adopts the shown terminal's pooled container. Only while shown —
 * the pool keeps views for shown terminals alone, so adopting an inactive tab's container
 * would hold an empty node. A hidden dock is not shown either: the pool disposes the view
 * with the dock and builds a FRESH container on the way back, which the effect re-adopts
 * because `active` fell to false meanwhile (the shell keeps running server-side and its
 * screen is restored on reattach; xterm refits once the container has real size again).
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

/**
 * A panel tab's body: the registry's component for its id, inside the provider that tells the
 * body about its own tab. An id with no definition registered (a plugin's tab stored before the
 * plugin loads, or after it was removed) shows a placeholder that says so and keeps the tab
 * closable from the strip; the body appears the moment the definition is registered, since the
 * dock re-renders on registration.
 */
function PanelBody({
  id,
  position,
  merged,
  active,
  fullscreen,
}: {
  id: PanelId;
  position: DockPosition;
  merged: boolean;
  active: boolean;
  fullscreen: boolean;
}) {
  const handle = useMemo<DockPanelHandle>(
    () => ({
      id,
      position,
      merged,
      active,
      fullscreen,
      // Only this surface's own fullscreen is this body's to end: a body in the other dock
      // asking for "off" must not cancel a fullscreen it is no part of.
      setFullscreen: (on) => {
        if (on) setDockFullscreen(position);
        else if (fullscreenDock() === position) setDockFullscreen(null);
      },
      // The tab's × path: a close guard the body registered (unsaved text) asks first.
      close: () => {
        void confirmClose([id]).then((ok) => {
          if (ok) removeTab(id);
        });
      },
    }),
    [id, position, merged, active, fullscreen],
  );
  const Body = dockPanelDefinition(id)?.Body;
  return (
    <DockPanelProvider handle={handle}>
      {Body !== undefined ? (
        <Body active={active} />
      ) : (
        <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-4">
          <EmptyState title={S.dock.panelUnavailable} />
        </div>
      )}
    </DockPanelProvider>
  );
}

/** The strip label of a terminal tab: stable seq + live title, like a tmux status line. */
function terminalLabel(info: TerminalInfo | undefined, id: string, ordinal: number): string {
  if (!info) return `${ordinal}: ${id.slice(0, 6)}`;
  return `${info.seq ?? ordinal}: ${displayTitle(info.title) || info.name}`;
}

export interface DockPanelProps {
  view: DockView;
  /** Attention dots per panel id (the agents tab's pending-approval amber dot). */
  panelBadges?: Partial<Record<PanelId, boolean>>;
  /** Whether the server serves the terminal API at all (an older runtime does not). */
  terminalSupported: boolean;
  /** False only while the dock collapses on its way out (use-dock-mount keeps it mounted). */
  open?: boolean;
  /** Whether mounting plays the expand transition (false for instant changes — scope switches, moves). */
  animateEntrance?: boolean;
}

export function DockPanel({
  view,
  panelBadges,
  terminalSupported,
  open = true,
  animateEntrance = true,
}: DockPanelProps) {
  useSyncExternalStore(subscribeDock, dockVersion);
  const terminals = useSyncExternalStore(subscribeTerminals, liveTerminals);
  const closeShortcut = useShortcutLabel("terminal.close");
  const toggleChord = useDisplayedBinding("terminal.toggle");
  // The panels offered here, in registry order: what the "+" menu and the picker list, and
  // what re-renders the strip when a definition arrives for a tab it already shows.
  const offered = useDockPanels();
  const terminalById = new Map(terminals.map((t) => [t.id, t]));
  const { position, merged, tabs, activeKey } = view;
  const horizontal = position === "bottom";
  const other: DockPosition = position === "right" ? "bottom" : "right";
  const [addOpen, setAddOpen] = useState(false);

  const activeTab = tabs.find((tab) => tabKey(tab) === activeKey) ?? null;

  // The store decides which surface (if any) covers the window; this one is it while it is open
  // and the store names its position (the merged view's is "bottom", like the bottom dock's).
  const fullscreen = open && fullscreenDock() === position;

  // ---------------------------------------------------------------------------- selection

  // A terminal tab's × ends the shell itself (server-side) — an easy mis-click next to
  // the tab, so it confirms first. A panel tab closes directly unless its body registered
  // a close guard (the Files panel's editor holding unsaved text), which asks first: the
  // tab's × is the one gesture here that really unmounts a body.
  const [confirmKill, setConfirmKill] = useState<{ id: string; label: string } | null>(null);
  const closeTab = useCallback((tab: DockTab, label: string) => {
    if (tab.kind === "terminal") {
      setConfirmKill({ id: tab.terminalId, label });
      return;
    }
    const key = tabKey(tab);
    void confirmClose([key]).then((ok) => {
      if (ok) removeTab(key);
    });
  }, []);
  // Hiding puts the surface away and nothing else — every body stays mounted at zero size —
  // so there is nothing to ask about, however much unsaved work a tab is holding.
  const hide = useCallback(() => hideView(view), [view]);
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

  // The strip's node: the drag below hit-tests its tabs (the strip itself keeps the shown
  // tab in view and scrolls sideways under the wheel).
  const stripRef = useRef<HTMLDivElement | null>(null);

  // ------------------------------------------------------------------ header drag: move dock
  const [headerDrag, setHeaderDrag] = useState<{
    active: boolean;
    candidate: DockPosition | null;
  }>({ active: false, candidate: null });
  const clearHeaderDrag = () => setHeaderDrag({ active: false, candidate: null });

  const headerDragProps = usePointerDrag<object>({
    begin: (event) =>
      // The merged view spans both docks, so "move the dock" has no target of its own; a
      // fullscreen surface has no edge to move to either, the other one being under the cover.
      merged ||
      fullscreen ||
      (event.target as HTMLElement).closest("button, [data-testid='dock-tab']")
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
      // The gesture is tracked on the window, so the strip comes from its ref rather than
      // from the event's target — which is wherever the pointer has travelled to.
      const stripEl = stripRef.current;
      if (!stripEl) return;
      // Out of the strip (with a little slack): the gesture becomes "move to the other
      // edge" — the same overlay as moving a dock, with the preview showing the landing.
      // Not while fullscreen, when the other edge is under the cover: the drag stays a reorder.
      const strip = stripEl.getBoundingClientRect();
      if (!fullscreen && (event.clientY < strip.top - 20 || event.clientY > strip.bottom + 20)) {
        setTabDrag({ active: true, candidate: dockDropCandidate(event.clientX, event.clientY) });
        return;
      }
      setTabDrag({ active: false, candidate: null });

      // Within the strip: live reorder against the other tabs' midpoints.
      const tabEls = [...stripEl.querySelectorAll<HTMLElement>("[data-tab-id]")];
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

  /** One move of a boundary drag: the pointer's position, as the dock's new size. */
  const resizeTo = (event: PointerEvent): void => {
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
  };
  const resizeEnd = (committed: boolean): void => {
    setResizing(false);
    // Once per drag, not per frame; an abandoned drag stores nothing.
    if (committed && !horizontal) persistPanelWidth();
  };

  // The bottom dock's height in PIXELS: ratio × the measured chat column, with the same
  // clamps the drag applies. Pixels rather than a CSS percentage so the expand/collapse
  // transition interpolates cleanly to 0 and the INNER content can sit at the settled
  // height while the outer box animates past it (no reflow mid-transition; xterm would
  // refit its grid on every intermediate height).
  // Lazy initial measurement: on every mount but the app's very first commit the host is
  // already in the DOM, so the first paint uses the real height — a 0 start would make
  // the height jump 0→target one commit later, which the transition turns into an
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

  // ------------------------------------------------------------------------------ fullscreen

  // The header's button toggles in place (corners out ↔ corners in), so a flip made there keeps
  // the focus where it is, and a quick second click lands on the same button rather than on
  // whatever slid into its slot. Leaving from the floating corner button unmounts that button,
  // which would drop the focus on the body; the focus moves to the header's toggle instead. An
  // exit the store forces (the agent opened a panel in the other dock) leaves the focus where the
  // user had it. Programmatic focus after a click draws no ring; after a keypress it does, which
  // is when it matters.
  const coarsePointer = useCoarsePointer();
  const focusToggleAfterExit = useRef(false);
  const toggleFullscreen = () => setDockFullscreen(fullscreen ? null : position);
  const exitFromCorner = () => {
    focusToggleAfterExit.current = true;
    setDockFullscreen(null);
  };
  useLayoutEffect(() => {
    if (fullscreen || !focusToggleAfterExit.current) return;
    focusToggleAfterExit.current = false;
    rootRef.current?.querySelector<HTMLElement>("[data-testid='dock-fullscreen']")?.focus();
  }, [fullscreen]);

  // ------------------------------------------------------------------------------ add menu

  const openPanelHere = (id: PanelId): void => {
    setAddOpen(false);
    // The merged view has no edge of its own to insist on — the panel's existing tab (or
    // the right-dock default) decides, which is also where it lands when the window
    // widens back out.
    openPanel(id, merged ? undefined : position);
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
        <DockHeaderButton
          label={S.dock.addTab}
          coarse={coarsePointer}
          data-testid="dock-add"
          onClick={() => setAddOpen(!addOpen)}
        >
          <GlyphIcon d={ICONS.plus} size={ICON_SIZE.iconButton} />
        </DockHeaderButton>
      }
    >
      <Menu>
        {offered.map((definition) => (
          <MenuItem
            key={definition.id}
            data-testid={`dock-add-${definition.id}`}
            glyph={definition.glyph}
            label={definition.label()}
            onSelect={() => openPanelHere(definition.id)}
          />
        ))}
        {terminalSupported && (
          <>
            <MenuSeparator />
            <MenuItem
              data-testid="dock-add-terminal"
              glyph={ICONS.plus}
              label={S.terminal.newShell}
              onSelect={() => {
                setAddOpen(false);
                void createShellInDock(merged ? undefined : position);
              }}
            />
            {/* Live shells no conversation holds, on the small rung: they are entries of the
                row above rather than panels of their own. */}
            {adoptable.map((terminal, index) => (
              <MenuItem
                key={terminal.id}
                density="sm"
                data-testid="dock-add-shell"
                data-terminal-id={terminal.id}
                label={terminalLabel(terminal, terminal.id, index + 1)}
                onSelect={() => {
                  setAddOpen(false);
                  addTerminalTab(terminal.id, merged ? undefined : position);
                }}
              />
            ))}
          </>
        )}
      </Menu>
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

  // A flip the store marks instant (a scope switch, a cross-dock move) must apply without
  // sliding. Leaving the tree is no longer what makes that instant — the node outlives a
  // collapse now — so the animation is left off for the commit that carries the flip and
  // restored two frames later, once the new size has been painted.
  const [snap, setSnap] = useState(false);
  const lastOpen = useRef(open);
  if (lastOpen.current !== open) {
    lastOpen.current = open;
    if (!animateEntrance) setSnap(true);
  }
  useEffect(() => {
    if (!snap) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSnap(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [snap]);

  const overlayActive = headerDrag.active || tabDrag.active;
  const overlayCandidate = headerDrag.active ? headerDrag.candidate : tabDrag.candidate;

  const terminalOrdinals = new Map<string, number>();
  tabs.forEach((tab) => {
    if (tab.kind === "terminal") terminalOrdinals.set(tab.terminalId, terminalOrdinals.size + 1);
  });

  // The terminal.close shortcut (⌃⌥` / Ctrl+Alt+` by default) inside a shown terminal asks for its
  // tab to close, and takes the × path above,
  // confirmation included. Only the dock holding that tab answers — and not while it is
  // collapsing out, when the merged view may list the same tab — so no request is answered
  // twice. The ref keeps one subscription per mount while the handler reads the current tabs.
  const closeRequest = useRef<(id: string) => void>(() => {});
  closeRequest.current = (id) => {
    if (!open) return;
    const tab = tabs.find((t) => t.kind === "terminal" && t.terminalId === id);
    if (!tab) return;
    closeTab(tab, terminalLabel(terminalById.get(id), id, terminalOrdinals.get(id) ?? 1));
  };
  useEffect(() => subscribeTerminalCloseRequests((id) => closeRequest.current(id)), []);

  // The strip's items: panel tabs by their panel's name and mark (the registry's, or the id and
  // the puzzle piece while no definition is registered), terminal tabs by their shell's seq and
  // title, closed by killing the shell.
  const stripTabs: DockTabItem[] = tabs.map((tab) => {
    const key = tabKey(tab);
    if (tab.kind === "panel") {
      return {
        key,
        label: panelLabel(tab.panel),
        glyph: panelGlyph(tab.panel, ICON_SIZE.inlineGlyph),
        badge: panelBadges?.[tab.panel] === true,
        closeLabel: S.dock.closeTab,
      };
    }
    const info = terminalById.get(tab.terminalId);
    const label = terminalLabel(info, tab.terminalId, terminalOrdinals.get(tab.terminalId) ?? 1);
    return {
      key,
      label,
      title: info ? `${info.name} — ${info.cwd}` : label,
      glyph: <GlyphIcon d={NAV_ICONS.terminal} size={ICON_SIZE.inlineGlyph} />,
      closeLabel: S.terminal.killShell,
      closeShortcut: closeShortcut ?? undefined,
      terminalId: tab.terminalId,
    };
  });
  const closeByKey = (key: string): void => {
    const tab = tabs.find((t) => tabKey(t) === key);
    const item = stripTabs.find((t) => t.key === key);
    if (tab && item) closeTab(tab, item.label);
  };

  // An open dock with nothing in it yet: the picker chooses what this dock opens. The
  // terminal row adopts the newest shell no conversation holds, or starts a fresh one, and
  // names its hotkey while one is bound; every panel row is one the registry offers here (the
  // built-in browser only where it can be shown: the desktop app's own window).
  const pickPanel = (definition: DockPanelDefinition): DockPickerChoice => ({
    key: definition.id,
    label: definition.label(),
    glyph: <GlyphIcon d={definition.glyph} size={ICON_SIZE.iconButton} />,
    onChoose: () => openPanel(definition.id, merged ? undefined : position),
  });
  const leading = (id: PanelId) => offered.find((definition) => definition.id === id);
  const agents = leading("agents");
  const browser = leading("builtin-browser");
  const pickerChoices: DockPickerChoice[] = [
    ...(agents !== undefined ? [pickPanel(agents)] : []),
    ...(terminalSupported
      ? [
          {
            key: "terminal",
            label: S.terminal.title,
            glyph: <GlyphIcon d={NAV_ICONS.terminal} size={ICON_SIZE.iconButton} />,
            ...(toggleChord !== null ? { keys: chordKeys(toggleChord) } : {}),
            onChoose: () => void openTerminalInDock(merged ? undefined : position),
          },
        ]
      : []),
    ...(browser !== undefined ? [pickPanel(browser)] : []),
    ...offered.filter((definition) => !PICKER_LEAD.includes(definition.id)).map(pickPanel),
  ];

  const bodies =
    tabs.length === 0 ? (
      <DockPicker choices={pickerChoices} horizontal={horizontal} />
    ) : (
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          const key = tabKey(tab);
          const active = key === activeKey;
          return (
            <div key={key} className={active ? "flex h-full min-h-0 flex-col" : "hidden"}>
              {/* A hidden dock's shown tab is no more on screen than a covered one: the
                  bodies gate their polling and their reload-on-return on this, and a
                  collapsed dock should cost nothing while it is away. */}
              {tab.kind === "panel" ? (
                <PanelBody
                  id={tab.panel}
                  position={position}
                  merged={merged}
                  active={active && open}
                  fullscreen={fullscreen}
                />
              ) : (
                <TerminalBody id={tab.terminalId} active={active && open} />
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
      cancelLabel={S.common.cancel}
    >
      {confirmKill !== null && (
        <p className="break-words text-sm text-gray-600 dark:text-gray-300">
          {S.dock.killConfirmBody(confirmKill.label)}
        </p>
      )}
    </ConfirmModal>
  );

  // The boundary handle: on the bottom dock an overlay straddling the top edge (it costs no
  // height), on the right dock a layout sibling (it must cost real width). The store clamps
  // the size a drag asks for.
  const handle = (
    <ResizeHandle
      data-testid="dock-resizer"
      axis={horizontal ? "y" : "x"}
      edge={horizontal ? "start" : undefined}
      label={S.dock.resize}
      onResizeStart={() => setResizing(true)}
      onResize={resizeTo}
      onResizeEnd={resizeEnd}
      onReset={onResizerDoubleClick}
    />
  );

  const settledSize = horizontal ? bottomHeight : sideWidth;

  return (
    <DockFrame
      position={horizontal ? "bottom" : "right"}
      open={open}
      // Collapsed to 0 while closing or entering.
      size={open && entered ? settledSize : 0}
      contentSize={settledSize}
      animate={!resizing && !snap}
      rootRef={rootRef}
      headerProps={headerDragProps}
      movable={!merged && !fullscreen}
      fullscreen={fullscreen}
      exitFullscreen={{ label: S.dock.exitFullscreen, onExit: exitFromCorner }}
      tabs={
        // Drag sideways to reorder, drag out to move onto the other edge.
        <DockTabs
          tabs={stripTabs}
          active={activeKey}
          onSelect={activateTab}
          onClose={closeByKey}
          coarse={coarsePointer}
          stripRef={stripRef}
          {...stripDragProps}
        />
      }
      actions={
        <>
          {activeTab?.kind === "terminal" && (
            <DockHeaderButton
              label={S.terminal.detach}
              coarse={coarsePointer}
              data-testid="dock-detach"
              onClick={detach}
            >
              <GlyphIcon d={ICONS.boxArrowOut} size={ICON_SIZE.rowLead} />
            </DockHeaderButton>
          )}
          {addMenu}
          {!merged && !fullscreen && tabs.length > 0 && (
            <DockHeaderButton
              label={position === "right" ? S.dock.moveToBottom : S.dock.moveToRight}
              coarse={coarsePointer}
              data-testid="dock-move"
              onClick={() => moveDock(position, other)}
            >
              <GlyphIcon
                d={position === "right" ? ICONS.panelBottom : ICONS.panelRight}
                size={ICON_SIZE.rowLead}
              />
            </DockHeaderButton>
          )}
          {/* Not in the picker state: with no tab there is nothing to show full screen. While
              fullscreen it stays where it was, as the way back beside the floating one. */}
          {tabs.length > 0 && (
            <DockHeaderButton
              label={fullscreen ? S.dock.exitFullscreen : S.dock.fullscreen}
              coarse={coarsePointer}
              data-testid="dock-fullscreen"
              onClick={toggleFullscreen}
            >
              <GlyphIcon
                d={fullscreen ? ICONS.cornersIn : ICONS.cornersOut}
                size={ICON_SIZE.rowLead}
              />
            </DockHeaderButton>
          )}
          <DockHeaderButton
            label={S.dock.hideDock}
            coarse={coarsePointer}
            data-testid="dock-close"
            onClick={hide}
          >
            <CloseIcon size={12} />
          </DockHeaderButton>
        </>
      }
      handle={handle}
      overlays={
        <>
          {overlayActive && <DockDragOverlay candidate={overlayCandidate} />}
          {killConfirm}
        </>
      }
    >
      {bodies}
    </DockFrame>
  );
}
