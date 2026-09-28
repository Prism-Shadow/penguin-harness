/**
 * The site frame every page renders inside: the top bar, then the body — an optional left column
 * with the module list, the content column, and an optional right column ("on this page").
 *
 * At phone width the columns collapse: the left and right columns disappear, the content column
 * fills, and the menu button in the bar opens a drawer under it holding the page links, the view
 * controls and the module list, closed again by a link, the button or Escape.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useGallery } from "../state";
import { ModuleNav } from "./sidenav";
import { ModeSwitch, PageLinks, TopBar, ViewControls, ViewToggles } from "./topbar";
import type { SitePage } from "./topbar";

export function Site({
  page,
  activeId = null,
  nav = false,
  toc,
  wide = false,
  children,
}: {
  page: SitePage;
  /** The module page this is, for the module list's current mark. */
  activeId?: string | null;
  /** Show the module list in the left column (module pages). */
  nav?: boolean;
  /** The right column's content (module pages). */
  toc?: ReactNode;
  /** Let the content column grow past the reading width: compare frames need the room. */
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
    <div className="g-site g-chrome" data-nav={nav || undefined} data-toc={toc ? true : undefined}>
      <TopBar page={page} open={open} onToggle={() => setOpen((current) => !current)} />
      {open && (
        <div className="g-drawer">
          <nav className="g-drawer-links" aria-label={S.site.pages}>
            <PageLinks current={page} onNavigate={close} />
          </nav>
          <div className="g-drawer-controls">
            <span className="g-nav-eyebrow">{S.site.settings}</span>
            <ViewControls />
            <ViewToggles />
            <div className="g-control">
              <span className="g-control-label">{S.rail.mode}</span>
              <ModeSwitch />
            </div>
          </div>
          <ModuleNav activeId={activeId} onNavigate={close} />
        </div>
      )}
      <div className="g-body" data-wide={wide || undefined}>
        {nav && (
          <aside className="g-sidenav">
            <ModuleNav activeId={activeId} />
          </aside>
        )}
        <main className="g-main">{children}</main>
        {toc && <aside className="g-toc">{toc}</aside>}
      </div>
    </div>
  );
}
