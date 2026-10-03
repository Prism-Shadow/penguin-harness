/**
 * The user event stream's dispatch (`SessionsModule.userEvents`): the session list store reads
 * the one user-level connection (/api/events, state/sessions.tsx) and handles the events that
 * are its own; every other event goes to the handlers the features contributed, in `order`.
 * Each handler claims its own event types, so the list never names the features that listen.
 *
 * The slot hangs on the interface the sessions module provides (`UserEventHandlersSlots` beside
 * `UserEventHandlers`); a contribution names the module: `"SessionsModule.userEvents"`.
 */
import type { ServerEvent } from "@prismshadow/penguin-server/api";
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Opaque, Slot } from "@prismshadow/penguin-core/kernel";

/** A feature's share of the user event stream. */
export interface UserEventHandler {
  /**
   * One event the list did not keep to itself. `source` is the machine it came from, null for
   * this server. The event is opaque to the interface table: its shape is the server's wire
   * protocol, already typed by the server's api, and projecting the whole union would put it
   * in the table the entry bundle carries.
   */
  event(ev: Opaque<"ServerEvent", ServerEvent>, source: string | null): void;
  /**
   * The stream reconnected past its replay buffer (`resync_required`), on `source`: events were
   * lost, so whatever was derived from them must be read again.
   */
  resync?(source: string | null): void;
}

/** The data half of a `userEvents` contribution. */
export interface UserEventsData {
  /** The handler's place in the dispatch, ascending. */
  order: number;
}

/** The contributed handlers, in dispatch order. */
@Interface()
export abstract class UserEventHandlers {
  abstract all(): readonly UserEventHandler[];
}

export interface UserEventHandlersSlots {
  /** A feature's handler for the user events it claims. */
  userEvents: Slot<UserEventsData, UserEventHandler>;
}
