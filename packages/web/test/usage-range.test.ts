// @vitest-environment jsdom
/**
 * The Cost Center's date range, through the real page and HTTP client; the clock stands at
 * 12 November 2026.
 *
 * - Given a preset (the page opens on the last 7 days), no range picker is on the page; choosing
 *   Custom shows one holding the dates the preset had, the dashboard is read again for the two
 *   days picked and confirmed in it, and choosing a preset again takes the picker away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import type { ProjectSummary, UsageBucket, UsageResponse } from "@prismshadow/penguin-server/api";
import { UsagePage } from "@prismshadow/penguin-library-observability/web/usage/usage-page";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { ProjectProvider } from "../src/state/project";
import { ThemeProvider } from "../src/state/theme";
import { button, click, mount, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";

const PROJECT: ProjectSummary = {
  projectId: "p1",
  role: "member",
  ownerUserId: "admin",
  createdAt: "2026-01-01T00:00:00.000Z",
};
const EMPTY: UsageBucket = {
  total: 0,
  requests: 0,
  cost: null,
  hasUncosted: false,
  toolRequests: 0,
  toolCost: null,
};
const USAGE: UsageResponse = {
  summary: { today: EMPTY, last7d: EMPTY, total: EMPTY },
  groupBy: "date",
  groups: [],
  granularity: "day",
  series: [],
  byAgentSeries: [],
  byModelSeries: [],
  tools: [],
  agentIds: [],
  models: [],
  errors: { total: 0, unexpected: 0, rows: 0, recent: [], topCode: null },
};

/** A server with one Project and no usage; every dashboard read is recorded. */
function server() {
  const fetch = stubFetch((req) => {
    if (req.path === "/api/me/prefs") return json({ prefs: {} });
    if (req.path === "/api/projects") return json({ projects: [PROJECT] });
    if (req.path === "/api/projects/p1/agents") return json({ agents: [] });
    if (req.path === "/api/projects/p1/usage/errors") return json({ items: [], total: 0, rows: 0 });
    if (req.path === "/api/projects/p1/usage") return json(USAGE);
    return apiError(404, "not_found");
  });
  /** The spans the dashboard was read for, oldest first. */
  const spans = () =>
    fetch.requests
      .filter((r) => r.path === "/api/projects/p1/usage")
      .map((r) => `${r.query.get("from")}..${r.query.get("to")}`);
  return { spans };
}

/** The range picker's field, named by the page; null while the page shows none. */
const rangePicker = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')].find((each) =>
    each.getAttribute("aria-label")?.startsWith(`${en.usage.rangeDates}: `),
  ) ?? null;

/** Chooses `label` in the page's range Select. */
async function chooseRange(label: string): Promise<void> {
  await click(button(en.usage.rangeLabel));
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (each) => each.textContent?.trim() === label,
  );
  if (option === undefined) throw new Error(`no range named ${JSON.stringify(label)}`);
  await click(option);
}

/** The day reading `n` on the open range calendar. */
const day = (n: number) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="grid"] button')].find(
    (each) => each.textContent === String(n),
  )!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 12, 14, 37) });
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {},
  }));
  setActiveStrings(en);
  localStorage.setItem("penguin.lastProjectId", PROJECT.projectId);
});
afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
  localStorage.clear();
});

describe("the Cost Center's date range", () => {
  it("shows its range picker only while the range is Custom, and reads the span confirmed in it", async () => {
    const api = server();
    await mount(
      h(MemoryRouter, null, h(ThemeProvider, null, h(ProjectProvider, null, h(UsagePage)))),
    );
    await waitFor(() => api.spans().length > 0);
    expect(api.spans()).toEqual(["2026-11-06..2026-11-12"]);
    expect(rangePicker()).toBeNull();

    await chooseRange(en.usage.rangeCustom);
    expect(rangePicker()?.textContent?.replace(/\s/g, " ")).toBe("Nov 6, 2026 – Nov 12, 2026");

    await click(rangePicker()!);
    await click(day(2));
    await click(day(9));
    expect(api.spans().at(-1)).toBe("2026-11-06..2026-11-12");
    await click(button(en.datePicker.confirm));
    await waitFor(() => api.spans().at(-1) === "2026-11-02..2026-11-09");
    expect(rangePicker()?.textContent?.replace(/\s/g, " ")).toBe("Nov 2, 2026 – Nov 9, 2026");

    await chooseRange(en.usage.range30d);
    await waitFor(() => api.spans().at(-1) === "2026-10-14..2026-11-12");
    expect(rangePicker()).toBeNull();
  });
});
