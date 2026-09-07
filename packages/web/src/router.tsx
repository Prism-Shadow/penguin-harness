/**
 * Router (react-router v7 declarative style): /login is public; all other routes go through
 * the RequireAuth guard (redirects to /login when not authenticated) and are wrapped in
 * ProjectProvider + AppLayout.
 *
 * Every page but the chat is a lazy chunk. The chat is what a boot lands on, so it stays in
 * the entry; the rest — agents, plugins, models, usage, benchmark, the terminal — is fetched
 * the first time it is opened, and until then costs a phone nothing to parse. The fallback
 * while a page chunk loads is nothing at all, inside the layout: the sidebar stays, the
 * content area is blank for the one round trip, which is the same thing the page itself
 * shows while its first request is in flight.
 */
import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { useAuth } from "./state/auth";
import { ProjectProvider } from "./state/project";
import { SessionsProvider } from "./state/sessions";
import { AppLayout } from "./components/layout/app-layout";
import { BootSkeleton } from "./components/layout/boot-skeleton";
import { LoginPage } from "./pages/login";
import { ChatPage } from "./features/chat/chat-page";

const AgentsPage = lazy(() =>
  import("./features/agents/agents-page").then((m) => ({ default: m.AgentsPage })),
);
const AgentSettingsPage = lazy(() =>
  import("./features/agents/agent-settings-page").then((m) => ({
    default: m.AgentSettingsPage,
  })),
);
const PluginsPage = lazy(() =>
  import("./features/plugins/plugins-page").then((m) => ({ default: m.PluginsPage })),
);
const ModelsPage = lazy(() =>
  import("./features/models/models-page").then((m) => ({ default: m.ModelsPage })),
);
const UsagePage = lazy(() =>
  import("./features/usage/usage-page").then((m) => ({ default: m.UsagePage })),
);
const BenchmarkPage = lazy(() =>
  import("./features/benchmark/benchmark-page").then((m) => ({ default: m.BenchmarkPage })),
);
const TerminalPage = lazy(() =>
  import("./features/terminal/terminal-page").then((m) => ({ default: m.TerminalPage })),
);

/** A lazy page inside the layout: blank content area until its chunk is here. */
function page(element: React.ReactNode) {
  return <Suspense fallback={null}>{element}</Suspense>;
}

/**
 * Route guard: shows the app's empty frame while initializing (the same frame index.html
 * painted before the bundle arrived, so nothing flashes), redirects to /login when not
 * authenticated.
 */
function RequireAuth() {
  const { user } = useAuth();
  if (user === undefined) return <BootSkeleton />; // GET /api/me is still initializing
  if (user === null) return <Navigate to="/login" replace />;
  return (
    <ProjectProvider>
      <SessionsProvider>
        <AppLayout />
      </SessionsProvider>
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
  return <LoginPage />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route
          path="/terminal"
          element={<RequireAuthBare>{page(<TerminalPage />)}</RequireAuthBare>}
        />
        <Route element={<RequireAuth />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="/chat/:sessionId?" element={<ChatPage />} />
          <Route path="/agents" element={page(<AgentsPage />)} />
          <Route path="/agents/:agentId" element={page(<AgentSettingsPage />)} />
          <Route path="/plugins" element={page(<PluginsPage />)} />
          <Route path="/models" element={page(<ModelsPage />)} />
          {/* Admin-only server-side (403 otherwise); the sidebar hides the row for
              everyone else, so a member only ever reaches this by typing the URL. */}
          <Route path="/usage" element={page(<UsagePage />)} />
          <Route path="/benchmark" element={page(<BenchmarkPage />)} />
          {/* System settings and user management live in the settings dialog now (see
              SettingsDialog); their old routes fall through to the catch-all. */}
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
