import { mainPanelDefinition as mainAgents } from "../src/features/chat/main-agents-panel";
import { mainPanelDefinition as mainMemory } from "../src/features/chat/main-memory-panel";
import { mainPanelDefinition as mainWorkspace } from "../src/features/workspace/main-dock-panel";
import { mainPanelDefinition as mainTrace } from "../src/features/traces/main-dock-panel";
import { mainPanelDefinition as mainMessaging } from "../src/features/messaging/main-dock-panel";
import { mainPanelDefinition as mainSchedules } from "../src/features/schedules/main-dock-panel";
import { mainPanelDefinition as mainBrowser } from "../src/features/builtin-browser/main-dock-panel";
import { dockPanelDefinition, type DockPanelDefinition } from "../src/features/dock/panel-registry";

const OrgProposalsPage = () => null;
/**
 * The booted page table: the real composition root (web-root.ts) boots under vitest, and the
 * shell receives every page the modules contributed.
 *
 * - bootWeb() boots the tree and hands back WebApp's root component.
 * - Every page has a unique id, key and path, and the component its module bound.
 * - Terminal and the workflow app pages mount outside the shell; everything else inside it.
 * - The main nav is Agents, Models, Plugins, Machines, Usage, Benchmark in that order, all
 *   released, Machines alone admin-only, and every page names its nav title in both languages
 *   (the words the nav dictionary held) and a glyph in the icon registry.
 * - A member's nav drops admin-only pages and adds nothing the admin lacks.
 * - The chat page is the chat page; the dashboard and one machine's ports are
 *   pages of their own modules, off the nav, the ports page admin-only.
 * - Home (`/` and every unmatched path) is company mode's page, since it depends on the mode.
 * - The proposals page is the one page renderer, under the name its plugin's page names.
 * - Folded into the booted table, a contributed page whose key the app owns is ignored, and the
 *   company-mode proposals page is drawn by the proposals page, inside company mode and from
 *   the root alike.
 * - The shell receives company's provider and the update badges' owner for the signed-in
 *   session, the six layers in their mount order, and the user event handlers of company, the
 *   built-in browser and schedules in their dispatch order.
 * - The sidebar receives the Project switcher and the session list for development mode,
 *   company's mode with its switcher, channels, roadmaps and desks, the to-do dots and the
 *   balance on their anchors, and company's unread count on the contributed proposals page's row
 *   (anchored by the renderer's name);
 *   the session list receives the messaging binding, the scheduled mark and the dock's "Browse
 *   files".
 * - The dock receives the eight panels in their menu order — agents and memory from chat, the
 *   files from workspace, the trace, messaging, schedules, the built-in browser and the ports from
 *   theirs — with the names the dictionary held and a glyph in the icon registry, which the dock
 *   module registers in its panel registry at boot.
 * - The chat page receives the workflow tab strip beside the conversation.
 */
import type { ComponentType, ReactElement } from "react";
import {
  bootModules,
  moduleDefOf,
  type ClassCtx,
  type Contributed,
  type IfaceTable,
  type ManifestTable,
  type ModuleClass,
} from "@prismshadow/penguin-core/kernel";

import { beforeAll, describe, expect, it } from "vitest";
import table from "../src/ifaces.json";
import { bootWeb, WebRoot } from "../src/web-root";
import { WebAppModule } from "../src/web-app/module";
import { navPagesOf, type WebAppPage } from "../src/web-app";

import { pageTableOf } from "../src/web-app/page-table";
import { contributedPagesOf } from "../src/web-app/contributions";
import { orgPagesOf } from "../src/features/company/use-org-pages";
import { navKeysFor } from "../src/web-app/sidebar/nav-state";
import { SidebarModule } from "../src/web-app/sidebar/module";
import { badgesOf, marksFor, modesOf, sectionsIn, sectionsOf } from "../src/web-app/sidebar/modes";
import { SessionListModule } from "../src/features/session-list/module";
import { rowExtensionsOf, type RowExtensions } from "../src/features/session-list/row-actions";

