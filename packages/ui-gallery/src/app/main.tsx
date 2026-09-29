/**
 * The framed app's entry (`app.html`): the real Web App, mounted on an in-memory router at the
 * route the URL names, against the demo store in the language the URL names. The document's
 * storage was already replaced and seeded by the inline script in the page head, and the app's
 * own boot script has applied the theme, so by the time this runs the app boots exactly as it
 * does for a user with those preferences.
 *
 * The app's own entry reconciles browser storage against the server's data root before
 * mounting; a frame's storage is fresh every load, so there is nothing to reconcile and the
 * app mounts at once. KaTeX's stylesheet and the app's come in the same order as in the app's
 * entry, so the app's `.katex` rules still win the cascade.
 *
 * `open=settings` (or `settings.<page>`) asks the app for its Settings dialog through the
 * app's own request seam, which the account menu answers as soon as it mounts.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../../web/src/app";
import { requestSettings } from "../../../web/src/features/settings/settings-request";
import type { SettingsSectionKey } from "../../../web/src/lib/settings-sections";
// The app's dependency, reached through its own node_modules: the gallery does not depend on
// KaTeX, and the app's math rules expect this sheet ahead of the app's own.
import "../../../web/node_modules/katex/dist/katex.min.css";
import "./app.css";
import { parseFrameParams } from "./frame";
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

const container = document.getElementById("root");
if (!container) throw new Error("#root mount point not found");

createRoot(container).render(
  <StrictMode>
    <App initialPath={params.route} />
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
