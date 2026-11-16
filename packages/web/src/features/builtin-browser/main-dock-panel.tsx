import { ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { isBrowserOffered, subscribeBrowser } from "./browser-store";
import { BuiltinBrowserPanel } from "./browser-panel";

export const mainPanelDefinition = {
  id: "builtin-browser",
  label: () => S.builtinBrowser.panelTitle,
  glyph: ICONS.globe,
  order: 70,
  offered: isBrowserOffered,
  subscribeOffered: subscribeBrowser,
  Body: BuiltinBrowserPanel,
};