import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { glyphOf } from "../src/lib/nav-icons";
import { AgentsPage } from "../src/features/agents/agents-page";
import { TerminalPage, TerminalDockRuntime } from "../src/features/terminal";
import { OrgRoutes } from "../src/features/company/org-routes";
import { HomeRedirect } from "../src/features/company/home-redirect";
import { ChatPage } from "../src/features/chat/chat-page";
import { CompanyProvider, companyUserEvents } from "../src/features/company/company-state";
import { ShortcutRuntime } from "../src/features/settings/shortcut-runtime";
import { BuiltinBrowserLayer } from "../src/features/builtin-browser/browser-layer";
import { builtinBrowserUserEvents } from "../src/features/builtin-browser/browser-events";
import { AppPalette } from "../src/features/palette/app-palette";
import { scheduleUserEvents } from "../src/features/schedules/schedule-store";
import { SettingsLayer } from "../src/features/settings/settings-layer";
import { DockScope } from "../src/features/dock/dock-scope";
import { PinnedBalanceBadge } from "../src/features/models/group-balance";
import { ProjectSwitcher } from "../src/features/projects/project-switcher";
import {
  companyChannels,
  companyDesks,
  companyMode,
  companySwitcher,
} from "../src/features/company/sidebar-mode";
import { messagingRowAction } from "../src/features/messaging/session-row-action";
import { scheduledRowMark } from "../src/features/schedules/session-row-mark";
import { browseFilesAction } from "../src/features/dock/browse-files";
import type { UserEventHandler } from "../src/state/user-events";
import { DockModule } from "../src/features/dock/module";
import { ChatModule } from "../src/features/chat/module";
import { sessionTabsOf } from "../src/features/chat/deps";
import { WorkbenchSessionTab } from "../src/features/workbenches/session-tab";

let pages: readonly WebAppPage[] = [];
let pageRenderers: readonly Contributed[] = [];
let sessionProviders: readonly Contributed[] = [];
let layers: readonly Contributed[] = [];
let userEvents: readonly UserEventHandler[] = [];
let sidebarSlots: Readonly<Record<string, readonly Contributed[]>> = {};
let rows: RowExtensions | null = null;
let sessionListSection: unknown = null;
let dockPanels: readonly Contributed[] = [];
let sessionTabs: readonly Contributed[] = [];

/** A slot's code halves in the order the shell mounts them. */
const codeByOrder = (list: readonly Contributed[]): unknown[] =>
  [...list].sort((a, b) => (a.data.order as number) - (b.data.order as number)).map((c) => c.code);

/**
 * Boots the real tree as bootWeb does, with the shell, the sidebar, the session list, the dock and
 * the chat page standing in by doubles that keep their slots' contributions instead of binding
 * them into components (which need a browser to render).
 */
beforeAll(async () => {
  const webApp = Object.assign(new WebAppModule(), {
    setup({ contributions }: ClassCtx) {
      pages = pageTableOf(contributions.pages ?? []);
      pageRenderers = contributions.pageRenderers ?? [];
      sessionProviders = contributions.sessionProviders ?? [];
      layers = contributions.layers ?? [];
      userEvents = webApp.userEventHandlers.all();
      webApp.webApp = { Root: () => null };
    },
  });
  const sidebar = Object.assign(new SidebarModule(), {
    setup({ contributions }: ClassCtx) {
      sidebarSlots = contributions;
      sidebar.sidebar = {
        Column: () => null,
        Rail: () => null,
        useColumnState: () => ({ inDefaultMode: true, listName: "", menuNote: null }),
      };
    },
  });
  const sessionList = Object.assign(new SessionListModule(), {
    setup({ contributions }: ClassCtx) {
      rows = rowExtensionsOf(contributions.rowActions ?? []);
      sessionList.section = { Full: () => null };
      sessionList.sessionList = {};
      sessionListSection = sessionList.section;
    },
  });
  const dock = Object.assign(new DockModule(), {
    setup({ contributions }: ClassCtx) {
      dockPanels = contributions.panels ?? [];
      DockModule.prototype.setup.call(dock, { contributions } as ClassCtx);
    },
  });
  const chat = Object.assign(new ChatModule(), {
    setup(ctx: ClassCtx) {
      sessionTabs = ctx.contributions.sessionTabs ?? [];
      ChatModule.prototype.setup.call(chat, ctx);
    },
  });
  await bootModules(
    moduleDefOf(WebRoot, {
      manifests: table.modules as unknown as ManifestTable,
      instances: new Map<ModuleClass, object>([
        [WebAppModule, webApp],
        [SidebarModule, sidebar],
        [SessionListModule, sessionList],
        [DockModule, dock],
        [ChatModule, chat],
      ]),
    }),
    {
      ifaces: table as unknown as IfaceTable,
      resources: { register: () => () => {}, claim: () => undefined },
    },
  );
});

