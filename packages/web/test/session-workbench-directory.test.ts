/** @vitest-environment jsdom */
/**
 * - A bulk close across machines leaves failed groups selected and offers a targeted retry.
 * - Files lists archived workspaces without reading any resource counts.
 * - A Browser count refresh removes the last closed page’s Session, and an empty Session
 *   shortcut still opens its own workbench.
 * - Searching the Browser directory finds an archived child beyond the first page.
 */
import { act, createElement as h } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { SessionWorkbenchPage } from "@prismshadow/penguin-library-session/web/dock/session-workbench-page";
import { en } from "../src/lib/strings-en";
import { setActiveStrings, zh } from "../src/lib/strings";
import { button, click, field, mount, run, type, unmountAll, waitFor } from "./helpers/dom";

const fixture = vi.hoisted(() => {
  const agent = { agentId: "author" };
  const machines = [
    { machine: { machineId: "remote-a", label: "Studio" }, live: true, agents: [agent] },
    { machine: { machineId: "remote-b", label: "Workshop" }, live: true, agents: [agent] },
    { machine: { machineId: "offline", label: "Away" }, live: false, agents: [] },
  ];
  const row = {
    agentId: agent.agentId,
    projectId: "project",
    sessionId: "shared",
    title: "Notes",
    workspace: "/notes",
    lastActiveAt: "2026-11-23T09:00:00Z",
  };
  return {
    agent,
    agents: [agent],
    machines,
    row,
    counts: vi.fn(),
    close: vi.fn(),
    open: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
  };
});
vi.mock("../src/state/project", () => ({
  useProject: () => ({ currentProject: { projectId: "project" }, agents: fixture.agents }),
}));
vi.mock("../src/lib/machine-agent-lists", async (original) => ({
  ...(await original<typeof import("../src/lib/machine-agent-lists")>()),
  useMachineAgents: () => ({ lists: fixture.machines }),
}));
vi.mock("../src/lib/page-workspace-context", () => ({
  usePageWorkspace: () => ({ openBesideSession: fixture.open }),
}));
vi.mock("@prismshadow/penguin-library-session/web/dock/panel-registry", () => ({
  useSessionWorkbenchPanels: () => [
    { id: "terminal", label: () => "Terminal" },
    { id: "builtin-browser", label: () => "Browser" },
    { id: "workspace", label: () => "Files" },
  ],
}));
vi.mock("../src/api/endpoints", () => ({ listSessions: fixture.list, getSession: fixture.get }));
vi.mock("../src/lib/session-resource-counts", () => ({
  listSessionResourceCounts: fixture.counts,
  closeSessionResources: fixture.close,
}));

afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
  vi.resetAllMocks();
  setActiveStrings(zh);
});

async function directory(kind: string) {
  await mount(
    h(
      MemoryRouter,
      { initialEntries: ["/session-tools/" + kind] },
      h(Routes, null, h(Route, { path: "/session-tools/:kind", element: h(SessionWorkbenchPage) })),
    ),
  );
}

it.each(["terminal", "builtin-browser"])("%s retries only the failed machine", async (kind) => {
  const unit = kind === "terminal" ? "terminal" : "page";
  setActiveStrings(en);
  const live = new Map<string | null, number>([
    [null, 1],
    ["remote-a", 2],
  ]);
  fixture.get.mockResolvedValue({ session: fixture.row });
  fixture.counts.mockImplementation(async (_kind, _project, machine: string | null) => {
    if (machine === "remote-b") throw new Error("Not permitted");
    return { shared: live.get(machine) ?? 0 };
  });
  let retry = false;
  fixture.close.mockImplementation(
    async (_kind, _project, machine: string | null, ids: string[]) => {
      expect(ids).toEqual(["shared"]);
      if (machine === "remote-a" && !retry)
        return { results: [{ sessionId: "shared", closed: 0, error: "close_failed" }] };
      const count = live.get(machine) ?? 0;
      live.set(machine, 0);
      return { results: [{ sessionId: "shared", closed: count }] };
    },
  );
  await directory(kind);
  const checkbox = (host: string) =>
    document.querySelector<HTMLInputElement>(
      'input[aria-label="Select Session Notes (' + host + ')"]',
    )!;
  await waitFor(() => checkbox("Studio") !== null);
  expect(checkbox("Workshop")).toBeNull();
  expect(fixture.list).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Away (Unavailable)");
  expect(document.body.textContent).toContain("Workshop: Not permitted");
  const activateRow = checkbox("Studio").closest("li")!.querySelector("button")!;
  await click(activateRow);
  expect(fixture.open).toHaveBeenCalledWith(
    "shared",
    expect.objectContaining({ path: expect.stringContaining("machine=remote-a") }),
    expect.objectContaining({
      projectId: "project",
      machineId: "remote-a",
      session: fixture.row,
    }),
  );
  expect(fixture.close).not.toHaveBeenCalled();
  await click(checkbox("This server"));
  await click(checkbox("Studio"));
  await click(button("Close selected resources (2)"));
  const confirm = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(confirm().textContent).toContain("Notes (This server) 1 open " + unit);
  expect(confirm().textContent).toContain("Notes (Studio) 2 open " + unit + "s");
  await click(button("Close"));
  await waitFor(
    () => document.body.textContent?.includes("Studio (shared): close_failed") === true,
  );
  await waitFor(() => checkbox("This server") === null);
  expect(checkbox("Studio").checked).toBe(true);
  retry = true;
  await click(button("Close selected resources (1)"));
  await click(button("Close"));
  await waitFor(() => checkbox("Studio") === null);
  const targets = fixture.close.mock.calls.map((call) => call[2]);
  expect(targets.slice(0, 2)).toEqual(expect.arrayContaining([null, "remote-a"]));
  expect(targets.slice(2)).toEqual(["remote-a"]);
});

