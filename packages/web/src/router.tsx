/**
 * Router (react-router v7 declarative style): /login is public; all other routes go through
 * the RequireAuth guard (redirects to /login when not authenticated) and are wrapped in
 * ProjectProvider + AppLayout.
 */
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { useAuth } from "./state/auth";
import { ProjectProvider } from "./state/project";
import { SessionsProvider } from "./state/sessions";
import { AppLayout } from "./components/layout/app-layout";
import { LoginPage } from "./pages/login";
import { ChatPage } from "./features/chat/chat-page";
import { AgentsPage } from "./features/agents/agents-page";
import { AgentSettingsPage } from "./features/agents/agent-settings-page";
import { SkillsPage } from "./features/skills/skills-page";
import { ModelsPage } from "./features/models/models-page";
import { UsagePage } from "./features/usage/usage-page";
import { TracesPage } from "./features/traces/traces-page";
import { BenchmarkPage } from "./features/benchmark/benchmark-page";
import { AdminUsersPage } from "./features/admin/admin-users-page";
import { SettingsPage } from "./features/settings/settings-page";
import { TerminalPage } from "./features/terminal/terminal-page";

/** Route guard: shows blank while initializing, redirects to /login when not authenticated. */
function RequireAuth() {
  const { user } = useAuth();
  if (user === undefined) return null; // GET /api/me is still initializing
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
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/traces" element={<TracesPage />} />
          <Route path="/benchmark" element={<BenchmarkPage />} />
          {/* Bare /settings lands on the first sub-page the viewer may open; the page itself
              resolves that, since which sections exist depends on who is asking. */}
          <Route path="/settings/:section?" element={<SettingsPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
