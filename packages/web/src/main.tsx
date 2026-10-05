/**
 * Frontend entry point: mounts the React root component (the frontend SPA is only
 * responsible for rendering and interaction).
 *
 * One thing happens before the mount: the browser's persisted UI state is reconciled
 * against the data root the server is actually serving (lib/install-scope.ts). It has to be
 * HERE and not in a provider, because the state it may clear is read from `useState`
 * initializers scattered through the tree — the sidebar's pins and order, the composer's
 * draft — and those run during the first render. A sweep that arrived one effect later
 * would let a stale draft be read once and then deleted underneath the component holding
 * it, which is worse than either doing nothing or doing it in time. Before `createRoot`
 * there is provably no component to have read anything.
 *
 * It costs one same-origin request to the server this page was just served by, and it is
 * bounded (see syncInstallScope): it can delay the first paint, it can never prevent it.
 * `GET /api/me` — what the route guard waits on before it draws anything — is asked at the
 * same moment rather than after the mount, so the two waits overlap instead of adding up.
 * Asking it early reads nothing from the store, so it does not race the sweep.
 *
 * A boot that actually swept RELOADS instead of mounting, and does not render at all on this
 * pass — every module in the static import graph was evaluated before this file ran, so any
 * that read the store at module scope is holding keys the sweep just removed. See
 * bootInstallScope for why that is the remedy rather than making those modules lazy.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { hasEscLayers } from "@prismshadow/penguin-ui";
import { App } from "./app";
import { bootInstallScope, watchInstallScope } from "./lib/install-scope";
import { prefetchMe } from "./state/auth";
import { watchStaleBuild } from "./lib/stale-build";
// The global shortcut dispatcher installs itself at module evaluation (a React effect would
// leave a post-paint window where a chord is dead); the import is what evaluates it.
import { setShortcutBlocker } from "./lib/shortcuts/dispatcher";
// KaTeX's stylesheet comes with the shared UI package's Markdown (content/prose/prose.tsx imports
// it), resolved out of node_modules so Vite emits it and its woff2 faces as local assets: the
// desktop app has to render math with no network.
import "./styles.css";

// No global command runs behind an open dialog or menu: they all join the UI package's Escape
// layer stack, which is what the blocker reads. Installed here, before the mount, since the
// package cannot reach the app's dispatcher.
setShortcutBlocker(hasEscLayers);

const container = document.getElementById("root");
if (!container) throw new Error("#root mount point not found");

function mount(): void {
  createRoot(container!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// A tab opened before a web push asks for chunk names the new dist no longer has; the first
// such failure reloads it onto the current build (lib/stale-build.ts). This module's own URL
// is the entry chunk's, which names the build.
watchStaleBuild(import.meta.url);

// A second tab can recognise a replaced root while this one is open, leaving everything on
// screen here pointing at a data root that is gone.
watchInstallScope();

// Who is signed in, asked while the install id is being asked rather than after it.
prefetchMe();

// The rejection handler mounts too: bootInstallScope already swallows everything it can, and
// the app must mount even if it somehow does not.
void bootInstallScope().then((action) => {
  if (action === "reload") location.reload();
  else mount();
}, mount);
