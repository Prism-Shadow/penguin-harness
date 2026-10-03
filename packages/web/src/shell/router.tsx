/**
 * Router: /login is public; all other routes go through the RequireAuth guard (redirects to
 * /login when not authenticated) and are wrapped in ProjectProvider + AppLayout.
 *
 * A data router (`createBrowserRouter` + `RouterProvider`) rather than the declarative
 * `<BrowserRouter>`, for one reason: only a data router can block a navigation, and leaving a
 * form with unsaved edits has to ask first — the browser's back and forward buttons included.
 * The routes are still declared as `<Route>` elements and nothing loads data through the
 * router; the root route only puts the `NavigationGuard` above every page.
 *
 * Every route is a page a module contributed to `WebAppModule.pages` (shell/module.ts), read
 * from WebApp's bindings: a "shell" page goes through the guard wrapped in the layout, a
 * "bare" page only needs the user signed in. The pages still declared in src/module.json
 * render beside them through the builtin registry; the ones the server contributes with
 * `nav: "org"` are company-mode pages relative to the organization layout, mounted by
 * OrgRoutes (features/company/org-routes.tsx), so they are not flat routes here.
 *
 * The app normally routes on the browser's address bar. A host that mounts it inside another
 * document (the component gallery frames it against a mocked API) passes `initialPath`
 * instead: the router then runs in memory from that path, so the app navigates without
 * touching the host document's URL — the only seam the app needs to be mounted elsewhere.
 */
import { useLayoutEffect, useState } from "react";
import {
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  createBrowserRouter,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router";
import { releaseBootWallpaper } from "@prismshadow/penguin-ui/boot";
import { NavigationGuard } from "../lib/unsaved/navigation-guard";
import { useAuth } from "../state/auth";
import { useRuntimeLanguages } from "../features/chat/use-runtime-languages";
import { ProjectProvider } from "../state/project";
import { MachinesProvider } from "../state/machines";
import { SessionsProvider } from "../state/sessions";
import { CompanyProvider } from "../state/company";
import { AppLayout } from "../components/layout/app-layout";
import { LoginPage } from "../pages/login";
import { PAGES, type PageEntry } from "./page-table";
import type { WebAppPage } from "./page-table";
import { webAppDeps } from "./deps";

/**
 * The renderers the manifest may name. A page is a module.json entry plus one line here;
 * a server-contributed page renders only when its `builtin` is in this registry.
 */
const BUILTIN_PAGES: Record<string, React.ComponentType> = {};

function renderPage(page: PageEntry): React.ReactNode {
  if ("iframe" in page.renderer) {
    return (
      <iframe title={page.key} src={page.renderer.iframe.src} className="h-full w-full border-0" />
    );
  }
  const Component = BUILTIN_PAGES[page.renderer.builtin];
  return Component === undefined ? <Navigate to="/chat" replace /> : <Component />;
}

/** Route guard: shows blank while initializing, redirects to /login when not authenticated. */
function RequireAuth() {
  const { user } = useAuth();
  // Plugin-contributed grammars, adopted once for the signed-in tree (see the hook). Called
  // before the early returns, because a hook cannot be conditional; it fetches only once a user
  // is signed in.
  useRuntimeLanguages(user != null);
  if (user === undefined) return null; // GET /api/me is still initializing
  if (user === null) return <Navigate to="/login" replace />;
  return (
    <ProjectProvider>
      <MachinesProvider>
        <SessionsProvider>
          <CompanyProvider>
            <AppLayout />
          </CompanyProvider>
        </SessionsProvider>
      </MachinesProvider>
    </ProjectProvider>
  );
}

/**
 * Login guard without the app shell: the terminal page is a standalone full-window surface
 * (no sidebar, no Project context), it only needs the user to be signed in — the terminal
 * WebSocket authenticates with the same session cookie. A workflow's page as the whole app
 * is the other one; the command palette it mounts is the way back.
 */
function RequireAuthBare({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user === undefined) return null;
  if (user === null) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** When already logged in, visiting /login redirects straight to the chat page. */
function LoginRoute() {
  const { user } = useAuth();
  if (user) return <Navigate to="/chat" replace />;
  return <LoginPage />;
}

/**
 * The root of every route: the leave guard above the page the route renders. Until the session is
 * known no screen shows, and the pre-paint script's boot layer keeps the stored custom background
 * on the window meanwhile; once it is, the first screen mounts in the same commit — the shell,
 * painting its own wallpaper, or a screen outside it — and the boot layer ends before that frame
 * is painted.
 */
function RootFrame() {
  const { user } = useAuth();
  const settled = user !== undefined;
  useLayoutEffect(() => {
    if (settled) releaseBootWallpaper(document.documentElement);
  }, [settled]);
  return (
    <>
      <NavigationGuard />
      <Outlet />
    </>
  );
}

/**
 * The routes: the pages the modules contributed (WebApp's bindings), plus the pages still
 * declared in src/module.json, which render through the builtin registry — except the
 * `nav: "org"` ones, which OrgRoutes mounts under the organization layout.
 */
function appRoutes(pages: readonly WebAppPage[]) {
  const manifestPages = PAGES.filter((page) => page.nav !== "org");
  return createRoutesFromElements(
    <Route element={<RootFrame />}>
      <Route path="/login" element={<LoginRoute />} />
      {pages
        .filter((page) => page.frame === "bare")
        .map(({ id, path, Component }) => (
          <Route
            key={id}
            path={path}
            element={
              <RequireAuthBare>
                <Component />
              </RequireAuthBare>
            }
          />
        ))}
      <Route element={<RequireAuth />}>
        <Route index element={<Navigate to="/chat" replace />} />
        {/* Admin-only pages are refused server-side (403); the sidebar hides their row, so a
            member only ever reaches one by typing the URL. */}
        {pages
          .filter((page) => page.frame === "shell")
          .map(({ id, path, Component }) => (
            <Route key={id} path={path} element={<Component />} />
          ))}
        {manifestPages.map((page) => (
          <Route key={page.id} path={page.path} element={renderPage(page)} />
        ))}
        {/* Settings and user management live in the settings dialog now (see
            SettingsDialog); their old routes fall through to the catch-all. */}
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Route>
    </Route>,
  );
}

/**
 * The address-bar router, created once for the page's life: it listens to the window's history,
 * so a second one (a language switch remounts the tree; StrictMode runs initializers twice)
 * would be a second listener acting on every back and forward.
 */
let browserRouter: ReturnType<typeof createBrowserRouter> | null = null;

export interface AppRouterProps {
  initialPath?: string;
}

export function AppRouter({ initialPath }: AppRouterProps = {}) {
  const { pages } = webAppDeps.useDeps();
  const [router] = useState(() =>
    initialPath === undefined
      ? (browserRouter ??= createBrowserRouter(appRoutes(pages)))
      : createMemoryRouter(appRoutes(pages), { initialEntries: [initialPath] }),
  );
  return <RouterProvider router={router} />;
}
