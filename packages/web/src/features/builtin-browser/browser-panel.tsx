/**
 * The built-in browser's dock panel: its tab strip, its toolbar, and the viewport slot the
 * browser layer (browser-layer.tsx) lays the page on screen over. The browser is one set of
 * pages shared by every conversation, so every dock that shows this panel shows the same
 * tabs — the panel holds no page itself, it only registers where the page should appear.
 *
 * No tab open: the slot shows how to start — a new tab, or importing sign-ins from a system
 * browser. A blank new tab shows the slot's own empty surface, themed, with the address bar
 * waiting, rather than a white page. Where the browser cannot run (outside the desktop app,
 * an older shell) the panel says so instead.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { isWebUrl } from "./address";
import { activateBrowserTab, closeBrowserTab, openBrowserTab } from "./browser-actions";
import {
  activeTab,
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
import { ImportDialog } from "./import-dialog";
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

  // A new tab from "+" waits for an address. The field is keyed by tab, so it is focused once
  // the new tab is the one on screen — the request can come back before that happens.
  const [focusFor, setFocusFor] = useState<number | null>(null);
  useEffect(() => {
    if (focusFor === null || focusFor !== tabId) return;
    addressRef.current?.focus();
    setFocusFor(null);
  }, [focusFor, tabId]);
  const newTab = () => {
    void openBrowserTab().then(setFocusFor);
  };

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {state.tabs.length > 0 && (
        <BrowserTabStrip
          tabs={state.tabs}
          activeTabId={state.activeTabId}
          busy={(id) => tabBusy(state, id)}
          onSelect={activateBrowserTab}
          onClose={closeBrowserTab}
          onNew={newTab}
        />
      )}
      <BrowserToolbar
        tab={tab}
        activity={currentActivity(state)}
        hostsPage={guestForTab(state, tabId) !== null}
        addressRef={addressRef}
        onBack={() => drive(tabId, (view) => view.goBack())}
        onForward={() => drive(tabId, (view) => view.goForward())}
        onReload={() => drive(tabId, (view) => view.reload())}
        onStop={() => drive(tabId, (view) => view.stop())}
        onNavigate={navigate}
        onImport={() => setImportOpen(true)}
        onClearData={() => setClearOpen(true)}
        onOpenExternal={openExternal}
        onDevTools={() => drive(tabId, (view) => view.openDevTools())}
      />
      <div
        ref={slotRef}
        data-testid="builtin-browser-viewport"
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        {state.tabs.length === 0 && (
          <div className="flex h-full items-center justify-center overflow-y-auto p-4">
            <EmptyState
              title={S.builtinBrowser.emptyTitle}
              description={S.builtinBrowser.emptyBody}
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button onClick={newTab}>{S.builtinBrowser.newTab}</Button>
                  <Button variant="ghost" onClick={() => setImportOpen(true)}>
                    {S.builtinBrowser.importAction}
                  </Button>
                </div>
              }
            />
          </div>
        )}
      </div>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <ClearDataDialog open={clearOpen} onClose={() => setClearOpen(false)} />
    </div>
  );
}
