import { machineForSession } from "@prismshadow/penguin-web/internal";
/**
 * The scheduled-tasks panel (`DockModule.panels`, kind `schedules`): the open conversation's
 * scheduled tasks, started over per conversation (keyed by Session). Its draft placeholder says
 * what the first message unlocks.
 */
import { DraftPanelEmpty } from "@prismshadow/penguin-web/internal";
import { useChatSession } from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";
import { SchedulePanel } from "./schedule-panel";

export function ScheduleDockPanel({ active }: { active: boolean }) {
  const { selected, prefillComposer } = useChatSession();
  if (!selected) return <DraftPanelEmpty description={S.schedule.panelDraftEmpty} />;
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
