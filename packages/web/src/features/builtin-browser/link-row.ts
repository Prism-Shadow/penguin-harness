/**
 * The agent browser's row in the stream's menu for a web link (`ChatModule.linkActions`): Open in
 * built-in browser, or Open in agent's Chrome tab while the agents drive the user's own Chrome.
 * It is offered only where the agent browser can open the page — the desktop app's window with
 * the built-in browser available, or any window while the user's Chrome is connected — and opens
 * it through the browser's own new-tab request, which brings the Browser panel up in this
 * conversation's dock.
 */
import { ICONS } from "@prismshadow/penguin-ui";
import type { BrowserBackend } from "@prismshadow/penguin-server/api";
import type { LinkAction, LinkRow } from "@prismshadow/penguin-web-plugin";
import { openLinkInBrowser } from "./browser-actions";
import { browserLinkTarget, subscribeBrowser } from "./browser-store";
import { S } from "./strings";

/** The row for `href` while `target` can open it (browser-state.ts `linkTarget`), else none. */
export function browserLinkRow(target: BrowserBackend | null, href: string): LinkRow | null {
  if (target === null) return null;
  return {
    glyph: ICONS.globe,
    label: target === "chrome" ? S.linkMenu.openInChromeTab : S.linkMenu.openInBuiltinBrowser,
    onSelect: () => openLinkInBrowser(href),
  };
}

/** The contribution: the row for the browser that can open links now, following its store. */
export const browserLinkAction: LinkAction = {
  row: (href) => browserLinkRow(browserLinkTarget(), href),
  subscribe: subscribeBrowser,
};
