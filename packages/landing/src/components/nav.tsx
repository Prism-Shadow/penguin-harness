/** Landing routes and preferences rendered through the shared public-site navigation. */
import { useState } from "react";
import { Link, useLocation } from "react-router";
import {
  Fold,
  landingPageAt,
  SiteNav,
  SiteNavLinks,
  siteNavLinks,
  useEscapeToClose,
  useSiteLocale,
  useSiteTheme,
} from "@prismshadow/penguin-ui/site";
import type { SiteLink, SiteLinkProps } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { galleryUrl, REPO_API_URL, REPO_URL } from "../lib/links";

function routeLink({ href, ...props }: SiteLinkProps) {
  return <Link to={href} {...props} />;
}

/** One of this site's own pages, rendered through its router. */
const route = (href: string) => ({ href, render: routeLink });

export function Nav() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  useEscapeToClose(open, close);
  const { lang, locale, setLang } = useSiteLocale();
  const { mode, setMode } = useSiteTheme();
  const links = siteNavLinks({
    siteRoot: import.meta.env.BASE_URL,
    labels: S.nav,
    current: landingPageAt(pathname),
    overrides: {
      home: route("/"),
      blog: route("/blog"),
      download: route("/download"),
      plugins: route("/plugins"),
      benchmarks: route("/benchmarks"),
      leaderboards: route("/leaderboards"),
      amsp: route("/amsp"),
      gallery: { href: galleryUrl(locale) },
    },
  });
  // The RFC index is this site's own page too; it joins the row just before the "More" group
  // that ends it (siteNavLinks builds the shared sites' pages only).
  const rfcsLink: SiteLink = {
    id: "rfcs",
    href: "/rfcs",
    label: S.nav.rfcs,
    active: /^\/rfcs\/?$/.test(pathname),
    render: routeLink,
  };
  const moreAt = links.findIndex((item) => "links" in item);
  links.splice(moreAt === -1 ? links.length : moreAt, 0, rfcsLink);
  return (
    <SiteNav
      name={S.siteName}
      logo={`${import.meta.env.BASE_URL}penguin-logo.svg`}
      labels={S.nav}
      links={links}
      home={{
        id: "home",
        href: "/",
        label: S.nav.home,
        render: (props) => routeLink({ ...props, onClick: close }),
      }}
      language={{ value: lang, onChange: setLang, labels: S.lang }}
      theme={{ mode, onChange: setMode, labels: S.theme }}
      repo={{ href: REPO_URL, apiUrl: REPO_API_URL }}
      menu={{ open, onToggle: () => setOpen((v) => !v), hiddenClass: "lg:hidden" }}
    >
      <Fold open={open} className="site-ui-fold lg:hidden">
        <SiteNavLinks links={links} mobile onNavigate={close} />
      </Fold>
    </SiteNav>
  );
}
