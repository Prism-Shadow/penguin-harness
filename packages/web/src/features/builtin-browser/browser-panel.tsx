/**
 * The built-in browser's dock panel: its tab strip, its toolbar, and the viewport slot the
 * browser layer (browser-layer.tsx) lays the page on screen over. The browser is one set of
 * pages shared by every conversation, so every dock that shows this panel shows the same
 * tabs — the panel holds no page itself, it only registers where the page should appear.
 *
 * The panel always has a tab: the layer opens the new-tab page when it shows none. A new tab
 * opens the homepage when one is set, and reads as that homepage while it loads. A blank one
 * shows the slot's own empty surface, themed, rather than a white page, and the address bar
 * takes the focus to wait for an address. A tab whose page crashed shows that in the slot, with
 * Reload, instead of the dead page's blank area. Where the browser cannot run (outside the
 * desktop app, an older shell) the panel says so instead.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, EmptyState } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { isBlankUrl, isWebUrl } from "./address";
import { activateBrowserTab, closeBrowserTab, openBrowserTab } from "./browser-actions";
import {
  activeTab,
  addressOf,
  browserOffered,
  currentActivity,
  guestForTab,
  tabBusy,
  type BrowserState,
} from "./browser-state";
import { browserState, subscribeBrowser } from "./browser-store";
import { BrowserTabStrip } from "./browser-tab-strip";
import { BrowserToolbar } from "./browser-toolbar";
import { ClearDataDialog } from "./clear-data-dialog";
import { HomepageDialog } from "./homepage-dialog";
import { ImportDialog } from "./import-dialog";
import { heavyTabMemory, loadWarningText } from "./load";
import { registerSlot, setSlotVisible } from "./slot-registry";
import { webviewForTab, type WebviewElement } from "./webview-registry";

/**
 * Runs a command on the page element of a tab. The element refuses every call until its
 * page has attached, and a page that is not there cannot be driven anyway, so a refusal is
 * dropped rather than surfaced.
 */
function drive(tabId: number | null, command: (view: WebviewElement) => void): void {
  const view = webviewForTab(tabId);
  if (view === null) return;
  try {
    command(view);
  } catch {
    // Not attached yet, or already gone.
  }
}

/**
 * Whether the focus is in a text field outside `panel`, such as the composer or a dialog's
 * field. A blank tab coming on screen does not take the focus from someone typing there.
 */
function typingElsewhere(panel: HTMLElement | null): boolean {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || panel?.contains(focused) === true) return false;
  const tag = focused.tagName;
  return focused.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Why the browser cannot run here, in the words the panel shows. */
function unavailableDetail(state: BrowserState): string | undefined {
  if (!state.supported) return S.builtinBrowser.unavailableDesktop;
  switch (state.reason) {
    case "not_desktop":
      return S.builtinBrowser.unavailableDesktop;
    case "shell_unsupported":
      return S.builtinBrowser.unavailableShell;
    case "no_window":
      return S.builtinBrowser.unavailableWindow;
    default:
      return undefined;
  }
}

export function BuiltinBrowserPanel({ active }: { active: boolean }) {
  const state = useSyncExternalStore(subscribeBrowser, browserState);
  if (!browserOffered(state)) {
    const detail = unavailableDetail(state);
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-4">
        <EmptyState
          title={S.builtinBrowser.unavailableTitle}
          {...(detail !== undefined ? { description: detail } : {})}
        />
      </div>
    );
  }
  return <BrowserSurface state={state} active={active} />;
}

function BrowserSurface({ state, active }: { state: BrowserState; active: boolean }) {
  const tab = activeTab(state);
  const tabId = tab?.id ?? null;
  const [importOpen, setImportOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [homepageOpen, setHomepageOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const addressRef = useRef<HTMLInputElement | null>(null);

  // The slot is where the layer puts the page on screen; it says so only while this panel is
  // the tab its dock shows (a hidden dock or another tab in front parks the page instead).
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [slotId] = useState(() => Symbol("builtin-browser-slot"));
  useLayoutEffect(() => {
    const element = slotRef.current;
    return element === null ? undefined : registerSlot(slotId, element);
  }, [slotId]);
  useLayoutEffect(() => setSlotVisible(slotId, active), [slotId, active]);

  // A blank tab coming on screen waits for an address, so the address bar takes the focus,
  // unless the user is typing somewhere else. It is decided once this window hosts the tab's
  // page: until then a tab opening the homepage cannot be told from a blank one. The field is
  // keyed by tab, so the one focused is the new tab's.
  const address = tab === null ? "" : addressOf(state, tab);
  const blankOnScreen =
    active && tab !== null && guestForTab(state, tab.id) !== null && isBlankUrl(address)
      ? tab.id
      : null;
  useEffect(() => {
    if (blankOnScreen !== null && !typingElsewhere(rootRef.current)) addressRef.current?.focus();
  }, [blankOnScreen]);
  const newTab = () => void openBrowserTab();

  const navigate = (url: string) => {
    if (tabId === null) {
      void openBrowserTab(url);
      return;
    }
    drive(tabId, (view) => {
      // A navigation the next one interrupts rejects; the page shows where it ended up.
      view.loadURL(url).catch(() => undefined);
      view.focus();
    });
  };

  const openExternal =
    tab !== null && isWebUrl(tab.url)
      ? () => window.open(tab.url, "_blank", "noopener,noreferrer")
      : null;
  const { homepage } = state;
  const goHome = homepage !== null ? () => navigate(homepage) : null;
  const reload = () => drive(tabId, (view) => view.reload());

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <BrowserTabStrip
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        address={(shown) => addressOf(state, shown)}
        busy={(id) => tabBusy(state, id)}
        heavyMemory={(id) => heavyTabMemory(state.metrics, id)}
        onSelect={activateBrowserTab}
        onClose={closeBrowserTab}
        onNew={newTab}
      />
      <BrowserToolbar
        tab={tab}
        address={address}
        activity={currentActivity(state)}
        loadWarning={loadWarningText(state.metrics, state.tabs.length)}
        hostsPage={guestForTab(state, tabId) !== null}
        addressRef={addressRef}
        onBack={() => drive(tabId, (view) => view.goBack())}
        onForward={() => drive(tabId, (view) => view.goForward())}
        onReload={reload}
        onStop={() => drive(tabId, (view) => view.stop())}
        onHome={goHome}
        onNavigate={navigate}
        onImport={() => setImportOpen(true)}
        onClearData={() => setClearOpen(true)}
        onSetHomepage={() => setHomepageOpen(true)}
        onOpenExternal={openExternal}
        onDevTools={() => drive(tabId, (view) => view.openDevTools())}
      />
      <div
        ref={slotRef}
        data-testid="builtin-browser-viewport"
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        {tab?.crashed !== undefined && (
          <div
            data-testid="builtin-browser-crashed"
            className="flex h-full items-center justify-center overflow-y-auto p-4"
          >
            <EmptyState
              title={S.builtinBrowser.crashedTitle}
              description={
                tab.crashed === "oom"
                  ? S.builtinBrowser.crashedOutOfMemory
                  : S.builtinBrowser.crashedBody
              }
              action={<Button onClick={reload}>{S.builtinBrowser.reload}</Button>}
            />
          </div>
        )}
      </div>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <ClearDataDialog open={clearOpen} onClose={() => setClearOpen(false)} />
      {homepageOpen && (
        <HomepageDialog
          homepage={homepage}
          currentPage={tab !== null && isWebUrl(tab.url) ? tab.url : null}
          onClose={() => setHomepageOpen(false)}
        />
      )}
    </div>
  );
}
