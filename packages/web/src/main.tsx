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
 *
 * A boot that actually swept RELOADS instead of mounting, and does not render at all on this
 * pass — every module in the static import graph was evaluated before this file ran, so any
 * that read the store at module scope is holding keys the sweep just removed. See
 * bootInstallScope for why that is the remedy rather than making those modules lazy.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { bootInstallScope, watchInstallScope } from "./lib/install-scope";
// KaTeX's stylesheet and its woff2 faces, resolved out of node_modules so Vite emits them as local
// assets: the desktop app has to render math with no network, and a CDN <link> would leave every
// formula as unstyled markup offline. Imported before styles.css so the app's own `.katex` rules
// (CJK fallback, error state, wide-formula scrolling) come later in the cascade and win.
import "katex/dist/katex.min.css";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root mount point not found");

function mount(): void {
  createRoot(container!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// A second tab can recognise a replaced root while this one is open, leaving everything on
// screen here pointing at a data root that is gone.
watchInstallScope();

// The rejection handler mounts too: bootInstallScope already swallows everything it can, and
// the app must mount even if it somehow does not.
void bootInstallScope().then((action) => {
  if (action === "reload") location.reload();
  else mount();
}, mount);
