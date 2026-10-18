/**
 * Router: home + blog list + blog post inside a shared Nav/Footer layout.
 * basename comes from Vite's BASE_URL so the site works under the GitHub Pages
 * project subpath; a route change scrolls to the top or to its hash target
 * (useRouteScroll — e.g. /#quickstart after leaving the blog, or a blog TOC entry).
 */
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useRouteScroll } from "@prismshadow/penguin-ui/site";
import { DOCS_URL, GALLERY_URL } from "./lib/links";
import { AnnouncementBar } from "./components/announcement-bar";
import { Nav } from "./components/nav";
import { Footer } from "./components/footer";
import { NeonBackground } from "./components/neon-bg";
import { HomePage } from "./pages/home";
import { BlogListPage } from "./pages/blog-list";
import { BlogPostPage } from "./pages/blog-post";
import { DownloadPage } from "./pages/download";

/**
 * Deep links into a sibling SPA (the docs, the gallery) that missed a real file (e.g. an
 * unknown slug) land on the site-root 404.html, which boots this landing SPA. Hand them
 * to that site's index — unless we are already there (landing dev serves index.html for
 * every path, so redirecting to the same URL would reload forever).
 */
function SiblingRedirect({ url }: { url: string }) {
  const target = new URL(url, window.location.origin).pathname;
  if (window.location.pathname !== target) {
    window.location.replace(target);
    return null;
  }
  return <Navigate to="/" replace />;
}

function Layout() {
  useRouteScroll(useLocation());

  return (
    <div className="relative flex min-h-full flex-col">
      <NeonBackground />
      <AnnouncementBar />
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
          <Route path="/download" element={<DownloadPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        {/* Outside Layout: pure redirects, no nav/footer flash. */}
        <Route path="/docs/*" element={<SiblingRedirect url={DOCS_URL} />} />
        <Route path="/gallery/*" element={<SiblingRedirect url={GALLERY_URL} />} />
      </Routes>
    </BrowserRouter>
  );
}
