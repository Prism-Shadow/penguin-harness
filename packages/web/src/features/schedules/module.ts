import { mainPanelDefinition as mainPanelschedules } from "./main-dock-panel";
/**
 * Scheduled tasks: the handler that keeps the schedule store current on the scheduler's events,
 * the mark a scheduled conversation's row wears in the session list (session-row-mark.ts), and the
 * dock's scheduled-tasks panel (schedule-dock-panel.tsx).
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { scheduleUserEvents } from "./schedule-store";
import { scheduledRowMark } from "./session-row-mark";
import { ScheduleDockPanel } from "./schedule-dock-panel";

@Module({
  contributes: {
    "SessionsModule.userEvents": [{ id: "schedules.events", order: 30 }],
    "SessionListModule.rowActions": [{ id: "schedules.mark", order: 20 }],
    "DockModule.panels": [
      {
        id: "schedules.panel",
        kind: "schedules",
        title: "Scheduled tasks",
        titleZh: "定时任务",
        icon: "alarmClock",
        order: 60,
      },
    ],
  },
})
export class SchedulesModule {
  @Bind("schedules.events") events = scheduleUserEvents;
  @Bind("schedules.mark") mark = scheduledRowMark;
  @Bind("schedules.panel") panel = { mainDefinitions: [mainPanelschedules] };
}
