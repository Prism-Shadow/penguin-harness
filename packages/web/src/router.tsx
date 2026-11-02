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
 * The app normally routes on the browser's address bar. A host that mounts it inside another
 * document (the component gallery frames it against a mocked API) passes `initialPath`
 * instead: the router then runs in memory from that path, so the app navigates without
 * touching the host document's URL — the only seam the app needs to be mounted elsewhere.
 */
import { lazy, useLayoutEffect, useState } from "react";
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
import { NavigationGuard } from "./lib/unsaved/navigation-guard";
import { useAuth } from "./state/auth";
import { useRuntimeLanguages } from "./features/chat/use-runtime-languages";
import { ProjectProvider } from "./state/project";
import { MachinesProvider } from "./state/machines";
import { SessionsProvider } from "./state/sessions";
import { CompanyProvider } from "./state/company";
import { AppLayout } from "./components/layout/app-layout";
import { PAGES } from "./lib/pages";
import type { PageEntry } from "./lib/pages";

/**
 * A page behind a dynamic import, so the entry chunk does not carry it.
 *
 * A first paint needs the login page and the app shell. Every other page is reached from
 * somewhere else: a chat by typing /chat, a benchmark by picking a case, the terminal by
 * its own URL. Shipping all of them in the entry meant every visitor downloaded the
 * terminal runtime and the benchmark runner before the sidebar could appear.
 *
 * The name is passed through so the chunk Vite emits, a stack frame and a network-panel line
 * all say which page it is, rather than an anonymous chunk.
 *
 * No `Suspense` is added here or above: with none anywhere, React holds the root's paint — the
 * shell included — until the reached page's chunk lands, so the entry stays small and only the
 * route the visitor asked for is fetched. A boundary per route would let the shell paint first
 * and leave the page's own area blank until it arrives.
 */
function lazyPage(load: () => Promise<Record<string, unknown>>, name: string): React.ComponentType {
  return lazy(async () => {
    const mod = await load();
    const picked = mod[name] ?? Object.values(mod).find((v) => typeof v === "function");
    if (typeof picked !== "function") {
      throw new Error("lazy page module has no component export: " + name);
    }
    return { default: picked as React.ComponentType };
  });
}

const LazyLoginPage = lazyPage(() => import("./pages/login"), "LoginPage");
const LazyTerminalPage = lazyPage(
  () => import("./features/terminal/terminal-page"),
  "TerminalPage",
);
const LazyWorkbenchAppPage = lazyPage(
  () => import("./features/workbenches/workbench-app-page"),
  "WorkbenchAppPage",
);
const LazyOrgIndexRedirect = lazyPage(
  () => import("./features/company/org-layout"),
  "OrgIndexRedirect",
);
const LazyOrgLayout = lazyPage(() => import("./features/company/org-layout"), "OrgLayout");
const LazyOverviewPage = lazyPage(() => import("./features/company/overview-page"), "OverviewPage");
const LazyOrgChartPage = lazyPage(
  () => import("./features/company/org-chart-page"),
  "OrgChartPage",
);
const LazyCalendarPage = lazyPage(() => import("./features/company/calendar-page"), "CalendarPage");
const LazyTicketsPage = lazyPage(() => import("./features/company/tickets-page"), "TicketsPage");
const LazyFinancePage = lazyPage(() => import("./features/company/finance-page"), "FinancePage");
const LazyHandbookPage = lazyPage(() => import("./features/company/handbook-page"), "HandbookPage");
const LazyChannelView = lazyPage(() => import("./features/company/channel-view"), "ChannelView");
/**
 * The renderers the manifest may name. A page is a module.json entry plus one line here;
 * a server-contributed page renders only when its `builtin` is in this registry.
 */
const BUILTIN_PAGES: Record<string, React.ComponentType> = {
  ChatPage: lazyPage(() => import("./features/chat/chat-page"), "ChatPage"),
  AgentsPage: lazyPage(() => import("./features/agents/agents-page"), "AgentsPage"),
  AgentSettingsPage: lazyPage(
    () => import("./features/agents/agent-settings-page"),
    "AgentSettingsPage",
  ),
  PluginsPage: lazyPage(() => import("./features/plugins/plugins-page"), "PluginsPage"),
  ModelsPage: lazyPage(() => import("./features/models/models-page"), "ModelsPage"),
  MachinesPage: lazyPage(() => import("./features/machines/machines-page"), "MachinesPage"),
  UsagePage: lazyPage(() => import("./features/usage/usage-page"), "UsagePage"),
  BenchmarkPage: lazyPage(() => import("./features/benchmark/benchmark-page"), "BenchmarkPage"),
  BenchmarkDetailPage: lazyPage(
    () => import("./features/benchmark/benchmark-detail-page"),
    "BenchmarkDetailPage",
  ),
};

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
 * WebSocket authenticates with the same session cookie.
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
  return <LazyLoginPage />;
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

function appRoutes() {
  return createRoutesFromElements(
    <Route element={<RootFrame />}>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        path="/terminal"
        element={
          <RequireAuthBare>
            <LazyTerminalPage />
          </RequireAuthBare>
        }
      />
      {/* One workbench's page as the whole app: outside the shell, like the terminal; the
          command palette it mounts is the way back. */}
      {[
        "/app/:projectId/:agentId/:workbenchId",
        "/app/:projectId/:agentId/:workbenchId/:tabKey",
      ].map((appPath) => (
        <Route
          key={appPath}
          path={appPath}
          element={
            <RequireAuthBare>
              <LazyWorkbenchAppPage />
            </RequireAuthBare>
          }
        />
      ))}
      <Route element={<RequireAuth />}>
        <Route index element={<Navigate to="/chat" replace />} />
        {/* Every page is a module.json entry (lib/pages.ts). Admin-only ones are refused
            server-side (403); the sidebar hides their row, so a member only ever reaches
            one by typing the URL. */}
        {PAGES.map((page) => (
          <Route key={page.id} path={page.path} element={renderPage(page)} />
        ))}
        {/* Company mode: /org resolves to an organization (or the empty landing), and an
            organization opens on its overview — the page that says what the whole
            organization is doing; its channels are the sidebar's own list beside it. Both
            fall back to /chat while company mode is unavailable (see OrgLayout). */}
        <Route path="/org" element={<LazyOrgIndexRedirect />} />
        <Route path="/org/:projectId/:orgId" element={<LazyOrgLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<LazyOverviewPage />} />
          <Route path="chart" element={<LazyOrgChartPage />} />
          <Route path="calendar" element={<LazyCalendarPage />} />
          <Route path="tickets" element={<LazyTicketsPage />} />
          <Route path="finance" element={<LazyFinancePage />} />
          <Route path="handbook" element={<LazyHandbookPage />} />
          <Route path="channels/:channelId" element={<LazyChannelView />} />
          <Route path="*" element={<Navigate to="overview" replace />} />
        </Route>
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

export function AppRouter({ initialPath }: { initialPath?: string } = {}) {
  const [router] = useState(() =>
    initialPath === undefined
      ? (browserRouter ??= createBrowserRouter(appRoutes()))
      : createMemoryRouter(appRoutes(), { initialEntries: [initialPath] }),
  );
  return <RouterProvider router={router} />;
}
