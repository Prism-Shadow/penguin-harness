/**
 * The route switch. The routes themselves are in lib/routes.ts; every one is a full page load
 * (each is also an iframe or screenshot target), so there are no client-side transitions to
 * manage.
 */
import { EmbedPage } from "./pages/embed";
import { FontsPage } from "./pages/fonts";
import { HomePage } from "./pages/home";
import { MissingModule, ModulePage } from "./pages/module";
import { ScreenPage } from "./pages/screen";
import { routePath } from "./lib/location";
import { parseRoute } from "./lib/routes";
import { GalleryProvider } from "./state";

const EMBED_PARAMS = ["module", "demo", "variant", "frame", "play", "sync"] as const;

export function App() {
  const route = parseRoute(routePath());
  switch (route.kind) {
    case "embed":
      return (
        <GalleryProvider extraParams={EMBED_PARAMS}>
          <EmbedPage />
        </GalleryProvider>
      );
    case "screen":
      return (
        <GalleryProvider extraParams={["bare"]}>
          <ScreenPage name={route.name} />
        </GalleryProvider>
      );
    case "fonts":
      return (
        <GalleryProvider canonicalizeUrl>
          <FontsPage />
        </GalleryProvider>
      );
    case "module":
      return (
        <GalleryProvider canonicalizeUrl>
          <ModulePage id={route.id} />
        </GalleryProvider>
      );
    case "missing":
      return (
        <GalleryProvider canonicalizeUrl>
          <MissingModule id={route.id} />
        </GalleryProvider>
      );
    case "home":
    case "unknown":
      return (
        <GalleryProvider canonicalizeUrl>
          <HomePage />
        </GalleryProvider>
      );
  }
}