it("lists archived workspaces by path without counting terminal or browser resources", async () => {
  setActiveStrings(en);
  fixture.list.mockResolvedValue({ sessions: [{ ...fixture.row, archived: true }] });
  await directory("workspace");
  await waitFor(() => document.body.textContent?.includes("/notes") === true);
  expect(document.body.textContent).toContain("Archived");
  expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  expect(fixture.counts).not.toHaveBeenCalled();
});

it("removes the Session when its last page closes and can open that empty Session by its shortcut", async () => {
  setActiveStrings(en);
  let pages = 2;
  fixture.counts.mockImplementation(async (_kind, _project, machine) =>
    machine === "remote-a" ? { shared: pages } : {},
  );
  fixture.get.mockResolvedValue({ session: fixture.row });
  await directory("builtin-browser");
  await waitFor(() => document.body.textContent?.includes("2 open pages") === true);
  expect(document.querySelectorAll("li")).toHaveLength(1);
  expect(document.querySelector("li")?.textContent).toContain("Studio");
  expect(fixture.list).not.toHaveBeenCalled();
  pages = 0;
  await run(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => document.body.textContent?.includes("No open browser pages") === true);
  expect(document.querySelector("li")).toBeNull();
  expect(fixture.open).not.toHaveBeenCalled();
  await unmountAll();
  await directory("builtin-browser?project=project&session=shared&machine=remote-a");
  await waitFor(() => fixture.open.mock.calls.length === 1);
  expect(fixture.open).toHaveBeenCalledWith(
    "shared",
    expect.objectContaining({ path: expect.stringContaining("machine=remote-a") }),
    { projectId: "project", machineId: "remote-a", session: fixture.row },
  );
});

it("finds an archived child outside the first page of browser owners and excludes other Projects", async () => {
  setActiveStrings(en);
  vi.useFakeTimers();
  const ids = Array.from({ length: 33 }, (_, i) => "owner-" + String(i).padStart(2, "0"));
  fixture.counts.mockImplementation(async (_kind, _project, machine) =>
    machine === null ? Object.fromEntries(ids.map((id) => [id, 1])) : {},
  );
  fixture.get.mockImplementation(async (id: string) => ({
    session: {
      ...fixture.row,
      sessionId: id,
      ...(id === ids[0] ? { projectId: "another", title: "Recipe elsewhere" } : {}),
      ...(id === ids.at(-1) ? { title: "Recipe", source: "subagent", archived: true } : {}),
    },
  }));
  await directory("builtin-browser");
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(document.body.textContent).not.toContain("Recipe");
  const search = field("Search Sessions with open browser pages");
  await type(search, "recipe");
  await act(() => vi.advanceTimersByTimeAsync(150));
  const row = document.querySelector("li");
  expect(row?.textContent).toContain("Archived");
  expect(row?.textContent).toContain("Subagent");
  expect(row?.textContent).toContain(ids.at(-1));
  expect(document.querySelectorAll("li")).toHaveLength(1);
  await type(search, "no match");
  await act(() => vi.advanceTimersByTimeAsync(150));
  expect(document.body.textContent).toContain("No matching Sessions.");
  expect(document.body.textContent).not.toContain("No open browser pages");
  expect(fixture.list).not.toHaveBeenCalled();
});
