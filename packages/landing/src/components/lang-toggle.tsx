/** Bind the shared site control to this site's preferences and translations. */
import { SiteLanguageMenu } from "@prismshadow/penguin-ui/site";
import { useLocale } from "../state/locale";
import { S } from "../lib/strings";

export function LangToggle() {
  const { lang, setLang } = useLocale();
  return <SiteLanguageMenu value={lang} onChange={setLang} labels={S.lang} />;
}
