/**
 * The Browser panel while it shows a server's own Chrome (the `hosted` backend): the Chrome that
 * server runs on its machine, which its agents drive and the viewer sees as a picture.
 *
 * It is every machine's panel — a machine's server has no page in this window and no Chrome
 * paired from here — and this server's while hosted is the backend chosen on it.
 *
 * - The browser can run: the tab strip (× closes a tab there, + opens one), the toolbar (back,
 *   forward, reload and stop travel as input to the page, the address bar loads through the
 *   server) and the page (hosted-surface.tsx). With no tab the page area says where pages will
 *   appear; nothing is opened just because the panel is looked at, since the first tab is what
 *   starts Chrome.
 * - It cannot: the page area says why and what to do — no Chrome on that machine, a Chrome that
 *   did not start (with the line it printed), a server that offers none, or a server whose
 *   agents drive another browser, with the switch to this one.
 *
 * Nothing announces that Chrome started, exited or failed, so the panel reads the status when
 * it comes on screen and keeps asking, at growing intervals, while the browser cannot run.
 * The built-in browser's own are not offered: import, clearing data, the homepage, the system
 * browser and developer tools belong to pages this window hosts.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button, EmptyState, Spinner, toastError } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { requestSettings } from "../../lib/settings-request";
import { BackendMenuRows, backendRowsShown } from "./backend-menu";
import {
  activateBrowserTab,
  closeRemoteTab,
  navigateRemoteTab,
  openBrowserTab,
  refreshBrowserStatus,
  switchBrowserBackend,
} from "./browser-actions";
import { currentActivity, hostedInfo, tabBusy, type BrowserState } from "./browser-state";
import { BrowserTabStrip } from "./browser-tab-strip";
import { BrowserToolbar } from "./browser-toolbar";
import { HostedSurface } from "./hosted-surface";
import { PairingDialog } from "./pairing-dialog";

/** Status re-reads while the browser cannot run and its panel is on screen (ms). */
const STATUS_RETRY_MS = [3_000, 10_000, 30_000] as const;

/** Why a server's Chrome is not what the panel can show, as the page area words it. */
export type HostedStanding =
  /** It can be driven. */
  | "ready"
  /** The status has not been read yet. */
  | "reading"
  /** The server offers no Chrome of its own (an older one, or one that could not be asked). */
  | "not-offered"
  /** Its agents drive another backend. */
  | "not-chosen"
  | "no-chrome"
  | "launch-failed";

export function hostedStanding(state: BrowserState, read: boolean): HostedStanding {
  const info = hostedInfo(state);
  if (info === null) return read ? "not-offered" : "reading";
  if (info.reason === "hosted_no_chrome") return "no-chrome";
  if (info.reason === "hosted_launch_failed") return "launch-failed";
  if (state.backend !== "hosted") return "not-chosen";
  return state.available ? "ready" : "reading";
}

