/**
 * The top of the Browser panel's menu: which browser the agents drive, and the user's Chrome.
 * Nothing where neither applies (an older server); the caller draws the rule under the rows.
 *
 * - The choice among the backends the panel's server offers — Built-in, System Chrome, Chrome on
 *   this machine (the server's own, for its admins) — only where there is more than one. Picking
 *   one asks that server; while an agent acts the server refuses and a toast says to wait
 *   (browser-actions.ts `switchBrowserBackend`).
 * - The Chrome row wherever Chrome is offered: an icon and a line saying how the user's Chrome
 *   stands — connected (named), not connected, none paired, switched off by the admin — never in
 *   red. Its action is the pairing dialog while none is paired, Settings › Browser once one is,
 *   and nothing while the admin's switch is off.
 *
 * A machine's panel has neither the user's Chrome nor its row: a Chrome is paired to the server
 * this window is on, and the machine's server is reached only through it.
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

/** The backends the menu lets the user choose among on `server`, in the order it lists them. */
export function backendChoices(
  state: BrowserState,
  server: string | null = null,
): BrowserBackend[] {
  const offered = state.backends.map((entry) => entry.backend);
  return (["builtin", "chrome", "hosted"] as const).filter(
    (backend) => offered.includes(backend) && (server === null || backend !== "chrome"),
  );
}

/** The user's Chrome as the menu's row shows it; none on a machine's panel. */
function chromeRow(state: BrowserState, server: string | null): BrowserBackendInfo | null {
  return server === null ? chromeInfo(state) : null;
}

/** Whether the menu has these rows to show: a choice of backends, or the user's Chrome. */
export function backendRowsShown(state: BrowserState, server: string | null = null): boolean {
  return backendChoices(state, server).length > 1 || chromeRow(state, server) !== null;
}

const BACKEND_LABEL: Record<BrowserBackend, () => string> = {
  builtin: () => S.builtinBrowser.backendBuiltin,
  chrome: () => S.builtinBrowser.backendChrome,
  hosted: () => S.builtinBrowser.backendHosted,
};

export function BackendMenuRows({
  state,
  server = null,
  onPick,
  onConnect,
  onManage,
}: {
  state: BrowserState;
  /** The server the panel belongs to: null for this one, a machine id otherwise. */
  server?: string | null;
  onPick: (backend: BrowserBackend) => void;
  /** Opens the pairing dialog. */
  onConnect: () => void;
  /** Opens Settings › Browser. */
  onManage: () => void;
}) {
  const choices = backendChoices(state, server);
  const choosable = choices.length > 1;
  const chrome = chromeRow(state, server);
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
          {choices.map((backend) => (
            <MenuRadioItem
              key={backend}
              checked={state.backend === backend}
              label={BACKEND_LABEL[backend]()}
              onSelect={() => onPick(backend)}
            />
          ))}
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
