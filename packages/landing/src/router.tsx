/**
 * Router: home + blog list + blog post inside a shared Nav/Footer layout.
 * basename comes from Vite's BASE_URL so the site works under the GitHub Pages
 * project subpath; scroll restores to top on route change (hash targets excluded).
 */
import { useEffect } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { DOCS_URL } from "./lib/links";
import { Nav } from "./components/nav";
import { Footer } from "./components/footer";
import { NeonBackground } from "./components/neon-bg";
import { HomePage } from "./pages/home";
import { BlogListPage } from "./pages/blog-list";
import { BlogPostPage } from "./pages/blog-post";

/**
 * Deep links into the docs SPA that missed a real file (e.g. an unknown slug) land on
 * the site-root 404.html, which boots this landing SPA. Hand them to the docs index —
 * unless we are already at the docs index (landing dev serves index.html for every
 * path, so redirecting to the same URL would reload forever).
 */
function DocsRedirect() {
  const target = new URL(DOCS_URL, window.location.origin).pathname;
  if (window.location.pathname !== target) {
    window.location.replace(target);
    return null;
  }
  return <Navigate to="/" replace />;
}

/**
 * Last history entry whose scroll was already handled. Module-level so it survives
 * the locale-keyed remount of the whole tree: switching language re-mounts Layout,
 * and without this guard the navigation effect would re-run (jumping to the hash or
 * to the top) and defeat LocaleScope's scroll preservation.
 */
let handledLocationKey = "";

function Layout() {
  const { pathname, hash, key } = useLocation();
  // Genuine route change: jump to top; with a hash (e.g. /#quickstart after leaving
  // the blog) scroll to the target once the section is in the DOM.
  useEffect(() => {
    if (key === handledLocationKey) return;
    handledLocationKey = key;
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash, key]);

  return (
    <div className="relative flex min-h-full flex-col">
      <NeonBackground />
      <Nav />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

export function AppRouter() {
  const basename = import.meta.env.BASE_URL.replace(/\/+$/, "") || "/";
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="/blog" element={<BlogListPage />} />
          <Route path="/blog/:slug" element={<BlogPostPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        {/* Outside Layout: a pure redirect, no nav/footer flash. */}
        <Route path="/docs/*" element={<DocsRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}
