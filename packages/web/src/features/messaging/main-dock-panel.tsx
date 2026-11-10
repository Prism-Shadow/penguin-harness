import { EmptyState, ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { panelLabel, type DockPanelBodyProps, type PanelId } from "../dock/index";

import { MessagingPanel } from "./messaging-panel";
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
function MessagingPanelBody({ active }: DockPanelBodyProps) {
  const { selected } = useChatSession();
  if (!selected) return draftPlaceholder("messaging");
  return <MessagingPanel key={selected.sessionId} sessionId={selected.sessionId} active={active} />;
}
export const mainPanelDefinition = {
  id: "messaging",
  label: () => S.messaging.panelTitle,
  glyph: ICONS.paperPlane,
  order: 50,
  Body: MessagingPanelBody,
};
