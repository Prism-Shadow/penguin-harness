/**
 * The messaging panel (`DockModule.panels`, kind `messaging`): the open conversation's relay
 * bindings, started over per conversation (keyed by Session).
 */
import { DraftPanelEmpty } from "../../lib/dock-panel-empty";
import { useChatSession } from "../../lib/chat-session";
import { MessagingPanel } from "./messaging-panel";

export function MessagingDockPanel({ active }: { active: boolean }) {
  const { selected } = useChatSession();
  if (!selected) return <DraftPanelEmpty />;
  return <MessagingPanel key={selected.sessionId} sessionId={selected.sessionId} active={active} />;
}
