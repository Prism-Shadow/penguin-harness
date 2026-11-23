/** @vitest-environment jsdom */
import { createElement as h } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { SessionWorkbenchPage } from "../src/features/dock/session-workbench-page";
import { en } from "../src/lib/strings-en";
import { setActiveStrings, zh } from "../src/lib/strings";
import { button, click, mount, unmountAll, waitFor } from "./helpers/dom";

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
vi.mock("../src/lib/page-workspace", () => ({
  usePageWorkspace: () => ({ openBesideSession: fixture.open }),
}));
vi.mock("../src/features/dock/panel-registry", () => ({
  useSessionWorkbenchPanels: () => [{ id: "terminal", label: () => "Terminal" }],
}));
vi.mock("../src/api/endpoints", () => ({ listSessions: fixture.list, getSession: fixture.get }));
vi.mock("../src/lib/session-resource-counts", () => ({
  listSessionResourceCounts: fixture.counts,
  closeSessionResources: fixture.close,
}));

afterEach(async () => {
  await unmountAll();
  vi.resetAllMocks();
  setActiveStrings(zh);
});

it("keeps same-ID local and remote resource groups distinct, reports a failed target and retries only that target", async () => {
  setActiveStrings(en);
  const live = new Map<string | null, number>([
    [null, 1],
    ["remote-a", 2],
  ]);
  fixture.list.mockResolvedValue({ sessions: [fixture.row] });
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
  await mount(
    h(
      MemoryRouter,
      { initialEntries: ["/session-tools/terminal"] },
      h(Routes, null, h(Route, { path: "/session-tools/:kind", element: h(SessionWorkbenchPage) })),
    ),
  );
  const checkbox = (host: string) =>
    document.querySelector<HTMLInputElement>(
      'input[aria-label="Select Session Notes (' + host + ')"]',
    )!;
  await waitFor(() => checkbox("Studio") !== null);
  expect(checkbox("Workshop").disabled).toBe(true);
  expect(document.body.textContent).toContain("Away (Unavailable)");
  expect(document.body.textContent).toContain("Workshop: Not permitted");
  const activateRow = checkbox("Studio").closest("li")!.querySelector("button")!;
  await click(activateRow);
  expect(fixture.open).toHaveBeenCalledWith(
    "shared",
    expect.objectContaining({ path: expect.stringContaining("machine=remote-a") }),
    expect.objectContaining({ projectId: "project", machineId: "remote-a", session: fixture.row }),
  );
  expect(fixture.close).not.toHaveBeenCalled();
  await click(checkbox("This server"));
  await click(checkbox("Studio"));
  await click(button("Close selected resources (2)"));
  const confirm = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(confirm().textContent).toContain("Notes (This server) 1 open terminal");
  expect(confirm().textContent).toContain("Notes (Studio) 2 open terminals");
  await click(button("Close"));
  await waitFor(
    () => document.body.textContent?.includes("Studio (shared): close_failed") === true,
  );
  expect(checkbox("This server").checked).toBe(false);
  expect(checkbox("Studio").checked).toBe(true);
  retry = true;
  await click(button("Close selected resources (1)"));
  await click(button("Close"));
  await waitFor(() => checkbox("Studio").disabled);
  const targets = fixture.close.mock.calls.map((call) => call[2]);
  expect(targets.slice(0, 2)).toEqual(expect.arrayContaining([null, "remote-a"]));
  expect(targets.slice(2)).toEqual(["remote-a"]);
});
