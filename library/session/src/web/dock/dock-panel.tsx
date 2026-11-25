import {
  DockPanelTitle,
  S,
  ScopedPanelSession,
  SessionAppDockBody,
  chordKeys,
  confirmClose,
  displayedBinding,
  dockPageId,
  pageSessionId,
  sessionAppPair,
  sessionWorkbenchKindAt,
  useCoarsePointer,
  useKeymap,
  usePageWorkspace,
} from "@prismshadow/penguin-web/internal";
/**
 * One dock surface (dock-state.ts owns the arrangement): a tab strip across the top and
 * the active tab's body below — or, while the open dock has no tabs, a centered picker
 * choosing what to open here. The chat page renders one per open dock — right and/or
 * bottom — or a single merged bottom surface below the desktop breakpoint.
 *
 * The drawing is the UI package's (`DockFrame`, `DockTabs`, `DockPicker`); this container
 * binds it to the dock store and the panel registry.
 *
 * Panel tabs' bodies are the registry's (panel-registry.ts: the page registers one definition
 * per panel, body included, and this surface never names a panel itself), each wrapped in the
 * provider that tells it about its own tab (panel-context.tsx). A tab whose id has no definition
 * registered — a plugin's panel before the plugin loads — shows a placeholder saying so and keeps
 * its × until the definition arrives. The terminal is one of these panels: its body lists the
 * conversation's shells as tabs of its own (terminal-panel.tsx), as the browser's lists its pages.
 * Every tab's body stays mounted while its tab is in the strip — switching tabs hides and
 * shows, and so does hiding the whole dock (which renders at zero size rather than
 * unmounting), so a panel keeps its scroll, its drill-down and its unsaved text.
 *
 * The header carries the strip, a "+" menu (the panels the registry offers here), a
 * move-to-other-edge button, a fullscreen toggle, and the dock's × (hide — tabs and everything
 * their bodies hold stay; each tab's own always-visible × is what removes). A terminal has no way
 * out of its conversation's dock: no window of its own, no background form — it is a tab of the
 * terminal panel, and fullscreen is how it gets large. Tabs drag sideways to reorder;
 * dragging a tab out of the strip brings up the edge overlay (dock-drag.tsx) and dropping on
 * the other edge moves that tab there. Dragging the header itself moves the whole dock the same
 * way. The boundary with the chat content resizes the dock — the right dock through the shared
 * side-panel width, the bottom dock through its height ratio.
 *
 * The right surface can expand across the Session. A bottom surface expands below its
 * conversation toolbar. Only the explicit header button toggles fullscreen. Resizing changes
 * the dimensions of a docked surface and preserves its tabs, bodies and fullscreen state.
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
  DockFrame,
  DockHeaderButton,
  DockPicker,
  DockTabs,
  Dropdown,
  CrashBoundary,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Menu,
  MenuItem,
  ResizeHandle,
  usePointerDrag,
  type DockPickerChoice,
  type DockTabItem,
} from "@prismshadow/penguin-ui";

import { announceDockLayout } from "./dock-listeners";

import { DockDragOverlay, dockDropCandidate } from "./dock-drag";

import { DockPanelProvider, type DockPanelHandle } from "./panel-context";

import {
  DockPanelArea,
  NativePanelSlot,
  useNativePanelSlots,
  useDockAreaWidth,
  type PanelBodyProps,
} from "./dock-panel-bodies";
import type { ComponentProps } from "react";

import { panelGlyph, panelLabel } from "./panel-meta";
import {
  dockPanelDefinition,
  useDockPanels,
  type DockPanelDefinition,
  type PanelId,
} from "./panel-registry";
import { bottomDockHeight, bottomDockMaxHeight } from "./bottom-dock-size";
import { composerHeight, useComposerHeight } from "./composer-height";

import {
  activateTab,
  borrowedDockPanel,
  bottomRatio,
  currentDockScope,
  dockVersion,
  fullscreenDock,
  hideView,
  moveDock,
  moveTab,
  openNativePanel,
  removeTab,
  reorderDock,
  resetBottomRatio,
  setBottomRatio,
  setDockFullscreen,
  subscribeDock,
  tabHome,
  tabKey,
  type DockPosition,
  type DockTab,
  type DockView,
} from "./dock-state";
import { useSessionShortcuts } from "./session-shortcuts";
import {
  dockWidthFor,
  persistPanelWidth,
  resetPanelWidth,
  setPanelWidth,
  usePanelWidthValue,
} from "./use-panel-width";

/**
 * Closes a tab once its close guards agree (the Files panel's editor asks about unsaved text),
 * in the conversation it was closed in: an answer given after the user moved to another
 * conversation must not close that conversation's tab of the same kind.
 */
function closeWhenAllowed(key: string): void {
  const asked = currentDockScope();
  void confirmClose([key]).then((ok) => {
    if (ok && currentDockScope() === asked) removeTab(key);
  });
}

