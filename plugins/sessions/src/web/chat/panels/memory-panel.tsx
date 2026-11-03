/**
 * The memory panel (`DockModule.panels`, kind `memory`): what the open conversation's Agent
 * remembers and what this conversation changed, started over per conversation (keyed by Session).
 * Management (add / edit / delete) lives on the agent-settings memory tab.
 */
import { DraftPanelEmpty } from "../../../lib/dock-panel-empty";
import { ChatMemoryView } from "../memory-view";
import { useChatControllerContext } from "../session/chat-session-context";

export function MemoryPanel({ active }: { active: boolean }) {
  const { navigate, selected, memoryRequest, sessionMemoryChanges, memoryListing } =
    useChatControllerContext();
  if (!selected) return <DraftPanelEmpty />;
  return (
    <ChatMemoryView
      key={selected.sessionId}
      session={selected}
      changes={sessionMemoryChanges}
      scopes={memoryListing.scopes}
      listingError={memoryListing.error}
      request={memoryRequest}
      active={active}
      onOpenSettings={() => navigate(`/agents/${selected.agentId}?tab=memory`)}
    />
  );
}
