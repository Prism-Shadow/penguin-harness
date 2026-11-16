import { EmptyState } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { NAV_ICONS } from "../../lib/nav-icons";
import { panelLabel, type DockPanelBodyProps, type PanelId } from "../dock/index";

import { TracePanel } from "./trace-panel";
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
function TracePanelBody({ active }: DockPanelBodyProps) {
  const { selected, settledTurnSignal } = useChatSession();
  if (!selected) return draftPlaceholder("trace");
  return (
    <TracePanel
      key={selected.sessionId}
      session={selected}
      active={active}
      reloadSignal={settledTurnSignal}
    />
  );
}
export const mainPanelDefinition = {
  id: "trace",
  label: () => S.nav.traces,
  glyph: NAV_ICONS.traces,
  order: 40,
  Body: TracePanelBody,
};
