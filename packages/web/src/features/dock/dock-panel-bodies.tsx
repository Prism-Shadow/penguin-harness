import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { PageIdentity } from "../../lib/page-focus";
import {
  borrowedDockPanel,
  dockTabs,
  matchesDockOwner,
  fullscreenDock,
  type DockPosition,
} from "./dock-state";
import { usePanelWidthValue } from "./use-panel-width";
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
  children,
}: {
  mounts: DockMount[] | null;
  sessionId: string | null;
  Body: ComponentType<PanelBodyProps>;
  children: ReactNode;
}) {
  const width = usePanelWidthValue();
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
      <div data-dock-area data-right-dock-width={width} className="flex min-h-0 flex-1 flex-col">
        <div ref={parking} hidden />
        {children}
        {[...placements.values()].map((props) => {
          const node = pool.nodes.get(props.id);
          return node ? createPortal(<Body {...props} />, node, props.id) : null;
        })}
      </div>
    </Containers.Provider>
  );
}
