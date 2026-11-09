/**
 * The dock's interface and its slot. A panel tab's body comes from the module that owns it — the
 * conversation's agents and memory from chat, the files from workspace, the trace, the messaging
 * binding, the scheduled tasks, the built-in browser and the port forwards from theirs — as a
 * contribution to `panels`, so the dock names none of them. A body reads the conversation it is
 * docked beside through `useChatSession()` (lib/chat-session.ts) and shows its own draft
 * placeholder (lib/dock-panel-empty.tsx).
 *
 * The interface itself carries nothing: the kernel hangs a module's slots on an interface it
 * provides (`DockSlots` beside `Dock`), and the dock module registers every contribution in the
 * panel registry (panel-registry.ts) at boot, which is what the dock's surfaces read (module.ts).
 */
import type { ComponentType } from "react";
import { Interface, type Slot } from "@prismshadow/penguin-core/kernel";

@Interface()
export abstract class Dock {}

/** The data half of a `panels` contribution: the panel's identity wherever it is named. */
export interface DockPanelData {
  /** The tab's stored key (dock-state.ts) — stable across versions, since layouts persist it. */
  kind: string;
  /** The panel's name on its tab and in the docks' menus, in English and in Chinese. */
  title: string;
  titleZh: string;
  /** Its mark: a name in the UI package's icon registry (`ICONS`). */
  icon: string;
  /** Its place in the docks' menus, ascending. */
  order: number;
}

/**
 * A panel body. It stays mounted while its tab is in a strip; `active` is whether it is on screen
 * (its tab in front and its dock open), which is what a body gates its polling on. A body offered
 * only in some places (the built-in browser) carries the registry's live question on itself as
 * `PanelOffering`, which the dock registers with it (module.ts).
 */
export type DockPanel = ComponentType<{ active: boolean }>;

/** Where a panel is offered, when not everywhere: a live answer and the feed of its changes. */
export interface PanelOffering {
  offered?: () => boolean;
  subscribeOffered?: (listener: () => void) => () => void;
}

export interface DockSlots {
  /** A panel kind the docks offer, and its body. */
  panels: Slot<DockPanelData, DockPanel>;
}