export function HostedPanel({
  server,
  state,
  active,
}: {
  /** The server whose Chrome this is: null for this one, a machine id otherwise. */
  server: string | null;
  state: BrowserState;
  active: boolean;
}) {
  const [read, setRead] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const standing = hostedStanding(state, read);
  const ready = standing === "ready";
  const registry = state.hosted;
  const tab = ready
    ? (registry.tabs.find((shown) => shown.id === registry.activeTabId) ?? null)
    : null;

  // The status as the panel comes on screen (and for another server, when the conversation
  // moves): Chrome may have started, exited or failed since the last look.
  useEffect(() => {
    if (!active) return;
    let stale = false;
    setRead(false);
    void refreshBrowserStatus(server).then(() => {
      if (!stale) setRead(true);
    });
    return () => {
      stale = true;
    };
  }, [active, server]);

  // While it cannot run, keep asking: Chrome being installed, or fixed, is not announced.
  useEffect(() => {
    if (!active || ready || !read) return;
    let cancelled = false;
    let attempt = 0;
    let timer = 0;
    const schedule = () => {
      const delay = STATUS_RETRY_MS[Math.min(attempt, STATUS_RETRY_MS.length - 1)];
      if (cancelled || delay === undefined) return;
      attempt += 1;
      timer = window.setTimeout(() => void refreshBrowserStatus(server).then(schedule), delay);
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, ready, read, server]);

  const check = async (run: () => Promise<unknown>) => {
    setChecking(true);
    try {
      await run();
    } finally {
      setChecking(false);
    }
  };
  const checkAgain = () => void check(() => refreshBrowserStatus(server));
  // Only a command starts Chrome, so trying again is opening a tab; the status then says how it went.
  const startAgain = () =>
    void check(async () => {
      await openBrowserTab(undefined, server);
      await refreshBrowserStatus(server);
    });

  const nav = (action: "back" | "forward" | "reload" | "stop") => {
    if (tab === null) return;
    api
      .sendHostedBrowserInput(tab.id, { events: [{ type: "nav", action }] }, server)
      .catch((err: unknown) => toastError(S.builtinBrowser.hostedNavFailed(apiErrorText(err))));
  };
  const navigate = (url: string) => {
    if (tab === null) void openBrowserTab(url, server);
    else navigateRemoteTab(tab.id, url, server);
  };

  return (
    <div
      data-testid="hosted-browser-panel"
      data-standing={standing}
      className="flex h-full min-h-0 flex-col"
    >
      {ready && (
        <BrowserTabStrip
          tabs={registry.tabs}
          activeTabId={registry.activeTabId}
          address={(shown) => shown.url}
          busy={(id) => tabBusy(state, id)}
          heavyMemory={() => null}
          onSelect={(id) => activateBrowserTab(id, "hosted", server)}
          onClose={(id) => closeRemoteTab(id, "hosted", server)}
          onNew={() => void openBrowserTab(undefined, server)}
        />
      )}
      <BrowserToolbar
        tab={tab}
        address={tab?.url ?? ""}
        activity={ready ? currentActivity(state) : null}
        loadWarning={null}
        hostsPage={false}
        addressRef={addressRef}
        onBack={() => nav("back")}
        onForward={() => nav("forward")}
        onReload={() => nav("reload")}
        onStop={() => nav("stop")}
        onHome={null}
        onNavigate={navigate}
        suggest={false}
        onImport={null}
        onClearData={null}
        onSetHomepage={null}
        onOpenExternal={null}
        onDevTools={() => undefined}
        {...(backendRowsShown(state, server)
          ? {
              menuTop: (close: () => void) => (
                <BackendMenuRows
                  state={state}
                  server={server}
                  onPick={(backend) => {
                    close();
                    void switchBrowserBackend(backend, server);
                  }}
                  onConnect={() => {
                    close();
                    setPairingOpen(true);
                  }}
                  onManage={() => {
                    close();
                    requestSettings({ section: "browser" });
                  }}
                />
              ),
            }
          : {})}
      />
      <div
        data-testid="hosted-browser-viewport"
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        {tab !== null && tab.crashed === undefined && (
          <HostedSurface
            key={tab.id}
            server={server}
            tab={tab}
            active={active}
            busy={tabBusy(state, tab.id)}
          />
        )}
        {tab !== null && tab.crashed !== undefined && (
          <Centered testId="hosted-browser-crashed">
            <EmptyState
              title={S.builtinBrowser.crashedTitle}
              description={
                tab.crashed === "oom"
                  ? S.builtinBrowser.crashedOutOfMemory
                  : S.builtinBrowser.crashedBody
              }
              action={<Button onClick={() => nav("reload")}>{S.builtinBrowser.reload}</Button>}
            />
          </Centered>
        )}
        {ready && tab === null && (
          <Centered testId="hosted-browser-empty">
            <EmptyState
              title={S.builtinBrowser.hostedNoTabsTitle}
              description={S.builtinBrowser.hostedNoTabsBody}
              action={
                <Button size="sm" onClick={() => void openBrowserTab(undefined, server)}>
                  {S.builtinBrowser.newTab}
                </Button>
              }
            />
          </Centered>
        )}
        {standing === "reading" && (
          <div
            role="status"
            className="flex h-full items-center justify-center gap-2 text-xs text-fg-muted"
          >
            <Spinner size="sm" label={S.builtinBrowser.hostedReading} />
            {S.builtinBrowser.hostedReading}
          </div>
        )}
        {standing === "not-offered" && (
          <Centered testId="hosted-browser-unavailable">
            <EmptyState
              title={S.builtinBrowser.hostedNotOfferedTitle}
              description={
                server === null
                  ? S.builtinBrowser.hostedNotOfferedHere
                  : S.builtinBrowser.hostedNotOfferedMachine
              }
              action={<CheckButton busy={checking} onClick={checkAgain} />}
            />
          </Centered>
        )}
        {standing === "not-chosen" && (
          <Centered testId="hosted-browser-unavailable">
            <EmptyState
              title={S.builtinBrowser.hostedNotChosenTitle}
              description={S.builtinBrowser.hostedNotChosenBody}
              action={
                <Button size="sm" onClick={() => void switchBrowserBackend("hosted", server)}>
                  {S.builtinBrowser.useHosted}
                </Button>
              }
            />
          </Centered>
        )}
        {standing === "no-chrome" && (
          <Centered testId="hosted-browser-unavailable">
            <EmptyState
              title={S.builtinBrowser.hostedNoChromeTitle}
              description={S.builtinBrowser.hostedNoChromeBody}
              action={<CheckButton busy={checking} onClick={checkAgain} />}
            />
          </Centered>
        )}
        {standing === "launch-failed" && (
          <Centered testId="hosted-browser-unavailable">
            <div className="flex max-w-md flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm font-medium text-fg-muted">
                {S.builtinBrowser.hostedLaunchFailedTitle}
              </p>
              {hostedInfo(state)?.detail !== undefined && (
                <pre
                  data-testid="hosted-browser-detail"
                  className="max-h-32 w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-muted px-2 py-1 text-left font-mono text-xs text-fg-muted"
                >
                  {hostedInfo(state)?.detail}
                </pre>
              )}
              <p className="text-xs text-fg-muted">{S.builtinBrowser.hostedLaunchFailedBody}</p>
              <div className="mt-2">
                <Button size="sm" loading={checking} onClick={startAgain}>
                  {S.builtinBrowser.hostedTryAgain}
                </Button>
              </div>
            </div>
          </Centered>
        )}
      </div>
      {server === null && (
        <PairingDialog open={pairingOpen} onClose={() => setPairingOpen(false)} />
      )}
    </div>
  );
}

function Centered({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      className="flex h-full items-center justify-center overflow-y-auto p-4"
    >
      {children}
    </div>
  );
}

function CheckButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Button size="sm" loading={busy} onClick={onClick}>
      {S.builtinBrowser.hostedCheckAgain}
    </Button>
  );
}
