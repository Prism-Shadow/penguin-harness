/** Scheduled tasks: the handler that keeps the schedule store current on the scheduler's events. */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { scheduleUserEvents } from "./schedule-store";

@Module({
  contributes: {
    "SessionsModule.userEvents": [{ id: "schedules.events", order: 30 }],
  },
})
export class SchedulesModule {
  @Bind("schedules.events") events = scheduleUserEvents;
}
