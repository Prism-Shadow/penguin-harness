import { CodeHighlighterProvider, Toaster, TooltipLayer } from "@prismshadow/penguin-ui";
import { highlightCode } from "@prismshadow/penguin-web/internal";

  CodeHighlighterProvider,
  ReportHost,
  Toaster,
  TooltipLayer,
||||||| parent of bdf45dcf64 (ui-gallery: take highlightCode from web internal (chat face moved to sessions))
import { LocaleProvider, LocaleScope } from "../../../web/src/state/locale";
import { ThemeProvider } from "../../../web/src/state/theme";
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
    <CodeHighlighterProvider highlight={highlightCode}>
      <LocaleProvider>
        <ThemeProvider>
          <LocaleScope>
            <GalleryProvider>
              <LibraryBoardPage topic={params.topic} />
            </GalleryProvider>
            <Toaster />
            <ReportHost />
            <TooltipLayer />
          </LocaleScope>
        </ThemeProvider>
      </LocaleProvider>
    </CodeHighlighterProvider>
  </StrictMode>,
);
