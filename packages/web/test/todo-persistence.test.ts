// @vitest-environment jsdom
/**
 * Error notices through the real page, badge stores and HTTP client.
 *
 * - Given an app-start probe followed by more errors, opening the cost center refreshes
 *   the notice; marking it read survives a fresh client, while a later error raises it again.
 * - Given a refused preference write, marking read keeps the notice and reports the failure;
 *   retrying successfully hides it and a fresh client keeps it hidden.
 * - Given overlapping dismissals, a slow first write cannot erase the second; repeated
 *   clicks write once, and both markers survive a fresh client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h, useState } from "react";
import type {
  ProjectSummary,
  UiPrefs,
  UsageBucket,
  UsageErrorItem,
  UsageResponse,
} from "@prismshadow/penguin-server/api";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { button, click, hasButton, mount, run, unmountAll, waitFor } from "./helpers/dom";

const PROJECT: ProjectSummary = {
  projectId: "p1",
  role: "member",
  ownerUserId: "admin",
  createdAt: "2026-01-01T00:00:00.000Z",
};
const OLD = "2026-10-14T01:00:00.000Z";
const SEEN = "2026-10-14T02:00:00.000Z";
const LATER = "2026-10-14T03:00:00.000Z";
const MARK_READ = "Mark as read";

/** Persisted HTTP state outlives the client modules, as it does when the app restarts. */
function server() {
  let prefs: UiPrefs = { todoDismissed: { other: { models: "custom/model" } } };
  let refuse = false;
  let hold: Promise<void> | undefined;
  const errors: UsageErrorItem[] = [];
  const bucket: UsageBucket = { total: 0, requests: 0, cost: null, hasUncosted: false };
  const fetch = stubFetch(async (req) => {
    if (req.path === "/api/me/prefs") {
      if (req.method === "PUT") {
        const pending = hold;
        hold = undefined;
        await pending;
        if (refuse) {
          refuse = false;
          return apiError(400, "save_failed", "Could not save read status");
        }
        prefs = { ...prefs, ...(req.body as UiPrefs) };
      }
      return json({ prefs });
    }
    if (req.path === "/api/projects") return json({ projects: [PROJECT] });
    if (req.path === "/api/projects/p1/agents") return json({ agents: [] });
    if (req.path === "/api/projects/p1/usage/errors") {
      return json({ items: errors.slice(0, 1), total: errors.length, rows: errors.length });
    }
    if (req.path === "/api/projects/p1/usage") {
      return json({
        summary: { today: bucket, last7d: bucket, total: bucket },
        groupBy: "date",
        groups: [],
        granularity: "day",
        series: [],
        byAgentSeries: [],
        byModelSeries: [],
        agentIds: [],
        models: [],
        errors: {
          total: errors.length,
          unexpected: errors.length,
          rows: errors.length,
          recent: errors,
          topCode: null,
        },
      } satisfies UsageResponse);
    }
    return apiError(404, "not_found");
  });
  return {
    addError(ts: string) {
      errors.unshift({
        ts,
        firstTs: ts,
        source: "session",
        kind: "unexpected",
        code: "run_failed",
        message: `Error at ${ts}`,
        count: 1,
      });
    },
    refuseNext: () => {
      refuse = true;
    },
    holdNextWrite: (until: Promise<void>) => {
      hold = until;
    },
    writes: () => fetch.requests.filter((r) => r.method === "PUT"),
    prefs: () => prefs,
  };
}

async function client() {
  vi.resetModules();
  const { MemoryRouter } = await import("react-router");
  const { ThemeProvider } = await import("../src/state/theme");
  const { ProjectProvider } = await import("../src/state/project");
  const { UsagePage } = await import("../src/features/usage/usage-page");
  const { useUpdateBadges } = await import("../src/lib/use-update-badges");
  const { useTodoDismissals, dismissTodo } = await import("../src/lib/todo-dismissals");
  const { Toaster } = await import("@prismshadow/penguin-ui");
  const { setActiveStrings } = await import("../src/lib/strings");
  const { en } = await import("../src/lib/strings-en");
  setActiveStrings(en);
  function Shell() {
    const [open, setOpen] = useState(false);
    const badges = useUpdateBadges(true);
    const dismissed = useTodoDismissals("p1");
    return h(
      "main",
      null,
      h("output", { "aria-label": "Cost badge" }, badges.navNotes["/usage"] ?? "clear"),
      h("output", { "aria-label": "Saved markers" }, JSON.stringify(dismissed)),
      h("button", { onClick: () => setOpen(true) }, "Open cost center"),
      open ? h(UsagePage) : null,
      h(Toaster),
    );
  }
  const mounted = await mount(
    h(MemoryRouter, null, h(ThemeProvider, null, h(ProjectProvider, null, h(Shell)))),
  );
  await waitFor(
    () => document.querySelector('[aria-label="Saved markers"]')?.textContent !== "null",
  );
  return { ...mounted, dismissTodo };
}

const badge = () => document.querySelector('[aria-label="Cost badge"]')?.textContent;
const markers = () =>
  JSON.parse(document.querySelector('[aria-label="Saved markers"]')!.textContent!);

beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(async () => {
  await unmountAll();
  localStorage.clear();
});

describe("persisted error read status", () => {
  it("marks the errors seen on opening the page, survives a restart, and still reports later errors", async () => {
    const api = server();
    api.addError(OLD);
    await client();
    await waitFor(() => badge() === "1 unexpected error");
    api.addError(SEEN);
    await click(button("Open cost center"));
    await waitFor(() => hasButton(MARK_READ));
    expect(document.body.textContent).toContain(`Error at ${SEEN}`);
    await click(button(MARK_READ));
    await waitFor(() => !hasButton(MARK_READ));
    expect(badge()).toBe("clear");
    expect(api.prefs().todoDismissed).toEqual({
      p1: { errors: SEEN },
      other: { models: "custom/model" },
    });
    await unmountAll();
    await client();
    await click(button("Open cost center"));
    expect(hasButton(MARK_READ)).toBe(false);
    expect(badge()).toBe("clear");
    api.addError(LATER);
    await unmountAll();
    await client();
    await waitFor(() => badge() === "3 unexpected errors");
  });

  it("keeps a failed dismissal visible with an error, then persists a successful retry", async () => {
    const api = server();
    api.addError(OLD);
    await client();
    await click(button("Open cost center"));
    await waitFor(() => hasButton(MARK_READ));
    api.refuseNext();
    await click(button(MARK_READ));
    expect(hasButton(MARK_READ)).toBe(true);
    expect(document.body.textContent).toContain("Could not save read status");
    expect(badge()).toBe("1 unexpected error");
    await click(button(MARK_READ));
    await waitFor(() => !hasButton(MARK_READ));
    await unmountAll();
    await client();
    await click(button("Open cost center"));
    expect(hasButton(MARK_READ)).toBe(false);
    expect(badge()).toBe("clear");
  });

  it("preserves overlapping dismissals across a restart and writes repeated clicks only once", async () => {
    const api = server();
    const page = await client();
    const pending = Promise.withResolvers<void>();
    api.holdNextWrite(pending.promise);
    await run(() => {
      page.dismissTodo("p1", "errors", OLD);
      page.dismissTodo("p1", "errors", OLD);
      page.dismissTodo("p1", "plugins", "web@2");
    });
    await run(() => pending.resolve());
    await waitFor(() => markers().plugins === "web@2");
    expect(api.writes()).toHaveLength(2);
    await unmountAll();
    await client();
    expect(markers()).toEqual({ errors: OLD, plugins: "web@2" });
  });
});
