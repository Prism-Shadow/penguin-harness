export type DockTab = { kind: "panel"; panel: string };
export function tabKey(tab: DockTab): string {
  return tab.panel;
}
