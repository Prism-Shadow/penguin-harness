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
import type { SiteLinkProps } from "@prismshadow/penguin-ui/site";
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
      amsp: route("/amsp"),
      gallery: { href: galleryUrl(locale) },
    },
  });
  return (
    <SiteNav
      name={S.siteName}
      logo={`${import.meta.env.BASE_URL}penguin-logo.svg`}
      labels={S.nav}
      links={links}
      home={{ ...links[0]!, render: (props) => routeLink({ ...props, onClick: close }) }}
      language={{ value: lang, onChange: setLang, labels: S.lang }}
      theme={{ mode, onChange: setMode, labels: S.theme }}
      repo={{ href: REPO_URL, apiUrl: REPO_API_URL }}
      menu={{ open, onToggle: () => setOpen((v) => !v), hiddenClass: "md:hidden" }}
    >
      <Fold open={open} className="site-ui-fold md:hidden">
        <SiteNavLinks links={links} mobile onNavigate={close} />
      </Fold>
    </SiteNav>
  );
}
