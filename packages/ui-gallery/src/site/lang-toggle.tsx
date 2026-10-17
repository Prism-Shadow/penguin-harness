/** Bind the shared site control to this site's preferences and translations. */
import { SiteLanguageMenu } from "@prismshadow/penguin-ui/site";
import { useLocale } from "./prefs";
import { useGallery } from "../state";

export function LangToggle() {
  const S = useGallery().S.sitebar;
  const { lang, setLang } = useLocale();
  return <SiteLanguageMenu value={lang} onChange={setLang} labels={S.lang} />;
}
