/** Gallery routes and drawer control rendered through the shared public-site navigation. */
import { SiteNav as SiteBar, SiteNavLinks, siteNavLinks } from "@prismshadow/penguin-ui/site";
import { BASE } from "../lib/location";
import { homeHref } from "../lib/routes";
import { useGallery } from "../state";
import { REPO_API_URL, REPO_URL, SITE_URL } from "./links";
import { useLocale, useTheme } from "./prefs";

/** The drawer button follows the link row or the section list's breakpoint. */
export type MenuWidth = "links" | "list";
const MENU_BUTTON_HIDDEN: Record<MenuWidth, string> = {
  links: "md:hidden",
  list: "min-[901px]:hidden",
};

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
  menuWidth,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
  menuWidth: MenuWidth;
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
        hiddenClass: MENU_BUTTON_HIDDEN[menuWidth],
      }}
    />
  );
}

export function SiteMenu({ onNavigate }: { onNavigate: () => void }) {
  return <SiteNavLinks links={useSiteLinks()} mobile onNavigate={onNavigate} />;
}
