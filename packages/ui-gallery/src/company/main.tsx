/**
 * The company-mode prototype's entry (`company.html`): the prototype mounted under the app's
 * own providers (locale, theme, the toast overlay and the tooltip layer), so it renders exactly
 * as the app would. The document's storage was already replaced and seeded by the inline script
 * in the page head, and the app's own boot script has applied the theme.
 *
 * Framed by a page outside the gallery (`embed=1`), it is that page's guest, as the framed app
 * is: until the reader clicks into it, it takes no focus and hands the wheel to the page.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, TooltipLayer } from "@prismshadow/penguin-ui";
import { LocaleProvider, LocaleScope } from "../../../web/src/state/locale";
import { ThemeProvider } from "../../../web/src/state/theme";
import "./company.css";
import { installGuestFrame } from "../app/guest-frame";
import { parseCompanyParams } from "./frame";
import { CompanyPrototype } from "./prototype";

const params = parseCompanyParams(window.location.search);
if (params.embedded && window.parent !== window) installGuestFrame(window);

const container = document.getElementById("root");
if (!container) throw new Error("#root mount point not found");

createRoot(container).render(
  <StrictMode>
    <LocaleProvider>
      <ThemeProvider>
        <LocaleScope>
          <CompanyPrototype start={params.start} />
          <Toaster />
          <TooltipLayer />
        </LocaleScope>
      </ThemeProvider>
    </LocaleProvider>
  </StrictMode>,
);

// What a page that frames this document waits for: the prototype mounted and its fonts loaded.
void document.fonts.ready.then(() => {
  document.documentElement.dataset.galleryReady = "1";
});
