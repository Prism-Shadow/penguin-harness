/**
 * The Evaluation Center's old addresses: `/benchmark` and every address under it, kept in links
 * and bookmarks from before it became the `rsi-workbench` plugin's workbench. Each leads into that
 * workbench's App Center window, replacing the history entry, with the rest of the path and the
 * query as the window's `at` (lib/app-window-address.ts): `/benchmark` opens it at its start,
 * `/benchmark/b1?agentId=x` at `/b1?agentId=x`.
 *
 * The window is the default Agent's `benchmark` workbench when the App Center lists it as the
 * plugin's, else the first other Agent's. With neither, the App Center opens with an offer to
 * install the plugin on the default Agent, which then opens the window there; the offer rides in
 * the history entry's state, so the address stays the App Center's own. A list that cannot be
 * read leads to the default Agent's window, which the App Center opens once it lists it.
 *
 * Compatibility for addresses made before the move: it stays until 1.0, and whoever prepares 1.0
 * removes this module, its page in module.ts and the offer in app-center-page.tsx.
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import { Notice } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { APP_CENTER_PATH, locatedAppKey } from "../../lib/app-center-path";
import { windowAddress } from "../../lib/app-window-address";
import { DEFAULT_AGENT_ID } from "../../lib/default-agent";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";
import { useProject } from "../../state/project";
import { installOnAgent } from "../plugins";

/** The plugin that ships the workbench, and the workbench's folder on each Agent that has it. */
const PLUGIN = "rsi-workbench";
const WORKBENCH = "benchmark";
/** The default Agent's window, by its App Center key. */
const DEFAULT_APP = locatedAppKey(DEFAULT_AGENT_ID, WORKBENCH);

/** The history state the offer rides in: where in the workbench to open the window once it is installed. */
interface OfferState {
  legacyBenchmarkAt: string;
}

/** The place inside the workbench an old address names: its path past `/benchmark`, then its query. */
function legacyBenchmarkAt(pathname: string, search: string): string {
  const rest = pathname
    .split("/")
    .filter((segment) => segment !== "")
    .slice(1);
  return `/${rest.join("/")}${search}`;
}

/** The App Center key of the window an old address opens, or null when no Agent has the workbench. */
function legacyBenchmarkApp(shortcuts: readonly AppCenterShortcut[]): string | null {
  const installed = shortcuts.filter(
    (shortcut) => shortcut.workbenchId === WORKBENCH && shortcut.plugin === PLUGIN,
  );
  const app = installed.find((shortcut) => shortcut.agentId === DEFAULT_AGENT_ID) ?? installed[0];
  return app === undefined ? null : locatedAppKey(app.agentId, app.workbenchId);
}

/** The page at `/benchmark/*`: it draws nothing and leaves once the App Center's list answers. */
export function LegacyBenchmarkRedirect() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const projectId = useProject().currentProject?.projectId ?? null;
  useEffect(() => {
    if (projectId === null) return;
    const at = legacyBenchmarkAt(pathname, search);
    let current = true;
    void api.getAppCenter(projectId).then(
      ({ shortcuts }) => {
        if (!current) return;
        const app = legacyBenchmarkApp(shortcuts);
        if (app !== null) void navigate(windowAddress(app, at), { replace: true });
        else
          void navigate(APP_CENTER_PATH, {
            replace: true,
            state: { legacyBenchmarkAt: at } satisfies OfferState,
          });
      },
      () => {
        if (current) void navigate(windowAddress(DEFAULT_APP, at), { replace: true });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, pathname, search, navigate]);
  return null;
}

/** Where the offer in the history entry's state opens the window; null when the entry has none. */
function offeredAt(state: unknown): string | null {
  const at = (state as Partial<OfferState> | null)?.legacyBenchmarkAt;
  return typeof at === "string" ? at : null;
}

/**
 * The App Center's offer, on arrival from an old address no Agent's workbench answers: it installs
 * the plugin on the default Agent through the Agent plugin install every page uses, has the App
 * Center read its list again, and opens the window at the place the address named. A refused
 * install says why in a toast and leaves the offer. Its cross replaces the entry with one
 * without it.
 */
export function LegacyBenchmarkOffer({
  projectId,
  onInstalled,
}: {
  projectId: string;
  /** Reads the App Center's list again, so the window has its app to open. */
  onInstalled: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [installing, setInstalling] = useState(false);
  const at = offeredAt(location.state);
  if (at === null) return null;
  const install = async () => {
    setInstalling(true);
    try {
      await installOnAgent({ projectId, agentId: DEFAULT_AGENT_ID, machineId: null }, [PLUGIN]);
    } catch (e) {
      toastApiError(e);
      setInstalling(false);
      return;
    }
    onInstalled();
    void navigate(windowAddress(DEFAULT_APP, at), { replace: true });
  };
  return (
    <Notice
      tone="attention"
      className="mb-4"
      action={{
        label: S.appCenter.legacyBenchmark.install,
        onClick: () => void install(),
        busy: installing,
      }}
      dismiss={{
        onClick: () =>
          void navigate(
            { pathname: location.pathname, search: location.search },
            { replace: true },
          ),
      }}
    >
      {S.appCenter.legacyBenchmark.notice}
    </Notice>
  );
}
