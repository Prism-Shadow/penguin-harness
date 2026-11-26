import { EmptyState } from "@prismshadow/penguin-ui";
import {
  S,
  NAV_ICONS,
  panelLabel,
  DockPanelBodyProps,
  PanelId,
  useChatSession,
} from "@prismshadow/penguin-web/internal";
import { TracePanel } from "./trace-panel";
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
