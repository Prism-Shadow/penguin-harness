/**
 * The top of the Browser panel's menu: which browser the agents drive, and the user's Chrome.
 * Nothing where neither applies (an older server); the caller draws the rule under the rows.
 *
 * - The choice, Built-in / System Chrome, only where both are offered (the desktop app, for its
 *   admin). Picking one asks the server; while an agent acts the server refuses and a toast says
 *   to wait (browser-actions.ts `switchBrowserBackend`).
 * - The Chrome row wherever Chrome is offered: an icon and a line saying how the user's Chrome
 *   stands — connected (named), not connected, none paired, switched off by the admin — never in
 *   red. Its action is the pairing dialog while none is paired, Settings › Browser once one is,
 *   and nothing while the admin's switch is off.
 */
import type { BrowserBackend, BrowserBackendInfo } from "@prismshadow/penguin-server/api";
import {
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  MenuLabel,
  MenuItem,
  MenuRadioItem,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { chromeInfo, type BrowserState } from "./browser-state";

/** How the user's Chrome stands, as the row says it. */
export type ChromeStanding = "connected" | "disconnected" | "unpaired" | "disabled";

export function chromeStanding(info: BrowserBackendInfo): ChromeStanding {
  if (info.available) return "connected";
  if (info.reason === "extension_disabled") return "disabled";
  if (info.reason === "extension_not_paired" || info.extension === undefined) return "unpaired";
  return "disconnected";
}

/** The row's words. */
export function chromeStatusText(info: BrowserBackendInfo): string {
  switch (chromeStanding(info)) {
    case "connected":
      return S.builtinBrowser.chromeConnected(info.extension?.name ?? null);
    case "disabled":
      return S.builtinBrowser.chromeDisabled;
    case "unpaired":
      return S.builtinBrowser.chromeNotPaired;
    case "disconnected":
      return S.builtinBrowser.chromeNotConnected;
  }
}

/** Whether the menu has these rows to show: a choice of backends, or the user's Chrome. */
export function backendRowsShown(state: BrowserState): boolean {
  const offered = state.backends.map((entry) => entry.backend);
  return (offered.includes("builtin") && offered.includes("chrome")) || chromeInfo(state) !== null;
}

export function BackendMenuRows({
  state,
  onPick,
  onConnect,
  onManage,
}: {
  state: BrowserState;
  onPick: (backend: BrowserBackend) => void;
  /** Opens the pairing dialog. */
  onConnect: () => void;
  /** Opens Settings › Browser. */
  onManage: () => void;
}) {
  const offered = state.backends.map((entry) => entry.backend);
  const choosable = offered.includes("builtin") && offered.includes("chrome");
  const chrome = chromeInfo(state);
  if (!choosable && chrome === null) return null;
  const standing = chrome === null ? null : chromeStanding(chrome);
  const action =
    standing === "unpaired"
      ? { label: S.builtinBrowser.connectChrome, run: onConnect }
      : standing === "connected" || standing === "disconnected"
        ? { label: S.builtinBrowser.manageChrome, run: onManage }
        : null;
  return (
    <>
      {choosable && (
        <>
          <MenuLabel>{S.builtinBrowser.backendGroup}</MenuLabel>
          <MenuRadioItem
            checked={state.backend === "builtin"}
            label={S.builtinBrowser.backendBuiltin}
            onSelect={() => onPick("builtin")}
          />
          <MenuRadioItem
            checked={state.backend === "chrome"}
            label={S.builtinBrowser.backendChrome}
            onSelect={() => onPick("chrome")}
          />
        </>
      )}
      {chrome !== null && (
        <MenuItem
          data-testid="browser-chrome-status"
          glyph={
            <GlyphIcon
              d={standing === "connected" ? ICONS.plug : ICONS.plugLifted}
              size={ICON_SIZE.rowLead}
              className={standing === "connected" ? toneInk.success : "text-fg-subtle"}
            />
          }
          label={chromeStatusText(chrome)}
          disabled={action === null}
          {...(action !== null ? { trailing: action.label, onSelect: action.run } : {})}
        />
      )}
    </>
  );
}
