import { EmptyState, ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { machineForSession } from "../../lib/session-machines";
import { panelLabel, type DockPanelBodyProps, type PanelId } from "../dock/index";

import { useChatDock } from "./session/main-dock-context";
import { ChatMemoryView } from "./memory-view";
function draftPlaceholder(id: PanelId) {
  return (
    <EmptyState
      title={panelLabel(id)}
      // The schedules tab says what the first message unlocks; the other tabs share one line.
      description={id === "schedules" ? S.schedule.panelDraftEmpty : S.dock.draftEmpty}
    />
  );
}
function MemoryPanelBody({ active }: DockPanelBodyProps) {
  const { selected, sessionMemoryChanges, memoryListing, memoryRequest, openMemorySettings } =
    useChatDock();
  if (!selected) return draftPlaceholder("memory");
  return (
    <ChatMemoryView
      key={selected.sessionId}
      session={selected}
      changes={sessionMemoryChanges}
      scopes={memoryListing.scopes}
      listingError={memoryListing.error}
      request={memoryRequest}
      active={active}
      // Management (add / edit / delete) lives on the agent-settings memory tab, of the Agent
      // on the machine this conversation is on.
      machineId={machineForSession(selected.sessionId)}
      onOpenSettings={() =>
        openMemorySettings(selected.agentId, machineForSession(selected.sessionId))
      }
    />
  );
}
export const mainPanelDefinition = {
  id: "memory",
  label: () => S.chat.memoryViewTitle,
  glyph: ICONS.brain,
  order: 30,
  Body: MemoryPanelBody,
};
