// @vitest-environment jsdom
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../src/web-app/sidebar/sidebar";
import { sidebarDeps } from "../src/web-app/sidebar/deps";
import { sessionListDeps } from "../src/features/session-list/deps";
import { MainSessionListSection } from "../src/features/session-list/main-sidebar-fragments";
import { PagesContext } from "../src/lib/web-app-pages";
import { mount, unmountAll, type, run } from "./helpers/dom";
const fixture = vi.hoisted(() => ({
  current: false,
  empty: [],
  map: new Map(),
  project: { projectId: "p1", name: "Project", role: "owner" },
  badges: { software: null, softwareNote: null },
  company: { currentOrgKey: null, lastOrgKey: null },
}));
vi.mock("../src/state/auth", () => ({
  useAuth: () => ({ user: { userId: "u", isAdmin: false }, sessionVia: null }),
}));
vi.mock("../src/state/locale", () => ({ useLocale: () => ({ locale: "en" }) }));
vi.mock("../src/state/project", () => ({
  useProject: () => ({
    currentProject: fixture.project,
    agents: fixture.empty,
    setCurrentAgentId: vi.fn(),
  }),
  agentDisplayName: (a: { name: string }) => a.name,
}));
vi.mock("../src/state/sessions", () => ({
  useSessions: () => ({
    sessions: fixture.empty,
    byAgent: fixture.map,
    countsByAgent: fixture.map,
    workspaceCountsByAgent: fixture.map,
    workspaceLatestActiveByAgent: fixture.map,
    machineLabels: fixture.map,
    isLoadedFor: () => true,
    hasMoreFor: () => false,
    activityWatermarkFor: () => null,
    loadMoreFor: vi.fn(),
    loading: false,
    remove: vi.fn(),
    replace: vi.fn(),
  }),
}));
vi.mock("../src/lib/company-context", () => ({ useCompany: () => fixture.company }));
vi.mock("../src/lib/use-update-badges", () => ({
  useUpdateBadges: () => fixture.badges,
  navNoteFor: () => null,
}));
vi.mock("../src/features/schedules", () => ({
  useProjectSchedules: () => ({ items: null }),
  pendingScheduleSessions: () => new Set(),
}));
vi.mock("../src/features/workspace", () => ({ WorkspaceSelect: () => null }));
vi.mock("../src/web-app/sidebar/user-menu", () => ({ UserMenu: () => null }));
const rows = { sessionEntries: [], marks: [], workspaceEntries: [] };
const Full = sessionListDeps.provide(
  { drafts: {} as never, rows, useRowMarks: () => () => ({}) },
  MainSessionListSection,
);
const modes = [
  {
    id: "company.mode",
    key: "company",
    title: "Company",
    titleZh: "公司",
    icon: "building",
    order: 10,
    mode: {
      listName: () => "Channels",
      useMode: () => ({
        available: true,
        current: fixture.current,
        select: () => null,
        navItems: [],
      }),
    },
  },
];
const Column = sidebarDeps.provide(
  {
    drafts: {} as never,
    modes,
    badges: [],
    sections: [{ id: "sessions", mode: "dev", place: "body", order: 30, section: { Full } }],
    useModes: () => modes.map((m) => m.mode.useMode()),
    useNotes: () => new Map(),
  },
  Sidebar,
);
function view() {
  return h(
    MemoryRouter,
    null,
    h(
      PagesContext.Provider,
      { value: { pages: [], pending: false, quickStarts: [], refresh: async () => null } },
      h(Column, { initialSearchOpen: true }),
    ),
  );
}
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
});
afterEach(async () => {
  await unmountAll();
  fixture.current = false;
  localStorage.clear();
});
describe("the actual decomposed sidebar", () => {
  it("mounts the one live controller and list contribution and keeps search state across mode changes", async () => {
    const root = await mount(view());
    const input = document.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    await type(input, "remember this query");
    fixture.current = true;
    await root.rerender(view());
    fixture.current = false;
    await root.rerender(view());
    expect((document.querySelector("input") as HTMLInputElement).value).toBe("remember this query");
  });
});
