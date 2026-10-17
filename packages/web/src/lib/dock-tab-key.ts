export type DockTab = { kind: "panel"; panel: string } | { kind: "terminal"; terminalId: string };
export function tabKey(tab: DockTab): string {
  return tab.kind === "panel" ? tab.panel : `terminal:${tab.terminalId}`;
}
