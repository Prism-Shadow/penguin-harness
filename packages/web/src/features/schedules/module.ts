/**
 * Scheduled tasks: the handler that keeps the schedule store current on the scheduler's events,
 * and the mark a scheduled conversation's row wears in the session list (session-row-mark.ts).
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { scheduleUserEvents } from "./schedule-store";
import { scheduledRowMark } from "./session-row-mark";

@Module({
  contributes: {
    "SessionsModule.userEvents": [{ id: "schedules.events", order: 30 }],
    "SessionListModule.rowActions": [{ id: "schedules.mark", order: 20 }],
  },
})
export class SchedulesModule {
  @Bind("schedules.events") events = scheduleUserEvents;
  @Bind("schedules.mark") mark = scheduledRowMark;
}
