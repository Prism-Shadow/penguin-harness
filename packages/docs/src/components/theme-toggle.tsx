/** Bind the shared site control to this site's preferences and translations. */
import { SiteThemeToggle } from "@prismshadow/penguin-ui/site";
import { useTheme } from "../state/theme";
import { S } from "../lib/strings";

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return <SiteThemeToggle mode={mode} onChange={setMode} labels={S.theme} />;
}
