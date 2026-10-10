/**
 * The site frame every page renders inside: the top bar, then the body — an optional left column
 * with the section's navigation list, the content column, and an optional right column ("on this
 * page") — and the tooltip layer the chrome's `data-tooltip` hints render through.
 *
 * At phone width the columns collapse: the left and right columns disappear, the content column
 * fills, and the menu button in the bar opens a drawer under it holding the page links, every
 * view control with its label and the section's list, closed again by a link, the button or
 * Escape.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useGallery } from "../state";
import { ChromeTooltips } from "./tooltip";
import { PageLinks, TopBar, ViewControls } from "./topbar";
import type { SitePage } from "./topbar";

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
  const { S } = useGallery();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div
      className="g-site g-chrome"
      data-nav={nav ? true : undefined}
      data-toc={toc ? true : undefined}
    >
      <TopBar page={page} open={open} onToggle={() => setOpen((current) => !current)} />
      {open && (
        <div className="g-drawer">
          <nav className="g-drawer-links" aria-label={S.site.pages}>
            <PageLinks current={page} onNavigate={close} />
          </nav>
          <div className="g-drawer-controls">
            <span className="g-nav-eyebrow">{S.site.settings}</span>
            <ViewControls all />
          </div>
          {nav?.(close)}
        </div>
      )}
      <div className="g-body" data-wide={wide || undefined}>
        {nav && <aside className="g-sidenav">{nav()}</aside>}
        <main className="g-main">{children}</main>
        {toc && <aside className="g-toc">{toc}</aside>}
      </div>
      <ChromeTooltips />
    </div>
  );
}
