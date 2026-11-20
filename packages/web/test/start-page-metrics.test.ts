/** @vitest-environment jsdom */
/**
 * The counts server modules contribute to the start page (`StartPageModule.metrics`, delivered in
 * `GET /api/contributions` as `startMetrics`; lib/start-metrics.ts, features/chat/start-dashboard.tsx).
 *
 * - The answer's counts are read as the server might send them: an entry with no id, no title or
 *   no finite value is skipped, a repeated id keeps the first, and they come in their order. An
 *   answer without the list (an older server, safe mode's none) has no counts.
 * - The start page draws them after its own three, each with its name in the reader's language and
 *   its number. One naming a system app that opens in the App Center's window opens that window;
 *   one naming a system app of the Web App's own opens its page; one naming no app the viewer has
 *   opens nothing.
 */
import { createElement as h, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ContributionsResponse } from "@prismshadow/penguin-server/api";
import { StartDashboard } from "../src/features/chat/start-dashboard";
import { startMetricsOf, type StartMetric } from "../src/lib/start-metrics";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { PagesContext } from "../src/lib/web-app-pages";
import { ThemeProvider } from "../src/state/theme";
import { pageTableFor } from "../src/web-app/contributions";
import { agentServer, mountAgentApp, whereIs } from "./helpers/agent-app";
import { click, unmountAll, waitFor } from "./helpers/dom";
import { SYSTEM_APP_PAGES } from "./helpers/system-app-pages";

afterEach(async () => {
  await unmountAll();
  setActiveStrings(zh);
});

describe("startMetricsOf", () => {
  it("keeps the well-formed counts, the first of a repeated id, in their order", () => {
    const answer = {
      startMetrics: [
        { id: "b", key: "b", title: "Second", order: 20, value: 2, app: "reports" },
        { id: "a", key: "a", title: "First", titleZh: "第一", icon: "trophy", order: 10, value: 7 },
        { id: "a", key: "a", title: "Again", order: 0, value: 9 },
        { id: "", title: "No id", order: 1, value: 1 },
        { id: "c", title: "", order: 1, value: 1 },
        { id: "d", title: "No value", order: 1, value: "3" },
        { id: "e", title: "Endless", order: 1, value: Number.POSITIVE_INFINITY },
        null,
      ],
    };
    expect(startMetricsOf(answer)).toEqual([
      { id: "a", title: "First", titleZh: "第一", icon: "trophy", order: 10, value: 7 },
      { id: "b", title: "Second", order: 20, value: 2, app: "reports" },
    ]);
  });

  it("has none in an answer that sends no list, or no answer at all", () => {
    const older: ContributionsResponse = {
      pages: [],
      fileRenderers: [],
      pageRemovals: [],
      agentTabs: [],
      sessionTabs: [],
    };
    expect(startMetricsOf(older)).toEqual([]);
    expect(startMetricsOf(null)).toEqual([]);
  });
});

/** A server module's iframe system app, which opens in the App Center's window. */
const PAGES = pageTableFor(
  SYSTEM_APP_PAGES,
  {
    pages: [
      {
        id: "reports.page",
        from: "ReportsModule",
        key: "reports",
        path: "/reports",
        nav: "none",
        admin: false,
        renderer: { iframe: { src: "/api/reports-app/ui/index.html", namespace: "reports" } },
        title: "Reports",
        titleZh: "报表",
        icon: "barChart",
        app: { order: 60 },
      },
    ],
    fileRenderers: [],
    pageRemovals: [],
    agentTabs: [],
    sessionTabs: [],
  },
  new Map(),
);

const METRICS: StartMetric[] = [
  { id: "orphan", title: "Orphans", order: 0, value: 1, app: "nowhere" },
  {
    id: "reports",
    title: "Reports",
    titleZh: "报表",
    icon: "barChart",
    order: 1,
    value: 7,
    app: "reports",
  },
  { id: "spend", title: "Spend", order: 2, value: 3, app: "usage" },
];

/** The page table as the shell holds it, with the server's counts. */
function Table({ children }: { children: ReactNode }) {
  return h(
    PagesContext.Provider,
    {
      value: {
        pages: PAGES,
        pending: false,
        quickStarts: [],
        startMetrics: METRICS,
        refresh: async () => null,
      },
    },
    children,
  );
}

/** The start page's counts: each one's label and number, and where it leads (null: nowhere). */
const counts = () =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="count"]')].map((count) => ({
    label: count.querySelector("span")?.textContent?.trim() ?? "",
    figure: count.querySelector('[data-slot="figure"]')?.textContent ?? "",
    to: count.querySelector("a")?.getAttribute("href") ?? null,
  }));

it("draws the contributed counts after its own, each leading to the app it names", async () => {
  setActiveStrings(en);
  agentServer();
  const router = await mountAgentApp(
    h(
      ThemeProvider,
      null,
      h(
        Table,
        null,
        h(StartDashboard, {
          projectId: "proj",
          composer: null,
          skillsLoaded: true,
          fill: () => undefined,
          readComposerText: () => "",
        }),
      ),
    ),
    {
      route: "/chat/new",
      at: "/chat/new",
      pages: PAGES,
      extra: [{ path: "/apps", element: h("p", null, "App Center") }],
    },
  );
  await waitFor(() => counts().length === 6);
  expect(counts().map(({ label }) => label)).toEqual([
    en.chat.start.metrics.agents,
    en.chat.start.metrics.toolkits,
    en.chat.start.metrics.benchmarks,
    "Orphans",
    "Reports",
    "Spend",
  ]);
  expect(counts().slice(3)).toEqual([
    { label: "Orphans", figure: "1", to: null },
    {
      label: "Reports",
      figure: "7",
      to: `/apps?${new URLSearchParams({ app: "system_agent/reports" })}`,
    },
    { label: "Spend", figure: "3", to: "/usage" },
  ]);

  await click(document.querySelector<HTMLElement>('[data-slot="count"]:nth-child(5) a')!);
  expect(whereIs(router)).toBe(`/apps?${new URLSearchParams({ app: "system_agent/reports" })}`);
});
