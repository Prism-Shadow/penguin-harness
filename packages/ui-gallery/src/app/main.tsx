/**
 * The framed app's entry (`app.html`): the real Web App, mounted on an in-memory router at the
 * route the URL names, against the demo store in the language the URL names. The document's
 * storage was already replaced and seeded by the inline script in the page head, and the app's
 * own boot script has applied the theme, so by the time this runs the app boots exactly as it
 * does for a user with those preferences.
 *
 * The app's own entry reconciles browser storage against the server's data root before
 * mounting; a frame's storage is fresh every load, so there is nothing to reconcile, and the
 * app mounts as soon as its module tree has booted (`bootWeb`, as in the app's entry). KaTeX's
 * stylesheet comes with the shared UI package's Markdown (its prose component imports it), as
 * it does in the app.
 *
 * `open=settings` (or `settings.<page>`) asks the app for its Settings dialog through the
 * app's own request seam, which the account menu answers as soon as it mounts; `embed=1` makes
 * the app the guest of the page that frames it (guest-frame.ts).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../../web/src/app";
import { bootWeb } from "../../../web/src/web-root";
import { requestSettings } from "../../../web/src/lib/settings-request";
import type { SettingsSectionKey } from "../../../web/src/lib/settings-sections";
import "./app.css";
import { parseFrameParams } from "./frame";
import { installGuestFrame } from "./guest-frame";
import { installFetchShim } from "./mock/fetch-shim";
import { getStore } from "./mock/store";

/** The dialog's pages, as `open=settings.<page>` may name them. */
const SETTINGS_PAGES = [
  "profile",
  "general",
  "appearance",
  "account",
  "proxy",
  "uploads",
  "company",
  "plugins",
  "users",
] as const satisfies readonly SettingsSectionKey[];

const isSettingsPage = (value: string): value is SettingsSectionKey =>
  (SETTINGS_PAGES as readonly string[]).includes(value);

const params = parseFrameParams(window.location.search);
getStore({ lang: params.lang, signedIn: !params.signedOut });
installFetchShim();

// Framed, a focus must not scroll the page around the frame: the chat composer focuses itself
// on mount, and the browser scrolls every ancestor document to centre a newly focused element,
// which dragged the gallery page down until the frame's top sat under the sticky bar. The frame
// is scaled to fit, so nothing in it is ever out of view; the app's own scroll-on-focus is not
// missed. Framed by another page (`embed=1`), the app is that page's guest until the reader
// clicks into it (guest-frame.ts). Standalone (opened in its own tab) keeps the browser's
// behaviour.
if (window.parent !== window) {
  if (params.embedded) {
    installGuestFrame(window);
  } else {
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      focus.call(this, { ...options, preventScroll: true });
    };
  }
}

const container = document.getElementById("root");
if (!container) throw new Error("#root mount point not found");

void bootWeb().then((Root) => {
  createRoot(container).render(
    <StrictMode>
      <App Root={Root} initialPath={params.route} />
    </StrictMode>,
  );

  if (params.open === "settings" || params.open?.startsWith("settings.")) {
    const page = params.open.slice("settings.".length);
    requestSettings(isSettingsPage(page) ? { section: page } : {});
  }

  // What the screenshot script waits for: the app mounted and its fonts loaded.
  void document.fonts.ready.then(() => {
    document.documentElement.dataset.galleryReady = "1";
  });
});
