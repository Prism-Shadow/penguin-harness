/** Bind the shared site control to this site's preferences and translations. */
import { SiteThemeToggle } from "@prismshadow/penguin-ui/site";
import { useTheme } from "./prefs";
import { useGallery } from "../state";

export function ThemeToggle() {
  const S = useGallery().S.sitebar;
  const { mode, setMode } = useTheme();
  return <SiteThemeToggle mode={mode} onChange={setMode} labels={S.theme} />;
}
