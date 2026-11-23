/**
 * The dock's interface and its slots. A panel tab's body comes from the module that owns it — the
 * conversation's agents and memory from chat, the files from workspace, the trace, the messaging
 * binding, the scheduled tasks, the built-in browser and the port forwards from theirs — as a
 * contribution to `panels`, so the dock names none of them. A body reads the conversation it is
 * docked beside through `useChatSession()` (lib/chat-session.ts) and shows its own draft
 * placeholder (lib/dock-panel-empty.tsx). A module that keeps state in step with the docks hears
 * of the conversation on screen (`scopeListeners`) and of full-screen steps (`layoutListeners`).
 *
 * The interface itself carries nothing: the kernel hangs a module's slots on an interface it
 * provides (`DockSlots` beside `Dock`), and the dock module registers every contribution in the
 * panel registry (panel-registry.ts) and the listener lists (dock-listeners.ts) at boot, which is
 * what the dock's surfaces read (module.ts). The data and code types are the plugin face's
 * (`@prismshadow/penguin-web-plugin`), so a plugin's web half and the boot check judge one shape.
 */
import type { ComponentType } from "react";
import { Interface, type Slot } from "@prismshadow/penguin-core/kernel";
import type {
  DockLayoutListener,
  DockPanelData,
  DockScopeListener,
  Ordered,
} from "@prismshadow/penguin-web-plugin";

export type { DockPanelData };

@Interface()
export abstract class Dock {}

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
  /** Told of the conversation on screen, before the docks switch to it. */
  scopeListeners: Slot<Ordered, DockScopeListener>;
  /** Told when a dock surface's step into or out of full screen has reached the DOM. */
  layoutListeners: Slot<Ordered, DockLayoutListener>;
}
