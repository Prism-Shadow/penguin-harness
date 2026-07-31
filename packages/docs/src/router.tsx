/**
 * Router + layout: sticky top bar, left sidebar (sticky column on desktop, overlay
 * panel on mobile), doc content, slim footer. basename comes from Vite's BASE_URL so
 * the site works under the GitHub Pages subpath ("/<repo>/docs/"); scroll restores to
 * top on route change (hash targets excluded).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, Outlet, Route, Routes, useLocation } from "react-router";
import { Nav } from "./components/nav";
import { Sidebar } from "./components/sidebar";
import { Footer } from "./components/footer";
import { DocSearchDialog } from "./components/doc-search-dialog";
import { DocPage } from "./pages/doc-page";

/**
 * Last history entry whose scroll was already handled. Module-level so it survives
 * the locale-keyed remount of the whole tree: switching language re-mounts Layout,
 * and without this guard the navigation effect would re-run (jumping to the hash or
 * to the top) and defeat LocaleScope's scroll preservation.
 */
let handledLocationKey = "";

function Layout() {
  const { pathname, hash, key } = useLocation();
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "k" &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        if (!searchOpen) openSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch, searchOpen]);

  // Genuine route change: jump to top; with a hash scroll to the target once it is
  // in the DOM. Also close the mobile sidebar.
  useEffect(() => {
    setMenuOpen(false);
    if (key === handledLocationKey) return;
    handledLocationKey = key;
    if (hash) {
      // Anchors of CJK headings arrive percent-encoded in the URL hash.
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) {
        el.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash, key]);

  return (
    <div className="flex min-h-full flex-col">
      <Nav
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((v) => !v)}
        menuButtonRef={menuButtonRef}
      />

      {menuOpen && (
        <div className="anim-fade fixed inset-x-0 top-14 bottom-0 z-30 overflow-y-auto border-t border-gray-200 bg-white px-6 py-6 lg:hidden dark:border-gray-800 dark:bg-gray-950">
          <Sidebar onNavigate={() => setMenuOpen(false)} onOpenSearch={openSearch} />
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

      <Footer />
      <DocSearchDialog
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
