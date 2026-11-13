/** Gallery routes and drawer control rendered through the shared public-site navigation. */
import { SiteNav as SiteBar, SiteNavLinks, siteNavLinks } from "@prismshadow/penguin-ui/site";
import { BASE } from "../lib/location";
import { homeHref } from "../lib/routes";
import { useGallery } from "../state";
import { REPO_API_URL, REPO_URL, SITE_URL } from "./links";
import { useLocale, useTheme } from "./prefs";

/**
 * The drawer button shows until the link row does (1024 px), which is also past the width where
 * the section list leaves the drawer for the side column, so one breakpoint serves both.
 */
const MENU_BUTTON_HIDDEN = "lg:hidden";

/** The site's pages, with the gallery as its overview in the view's language and theme. */
function useSiteLinks() {
  const { S, state } = useGallery();
  return siteNavLinks({
    siteRoot: SITE_URL,
    labels: S.sitebar.nav,
    current: "gallery",
    overrides: { gallery: { href: homeHref(BASE, state) } },
  });
}

export function SiteNav({
  menuOpen,
  onToggleMenu,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  const S = useGallery().S.sitebar;
  const { lang, setLang } = useLocale();
  const { mode, setMode } = useTheme();
  return (
    <SiteBar
      name={S.siteName}
      logo={`${import.meta.env.BASE_URL}penguin-logo.svg`}
      labels={S.nav}
      links={useSiteLinks()}
      language={{ value: lang, onChange: setLang, labels: S.lang }}
      theme={{ mode, onChange: setMode, labels: S.theme }}
      repo={{ href: REPO_URL, apiUrl: REPO_API_URL }}
      menu={{
        open: menuOpen,
        onToggle: onToggleMenu,
        hiddenClass: MENU_BUTTON_HIDDEN,
      }}
    />
  );
}

export function SiteMenu({ onNavigate }: { onNavigate: () => void }) {
  return <SiteNavLinks links={useSiteLinks()} mobile onNavigate={onNavigate} />;
}
