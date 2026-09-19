/**
 * Routes, by path (full page loads — every route is also an iframe or screenshot target, so
 * there are no client-side transitions to manage):
 *
 *   /                 the gallery
 *   /embed            one module variant (a live one on its own clock), or one part demo, alone
 *   /screens/<name>   a full-viewport composite
 *   /fonts            font specimens, declared faces and licences
 */
import { EmbedPage } from "./pages/embed";
import { FontsPage } from "./pages/fonts";
import { GalleryPage } from "./pages/gallery";
import { ScreenPage } from "./pages/screen";
import { routePath } from "./lib/location";
import { GalleryProvider } from "./state";

const EMBED_PARAMS = ["module", "demo", "variant", "frame", "play", "sync"] as const;

export function App() {
  const path = routePath();
  if (path === "/embed") {
    return (
      <GalleryProvider extraParams={EMBED_PARAMS}>
        <EmbedPage />
      </GalleryProvider>
    );
  }
  const screen = /^\/screens\/([^/]+)$/.exec(path)?.[1];
  if (screen !== undefined) {
    return (
      <GalleryProvider extraParams={["bare"]}>
        <ScreenPage name={decodeURIComponent(screen)} />
      </GalleryProvider>
    );
  }
  if (path === "/fonts") {
    return (
      <GalleryProvider canonicalizeUrl>
        <FontsPage />
      </GalleryProvider>
    );
  }
  return (
    <GalleryProvider canonicalizeUrl>
      <GalleryPage />
    </GalleryProvider>
  );
}
