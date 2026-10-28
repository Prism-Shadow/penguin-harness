/**
 * Router: home, blog list, blog post, download and the AMSP page inside a shared Nav/Footer
 * layout. basename comes from Vite's BASE_URL so the site works under the GitHub Pages
 * project subpath; a route change scrolls to the top or to its hash target
 * (useRouteScroll — e.g. /#quickstart after leaving the blog, or a blog TOC entry).
 *
 * Two routes load on demand: the post page carries the Markdown renderer, and the AMSP page its
 * player, scripted runs and code samples, none of which the other pages use.
 */
import { lazy, Suspense, useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router";
import { useRouteScroll, useSiteLocale } from "@prismshadow/penguin-ui/site";
import { DOCS_URL, GALLERY_URL } from "./lib/links";
import { getPost, loadPostBody } from "./lib/blog";
import { AnnouncementBar } from "./components/announcement-bar";
import { Nav } from "./components/nav";
import { Footer } from "./components/footer";
import { NeonBackground } from "./components/neon-bg";
import { PostPending } from "./components/post-pending";
import { HomePage } from "./pages/home";
import { BlogListPage } from "./pages/blog-list";
import { DownloadPage } from "./pages/download";

const AmspPage = lazy(() =>
  import("./pages/amsp").then((module) => ({ default: module.AmspPage })),
);

const BlogPostPage = lazy(() =>
  import("./pages/blog-post").then((page) => ({ default: page.BlogPostPage })),
);

/**
 * A post's route. Its body starts downloading beside the page's code instead of after it; the
 * main column holds a screen of empty space until both are in, and the page then shows header
 * and body together.
 */
function BlogPostRoute() {
  const { slug = "" } = useParams();
  const { locale } = useSiteLocale();
  const post = getPost(slug, locale);
  useEffect(() => {
    // A chunk that fails to load reloads the page (main.tsx): nothing to handle here.
    if (post) void loadPostBody(post).catch(() => undefined);
  }, [post]);
  return (
    <Suspense fallback={<PostPending />}>
      <BlogPostPage />
    </Suspense>
  );
}

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
          <Route path="/blog/:slug" element={<BlogPostRoute />} />
          <Route path="/download" element={<DownloadPage />} />
          <Route
            path="/amsp"
            element={
              // A screen of empty space while the chunk loads, as for a post.
              <Suspense fallback={<PostPending />}>
                <AmspPage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        {/* Outside Layout: pure redirects, no nav/footer flash. */}
        <Route path="/docs/*" element={<SiblingRedirect url={DOCS_URL} />} />
        <Route path="/gallery/*" element={<SiblingRedirect url={GALLERY_URL} />} />
      </Routes>
    </BrowserRouter>
  );
}
