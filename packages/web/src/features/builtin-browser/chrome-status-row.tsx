/**
 * The Chrome surface's menu row: how the user's Chrome stands, with the one thing to do about
 * it. Which browser the agents drive is chosen in Settings › Browser only; no menu offers it.
 *
 * The row is an icon and a line saying how the user's Chrome stands — connected (named), not
 * connected, none paired, switched off by the admin — never in red. Its action is the pairing
 * dialog while none is paired, Settings › Browser once one is, and nothing while the admin's
 * switch is off.
 */
import type { BrowserBackendInfo } from "@prismshadow/penguin-server/api";
import { GlyphIcon, ICONS, ICON_SIZE, MenuItem } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";

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

export function ChromeStatusRow({
  info,
  onConnect,
  onManage,
}: {
  info: BrowserBackendInfo;
  /** Opens the pairing dialog. */
  onConnect: () => void;
  /** Opens Settings › Browser. */
  onManage: () => void;
}) {
  const standing = chromeStanding(info);
  const action =
    standing === "unpaired"
      ? { label: S.builtinBrowser.connectChrome, run: onConnect }
      : standing === "connected" || standing === "disconnected"
        ? { label: S.builtinBrowser.manageChrome, run: onManage }
        : null;
  return (
    <MenuItem
      data-testid="browser-chrome-status"
      glyph={
        <GlyphIcon
          d={standing === "connected" ? ICONS.plug : ICONS.plugLifted}
          size={ICON_SIZE.rowLead}
          className={standing === "connected" ? toneInk.success : "text-fg-subtle"}
        />
      }
      label={chromeStatusText(info)}
      disabled={action === null}
      {...(action !== null ? { trailing: action.label, onSelect: action.run } : {})}
    />
  );
}
