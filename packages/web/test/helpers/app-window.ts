/**
 * The app window as the Web App lays it out (web-app/app-layout.tsx), mounted on the fake
 * server: the real sidebar column and rail with no contributed section or mode, and a chat
 * module that opens no draft. For the suites whose behaviour is the window's own chrome: the
 * desktop band, the sidebar's fold and width, the phone's drawer.
 */
import { createElement as h } from "react";
import type { ChatDrafts } from "@prismshadow/penguin-library-session/web/chat";
import { CompanyProvider } from "../../src/features/company/company-state";
import { PagesContext } from "../../src/lib/web-app-pages";
import { BackgroundProvider } from "../../src/state/background";
import { ThemeProvider } from "../../src/state/theme";
import { AppLayout } from "../../src/web-app/app-layout";
import { webAppDeps } from "../../src/web-app/deps";
import { sidebarDeps, useColumnStateOf, type SidebarDeps } from "../../src/web-app/sidebar/deps";
import { CollapsedRail } from "../../src/web-app/sidebar/rail";
import { Sidebar } from "../../src/web-app/sidebar/sidebar";
import { agentServer, mountAgentApp } from "./agent-app";

const drafts: ChatDrafts = {
  newChatId: "new",
  useParked: () => [],
  removeParked: () => undefined,
  forgetSession: () => undefined,
  prepareNewChat: () => undefined,
  useNewChat: () => () => undefined,
};
const sidebarWith: SidebarDeps = {
  sections: [],
  modes: [],
  badges: [],
  useModes: () => [],
  useNotes: () => new Map(),
  drafts,
};
const Layout = webAppDeps.provide(
  {
    pages: [],
    pageRenderers: new Map(),
    sessionProviders: [],
    layers: [],
    userEvents: [],
    sidebar: {
      Column: sidebarDeps.provide(sidebarWith, Sidebar),
      Rail: sidebarDeps.provide(sidebarWith, CollapsedRail),
      useColumnState: () => useColumnStateOf(sidebarWith),
    },
    drafts,
  },
  AppLayout,
);
const pages = { pages: [], pending: false, quickStarts: [], refresh: async () => null };

/** Mounts the app window at `/home`; resolves to the router, for reading where it went. */
export async function mountAppWindow() {
  agentServer();
  return mountAgentApp(
    h(
      PagesContext.Provider,
      { value: pages },
      h(ThemeProvider, null, h(BackgroundProvider, null, h(CompanyProvider, null, h(Layout)))),
    ),
    {
      route: "/home",
      at: "/home",
    },
  );
}