describe("the booted page table", () => {
  it("bootWeb() hands back WebApp's root component", async () => {
    expect(typeof (await bootWeb())).toBe("function");
  });

  it("every page has a unique id, key and path, and its bound component", () => {
    expect(pages.length).toBeGreaterThan(0);
    expect(new Set(pages.map((p) => p.id)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.key)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.path)).size).toBe(pages.length);
    for (const page of pages) expect(typeof page.Component).toBe("function");
    expect(pages.find((p) => p.key === "agents")?.Component).toBe(AgentsPage);
    expect(pages.find((p) => p.key === "terminal")?.Component).toBe(TerminalPage);
    expect(pages.find((p) => p.path === "/org/*")?.Component).toBe(OrgRoutes);
  });

  it("mounts the terminal and the workflow app pages outside the shell", () => {
    expect(pages.filter((p) => p.frame === "bare").map((p) => p.path)).toEqual([
      "/terminal",
      "/app/:projectId/:agentId/:workbenchId",
      "/app/:projectId/:agentId/:workbenchId/:tabKey",
    ]);
  });

  it("keeps the main nav's order, release and admin flags", () => {
    const nav = navPagesOf(pages);
    expect(nav.map(({ key, admin, released }) => ({ key, admin, released }))).toEqual([
      { key: "agents", admin: false, released: true },
      { key: "models", admin: false, released: true },
      { key: "plugins", admin: false, released: true },
      { key: "machines", admin: true, released: true },
      { key: "usage", admin: false, released: true },
      { key: "benchmark", admin: false, released: true },
    ]);
  });

  it("names every nav page's title in both languages and its glyph", () => {
    const nav = navPagesOf(pages);
    expect(nav.map(({ key, title, titleZh, icon }) => ({ key, title, titleZh, icon }))).toEqual([
      { key: "agents", title: en.nav.agents, titleZh: zh.nav.agents, icon: "robot" },
      { key: "models", title: "Models", titleZh: "模型库", icon: "chip" },
      { key: "plugins", title: en.nav.plugins, titleZh: zh.nav.plugins, icon: "puzzle" },
      {
        key: "machines",
        title: en.machines.pageTitle,
        titleZh: zh.machines.pageTitle,
        icon: "server",
      },
      { key: "usage", title: en.nav.usage, titleZh: zh.nav.usage, icon: "barChart" },
      { key: "benchmark", title: "Evaluation Center", titleZh: "评估中心", icon: "trophy" },
    ]);
    for (const page of nav) expect(glyphOf(page.icon)).not.toBe("");
  });

  it("the nav a member sees drops admin-only pages", () => {
    const nav = navPagesOf(pages);
    const admin = navKeysFor(nav, true);
    const member = navKeysFor(nav, false);
    expect(admin).toContain("machines");
    expect(member).not.toContain("machines");
    expect(member.every((key) => admin.includes(key))).toBe(true);
  });

  it("routes chat, the dashboard and one machine's ports through their modules", () => {
    const page = (key: string) => pages.find((p) => p.key === key);
    // Chat binds its page under its deps' provider (lib/module-deps.tsx), wrapping the route.
    const chatRoot = page("chat")?.Component as
      ((props: object) => ReactElement<{ children: ReactElement }>) | undefined;
    expect(chatRoot?.({}).props.children.type).toBe(ChatPage);
  });

  it("leads home through company mode's page, inside the shell and off the nav", () => {
    expect(pages.find((p) => p.key === "home")).toMatchObject({
      path: "*",
      frame: "shell",
      nav: "none",
      admin: false,
      Component: HomeRedirect,
    });
  });
  it("keeps builtin renderer registration pluggable without restoring a retired owner", () => {
    expect(pageRenderers).toEqual([]);
  });

  it("folds a contributed page in only under a key the app does not own, drawn by its module's renderer", () => {
    const remote = [
      {
        id: "x.agents",
        from: "X",
        key: "agents",
        path: "/elsewhere",
        renderer: { iframe: { src: "/x", namespace: "x" } },
      },
      {
        id: "proposals.page",
        from: "CompanyProposals",
        key: "org-proposals",
        path: "proposals/:number?",
        nav: "org",
        renderer: { builtin: "OrgProposalsPage" },
      },
    ];
    const renderers = new Map(
      pageRenderers.map((c) => [c.data.name as string, c.code as ComponentType]),
    );
    const answer = {
      pages: remote,
      agentTabs: [],
      sessionTabs: [],
      quickStarts: [],
      sessionSurfaces: [],
    };
    renderers.set("OrgProposalsPage", OrgProposalsPage);
    const merged = contributedPagesOf(pages, answer, renderers);
    expect(merged.slice(0, pages.length)).toEqual(pages);
    // One table: the router mounts the page from the root, company mode under the organization.
    expect(merged.slice(pages.length)).toMatchObject([
      { key: "org-proposals", path: "proposals/:number?", frame: "shell", nav: "org" },
    ]);
    expect(orgPagesOf(merged).map((p) => [p.key, p.Component])).toEqual([
      ["org-proposals", OrgProposalsPage],
    ]);
    expect(contributedPagesOf(pages, answer, new Map())).toEqual(pages);
  });
});

