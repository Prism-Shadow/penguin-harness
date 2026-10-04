/**
 * Pages removed by the server's contributions (web-app/page-table.ts `removedPagesOf`,
 * web-app/contributions.tsx `pageRemovalsOf` and `pageTableFor`).
 *
 * - A removal drops the page its key names and every page whose route lies under that page's
 *   path (`benchmark` takes `/benchmark/:benchmarkId`, not the other way round); a key naming no
 *   page does nothing; a page at "/" takes only itself; the pages answering HOME_PATHS stay —
 *   the home page (`*`) and the homes it leads to in both modes (company-nav.ts `homePath`).
 * - Only non-empty string keys are read; an answer without the list removes nothing.
 * - The table: removals apply to compiled and contributed pages alike, before the parent check,
 *   so a removed page's children go too; without an answer the table is the compiled one.
 * - Safe mode asks nothing, so nothing is removed.
 */
import { createElement, type ComponentType } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import type { ContributionsResponse } from "@prismshadow/penguin-server/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createContributionsStore,
  pageRemovalsOf,
  pageTableFor,
  WebAppPagesProvider,
  useWebAppPages,
  useWebAppPagesPending,
} from "../src/web-app/contributions";
import { webAppDeps, type WebAppDeps } from "../src/web-app/deps";

import { homePath } from "../src/features/company/company-nav";
import { HOME_PATHS, removedPagesOf, type WebAppPage } from "../src/web-app/page-table";

import { setSafeMode } from "../src/rescue/safe-mode";

vi.mock("../src/state/auth", () => ({ useAuth: () => ({ user: { userId: "bob" } }) }));
vi.mock("../src/api/endpoints", () => ({
  getContributions: vi.fn(() => new Promise<never>(() => undefined)),
}));

const Blank: ComponentType = () => null;

function page(key: string, path: string, extra: Partial<WebAppPage> = {}): WebAppPage {
  return {
    id: `${key}.page`,
    key,
    path,
    frame: "shell",
    nav: "main",
    admin: false,
    released: true,
    order: 0,
    Component: Blank,
    ...extra,
  };
}

/** The compiled pages that matter here, with the app's own paths. */
const COMPILED: WebAppPage[] = [
  page("chat", "/chat/:sessionId?", { order: 10 }),
  page("agents", "/agents", { order: 20 }),
  page("agent-settings", "/agents/:agentId", { nav: "none", order: 21 }),
  page("plugins", "/plugins", { order: 40 }),
  page("plugin-detail", "/plugins/registry/*", { nav: "none", order: 41 }),
  page("benchmark", "/benchmark", { order: 70 }),
  page("benchmark-detail", "/benchmark/:benchmarkId", { nav: "none", order: 71 }),
  page("workflow-app", "/app/:projectId/:agentId/:workflowId", { frame: "bare", order: 110 }),
  page("workflow-app-tab", "/app/:projectId/:agentId/:workflowId/:tabKey", {
    frame: "bare",
    order: 111,
  }),
];

const keysOf = (pages: readonly WebAppPage[]) => pages.map((p) => p.key);

/** No builtin page renderer: the contributed pages here are iframes. */
const NONE: ReadonlyMap<string, ComponentType> = new Map();

/** An answer as the server might send it: entries the app must check, malformed ones included. */
function answer(
  pages: readonly object[],
  pageRemovals?: readonly unknown[],
): ContributionsResponse {
  return {
    pages,
    fileRenderers: [],
    ...(pageRemovals === undefined ? {} : { pageRemovals }),
    agentTabs: [],
    sessionTabs: [],
  } as unknown as ContributionsResponse;
}

/** The validation plugins' contributions: a page under the Evaluation Center, and its removal. */
const HELLO = {
  id: "hello.page",
  from: "HelloPage",
  key: "example-hello",
  path: "/example-hello",
  nav: "main",
  admin: false,
  parent: "benchmark",
  renderer: { iframe: { src: "/hello.html", namespace: "hello" } },
};
const REMOVE_BENCHMARK = { id: "r", from: "NoEvaluationCenter", key: "benchmark" };