/**
 * A panel tab's body: the registry's component for its id, inside the provider that tells the
 * body about its own tab. An id with no definition registered (a plugin's tab stored before the
 * plugin loads, or after it was removed) shows a placeholder that says so and keeps the tab
 * closable from the strip; the body appears the moment the definition is registered, since the
 * dock re-renders on registration.
 */
function PanelBody({ id, position, merged, active, fullscreen, loanKey }: PanelBodyProps) {
  const workspace = usePageWorkspace();
  const ownerId = dockPageId(loanKey ?? id);
  const owner = workspace?.layout.pages.find((item) => item.id === ownerId);
  const page = loanKey ? undefined : owner;
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
        if (ownerId && workspace) workspace.close(ownerId);
        else closeWhenAllowed(id);
      },
    }),
    [id, position, merged, active, fullscreen, ownerId, workspace],
  );
  const session = workspace && sessionAppPair(workspace.layout)?.session;
  const Body = dockPanelDefinition(id)?.Body;
  return (
    <DockPanelProvider handle={handle}>
      <ScopedPanelSession path={owner?.path}>
        {page && session ? (
          <CrashBoundary resetKey={id}>
            <SessionAppDockBody page={page} sessionId={pageSessionId(session)} active={active} />
          </CrashBoundary>
        ) : Body !== undefined ? (
          // A panel that crashes (a plugin's, or one of ours) takes down its own tab, not the
          // conversation beside it.
          <CrashBoundary resetKey={id}>
            {/* The panel's name, which a contributed body's draft placeholder wears as its title. */}
            <DockPanelTitle.Provider value={panelLabel(id)}>
              <Body active={active} />
            </DockPanelTitle.Provider>
          </CrashBoundary>
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-4">
            <EmptyState title={S.dock.panelUnavailable} />
          </div>
        )}
      </ScopedPanelSession>
    </DockPanelProvider>
  );
}

export function ChatDockArea(props: Omit<ComponentProps<typeof DockPanelArea>, "Body">) {
  return <DockPanelArea {...props} Body={PanelBody} />;
}

export interface DockPanelProps {
  view: DockView;
  /** Attention dots per panel id (the agents tab's pending-approval amber dot). */
  panelBadges?: Partial<Record<PanelId, boolean>>;
  /** False only while the dock collapses on its way out (use-dock-mount keeps it mounted). */
  open?: boolean;
  /** Whether mounting plays the expand transition (false for instant changes — scope switches, moves). */
  animateEntrance?: boolean;
}

