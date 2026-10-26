/**
 * Router + layout: sticky top bar, left sidebar (sticky column on desktop; on mobile an
 * overlay panel under the site's links), doc content, slim footer. basename comes from Vite's BASE_URL so
 * the site works under the GitHub Pages subpath ("/<repo>/docs/"); a route change
 * scrolls to the top or to its hash target (useRouteScroll).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, Outlet, Route, Routes, useLocation } from "react-router";
import {
  SiteFooter,
  useEscapeToClose,
  useRouteScroll,
  useSearchHotkey,
} from "@prismshadow/penguin-ui/site";
import { Nav, SiteMenu } from "./components/nav";
import { Sidebar } from "./components/sidebar";
import { DocSearch } from "./components/doc-search";
import { S } from "./lib/strings";
import { LICENSE_URL, REPO_URL, SITE_URL } from "./lib/links";
import { DocPage } from "./pages/doc-page";

function Layout() {
  const location = useLocation();
  const { pathname, hash, key } = location;
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);

  const openSearch = useCallback(
    (trigger?: HTMLElement) => {
      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      searchReturnFocusRef.current = menuOpen ? menuButtonRef.current : (trigger ?? activeElement);
      setMenuOpen(false);
      setSearchOpen(true);
    },
    [menuOpen],
  );

  const openSearchByKey = useCallback(() => openSearch(), [openSearch]);
  useSearchHotkey(searchOpen, openSearchByKey);
  useRouteScroll(location);

  // Any navigation closes the mobile sidebar, and so does Escape.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname, hash, key]);
  useEscapeToClose(menuOpen, () => setMenuOpen(false));

  return (
    <div className="flex min-h-full flex-col">
      <Nav
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((v) => !v)}
        menuButtonRef={menuButtonRef}
      />

      {menuOpen && (
        <div className="anim-fade fixed inset-x-0 top-14 bottom-0 z-30 overflow-y-auto bg-white lg:hidden dark:bg-gray-950">
          <SiteMenu onNavigate={() => setMenuOpen(false)} />
          <div className="px-6 py-6">
            <Sidebar onNavigate={() => setMenuOpen(false)} onOpenSearch={openSearch} />
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-7xl flex-1 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden border-r border-gray-200 lg:block dark:border-gray-800">
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto px-4 py-8 pl-6">
            <Sidebar onOpenSearch={openSearch} />
          </div>
        </aside>
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>

      <SiteFooter
        copyright={S.footer.copyright}
        links={[
          { id: "site", href: SITE_URL, label: S.footer.site },
          { id: "repo", href: REPO_URL, label: S.footer.repo, external: true },
          { id: "license", href: LICENSE_URL, label: S.footer.license, external: true },
        ]}
      />
      <DocSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        returnFocusRef={searchReturnFocusRef}
      />
    </div>
  );
}

export function AppRouter() {
  const basename = import.meta.env.BASE_URL.replace(/\/+$/, "") || "/";
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DocPage />} />
          <Route path="/:slug" element={<DocPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
