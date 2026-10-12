/**
 * The Browser panel while the agents drive the user's own Chrome: the same in the desktop app and
 * in a plain browser, since no page of it lives in this window.
 *
 * - Connected: the tab strip lists the tabs the extension drives (× closes one in Chrome, + opens
 *   a new one there, a tab picked here comes to the front there too), the toolbar holds the
 *   address bar (Enter loads the address in that tab) and the menu, and in place of the page a
 *   quiet card says the tab is open in Chrome, with "Show in Chrome". While an agent acts in the
 *   tab the card wears the pulsing ring and the toolbar the agent's mark, as on the built-in
 *   browser. With no tab yet, the card says where the agents' pages will appear.
 * - No Chrome paired: the pairing steps in place of the page, while the panel is on screen (a
 *   hidden panel asks for no code).
 * - Paired but not connected: which Chrome, and a fold with what to check, and pairing again.
 * - The admin switched Chrome connections off: that, and nothing to do about it here.
 *
 * The menu stays in every state, so the desktop app's choice of backend is always in reach.
 */
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  Dropdown,
  EmptyState,
  GlyphIcon,
  HelpFold,
  ICONS,
  ICON_SIZE,
  Menu,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { requestSettings } from "../settings/settings-request";
import { AddressBar } from "./address-bar";
import {
  activateBrowserTab,
  closeChromeTab,
  navigateChromeTab,
  openBrowserTab,
  switchBrowserBackend,
} from "./browser-actions";
import { BrowserTabStrip } from "./browser-tab-strip";
import { AgentBusyMark, ToolButton } from "./browser-toolbar";
import { BackendMenuRows, chromeStanding } from "./backend-menu";
import {
  chromeInfo,
  currentActivity,
  shownActiveTab,
  tabBusy,
  type BrowserState,
} from "./browser-state";
import { PairingDialog, PairingSteps } from "./pairing-dialog";

export function ChromeSurface({ state, active }: { state: BrowserState; active: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pairing, setPairing] = useState(false);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const info = chromeInfo(state);
  const standing = info === null ? "unpaired" : chromeStanding(info);
  const connected = state.available && standing === "connected";
  const { chrome } = state;
  const tab = shownActiveTab(state);
  const item = (run: () => void) => () => {
    setMenuOpen(false);
    run();
  };
  const connect = () => setPairing(true);
  const navigate = (url: string) => {
    if (tab === null) void openBrowserTab(url);
    else navigateChromeTab(tab.id, url);
  };
  const ringShown = connected && tab !== null && state.activity[tab.id] !== undefined;

  let body: ReactNode;
  if (connected) {
    body =
      tab === null ? (
        <EmptyState
          title={S.builtinBrowser.chromeNoTabsTitle}
          description={S.builtinBrowser.chromeNoTabsBody}
        />
      ) : (
        <EmptyState
          title={S.builtinBrowser.chromeTabCard}
          description={tab.url}
          action={
            <Button size="sm" onClick={() => activateBrowserTab(tab.id, "chrome")}>
              {S.builtinBrowser.showInChrome}
            </Button>
          }
        />
      );
  } else if (standing === "disabled") {
    body = (
      <EmptyState
        title={S.builtinBrowser.chromeDisabledTitle}
        description={S.builtinBrowser.chromeDisabledBody}
      />
    );
  } else if (standing === "unpaired") {
    body = (
      <div data-testid="browser-chrome-unpaired" className="mx-auto max-w-md space-y-3 px-4 py-6">
        <h3 className="text-sm font-medium">{S.builtinBrowser.pairTitle}</h3>
        <p className="text-xs text-fg-muted">{S.builtinBrowser.chromeUnpairedIntro}</p>
        {active && <PairingSteps origin={window.location.origin} />}
      </div>
    );
  } else {
    body = (
      <div
        data-testid="browser-chrome-disconnected"
        className="mx-auto max-w-md space-y-2 px-4 py-6"
      >
        <h3 className="text-sm font-medium">{S.builtinBrowser.chromeDisconnectedTitle}</h3>
        <p className="text-xs text-fg-muted">
          {S.builtinBrowser.chromeDisconnectedBody(info?.extension?.name ?? null)}
        </p>
        <HelpFold title={S.builtinBrowser.reconnectHelp}>
          <ul className="list-disc space-y-1 pl-4 text-xs text-fg-muted">
            <li>{S.builtinBrowser.reconnectOpen}</li>
            <li>{S.builtinBrowser.reconnectResume}</li>
            <li>
              {S.builtinBrowser.reconnectPair}{" "}
              <Button variant="link" size="sm" onClick={connect}>
                {S.builtinBrowser.connectChrome}
              </Button>
            </li>
          </ul>
        </HelpFold>
      </div>
    );
  }

  return (
    <div
      data-testid="browser-chrome-surface"
      data-standing={standing}
      className="flex h-full min-h-0 flex-col"
    >
      {connected && (
        <BrowserTabStrip
          tabs={chrome.tabs}
          activeTabId={chrome.activeTabId}
          address={(shown) => shown.url}
          busy={(id) => tabBusy(state, id)}
          heavyMemory={() => null}
          onSelect={(id) => activateBrowserTab(id, "chrome")}
          onClose={closeChromeTab}
          onNew={() => void openBrowserTab()}
        />
      )}
      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-canvas px-2 py-1">
        {connected ? (
          // Keyed by tab: switching tabs drops a half-typed address instead of carrying it over.
          <AddressBar
            key={tab?.id ?? "none"}
            url={tab?.url ?? ""}
            onNavigate={navigate}
            inputRef={addressRef}
            suggest={false}
          />
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        <AgentBusyMark activity={connected ? currentActivity(state) : null} />
        <Dropdown
          open={menuOpen}
          setOpen={setMenuOpen}
          portal={{ direction: "down", align: "right" }}
          menuClass="w-64"
          button={
            <ToolButton
              label={S.builtinBrowser.more}
              tooltipSuppressed={menuOpen}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <GlyphIcon d={ICONS.ellipsis} size={ICON_SIZE.rowLead} filled />
            </ToolButton>
          }
        >
          <Menu density="sm">
            <BackendMenuRows
              state={state}
              onPick={(backend) => {
                setMenuOpen(false);
                void switchBrowserBackend(backend);
              }}
              onConnect={item(connect)}
              onManage={item(() => requestSettings({ section: "browser" }))}
            />
          </Menu>
        </Dropdown>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {body}
        {ringShown && (
          <div
            aria-hidden
            data-testid="browser-chrome-agent-ring"
            className={`browser-agent-ring pointer-events-none absolute inset-0 ${toneInk.busy}`}
          />
        )}
      </div>
      <PairingDialog open={pairing} onClose={() => setPairing(false)} />
    </div>
  );
}
