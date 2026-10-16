/**
 * The scheduled-tasks panel (`DockModule.panels`, kind `schedules`): the open conversation's
 * scheduled tasks, started over per conversation (keyed by Session). Its draft placeholder says
 * what the first message unlocks.
 */
import { DraftPanelEmpty } from "../../lib/dock-panel-empty";
import { useChatSession } from "../../lib/chat-session";
import { S } from "../../lib/strings";
import { SchedulePanel } from "./schedule-panel";

export function ScheduleDockPanel({ active }: { active: boolean }) {
  const { selected, prefillComposer } = useChatSession();
  if (!selected) return <DraftPanelEmpty description={S.schedule.panelDraftEmpty} />;
  return (
    <SchedulePanel
      key={selected.sessionId}
      session={selected}
      active={active}
      onPrefillComposer={prefillComposer}
    />
  );
}