export function DockPanel({
  view,
  panelBadges,
  open = true,
  animateEntrance = true,
}: DockPanelProps) {
  useSyncExternalStore(subscribeDock, dockVersion);
  // The picker names a panel's keys (the terminal's toggle) and redraws when they are rebound.
  useKeymap();
  // The panels offered here, in registry order: what the "+" menu and the picker list, and
  // what re-renders the strip when a definition arrives for a tab it already shows.
  const offered = useDockPanels();
  const { position, merged, tabs, activeKey } = view;
  const shortcuts = useSessionShortcuts(offered, merged ? undefined : "right");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dockHost = () => rootRef.current?.closest<HTMLElement>("[data-dock-host]") ?? null;
  const nativeSlots = useNativePanelSlots();
  const horizontal = position === "bottom";
  const other: DockPosition = position === "right" ? "bottom" : "right";
  const [addOpen, setAddOpen] = useState(false);

  // The store decides which surface (if any) is fullscreen; this one is it while it is open and
  // the store names its position (the merged view's is "bottom", like the bottom dock's).
  const fullscreen = open && fullscreenDock() === position;

  // ---------------------------------------------------------------------------- selection

  // A panel tab closes directly unless its body registered a close guard (the Files panel's
  // editor holding unsaved text), which asks first: the tab's × is the one gesture here that
  // really unmounts a body. Closing the terminal panel's tab leaves its shells running — its
  // own strip's × is what ends one.
  const workspace = usePageWorkspace();
  const pageOf = (key: string) => workspace?.layout.pages.find((p) => p.id === dockPageId(key));
  const closeTab = (tab: DockTab) => {
    const page = pageOf(tabKey(tab));
    if (page && workspace) workspace.close(page.id);
    else closeWhenAllowed(tabKey(tab));
  };
  const selectTab = (key: string) => {
    const page = pageOf(key);
    const session = workspace && sessionAppPair(workspace.layout)?.session;
    if (page && session && workspace) workspace.openBesideSession(pageSessionId(session), page);
    activateTab(key);
  };
  // Hiding puts the surface away and nothing else — every body stays mounted at zero size —
  // so there is nothing to ask about, however much unsaved work a tab is holding.
  const hide = useCallback(() => hideView(view), [view]);

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
      // fullscreen surface is not moved either — it has grown past its edge, and the move
      // controls are put away with it.
      merged ||
      fullscreen ||
      (event.target as HTMLElement).closest("button, [data-testid='dock-tab']")
        ? null
        : {},
    onMove: (event) =>
      setHeaderDrag({
        active: true,
        candidate: dockDropCandidate(event.clientX, event.clientY, dockHost()),
      }),
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
      // Not while fullscreen, where the move controls are put away: the drag stays a reorder.
      const strip = stripEl.getBoundingClientRect();
      if (!fullscreen && (event.clientY < strip.top - 20 || event.clientY > strip.bottom + 20)) {
        setTabDrag({
          active: true,
          candidate: dockDropCandidate(event.clientX, event.clientY, dockHost()),
        });
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
  const preferredWidth = usePanelWidthValue();
  const hostWidth = useDockAreaWidth();
  const sideWidth = hostWidth === null ? preferredWidth : dockWidthFor(preferredWidth, hostWidth);
  const coveredElement = () =>
    rootRef.current?.closest<HTMLElement>(
      horizontal ? "[data-dock-bottom-area]" : "[data-dock-row]",
    ) ?? null;

  const [column, setColumn] = useState({ host: 0, area: 0 });
  useLayoutEffect(() => {
    if (!horizontal) return;
    const host = rootRef.current?.closest<HTMLElement>("[data-dock-host]");
    const area = rootRef.current?.closest<HTMLElement>("[data-dock-bottom-area]");
    if (!host || !area) return;
    const measure = () => {
      const next = { host: host.clientHeight, area: area.clientHeight };
      setColumn((last) => (next.host === last.host && next.area === last.area ? last : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(area);
    return () => observer.disconnect();
  }, [horizontal]);

  const resizeTo = (event: PointerEvent): void => {
    const pane = rootRef.current?.getBoundingClientRect();
    if (!pane || fullscreen) return;
    setResizing(true);
    if (horizontal) {
      if (column.host === 0) return;
      const max = bottomDockMaxHeight({ ...column, composer: composerHeight() });
      setBottomRatio(Math.min(pane.bottom - event.clientY, max) / column.host);
    } else {
      const asked = pane.right - event.clientX;
      setPanelWidth(hostWidth === null ? asked : dockWidthFor(asked, hostWidth));
    }
  };
  const resizeEnd = (committed: boolean): void => {
    setResizing(false);
    if (committed && !horizontal) persistPanelWidth();
  };

  const composer = useComposerHeight();
  const bottomSpace = { ...column, composer };
  const bottomMax = bottomDockMaxHeight(bottomSpace);
  const bottomHeight = bottomDockHeight(bottomRatio(), bottomSpace);

  const onResizerDoubleClick = useCallback(() => {
    if (horizontal) resetBottomRatio();
    else resetPanelWidth();
  }, [horizontal]);

  // ------------------------------------------------------------------------------ fullscreen

  // The header's button toggles in place (corners out ↔ corners in): a flip made there keeps the
  // focus where it is, and a quick second click lands on the same button rather than on whatever
  // slid into its slot. The header button toggles the fullscreen surface.
  const coarsePointer = useCoarsePointer();
  const toggleFullscreen = () => setDockFullscreen(fullscreen ? null : position);
  // A layer that lays content over a panel's slot by coordinates caches, per slot, which
  // ancestors clip it and whether it sits in a lifted surface. The frame's phase — not the store's
  // flag — is what changes both: the box is lifted, and clipping, through its enter and exit
  // animations, and back in the flow only once the exit has ended. Each step is announced once it
  // is in the DOM (`DockModule.layoutListeners`), and the listener re-measures on its next frame.
  const onFullscreenPhase = () => announceDockLayout();

  // ------------------------------------------------------------------------------ add menu

  const openPanelHere = (definition: DockPanelDefinition): void => {
    setAddOpen(false);
    // The merged view has no edge of its own to insist on — the panel's existing tab (or
    // its own default edge) decides, which is also where it lands when the window widens
    // back out.
    openNativePanel(definition.id, merged ? undefined : position, definition.defaultPosition);
  };

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
        {position === "right" || merged
          ? shortcuts.map((entry) => (
              <MenuItem
                key={entry.key}
                data-testid={`dock-add-${entry.key}`}
                glyph={<GlyphIcon d={entry.glyph} size={ICON_SIZE.inlineGlyph} />}
                label={entry.label}
                onSelect={() => {
                  setAddOpen(false);
                  entry.choose();
                }}
              />
            ))
          : offered.map((definition) => (
              <MenuItem
                key={definition.id}
                data-testid={`dock-add-${definition.id}`}
                glyph={<GlyphIcon d={definition.glyph} size={ICON_SIZE.inlineGlyph} />}
                label={definition.label()}
                onSelect={() => openPanelHere(definition)}
              />
            ))}
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

  // Suppress motion for an instant scope change or cross-dock move, including the first
  // host measurement when the destination mounts. Restore motion after the new size paints.
  const [snap, setSnap] = useState(!animateEntrance);
  const lastOpen = useRef(open);
  if (lastOpen.current !== open) {
    lastOpen.current = open;
    if (!animateEntrance) setSnap(true);
  }
  // A ceiling that comes down past the bottom dock (the composer grew a line, the window got
  // shorter) is room the composer needs now: the dock gives it up in the same commit rather than
  // through the layout motion, under which the composer would sit beneath the dock's edge until
  // the motion ended. A dock growing back, or resized on purpose, still moves.
  const [lastBottom, setLastBottom] = useState({ max: bottomMax, height: bottomHeight });
  if (horizontal && (lastBottom.max !== bottomMax || lastBottom.height !== bottomHeight)) {
    setLastBottom({ max: bottomMax, height: bottomHeight });
    if (bottomMax < lastBottom.max && bottomHeight < lastBottom.height) setSnap(true);
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

  // The strip's items: panel tabs by their panel's name and mark (the registry's, or the id and
  // the puzzle piece while no definition is registered).
  const stripTabs: DockTabItem[] = tabs.map((tab) => {
    const page = pageOf(tab.panel);
    const panel = (page && sessionWorkbenchKindAt(page.path)) ?? tab.panel;
    return {
      key: tabKey(tab),
      label: page?.title ?? panelLabel(tab.panel),
      glyph: panelGlyph(panel, ICON_SIZE.inlineGlyph),
      badge: panelBadges?.[tab.panel] === true,
      closeLabel: S.dock.closeTab,
    };
  });
  const closeByKey = (key: string): void => {
    const tab = tabs.find((t) => tabKey(t) === key);
    if (tab) closeTab(tab);
  };

  // An open dock with nothing in it yet: the picker chooses what this dock opens. Every row is a
  // panel the registry offers here (the terminal only with a Session to own its shells, the
  // built-in browser only where it can be shown: the desktop app's own window), and a row whose
  // panel names a command shows that command's keys while they are bound.
  const pickPanel = (definition: DockPanelDefinition): DockPickerChoice => {
    const chord = definition.shortcut === undefined ? null : displayedBinding(definition.shortcut);
    return {
      key: definition.id,
      label: definition.label(),
      glyph: <GlyphIcon d={definition.glyph} size={ICON_SIZE.iconButton} />,
      ...(chord !== null ? { keys: chordKeys(chord) } : {}),
      onChoose: () =>
        openNativePanel(definition.id, merged ? undefined : position, definition.defaultPosition),
    };
  };
  // The picker leads with the panels that ask to (`lead`): what a conversation most often opens.
  // Both runs keep the registry's order, which is where a plugin's panel lands.
  const pickerChoices: DockPickerChoice[] = [
    ...offered.filter((definition) => definition.lead === true),
    ...offered.filter((definition) => definition.lead !== true),
  ].map(pickPanel);

  const bodies =
    tabs.length === 0 ? (
      <DockPicker choices={pickerChoices} horizontal={horizontal} />
    ) : (
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          const key = tabKey(tab);
          const native = borrowedDockPanel(key) ?? key;
          const active = key === activeKey;
          return (
            <div key={key} className={active ? "flex h-full min-h-0 flex-col" : "hidden"}>
              {/* A hidden dock's shown tab is no more on screen than a covered one: the
                  bodies gate their polling and their reload-on-return on this, and a
                  collapsed dock should cost nothing while it is away. */}
              {nativeSlots && !native.startsWith(":") ? (
                <NativePanelSlot id={native} />
              ) : (
                <PanelBody
                  id={tab.panel}
                  position={position}
                  merged={merged}
                  active={active && open}
                  fullscreen={fullscreen}
                />
              )}
            </div>
          );
        })}
      </div>
    );

  const handle = (
    <ResizeHandle
      data-testid="dock-resizer"
      axis={horizontal ? "y" : "x"}
      edge={horizontal ? "start" : undefined}
      label={S.dock.resize}
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
      fullscreenHost={coveredElement}
      onFullscreenPhase={onFullscreenPhase}
      tabs={
        // Drag sideways to reorder, drag out to move onto the other edge.
        <DockTabs
          tabs={stripTabs}
          active={activeKey}
          onSelect={selectTab}
          onClose={closeByKey}
          coarse={coarsePointer}
          stripRef={stripRef}
          {...stripDragProps}
        />
      }
      actions={
        <>
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
              fullscreen it stays where it was, as the one way back. */}
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
        overlayActive && <DockDragOverlay candidate={overlayCandidate} element={dockHost()} />
      }
    >
      {bodies}
    </DockFrame>
  );
}
