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
import { useEffect, useLayoutEffect, useState } from "react";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  RouterProvider,
  createBrowserRouter,
  createMemoryRouter,
  createRoutesFromElements,
  useParams,
  useRouteError,
} from "react-router";
import { PageFrame } from "@prismshadow/penguin-ui";
import { CrashNotice, setReportRoute } from "@prismshadow/penguin-ui";
import { releaseBootWallpaper } from "@prismshadow/penguin-ui/boot";
import { routePattern } from "./lib/route-pattern";
import { NavigationGuard } from "./lib/unsaved/navigation-guard";
import { useAuth } from "./state/auth";
import { useRuntimeLanguages } from "./features/chat/use-runtime-languages";
import { ProjectProvider } from "./state/project";
import { MachinesProvider } from "./state/machines";
import { SessionsProvider } from "./state/sessions";
import { CompanyProvider, useCompany } from "./state/company";
import { AppLayout } from "./components/layout/app-layout";
import { BootPending } from "./components/ui/boot-pending";
import { LoginPage } from "./pages/login";
import { ChatPage } from "./features/chat/chat-page";
import { AgentsPage } from "./features/agents/agents-page";
import { AgentSettingsPage } from "./features/agents/agent-settings-page";
import { PluginsPage } from "./features/plugins/plugins-page";
import { ModelsPage } from "./features/models/models-page";
import { UsagePage } from "./features/usage/usage-page";
import { BenchmarkPage } from "./features/benchmark/benchmark-page";
import { BenchmarkDetailPage } from "./features/benchmark/benchmark-detail-page";
import { TerminalPage } from "./features/terminal";
import { OrgIndexRedirect, OrgLayout, OrgPageSkeleton } from "./features/company/org-layout";
import { homePath, orgPagePath } from "./features/company/company-nav";
import { useOrgPagesState } from "./features/company/use-org-pages";
import { OverviewPage } from "./features/company/overview-page";
import { OrgChartPage } from "./features/company/org-chart-page";
import { CalendarPage } from "./features/company/calendar-page";
import { TicketsPage } from "./features/company/tickets-page";
import { FinancePage } from "./features/company/finance-page";
import { ChannelView } from "./features/company/channel-view";
import { HandbookPage } from "./features/company/handbook-page";
import { MachinesPage } from "./features/machines/machines-page";
import { MachinePortsPage } from "./features/ports/machine-ports-page";
import { DashboardPage } from "./features/dashboard/dashboard-page";
import { WorkbenchAppPage } from "./features/workbenches/workbench-app-page";
import { OrgProposalsPage } from "./features/proposals/proposals-page";
import { PAGES, orgPagesOf } from "./lib/pages";
import type { PageEntry } from "./lib/pages";

/**
 * The renderers the manifest may name. A page is a module.json entry plus one line here;
 * a server-contributed page renders only when its `builtin` is in this registry.
 */
