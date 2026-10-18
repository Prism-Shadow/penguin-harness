/** Bind the shared site control to this site's preferences and translations. */
import { SiteLanguageMenu, useSiteLocale } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";

export function LangToggle() {
  const { lang, setLang } = useSiteLocale();
  return <SiteLanguageMenu value={lang} onChange={setLang} labels={S.lang} />;
}
