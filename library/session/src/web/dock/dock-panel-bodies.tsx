import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useLayoutEffect,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { RESIZE_HANDLE_PX } from "@prismshadow/penguin-ui";
import { PageIdentity } from "@prismshadow/penguin-web/internal";
import {
  borrowedDockPanel,
  dockTabs,
  matchesDockOwner,
  fullscreenDock,
  type DockPosition,
} from "./dock-state";
import { dockWidthFor, MIN_CONVERSATION_WIDTH, usePanelWidthValue } from "./use-panel-width";
import type { DockMount } from "./use-dock-mount";

export interface PanelBodyProps {
  id: string;
  loanKey?: string;
  position: DockPosition;
  merged: boolean;
  active: boolean;
  fullscreen: boolean;
}

// A native editor belongs to its Session, across a temporary change of dock edge.
// Each Body keeps one React key and one portal container; only its placement changes.
interface PanelContainers {
  nodes: Map<string, HTMLElement>;
  parking: RefObject<HTMLDivElement | null>;
}
const AreaWidth = createContext<number | null>(null);

export function useDockAreaWidth() {
  return useContext(AreaWidth);
}

const Containers = createContext<PanelContainers | null>(null);

function place(container: HTMLElement, slot: HTMLElement) {
  if (container.parentNode === slot) return;
  if (
    container.isConnected &&
    slot.isConnected &&
    "moveBefore" in slot &&
    typeof slot.moveBefore === "function"
  )
    slot.moveBefore(container, null);
  else slot.appendChild(container);
}

export function NativePanelSlot({ id }: { id: string }) {
  const pool = useContext(Containers);
  const container = pool?.nodes.get(id);
  const attach = useCallback(
    (slot: HTMLDivElement | null) => {
      if (!slot || !pool || !container) return;
      place(container, slot);
      return () => {
        if (container.parentNode === slot && pool.parking.current)
          place(container, pool.parking.current);
      };
    },
    [container, pool],
  );
  return <div ref={attach} className="flex h-full min-h-0 flex-col" />;
}

export function useNativePanelSlots() {
  return useContext(Containers) !== null;
}

export function DockPanelArea({
  mounts,
  sessionId,
  Body,
  toolbar,
  right,
  children,
}: {
  mounts: DockMount[] | null;
  sessionId: string | null;
  Body: ComponentType<PanelBodyProps>;
  toolbar: ReactNode;
  right: ReactNode;
  children: ReactNode;
}) {
  const preferred = usePanelWidthValue();
  const area = useRef<HTMLDivElement>(null);
  const [hostWidth, setHostWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const measure = () => setHostWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = hostWidth === null ? preferred : dockWidthFor(preferred, hostWidth);
  const page = useContext(PageIdentity);
  const parking = useRef<HTMLDivElement>(null);
  const pool = useRef<PanelContainers>({ nodes: new Map(), parking }).current;
  const last = useRef(new Map<string, PanelBodyProps>());
  // Changing routes briefly detaches the conversation from the foreground dock.
  // Return its actual editor when it is shown again, even after visiting another page.
  const owns = mounts !== null && (sessionId === null || matchesDockOwner(sessionId, page?.id));
  const placements = new Map<string, PanelBodyProps>();
  if (owns) {
    for (const position of ["right", "bottom"] as const) {
      for (const { panel: id } of dockTabs(position)) {
        if (last.current.has(id))
          placements.set(id, { id, position, merged: false, active: false, fullscreen: false });
      }
    }
  } else {
    for (const [id, body] of last.current)
      placements.set(id, { ...body, active: false, fullscreen: false });
  }
  for (const { view, open } of owns ? mounts : []) {
    if (!view) continue;
    for (const { panel } of view.tabs) {
      const id = borrowedDockPanel(panel) ?? panel;
      if (id.startsWith(":")) continue;
      placements.set(id, {
        id,
        ...(id !== panel ? { loanKey: panel } : {}),
        position: view.position,
        merged: view.merged,
        active: open && view.activeKey === panel,
        fullscreen: open && fullscreenDock() === view.position,
      });
    }
  }
  if (owns) last.current = placements;
  for (const id of pool.nodes.keys()) if (!placements.has(id)) pool.nodes.delete(id);
  for (const id of placements.keys()) {
    if (!pool.nodes.has(id) && typeof document !== "undefined") {
      const container = document.createElement("div");
      container.className = "flex h-full min-h-0 flex-col";
      pool.nodes.set(id, container);
    }
  }
  return (
    <Containers.Provider value={pool}>
      <AreaWidth.Provider value={hostWidth}>
        <div
          ref={area}
          data-dock-area
          data-dock-row
          data-right-dock-width={width}
          className="flex min-h-0 min-w-0 flex-1"
        >
          <div ref={parking} hidden />
          <div
            data-session-column
            className="flex min-h-0 flex-1 flex-col"
            style={{
              minWidth: `min(${MIN_CONVERSATION_WIDTH}px, calc(100% - ${RESIZE_HANDLE_PX}px))`,
            }}
          >
            {toolbar}
            {children}
          </div>
          {right}
          {[...placements.values()].map((props) => {
            const node = pool.nodes.get(props.id);
            return node ? createPortal(<Body {...props} />, node, props.id) : null;
          })}
        </div>
      </AreaWidth.Provider>
    </Containers.Provider>
  );
}
