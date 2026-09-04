/**
 * Router (react-router v7 declarative style): /login is public; all other routes go through
 * the RequireAuth guard (redirects to /login when not authenticated) and are wrapped in
 * ProjectProvider + AppLayout.
 */
import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { useAuth } from "./state/auth";
import { loadContributions, resetContributions, useContributions } from "./lib/contributions";
import { ProjectProvider } from "./state/project";
import { SessionsProvider } from "./state/sessions";
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
import { MachinesPage } from "./features/machines/machines-page";
import { PAGES, mergePages } from "./lib/pages";
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
  UsagePage,
  BenchmarkPage,
};

const BUILTIN_RENDERERS: ReadonlySet<string> = new Set(Object.keys(BUILTIN_PAGES));

/**
 * The pages this build mounts: the local manifest plus what the server contributed
 * (lib/contributions.ts), for the renderers the registry above carries.
 */
function usePages(): readonly PageEntry[] {
  const contributed = useContributions();
  return contributed.pages.length === 0
    ? PAGES
    : mergePages(PAGES, contributed.pages, BUILTIN_RENDERERS);
}

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
  // Contributions are per sign-in: an admin may see pages a member does not, and a push
  // between two sign-ins may have added some.
  useEffect(() => {
    if (user) void loadContributions(user.userId);
    else if (user === null) resetContributions();
  }, [user]);
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
  const pages = usePages();
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
          {/* Every page is a module.json entry (lib/pages.ts), or one the server contributed
              (lib/contributions.ts) for a renderer this build has. Admin-only ones are refused
              server-side (403); the sidebar hides their row, so a member only ever reaches
              one by typing the URL. */}
          {pages.map((page) => (
            <Route key={page.id} path={page.path} element={renderPage(page)} />
          ))}
          {/* System settings and user management live in the settings dialog now (see
              SettingsDialog); their old routes fall through to the catch-all. */}
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
