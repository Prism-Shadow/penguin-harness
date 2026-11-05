/**
 * App root: Locale -> Theme -> LocaleScope -> Router, the same composition as the landing page.
 * The shared providers own the preferences; this site supplies its dictionaries.
 */
import {
  SiteLocaleProvider,
  SiteLocaleScope,
  SiteThemeProvider,
} from "@prismshadow/penguin-ui/site";
import type { SiteLocale } from "@prismshadow/penguin-ui/site";
import { setActiveStrings, zh } from "./lib/strings";
import { en } from "./lib/strings-en";
import { AppRouter } from "./router";

const applyLocale = (locale: SiteLocale) => setActiveStrings(locale === "en" ? en : zh);

export function App() {
  return (
    <SiteLocaleProvider onLocale={applyLocale}>
      <SiteThemeProvider>
        <SiteLocaleScope>
          <AppRouter />
        </SiteLocaleScope>
      </SiteThemeProvider>
    </SiteLocaleProvider>
  );
}
