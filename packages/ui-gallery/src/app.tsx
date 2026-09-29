/**
 * The route switch. The routes themselves are in lib/routes.ts; every one is a full page load
 * (each is also a screenshot target), so there are no client-side transitions to manage. The
 * framed app is its own document (`app.html`), not a route here.
 */
import { FontsPage } from "./pages/fonts";
import { HomePage } from "./pages/home";
import { MissingPage, ModulePage } from "./pages/module";
import { SurfacePage } from "./pages/surface";
import { routePath } from "./lib/location";
import { parseRoute } from "./lib/routes";
import { GalleryProvider } from "./state";

export function App() {
  const route = parseRoute(routePath());
  return (
    <GalleryProvider canonicalizeUrl>
      {route.kind === "surface" ? (
        <SurfacePage id={route.id} />
      ) : route.kind === "module" ? (
        <ModulePage id={route.id} />
      ) : route.kind === "fonts" ? (
        <FontsPage />
      ) : route.kind === "missing" ? (
        <MissingPage id={route.id} />
      ) : (
        <HomePage />
      )}
    </GalleryProvider>
  );
}
