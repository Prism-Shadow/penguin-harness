import { ICONS } from "@prismshadow/penguin-ui";
import { S } from "./strings";
import { isBrowserOffered, subscribeBrowser } from "./browser-store";
import { BuiltinBrowserPanel } from "./browser-panel";

export const mainPanelDefinition = {
  id: "builtin-browser",
  label: () => S.builtinBrowser.panelTitle,
  glyph: ICONS.globe,
  order: 70,
  lead: true,
  availableFromAppCenter: ({ isAdmin }: { isAdmin: boolean }) => isAdmin,
  offered: isBrowserOffered,
  subscribeOffered: subscribeBrowser,
  Body: BuiltinBrowserPanel,
};