describe("the booted shell slots", () => {
  it("keeps company and the main eager badges owner mounted once", () => {
    const codes = codeByOrder(sessionProviders);
    expect(codes[0]).toBe(CompanyProvider);
    expect(codes).toHaveLength(2);
    expect(new Set(codes).size).toBe(2);
  });

  it("mounts the six layers in their order, the dock's scope last", () => {
    expect(codeByOrder(layers)).toEqual([
      TerminalDockRuntime,
      ShortcutRuntime,
      SettingsLayer,
      BuiltinBrowserLayer,
      AppPalette,
      DockScope,
    ]);
  });

  it("dispatches user events to company, the built-in browser and schedules, in that order", () => {
    expect(userEvents).toEqual([companyUserEvents, builtinBrowserUserEvents, scheduleUserEvents]);
  });
});

describe("the booted sidebar slots", () => {
  it("development mode: the Project switcher above, the session list below", () => {
    const sections = sectionsOf(sidebarSlots.sections ?? []);
    expect(sectionsIn(sections, "dev", "header").map((s) => s.section.Full)).toEqual([
      ProjectSwitcher,
    ]);
    expect(sectionsIn(sections, "dev", "body").map((s) => s.section)).toEqual([sessionListSection]);
  });

  it("company contributes its mode, its switcher, its channels, its roadmaps and its desks", () => {
    const sections = sectionsOf(sidebarSlots.sections ?? []);
    expect(modesOf(sidebarSlots.modes ?? []).map(({ key, mode }) => ({ key, mode }))).toEqual([
      { key: "company", mode: companyMode },
    ]);
    expect(sectionsIn(sections, "company", "header").map((s) => s.section)).toEqual([
      companySwitcher,
    ]);
    expect(sectionsIn(sections, "company", "body").map((s) => s.section)).toEqual([
      companyChannels,
      companyDesks,
    ]);
  });
  it("binds main badge hooks and balance without restoring the retired todos provider", () => {
    const badges = badgesOf(sidebarSlots.navBadges ?? []);
    for (const anchor of ["agents", "models", "plugins", "usage", "menu", "account"]) {
      const on = badges.filter((b) => b.anchor === anchor && typeof b.badge.useNote === "function");
      expect(on).toHaveLength(1);
      expect(typeof on[0]!.badge.useNote).toBe("function");
    }
    expect(marksFor(badges, "account").map((m) => m.Mark)).toEqual([PinnedBalanceBadge]);
  });
  it("does not register a retired proposal badge without its renderer owner", () => {
    expect(
      badgesOf(sidebarSlots.navBadges ?? []).filter((b) => b.anchor === "OrgProposalsPage"),
    ).toEqual([]);
  });

  it("gives the session list the binding entry, the two marks and Browse files", () => {
    expect(rows?.sessionEntries).toEqual([messagingRowAction.sessionEntry]);
    expect(rows?.marks).toEqual([messagingRowAction.sessionMark, scheduledRowMark.sessionMark]);
    expect(rows?.workspaceEntries).toEqual([browseFilesAction.workspaceEntry]);
  });
});

describe("the booted dock slot", () => {
  it("registers the seven main panel definitions from their owners without a retired ports panel", () => {
    const definitions = dockPanels
      .flatMap(
        (c) => (c.code as { mainDefinitions: readonly DockPanelDefinition[] }).mainDefinitions,
      )
      .sort((a, b) => a.order - b.order);
    const expected = [
      mainAgents,
      mainWorkspace,
      mainMemory,
      mainTrace,
      mainMessaging,
      mainSchedules,
      mainBrowser,
    ];
    expect(definitions).toEqual(expected);
    expect(definitions.map((d) => d.id)).toEqual([
      "agents",
      "workspace",
      "memory",
      "trace",
      "messaging",
      "schedules",
      "builtin-browser",
    ]);
    for (const definition of expected) {
      expect(dockPanelDefinition(definition.id)).toBe(definition);
      expect(typeof definition.Body).toBe("function");
      expect(definition.glyph).not.toBe("");
      expect(definition.label()).not.toBe("");
    }
    expect(Object.fromEntries(dockPanels.map((c) => [c.data.kind as string, c.from]))).toEqual({
      agents: "ChatModule",
      memory: "ChatModule",
      workspace: "WorkspaceModule",
      trace: "TracesModule",
      messaging: "MessagingModule",
      schedules: "SchedulesModule",
      "builtin-browser": "BuiltinBrowserModule",
    });
    expect(dockPanelDefinition("ports")).toBeUndefined();
  });
});

describe("the booted chat slot", () => {
  it("the chat page receives the workflow tab strip", () => {
    expect(sessionTabsOf(sessionTabs).map(({ Tab }) => Tab)).toEqual([WorkbenchSessionTab]);
    expect(sessionTabs.map((c) => c.from)).toEqual(["WorkbenchesModule"]);
  });
});
