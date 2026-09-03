/**
 * Router (react-router v7 declarative style): /login is public; all other routes go through
 * the RequireAuth guard (redirects to /login when not authenticated) and are wrapped in
 * ProjectProvider + AppLayout.
 */
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { useAuth } from "./state/auth";
import { ProjectProvider } from "./state/project";
import { SessionsProvider } from "./state/sessions";
import { CompanyProvider } from "./state/company";
import { AppLayout } from "./components/layout/app-layout";
import { LoginPage } from "./pages/login";
import { ChatPage } from "./features/chat/chat-page";
import { AgentsPage } from "./features/agents/agents-page";
import { AgentSettingsPage } from "./features/agents/agent-settings-page";
import { PluginsPage } from "./features/plugins/plugins-page";
import { ModelsPage } from "./features/models/models-page";
import { UsagePage } from "./features/usage/usage-page";
import { BenchmarkPage } from "./features/benchmark/benchmark-page";
import { TerminalPage } from "./features/terminal/terminal-page";
import { OrgIndexRedirect, OrgLayout } from "./features/company/org-layout";
import { OverviewPage } from "./features/company/overview-page";
import { OrgChartPage } from "./features/company/org-chart-page";
import { CalendarPage } from "./features/company/calendar-page";
import { TicketsPage } from "./features/company/tickets-page";
import { FinancePage } from "./features/company/finance-page";
import { ChannelView } from "./features/company/channel-view";
import { HandbookPage } from "./features/company/handbook-page";
import { DEFAULT_CHANNEL_ID } from "./features/company/channel-list";

/** Route guard: shows blank while initializing, redirects to /login when not authenticated. */
function RequireAuth() {
  const { user } = useAuth();
  if (user === undefined) return null; // GET /api/me is still initializing
  if (user === null) return <Navigate to="/login" replace />;
  return (
    <ProjectProvider>
      <SessionsProvider>
        <CompanyProvider>
          <AppLayout />
        </CompanyProvider>
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
          element={
            <RequireAuthBare>
              <TerminalPage />
            </RequireAuthBare>
          }
        />
        <Route element={<RequireAuth />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="/chat/:sessionId?" element={<ChatPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:agentId" element={<AgentSettingsPage />} />
          <Route path="/plugins" element={<PluginsPage />} />
          <Route path="/models" element={<ModelsPage />} />
          {/* Admin-only server-side (403 otherwise); the sidebar hides the row for
              everyone else, so a member only ever reaches this by typing the URL. */}
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/benchmark" element={<BenchmarkPage />} />
          {/* Company mode: /org resolves to an organization (or the empty landing), and an
              organization opens on its all-hands channel — channels are the mode's home
              surface, its pages hang beside them. Both fall back to /chat while company mode
              is unavailable (see OrgLayout). */}
          <Route path="/org" element={<OrgIndexRedirect />} />
          <Route path="/org/:projectId/:orgId" element={<OrgLayout />}>
            <Route index element={<Navigate to={`channels/${DEFAULT_CHANNEL_ID}`} replace />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="chart" element={<OrgChartPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="handbook" element={<HandbookPage />} />
            <Route path="channels/:channelId" element={<ChannelView />} />
            <Route path="*" element={<Navigate to={`channels/${DEFAULT_CHANNEL_ID}`} replace />} />
          </Route>
          {/* System settings and user management live in the settings dialog now (see
              SettingsDialog); their old routes fall through to the catch-all. */}
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
