/**
 * The Trace panel (`DockModule.panels`, kind `trace`): the open conversation's Trace files,
 * started over per conversation (keyed by Session) and re-read on every settled turn.
 */
import { DraftPanelEmpty } from "../../lib/dock-panel-empty";
import { useChatSession } from "../../lib/chat-session";
import { TracePanel } from "./trace-panel";

export function TraceDockPanel({ active }: { active: boolean }) {
  const { selected, settledTurnSignal } = useChatSession();
  if (!selected) return <DraftPanelEmpty />;
  return (
    <TracePanel
      key={selected.sessionId}
      session={selected}
      active={active}
      reloadSignal={settledTurnSignal}
    />
  );
}
