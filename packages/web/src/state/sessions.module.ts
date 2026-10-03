/**
 * The sessions module: owner of the user event stream's `userEvents` slot (state/user-events.ts).
 * It provides the contributed handlers in `order`; the shell hands them to `SessionsProvider`,
 * whose store dispatches every event it does not keep to itself through them.
 */
import { Module, Provide } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { UserEventHandler, UserEventHandlers, UserEventsData } from "./user-events";

@Module()
export class SessionsModule {
  @Provide() userEventHandlers!: UserEventHandlers;
  setup({ contributions }: ClassCtx) {
    const handlers = (contributions.userEvents ?? [])
      .map((c) => ({ order: (c.data as unknown as UserEventsData).order, handler: c.code }))
      .sort((a, b) => a.order - b.order)
      .map((c) => c.handler as UserEventHandler);
    this.userEventHandlers = { all: () => handlers };
  }
}