describe("removedPagesOf", () => {
  it("drops the named page and the routes under its path, not the pages above it", () => {
    expect(keysOf(removedPagesOf(COMPILED, ["benchmark"]))).toEqual([
      "chat",
      "agents",
      "agent-settings",
      "plugins",
      "plugin-detail",
      "workflow-app",
      "workflow-app-tab",
    ]);
    expect(keysOf(removedPagesOf(COMPILED, ["benchmark-detail"]))).toContain("benchmark");
    expect(keysOf(removedPagesOf(COMPILED, ["plugins"]))).not.toContain("plugin-detail");
    expect(keysOf(removedPagesOf(COMPILED, ["workflow-app"]))).not.toContain("workflow-app-tab");
    expect(keysOf(removedPagesOf(COMPILED, ["workflow-app-tab"]))).toContain("workflow-app");
  });

  it("compares whole segments: /agents does not take /agentsx", () => {
    const table = [...COMPILED, page("agentsx", "/agentsx")];
    expect(keysOf(removedPagesOf(table, ["agents"]))).toContain("agentsx");
  });

  it("returns the table as it is for no keys or keys naming no page", () => {
    expect(removedPagesOf(COMPILED, [])).toBe(COMPILED);
    expect(removedPagesOf(COMPILED, ["nowhere"])).toBe(COMPILED);
  });

  it("removes a page at / alone, not the whole table under it", () => {
    const table = [...COMPILED, page("root", "/")];
    expect(keysOf(removedPagesOf(table, ["root"]))).toEqual(keysOf(COMPILED));
  });

  it("keeps the page the catch-all leads to, however it is named", () => {
    expect(keysOf(removedPagesOf(COMPILED, ["chat"]))).toEqual(keysOf(COMPILED));
    // Kept by what it answers, not by its key: any page a home path would land on stays.
    const table = [...COMPILED, page("section", "/:section")];
    expect(keysOf(removedPagesOf(table, ["section"]))).toEqual(keysOf(table));
  });

  it("keeps the home page and the homes it leads to in either mode", () => {
    expect(HOME_PATHS).toEqual([homePath("dev"), homePath("company")]);
    const table = [
      ...COMPILED,
      page("org", "/org/*", { nav: "none", order: 120 }),
      page("home", "*", { nav: "none", order: 130 }),
    ];
    expect(keysOf(removedPagesOf(table, ["home", "org", "chat"]))).toEqual(keysOf(table));
    expect(keysOf(removedPagesOf(table, ["home", "benchmark"]))).toEqual(
      keysOf(table).filter((k) => !k.startsWith("benchmark")),
    );
  });
});

describe("pageRemovalsOf", () => {
  it("reads non-empty string keys in order and skips anything else", () => {
    const removals = [{ key: "a" }, null, { key: 7 }, { key: "" }, {}, "b", { key: "c" }];
    expect(pageRemovalsOf(answer([], removals))).toEqual(["a", "c"]);
  });

  it("is empty without an answer, and for a server that sends no list", () => {
    expect(pageRemovalsOf(null)).toEqual([]);
    expect(pageRemovalsOf(answer([]))).toEqual([]);
    expect(pageRemovalsOf(answer([], "benchmark" as unknown as unknown[]))).toEqual([]);
  });
});

describe("pageTableFor", () => {
  it("is the compiled table without an answer", () => {
    expect(pageTableFor(COMPILED, null, NONE)).toBe(COMPILED);
  });

  it("removes a compiled page with its children, contributed ones included", () => {
    const withHello = pageTableFor(COMPILED, answer([HELLO]), NONE);
    expect(keysOf(withHello)).toContain("example-hello");
    const removed = keysOf(pageTableFor(COMPILED, answer([HELLO], [REMOVE_BENCHMARK]), NONE));
    expect(removed).not.toContain("benchmark");
    expect(removed).not.toContain("benchmark-detail");
    expect(removed).not.toContain("example-hello");
    expect(removed).toContain("agents");
  });

  it("removes a contributed page by its key", () => {
    const table = pageTableFor(
      COMPILED,
      answer([HELLO], [{ id: "r", from: "M", key: "example-hello" }]),
      NONE,
    );
    expect(keysOf(table)).toEqual(keysOf(COMPILED));
  });

  it("removes nothing in a table that does not hold the key", () => {
    const table = pageTableFor(
      COMPILED,
      answer([], [{ id: "r", from: "M", key: "nowhere" }]),
      NONE,
    );
    expect(keysOf(table)).toEqual(keysOf(COMPILED));
  });
});

describe("safe mode", () => {
  afterEach(() => setSafeMode(false));

  it("asks nothing, so the removed page is still in the provider's table", () => {
    setSafeMode(true);
    function Probe() {
      const keys = keysOf(useWebAppPages()).join(",");
      return createElement("p", null, `${keys} pending=${String(useWebAppPagesPending())}`);
    }
    const Root = webAppDeps.provide(
      { pages: COMPILED, pageRenderers: NONE } as unknown as WebAppDeps,
      () => createElement(WebAppPagesProvider, null, createElement(Probe)),
    );
    expect(renderToStaticMarkup(createElement(Root))).toBe(
      `<p>${keysOf(COMPILED).join(",")} pending=false</p>`,
    );
  });

  it("a store told nobody is signed in never fetches, so it holds no removal", () => {
    const fetch = vi.fn(async () => answer([], [REMOVE_BENCHMARK]));
    const store = createContributionsStore(fetch);
    store.setUser(null);
    expect(fetch).not.toHaveBeenCalled();
    expect(pageTableFor(COMPILED, store.current().answer, NONE)).toBe(COMPILED);
  });
});
