/** Docs routes and drawer control rendered through the shared public-site navigation. */
import type { RefObject } from "react";
import { Link } from "react-router";
import {
  SiteNav,
  SiteNavLinks,
  siteNavLinks,
  useSiteLocale,
  useSiteTheme,
} from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { galleryUrl, REPO_API_URL, REPO_URL, SITE_URL } from "../lib/links";

/** The site's pages, with the docs as this router's root and the page being read. */
function useSiteLinks() {
  const { locale } = useSiteLocale();
  return siteNavLinks({
    siteRoot: SITE_URL,
    labels: S.nav,
    current: "docs",
    overrides: {
      docs: { href: "/", render: ({ href, ...props }) => <Link to={href} {...props} /> },
      gallery: { href: galleryUrl(locale) },
    },
  });
}

export function Nav({
  menuOpen,
  onToggleMenu,
  menuButtonRef,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { lang, setLang } = useSiteLocale();
  const { mode, setMode } = useSiteTheme();
  return (
    <SiteNav
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
        buttonRef: menuButtonRef,
        hiddenClass: "lg:hidden",
      }}
    />
  );
}

/** The site's links at the top of the drawer, where the bar has no room for them. */
export function SiteMenu({ onNavigate }: { onNavigate: () => void }) {
  return <SiteNavLinks links={useSiteLinks()} mobile onNavigate={onNavigate} />;
}
