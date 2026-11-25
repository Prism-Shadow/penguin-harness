/**
 * The site frame every page renders inside: the site navbar (site/nav.tsx), the landing page's
 * and the docs' own; the gallery's bar under it, with the gallery's pages and its view controls;
 * then the body — an optional left column with the section's navigation list, the content column,
 * and an optional right column ("on this page") — and the tooltip layer the chrome's
 * `data-tooltip` hints render through.
 *
 * At phone width the columns collapse: the left and right columns disappear and the content column
 * fills. The navbar's menu button then opens a drawer under it, as the docs open their sidebar: the
 * site's links where the navbar has no room for them, and the section's list, closed again by a
 * link, the button or Escape. The gallery's bar stays: its pages scroll sideways, its controls sit
 * in the popover.
 *
 * The navbar and its links in the drawer sit outside the `.g-chrome` subtree: they are the landing
 * page's Tailwind markup, and the chrome's base rules would outrank its utilities.
 */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { SiteMobileNav, SiteNav } from "@prismshadow/penguin-ui/site";
import { BASE } from "../lib/location";
import { homeHref } from "../lib/routes";
import { SITE_URL } from "../site/links";
import { useLocale, useSitePrefsSync, useTheme } from "../site/prefs";
import { useGallery } from "../state";
import { GalleryBar } from "./gallery-bar";
import type { SitePage } from "./gallery-bar";
import { ChromeTooltips } from "./tooltip";

export function Site({
  page,
  nav,
  toc,
  wide = false,
  children,
}: {
  page: SitePage;
  /** The section's navigation list, rendered in the left column and again in the drawer, which passes its close. */
  nav?: (onNavigate?: () => void) => ReactNode;
  /** The right column's content. */
  toc?: ReactNode;
  /** Let the content column grow past the reading width: a framed board needs the room. */
  wide?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { S, state } = useGallery();
  const { lang, setLang } = useLocale();
  const { mode, setMode } = useTheme();
  const overrides = useMemo(() => ({ gallery: { href: homeHref(BASE, state) } }), [state]);
  useSitePrefsSync();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="g-site" data-nav={nav ? true : undefined} data-toc={toc ? true : undefined}>
      <div className="g-sitebar">
        <SiteNav
          siteRoot={SITE_URL}
          logo={`${import.meta.env.BASE_URL}penguin-logo.svg`}
          current="gallery"
          overrides={overrides}
          language={{ value: lang, onChange: setLang, labels: S.sitebar.lang }}
          theme={{ mode, onChange: setMode, labels: S.sitebar.theme }}
          menu={{
            open,
            onToggle: () => setOpen((current) => !current),
            hiddenClass: "lg:hidden",
          }}
        />
      </div>
      {open && (
        <div className="g-drawer">
          <div className="g-sitebar">
            <SiteMobileNav
              siteRoot={SITE_URL}
              locale={state.lang}
              current="gallery"
              overrides={overrides}
              onNavigate={close}
            />
          </div>
          {nav && <div className="g-chrome g-drawer-list">{nav(close)}</div>}
        </div>
      )}
      <div className="g-chrome g-flow">
        <GalleryBar page={page} />
        <div className="g-body" data-wide={wide || undefined}>
          {nav && <aside className="g-sidenav">{nav()}</aside>}
          <main className="g-main">{children}</main>
          {toc && <aside className="g-toc">{toc}</aside>}
        </div>
        <ChromeTooltips />
      </div>
    </div>
  );
}
