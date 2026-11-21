/**
 * The Ports panel's registration, the way the other built-in dock panels do it
 * (schedules/main-dock-panel.ts): the conversation's Workspace's forwards, as a dock tab
 * beside the terminal. Keyed by the Workspace, not the Session: a forward belongs to the
 * directory on its machine, and two conversations there are looking at the same rows.
 */
import { machineForSession } from "../../lib/session-machines";
import { EmptyState, ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { panelLabel, type DockPanelBodyProps, type PanelId } from "../dock/index";

import { PortsPanel } from "./ports-panel";
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

function PortsPanelBody({ active }: DockPanelBodyProps) {
  const { selected } = useChatSession();
  if (!selected) return draftPlaceholder("ports");
  const machineId = machineForSession(selected.sessionId);
  return (
    <PortsPanel
      key={`${machineId ?? ""}:${selected.workspace}`}
      machineId={machineId}
      workspace={selected.workspace}
      active={active}
    />
  );
}

export const mainPanelDefinition = {
  id: "ports",
  label: () => S.ports.panelTitle,
  glyph: ICONS.arrowsOpposed,
  order: 80,
  Body: PortsPanelBody,
};
