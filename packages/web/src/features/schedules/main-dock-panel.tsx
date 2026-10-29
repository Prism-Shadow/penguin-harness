import { machineForSession } from "../../lib/session-machines";
import { EmptyState, ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { panelLabel, type DockPanelBodyProps, type PanelId } from "../dock/index";

import { SchedulePanel } from "./schedule-panel";
import { useChatSession } from "../../lib/chat-session";
function draftPlaceholder(id: PanelId) {
  return (
    <EmptyState
      title={panelLabel(id)}
      // The schedules tab says what the first message unlocks; the other tabs share one line.
      description={id === "schedules" ? S.schedule.panelDraftEmpty : S.dock.draftEmpty}
    />
  );
}
function SchedulesPanelBody({ active }: DockPanelBodyProps) {
  const { selected, prefillComposer } = useChatSession();
  if (!selected) return draftPlaceholder("schedules");
  return (
    <SchedulePanel
      key={selected.sessionId}
      session={selected}
      machineId={machineForSession(selected.sessionId)}
      active={active}
      onPrefillComposer={prefillComposer}
    />
  );
}
export const mainPanelDefinition = {
  id: "schedules",
  label: () => S.schedule.panelTitle,
  glyph: ICONS.alarmClock,
  order: 60,
  Body: SchedulesPanelBody,
};
