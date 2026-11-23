import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { borrowedDockPanel, fullscreenDock, type DockPosition } from "./dock-state";
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
const Containers = createContext<Map<string, HTMLElement> | null>(null);

export function NativePanelSlot({ id }: { id: string }) {
  const container = useContext(Containers)?.get(id);
  const attach = useCallback(
    (slot: HTMLDivElement | null) => {
      if (!slot || !container || container.parentNode === slot) return;
      if (
        container.isConnected &&
        slot.isConnected &&
        "moveBefore" in slot &&
        typeof slot.moveBefore === "function"
      )
        slot.moveBefore(container, null);
      else slot.appendChild(container);
    },
    [container],
  );
  return <div ref={attach} className="flex h-full min-h-0 flex-col" />;
}

export function useNativePanelSlots() {
  return useContext(Containers) !== null;
}

export function DockPanelArea({
  mounts,
  Body,
  children,
}: {
  mounts: DockMount[];
  Body: ComponentType<PanelBodyProps>;
  children: ReactNode;
}) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const placements = new Map<string, PanelBodyProps>();
  for (const { view, open } of mounts) {
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
  for (const id of nodes.current.keys()) if (!placements.has(id)) nodes.current.delete(id);
  for (const id of placements.keys()) {
    if (!nodes.current.has(id) && typeof document !== "undefined") {
      const container = document.createElement("div");
      container.className = "flex h-full min-h-0 flex-col";
      nodes.current.set(id, container);
    }
  }
  return (
    <Containers.Provider value={nodes.current}>
      <div data-dock-area className="flex min-h-0 flex-1 flex-col">
        {children}
        {[...placements.values()].map((props) => {
          const node = nodes.current.get(props.id);
          return node ? createPortal(<Body {...props} />, node, props.id) : null;
        })}
      </div>
    </Containers.Provider>
  );
}