const BUILTIN_PAGES: Record<string, React.ComponentType> = {
  ChatPage,
  AgentsPage,
  AgentSettingsPage,
  PluginsPage,
  ModelsPage,
  MachinesPage,
  MachinePortsPage,
  UsagePage,
  BenchmarkPage,
  BenchmarkDetailPage,
  DashboardPage,
  // Company-mode pages a plugin contributes (`nav: "org"`): mounted under the organization
  // layout, never at the root, so the company sidebar stays around them.
  OrgProposalsPage,
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

/** Apply an admin-only page's flag even when its URL is entered directly. */
function PageRoute({ page }: { page: PageEntry }) {
  const { user } = useAuth();
  if (page.admin && user?.isAdmin !== true) return <Navigate to="/" replace />;
  return renderPage(page);
}

/**
 * The company-mode pages a plugin contributes (`nav: "org"`). Their table arrives at runtime
 * (useOrgPagesState — GET /api/contributions), after the router was built, so they cannot be
 * children of the organization route the way its own pages are: the organization layout's one
 * wildcard child renders a second, relative route table over the table as it stands.
 *
 * A page it cannot find is only missing once the table has settled: a cold deep link is routed
 * before the contributions answer, so while they are on their way the child shows the page
 * skeleton instead of the overview — and the fallback is an absolute path, so an unknown child
 * can never append a segment to the address it did not match.
 *
 * Exported so the mounting can be stood up in a test of its own: the router's tree around it
 * needs a whole signed-in app.
 */
export function OrgContributedPages() {
  const { pages, status } = useOrgPagesState();
  const params = useParams<{ projectId: string; orgId: string }>();
  const overview = orgPagePath(params.projectId ?? "", params.orgId ?? "", "overview");
  // `error` settles the table too: it stays on the local manifest, which holds no such page.
  const settled = status === "ready" || status === "error";
  return (
    <Routes>
      {orgPagesOf(pages).map((page) => (
        <Route key={page.id} path={page.path} element={<PageRoute page={page} />} />
      ))}
      <Route
        path="*"
        element={
          settled ? (
            <Navigate to={overview} replace />
          ) : (
            // The page's own frame around the placeholder, so the content area keeps its
            // padding while the table is on its way instead of touching the window's edge.
            <PageFrame width="xl">
              <OrgPageSkeleton />
            </PageFrame>
          )
        }
      />
    </Routes>
  );
}

/** Route guard: shows the boot status while initializing, redirects to /login when not authenticated. */
function RequireAuth() {
  const { user } = useAuth();
  // Plugin-contributed grammars, adopted once for the signed-in tree (see the hook). Called
  // before the early returns, because a hook cannot be conditional; it fetches only once a user
  // is signed in.
  useRuntimeLanguages(user != null);
  if (user === undefined) return <BootPending />; // GET /api/me is still initializing
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
  if (user === undefined) return <BootPending />;
  if (user === null) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** When already logged in, visiting /login redirects to the shell's home (see HomeRedirect). */
function LoginRoute() {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

/**
 * `/` and every path nothing matches: the home of the mode the shell stands in (homePath) —
 * the organizations in company mode, the conversations in development mode. A sign-in and
 * the desktop shell's start both arrive at `/`.
 */
function HomeRedirect() {
  const { workMode } = useCompany();
  return <Navigate to={homePath(workMode)} replace />;
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
 * What the router shows in place of a route that crashed outside a page body's own boundary (the
 * shell, a guard): the crash notice over the whole window, with Reload and Report.
 */
function RouteCrash() {
  const error = useRouteError();
  return <CrashNotice error={error} className="h-dvh" />;
}

export function appRoutes() {
  return createRoutesFromElements(
    <Route element={<RootFrame />} errorElement={<RouteCrash />}>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        path="/terminal"
        element={
          <RequireAuthBare>
            <TerminalPage />
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
              <WorkbenchAppPage />
            </RequireAuthBare>
          }
        />
      ))}
      <Route element={<RequireAuth />}>
        <Route index element={<HomeRedirect />} />
        {/* Every page is a module.json entry (lib/pages.ts). Admin-only ones are guarded
            here as well as server-side (403); typing the URL cannot bypass the sidebar. */}
        {PAGES.map((page) => (
          <Route key={page.id} path={page.path} element={<PageRoute page={page} />} />
        ))}
        {/* Company mode: /org resolves to an organization (or the empty landing), and an
            organization opens on its overview — the page that says what the whole
            organization is doing; its channels are the sidebar's own list beside it. Both
            fall back to /chat while company mode is unavailable (see OrgLayout). */}
        <Route path="/org" element={<OrgIndexRedirect />} />
        <Route path="/org/:projectId/:orgId" element={<OrgLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="chart" element={<OrgChartPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="tickets" element={<TicketsPage />} />
          <Route path="finance" element={<FinancePage />} />
          <Route path="handbook" element={<HandbookPage />} />
          <Route path="channels/:channelId" element={<ChannelView />} />
          {/* The company-mode pages a plugin contributes, after the organization's own: their
              paths are relative to this layout, their nav row is the sidebar's
              (features/company/company-nav.ts ORG_PAGE_RENDERERS), and their table is the
              runtime one — so the wildcard child matches it as it arrives, and the same child
              is the absolute fallback for everything else. */}
          <Route path="*" element={<OrgContributedPages />} />
        </Route>
        {/* Settings and user management live in the settings dialog now (see
            SettingsDialog); their old routes fall through to the catch-all. */}
        <Route path="*" element={<HomeRedirect />} />
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
  // A problem report names the page by its route's pattern, never by the ids in the address.
  useEffect(() => {
    setReportRoute(() => routePattern(router.state.matches));
    return () => setReportRoute(null);
  }, [router]);
  return <RouterProvider router={router} />;
}
