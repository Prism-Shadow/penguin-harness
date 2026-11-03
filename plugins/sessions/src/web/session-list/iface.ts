/**
 * The session list's interface and its slot. The list is a sidebar section (module.ts); what it
 * offers on its rows beyond its own actions comes from `rowActions` — the messaging binding, the
 * scheduled-task mark, the Workspace group's "Browse files" — so the list imports none of the
 * features behind them. The contributed shapes live in lib/session-row-contributions.ts.
 *
 * The interface itself carries nothing: the kernel hangs a module's slots on an interface it
 * provides (`SessionListSlots` beside `SessionList`), and the list has no API of its own to offer.
 */
import { Interface, type Slot } from "@prismshadow/penguin-core/kernel";

import type { RowAction } from "../../lib/session-row-contributions";

@Interface()
export abstract class SessionList {}

/** The data half of a `rowActions` contribution. */
export interface RowActionData {
  /** Its place among the contributed entries of the same menu, ascending. */
  order: number;
}

export interface SessionListSlots {
  /** An entry in a conversation row's or a Workspace group's menu, or a mark on conversation rows. */
  rowActions: Slot<RowActionData, RowAction>;
}
