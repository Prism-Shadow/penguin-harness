/**
 * The framed component library's entry (`lib.html`): one topic's board, made of the Web App's
 * real components, mounted under the app's own providers — locale, theme, the toast overlay and
 * the tooltip layer — with the gallery's context for the boards that read tokens and the
 * gallery's dictionary. The document's storage was already replaced and seeded by the inline
 * script in the page head, and the app's own boot script has applied the theme, so the board
 * renders exactly as the app would.
 *
 * The mock network is installed as in the app frame: a component that fetches (the file
 * browser's preview, a chart) gets the demo store's answer.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "../../../web/src/components/ui/toast";
import { TooltipLayer } from "../../../web/src/components/ui/tooltip";
import { LocaleProvider, LocaleScope } from "../../../web/src/state/locale";
import { ThemeProvider } from "../../../web/src/state/theme";
// The app's dependency, reached through its own node_modules, ahead of the app's own sheet.
import "../../../web/node_modules/katex/dist/katex.min.css";
import "./library.css";
import { installFetchShim } from "../app/mock/fetch-shim";
import { getStore } from "../app/mock/store";
import { GalleryProvider } from "../state";
import { parseLibraryParams } from "./frame";
import { installSelfResizeGuard } from "./frame-resize";
import { LibraryBoardPage } from "./page";

const params = parseLibraryParams(window.location.search);
getStore({ lang: params.lang, signedIn: true });
installFetchShim();

// Framed, the document is sized by the page around it and must never show a scrollbar of its own
// (library.css keys on the attribute; set before the first paint), and a focus must not scroll
// the page around the frame (see src/app/main.tsx).
if (window.parent !== window) {
  document.documentElement.dataset.framed = "1";
  // Before the app mounts, so the guard's listener runs ahead of the app's own.
  installSelfResizeGuard(window);
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    focus.call(this, { ...options, preventScroll: true });
  };
}

const container = document.getElementById("root");
if (!container) throw new Error("#root mount point not found");

createRoot(container).render(
  <StrictMode>
    <LocaleProvider>
      <ThemeProvider>
        <LocaleScope>
          <GalleryProvider>
            <LibraryBoardPage topic={params.topic} />
          </GalleryProvider>
          <Toaster />
          <TooltipLayer />
        </LocaleScope>
      </ThemeProvider>
    </LocaleProvider>
  </StrictMode>,
);
