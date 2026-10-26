/** Docs routes and drawer control rendered through the shared public-site header. */
import type { RefObject } from "react";
import { Link } from "react-router";
import { SiteGitHubLink, SiteHeader, useSiteLocale } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { galleryUrl, REPO_API_URL, REPO_URL, SITE_URL } from "../lib/links";
import { ThemeToggle } from "./theme-toggle";
import { LangToggle } from "./lang-toggle";

export function Nav({
  menuOpen,
  onToggleMenu,
  menuButtonRef,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { locale } = useSiteLocale();
  const home = { id: "home", href: SITE_URL, label: S.nav.home };
  return (
    <SiteHeader
      name={S.siteName}
      logo={`${import.meta.env.BASE_URL}penguin-logo.svg`}
      home={home}
      links={[
        home,
        { id: "blog", href: `${SITE_URL}blog`, label: S.nav.blog },
        { id: "download", href: `${SITE_URL}download`, label: S.nav.download },
        {
          id: "docs",
          href: "/",
          label: S.nav.docs,
          active: true,
          render: ({ href, ...props }) => <Link to={href} {...props} />,
        },
        { id: "gallery", href: galleryUrl(locale), label: S.nav.gallery },
      ]}
      actions={
        <>
          <LangToggle />
          <ThemeToggle />
          <SiteGitHubLink href={REPO_URL} apiUrl={REPO_API_URL} label={S.nav.github} />
        </>
      }
      menu={{
        open: menuOpen,
        onToggle: onToggleMenu,
        buttonRef: menuButtonRef,
        label: menuOpen ? S.nav.closeMenu : S.nav.openMenu,
        hiddenClass: "lg:hidden",
      }}
    />
  );
}
