/** Landing routes and preferences rendered through the shared public-site header. */
import { useState } from "react";
import { Link, useLocation } from "react-router";
import {
  Fold,
  SiteGitHubLink,
  SiteHeader,
  SiteNavLinks,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import type { SiteLink, SiteLinkProps } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { DOCS_URL, galleryUrl, REPO_API_URL, REPO_URL } from "../lib/links";
import { ThemeToggle } from "./theme-toggle";
import { LangToggle } from "./lang-toggle";

function routeLink({ href, ...props }: SiteLinkProps) {
  return <Link to={href} {...props} />;
}

export function Nav() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const { locale } = useSiteLocale();
  const links: SiteLink[] = [
    { id: "home", href: "/", label: S.nav.home, active: pathname === "/", render: routeLink },
    {
      id: "blog",
      href: "/blog",
      label: S.nav.blog,
      active: pathname === "/blog" || pathname.startsWith("/blog/"),
      render: routeLink,
    },
    {
      id: "download",
      href: "/download",
      label: S.nav.download,
      active: pathname === "/download",
      render: routeLink,
    },
    {
      id: "amsp",
      href: "/amsp",
      label: S.nav.amsp,
      active: pathname === "/amsp" || pathname === "/amsp/",
      render: routeLink,
    },
    { id: "docs", href: DOCS_URL, label: S.nav.docs },
    { id: "gallery", href: galleryUrl(locale), label: S.nav.gallery },
  ];
  return (
    <SiteHeader
      name={S.siteName}
      logo={`${import.meta.env.BASE_URL}penguin-logo.svg`}
      home={{
        ...links[0]!,
        render: (props) => routeLink({ ...props, onClick: () => setOpen(false) }),
      }}
      links={links}
      actions={
        <>
          <LangToggle />
          <ThemeToggle />
          <SiteGitHubLink href={REPO_URL} apiUrl={REPO_API_URL} label={S.nav.github} />
        </>
      }
      menu={{
        open,
        onToggle: () => setOpen((v) => !v),
        label: open ? S.nav.closeMenu : S.nav.openMenu,
        hiddenClass: "md:hidden",
      }}
    >
      <Fold open={open} className="site-ui-fold md:hidden">
        <SiteNavLinks links={links} mobile onNavigate={() => setOpen(false)} />
      </Fold>
    </SiteHeader>
  );
}
