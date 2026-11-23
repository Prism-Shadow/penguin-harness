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
 * the app the guest of the page that frames it (guest-frame.ts); `notices=1` raises the notices a
 * conversation can carry in the demo store (mock/notices.ts).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../../web/src/app";
import { bootWeb } from "../../../web/src/web-root";
import { dismissOnboarding } from "../../../web/src/lib/model-onboarding";
import { requestSettings, requestSettingsPage } from "../../../web/src/lib/settings-request";
import type { HostSettingsSectionKey } from "../../../web/src/lib/settings-sections";
import "./app.css";
import { DEMO_TAKEN_OVER, parseFrameParams } from "./frame";
import { installGuestFrame } from "./guest-frame";
import { installFetchShim } from "./mock/fetch-shim";
import { getStore } from "./mock/store";
import { rsiPrompt } from "./mock/rsi-transcript";
import { installEvolutionAutoplay } from "./evolution-autoplay";

/** The dialog's own pages, as `open=settings.<page>` may name them. */
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
] as const satisfies readonly HostSettingsSectionKey[];

/** The pages a shipped plugin contributes, as the same parameter may name them. */
const CONTRIBUTED_SETTINGS_PAGES: readonly string[] = ["storage"];

const isSettingsPage = (value: string): value is HostSettingsSectionKey =>
  (SETTINGS_PAGES as readonly string[]).includes(value);

const params = parseFrameParams(window.location.search);
const store = getStore({
  lang: params.lang,
  signedIn: !params.signedOut,
  notices: params.notices === true,
  embedded: params.embedded === true,
  freshProject: params.freshProject === true,
  evolutionDemo: params.autoplay === "evolution",
});
// Each homepage frame has its own storage. A stopped run returns to a usable new chat.
if (params.freshProject) dismissOnboarding(store.f.project.projectId);
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
    if (CONTRIBUTED_SETTINGS_PAGES.includes(page)) requestSettingsPage({ section: page });
    else requestSettings(isSettingsPage(page) ? { section: page } : {});
  }

  // What the screenshot script waits for: the app mounted and its fonts loaded.
  void document.fonts.ready.then(() => {
    document.documentElement.dataset.galleryReady = "1";
  });
});

if (params.autoplay === "evolution") {
  const dispose = installEvolutionAutoplay(
    window,
    rsiPrompt(params.lang),
    store.evolutionPlayback,
    () => store.clearEvolutionRounds(),
    params.freshProject === true,
  );
  if (params.freshProject && params.embedded) {
    const controls =
      'a[href],button,input,textarea,select,summary,label,[contenteditable="true"],[tabindex="0"],[role="button"],[role="menuitem"],[role="tab"],[role="option"],[role="link"]';
    const events = ["click", "auxclick", "keydown", "beforeinput", "input", "change"];
    const cleanup = () => {
      for (const type of events) document.removeEventListener(type, activate, true);
    };
    const activate = (event: Event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const control = event.target.closest(controls);
      if (!control || control.matches(':disabled,[aria-disabled="true"]')) return;
      if (event instanceof KeyboardEvent && !["Enter", " ", "Escape"].includes(event.key)) {
        const editor =
          control instanceof HTMLTextAreaElement ||
          (control instanceof HTMLInputElement &&
            ["text", "search", "email", "url", "tel", "password"].includes(control.type)) ||
          (control instanceof HTMLElement && control.isContentEditable);
        const movesCaret = /^(Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/.test(event.key);
        const selectAll = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a";
        if (!editor || !(movesCaret || selectAll)) return;
      }
      if (event.type === "auxclick" && !(event instanceof MouseEvent && event.button === 1)) return;
      cleanup();
      dispose();
      store.takeOverEvolution();
      window.parent.postMessage(DEMO_TAKEN_OVER, window.location.origin);
    };
    for (const type of events) document.addEventListener(type, activate, true);
    import.meta.hot?.dispose(cleanup);
  }
  import.meta.hot?.dispose(dispose);
}
