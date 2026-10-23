// @vitest-environment jsdom
/**
 * Switching Projects: nothing read for one Project is shown, or asked about, under another
 * (lib/project-scope.ts). Driven through the real providers (state/project.tsx,
 * state/sessions.tsx) and the pages on top of them, against a two-Project server behind the
 * package's fetch fake: A has `alpha`, B has `beta`, both have `default_agent`.
 *
 * - Given A's Agent list answers late, after the switch to B: no render and no effect under B
 *   carries an Agent of A, before or after A's answer lands, and no request names one under B.
 * - Given A's conversations on screen: the switch to B never publishes them under B — not even
 *   in the commit before the list hears of the switch, where its descendants' effects run first.
 * - Given A's Session list answering after the switch to B, before B's Agents are in: A's rows
 *   never land under B.
 * - Given the current Project gone from a refreshed list: the Project the app falls back to is
 *   never published with the old one's Agents, and no request pairs them.
 * - Given a row of A handed to the list after the switch to B (a lookup that settled late): it is
 *   not held.
 * - Given the same Agent id in two Projects: while B's memory listing is on the way, A's is not
 *   shown in its place.
 * - Given an Agent's settings page under one Project: a switch to another asks it nothing about
 *   that Agent and leaves for the Agents list.
 * - Given a machine's Agents read under one Project: no render under the next Project is handed
 *   them, not even the one before the lists hear of the switch.
 * - Given the cost center filtered to A's Agent by its deep link, with A's answer late: after the
 *   switch to B no usage read names that Agent under B, and A's answer never shows under B.
 * - Given a Benchmark's page under A: a switch to B asks B nothing about that Benchmark and
 *   leaves for the Benchmarks list.
 * - Given A's organization Sessions answering after B's: B's stay.
 * - Given a switch to B with B's Session list held: every render under B before that list says
 *   loading, with no rows; the list clears it, and it never rises again under B.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Fragment, createElement as h, useEffect } from "react";
import { MemoryRouter, Outlet, RouterProvider, createMemoryRouter } from "react-router";
import type {
  AgentSummary,
  BenchmarkSummary,
  OrganizationSummary,
  OrgSessionsResponse,
  SessionInfo,
  SessionsBatchRequest,
  UsageBucket,
  UsageResponse,
} from "@prismshadow/penguin-server/api";
import { AuthProvider } from "../src/state/auth";
import { LocaleProvider } from "../src/state/locale";
import { ThemeProvider } from "../src/state/theme";
import { ProjectProvider, useProject } from "../src/state/project";
import { SessionsProvider, createSessionsStore, useSessions } from "../src/state/sessions";
import { createCompanyStore } from "../src/state/company";
import { useMemoryListing } from "../src/features/chat/use-memory-listing";
import { useMachineAgents } from "../src/lib/machine-agent-lists";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { UsagePage } from "../src/features/usage/usage-page";
import { BenchmarkDetailPage } from "../src/features/benchmark/benchmark-detail-page";
import { ADMIN_ME } from "./helpers/admin-settings";
import {
  AGENT_ID,
  OTHER_PROJECT_ID,
  PROJECT_ID,
  agentServer,
  mountAgentApp,
  whereIs,
} from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import { button, click, mount, run, settle, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FetchRequest } from "./helpers/fetch";

const A = "proj-a";
const B = "proj-b";
const AGENTS: Record<string, readonly string[]> = {
  [A]: ["default_agent", "alpha"],
  [B]: ["default_agent", "beta"],
};

const summary = (agentId: string) =>
  ({
    agentId,
    activeSessionCount: 0,
    sessionCount: 1,
    sessionActivity: [],
    toolCount: 0,
    version: 1,
    kernelOutdated: false,
    vaultKeyCount: 0,
    scheduleCount: 0,
    skillCount: 0,
    hookCount: 0,
    workbenchCount: 0,
    pluginUpdates: [],
  }) as unknown as AgentSummary;

function session(projectId: string, agentId: string): SessionInfo {
  return {
    sessionId: `${projectId}-${agentId}-s`,
    projectId,
    agentId,
    provider: "anthropic",
    modelId: "claude-sonnet-4",
    workspace: "/w",
    approvalMode: "allow-all",
    sandbox: { mode: "danger-full-access", network: "open" },
    createdAt: "2026-10-15T09:00:00.000Z",
    lastActiveAt: "2026-10-15T09:00:00.000Z",
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: false,
  };
}

/** Tokens each Project's cost center reports, so the screen says whose answer it shows. */
const TOKENS: Record<string, number> = { [A]: 111, [B]: 222 };

/** A Project's cost center answer: its own token total, and its own Agent named in the usage. */
const usageOf = (projectId: string): UsageResponse => {
  const bucket: UsageBucket = {
    total: TOKENS[projectId] ?? 0,
    requests: 1,
    cost: null,
    hasUncosted: false,
  };
  return {
    summary: { today: bucket, last7d: bucket, total: bucket },
    groupBy: "date",
    groups: [],
    granularity: "day",
    series: [],
    byAgentSeries: [],
    byModelSeries: [],
    agentIds: (AGENTS[projectId] ?? []).filter((agentId) => agentId !== "default_agent"),
    models: [],
    errors: { total: 0, unexpected: 0, rows: 0, recent: [], topCode: null },
  };
};

/** A published Benchmark only A has. */
const ALPHA_BENCHMARK: BenchmarkSummary = {
  id: "alpha-bench",
  title: "Alpha bench",
  status: "published",
  caseCount: 0,
  evaluations: [],
  agentIds: [],
};

/** Every Agent a request names — in its path, an `agentId` query or a batch body — with the Project it names. */
function pairsOf(request: FetchRequest): Array<[string, string]> {
  const path = /^\/api\/projects\/([^/]+)(?:\/(agents|sessions)(?:\/([^/]+))?)?/.exec(request.path);
  if (path === null) return [];
  const projectId = decodeURIComponent(path[1]!);
  const pairs: Array<[string, string]> = [];
  if (path[2] === "agents" && path[3] !== undefined) {
    pairs.push([projectId, decodeURIComponent(path[3])]);
  }
  if (path[2] === "sessions" && path[3] === "batch") {
    for (const r of (request.body as SessionsBatchRequest).requests) {
      pairs.push([projectId, r.agentId]);
    }
  }
  const queried = request.query.get("agentId");
  if (queried !== null) pairs.push([projectId, queried]);
  return pairs;
}

/** The requests that name an Agent under a Project that has no such Agent. */
const strayRequests = (requests: readonly FetchRequest[]) =>
  requests.flatMap((r) =>
    pairsOf(r)
      .filter(([projectId, agentId]) => !(AGENTS[projectId] ?? []).includes(agentId))
      .map(([projectId, agentId]) => `${r.method} ${r.path} names ${agentId} under ${projectId}`),
  );

/**
 * The two-Project server. `hold(match)` parks every later request it matches until the release
 * it returns is called — an answer that arrives late, in the order the test decides.
 */
function twoProjectServer() {
  let listed = [A, B];
  const holds: Array<{ match: (r: FetchRequest) => boolean; waiting: Array<() => void> | null }> =
    [];
  const answer = (request: FetchRequest): Response => {
    const { method, path } = request;
    if (path === "/api/me") return json(ADMIN_ME);
    if (path === "/api/me/prefs") return json({ prefs: {} });
    if (path === "/api/projects") {
      return json({
        projects: listed.map((projectId) => ({
          projectId,
          name: projectId,
          role: "owner",
          ownerUserId: "admin",
          createdAt: "2026-01-01T00:00:00Z",
        })),
      });
    }
    const agents = /^\/api\/projects\/([^/]+)\/agents$/.exec(path);
    if (agents && method === "GET") {
      return json({ agents: (AGENTS[agents[1]!] ?? []).map(summary) });
    }
    const usage = /^\/api\/projects\/([^/]+)\/usage$/.exec(path);
    if (usage) return json(usageOf(usage[1]!));
    if (/^\/api\/projects\/[^/]+\/usage\/errors$/.test(path)) {
      return json({ items: [], total: 0, rows: 0 });
    }
    const benchmarks = /^\/api\/projects\/([^/]+)\/benchmarks$/.exec(path);
    if (benchmarks && method === "GET") {
      return json({ benchmarks: benchmarks[1] === A ? [ALPHA_BENCHMARK] : [] });
    }
    const cases = /^\/api\/projects\/([^/]+)\/benchmarks\/([^/]+)\/cases$/.exec(path);
    if (cases && cases[1] === A && cases[2] === ALPHA_BENCHMARK.id) return json({ cases: [] });
    const batch = /^\/api\/projects\/([^/]+)\/sessions\/batch$/.exec(path);
    if (batch && method === "POST") {
      const projectId = batch[1]!;
      return json({
        results: (request.body as SessionsBatchRequest).requests.map((r) =>
          (AGENTS[projectId] ?? []).includes(r.agentId)
            ? { agentId: r.agentId, ok: true, sessions: [session(projectId, r.agentId)] }
            : { agentId: r.agentId, ok: false, reason: "absent" },
        ),
      });
    }
    return apiError(404, "not_found");
  };
  const fetch = stubFetch(async (request) => {
    for (const hold of holds) {
      if (hold.waiting !== null && hold.match(request)) {
        await new Promise<void>((resolve) => hold.waiting!.push(resolve));
      }
    }
    return answer(request);
  });
  return {
    fetch,
    list(projectIds: string[]) {
      listed = projectIds;
    },
    hold(match: (r: FetchRequest) => boolean): () => Promise<void> {
      const hold = { match, waiting: [] as Array<() => void> | null };
      holds.push(hold);
      return async () => {
        const waiting = hold.waiting ?? [];
        hold.waiting = null;
        for (const open of waiting) open();
        await settle();
      };
    },
  };
}

const agentsOf = (projectId: string) => (r: FetchRequest) =>
  r.method === "GET" && r.path === `/api/projects/${projectId}/agents`;
const sessionsOf = (projectId: string) => (r: FetchRequest) =>
  r.path === `/api/projects/${projectId}/sessions/batch`;

/** What one render — or one effect run, where a page would fire its requests — saw. */
interface Seen {
  phase: "render" | "effect";
  projectId: string | null;
  agentIds: string[];
  rowAgentIds: string[];
  /** The Session list's flag: no list of this context yet (the sidebar's skeleton). */
  loading: boolean;
}

/** Mounts the providers with a page that records what it is handed, under the Project A. */
async function mountShell() {
  localStorage.setItem("penguin.lastProjectId", A);
  const seen: Seen[] = [];
  function Page() {
    const { currentProject, agents, setCurrentProjectId, reloadProjects } = useProject();
    const { sessions, loading } = useSessions();
    const now = {
      projectId: currentProject?.projectId ?? null,
      agentIds: agents.map((a) => a.agentId),
      rowAgentIds: sessions.map((s) => s.agentId),
      loading,
    };
    seen.push({ phase: "render", ...now });
    useEffect(() => {
      seen.push({ phase: "effect", ...now });
    });
    return h(
      Fragment,
      null,
      h("button", { onClick: () => setCurrentProjectId(B) }, "switch to B"),
      h("button", { onClick: () => void reloadProjects() }, "reload projects"),
      h("p", null, `${now.projectId}: ${now.agentIds.join(",")} | ${now.rowAgentIds.join(",")}`),
    );
  }
  await mount(h(AuthProvider, null, h(ProjectProvider, null, h(SessionsProvider, null, h(Page)))));
  await settle();
  return {
    seen,
    /** Every render or effect under B that carried an Agent B does not have. */
    strays: () =>
      seen.filter(
        (s) =>
          s.projectId === B &&
          [...s.agentIds, ...s.rowAgentIds].some((agentId) => !AGENTS[B]!.includes(agentId)),
      ),
    text: () => document.querySelector("p")?.textContent ?? "",
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {},
  }));
});

/** Switches the shell to B: the switcher's one job, as a button. */
function SwitchToB() {
  const { setCurrentProjectId } = useProject();
  return h("button", { onClick: () => setCurrentProjectId(B) }, "switch to B");
}

afterEach(async () => {
  await unmountAll();
  localStorage.clear();
});

describe("switching Projects in the shell", () => {
  it("a late Agent list of the Project just left never shows, or is asked about, under the new one", async () => {
    const server = twoProjectServer();
    const releaseA = server.hold(agentsOf(A));
    const shell = await mountShell();
    await click(button("switch to B"));
    await waitFor(() => shell.text() === `${B}: default_agent,beta | default_agent,beta`);

    await releaseA();
    expect(shell.text()).toBe(`${B}: default_agent,beta | default_agent,beta`);
    expect(shell.strays()).toEqual([]);
    expect(strayRequests(server.fetch.requests)).toEqual([]);
  });

  it("the conversations of the Project just left are never published under the new one", async () => {
    const server = twoProjectServer();
    const shell = await mountShell();
    await waitFor(() => shell.text() === `${A}: default_agent,alpha | default_agent,alpha`);

    await click(button("switch to B"));
    await waitFor(() => shell.text() === `${B}: default_agent,beta | default_agent,beta`);
    expect(shell.strays()).toEqual([]);
    expect(strayRequests(server.fetch.requests)).toEqual([]);
  });

  it("a switch says loading with no rows until the new Project's first list, and never again after it", async () => {
    const server = twoProjectServer();
    const shell = await mountShell();
    await waitFor(() => shell.text() === `${A}: default_agent,alpha | default_agent,alpha`);
    const releaseSessionsB = server.hold(sessionsOf(B));

    await click(button("switch to B"));
    await waitFor(() => server.fetch.requests.some(sessionsOf(B)));
    const underB = () => shell.seen.filter((s) => s.phase === "render" && s.projectId === B);
    expect(underB().every((s) => s.loading && s.rowAgentIds.length === 0)).toBe(true);

    await releaseSessionsB();
    await waitFor(() => shell.text() === `${B}: default_agent,beta | default_agent,beta`);
    const renders = underB();
    const cleared = renders.findIndex((s) => !s.loading);
    expect(renders[cleared]?.rowAgentIds).toEqual(["default_agent", "beta"]);
    expect(renders.slice(cleared).some((s) => s.loading)).toBe(false);
  });

  it("a late Session list of the Project just left never lands under the new one", async () => {
    const server = twoProjectServer();
    const releaseSessionsA = server.hold(sessionsOf(A));
    const shell = await mountShell();
    await waitFor(() => server.fetch.requests.some(sessionsOf(A)));
    const releaseAgentsB = server.hold(agentsOf(B));

    await click(button("switch to B"));
    // A's rows answer while B's Agents are still on the way.
    await releaseSessionsA();
    await releaseAgentsB();
    await waitFor(() => shell.text() === `${B}: default_agent,beta | default_agent,beta`);
    expect(shell.strays()).toEqual([]);
    expect(strayRequests(server.fetch.requests)).toEqual([]);
  });

  it("falling back from a Project gone from the list never carries its Agents along", async () => {
    const server = twoProjectServer();
    const shell = await mountShell();
    await waitFor(() => shell.text() === `${A}: default_agent,alpha | default_agent,alpha`);

    server.list([B]);
    await click(button("reload projects"));
    await waitFor(() => shell.text() === `${B}: default_agent,beta | default_agent,beta`);
    expect(shell.strays()).toEqual([]);
    expect(strayRequests(server.fetch.requests)).toEqual([]);
  });

  it("a row of the Project just left, handed to the list late, is not held", () => {
    const store = createSessionsStore();
    store.setState({ projectId: B, agentIds: [...AGENTS[B]!] });
    store.getState().add(session(A, "alpha"));
    store.getState().replace(session(A, "alpha"));
    expect(store.getState().sessions).toEqual([]);
    store.getState().add(session(B, "beta"));
    expect(store.getState().sessions.map((s) => s.agentId)).toEqual(["beta"]);
  });
});

describe("pages over a Project switch", () => {
  it("one Project's memory listing never stands in for the same Agent id's in another", async () => {
    const answered = (projectId: string) =>
      json({
        scopeKey: "user",
        files: [{ name: `${projectId}-note.md`, description: "", type: "user", size: 1 }],
      });
    let held: Array<() => void> | null = null;
    stubFetch(async (request) => {
      if (held !== null) await new Promise<void>((resolve) => held!.push(resolve));
      const memory = /^\/api\/projects\/([^/]+)\/agents\/default_agent\/memory(\/.*)?$/.exec(
        request.path,
      );
      if (memory === null) return apiError(404, "not_found");
      if (memory[2] === undefined) {
        return json({
          enabled: true,
          templateHasMemory: true,
          memoryDir: "/m",
          scopes: [{ scopeKey: "user", kind: "user", fileCount: 1, hasIndex: true }],
        });
      }
      return answered(memory[1]!);
    });
    const NO_CHANGES: never[] = [];
    function Listing({ projectId }: { projectId: string }) {
      const { scopes } = useMemoryListing(projectId, "default_agent", null, true, NO_CHANGES);
      return h("p", null, scopes === null ? "—" : scopes.flatMap((s) => s.files)[0]?.name);
    }
    const mounted = await mount(h(Listing, { projectId: A }));
    await waitFor(() => mounted.container.textContent === `${A}-note.md`);

    held = [];
    await mounted.rerender(h(Listing, { projectId: B }));
    await settle();
    expect(mounted.container.textContent).toBe("—");
    const waiting = held;
    held = null;
    for (const open of waiting) open();
    await waitFor(() => mounted.container.textContent === `${B}-note.md`);
  });

  it("an Agent's settings page asks the next Project nothing about that Agent and leaves for the Agents list", async () => {
    const server = agentServer(undefined, { otherProject: true });
    function SwitchProject() {
      const { setCurrentProjectId } = useProject();
      return h("button", { onClick: () => setCurrentProjectId(OTHER_PROJECT_ID) }, "switch");
    }
    const router = await mountAgentApp(h(Fragment, null, h(SwitchProject), h(AgentSettingsPage)), {
      at: `/agents/${AGENT_ID}`,
    });
    await waitFor(() => document.querySelector("input, textarea") !== null);

    await click(button("switch"));
    await waitFor(() => whereIs(router) === "/agents");
    expect(
      server.fetch.requests.filter((r) =>
        r.path.startsWith(`/api/projects/${OTHER_PROJECT_ID}/agents/${AGENT_ID}`),
      ),
    ).toEqual([]);
  });

  it("a machine's Agents read under one Project are never handed to a render under the next", async () => {
    const gpu: FakeMachine = {
      machineId: "gpu1",
      alias: "gpu-box",
      agents: ["default_agent", "gpu_only"],
    };
    // The machine lists its two Agents under the Agent's Project, and none under the other.
    agentServer(undefined, { otherProject: true, machines: [gpu] });
    /** What each render was handed: the Project it rendered under, and the machine Agents. */
    const seen: Array<{ projectId: string | null; agentIds: string[] }> = [];
    function MachineAgentsProbe() {
      const { currentProject, setCurrentProjectId } = useProject();
      const projectId = currentProject?.projectId ?? null;
      const { lists } = useMachineAgents(projectId);
      seen.push({
        projectId,
        agentIds: lists.flatMap((list) => list.agents.map((agent) => agent.agentId)),
      });
      return h("button", { onClick: () => setCurrentProjectId(OTHER_PROJECT_ID) }, "switch");
    }
    await mountAgentApp(h(MachineAgentsProbe), { route: "/probe", at: "/probe" });
    await waitFor(() =>
      seen.some((s) => s.projectId === PROJECT_ID && s.agentIds.includes("gpu_only")),
    );

    await click(button("switch"));
    await waitFor(() => seen.at(-1)?.projectId === OTHER_PROJECT_ID);
    await settle();
    expect(seen.filter((s) => s.projectId === OTHER_PROJECT_ID && s.agentIds.length > 0)).toEqual(
      [],
    );
  });

  it("the cost center drops A's Agent filter and A's late answer after the switch to B", async () => {
    const server = twoProjectServer();
    const releaseA = server.hold((r) => r.path === `/api/projects/${A}/usage`);
    localStorage.setItem("penguin.lastProjectId", A);
    await mount(
      h(
        MemoryRouter,
        { initialEntries: ["/usage?agentId=alpha"] },
        h(ThemeProvider, null, h(ProjectProvider, null, h(SwitchToB), h(UsagePage))),
      ),
    );
    await waitFor(() => server.fetch.requests.some((r) => r.path === `/api/projects/${A}/usage`));
    // The filter's trigger shows the picked Agent; the totals show whose answer is on screen.
    const screen = () => document.body.textContent ?? "";

    await click(button("switch to B"));
    await waitFor(() => screen().includes(String(TOKENS[B])));
    await releaseA();
    expect(screen()).toContain(String(TOKENS[B]));
    expect(screen()).not.toContain(String(TOKENS[A]));
    expect(screen()).not.toContain("alpha");
    expect(strayRequests(server.fetch.requests)).toEqual([]);
  });

  it("a Benchmark's page asks the next Project nothing about that Benchmark and leaves for the Benchmarks list", async () => {
    const server = twoProjectServer();
    localStorage.setItem("penguin.lastProjectId", A);
    const router = createMemoryRouter(
      [
        {
          element: h(ProjectProvider, null, h(SessionsProvider, null, h(SwitchToB), h(Outlet))),
          children: [
            { path: "/benchmark", element: h("p", null, "Benchmarks list") },
            { path: "/benchmark/:benchmarkId", element: h(BenchmarkDetailPage) },
          ],
        },
      ],
      { initialEntries: ["/benchmark", `/benchmark/${ALPHA_BENCHMARK.id}`] },
    );
    await mount(
      h(
        LocaleProvider,
        null,
        h(AuthProvider, null, h(ThemeProvider, null, h(RouterProvider, { router }))),
      ),
    );
    await waitFor(() =>
      server.fetch.requests.some(
        (r) => r.path === `/api/projects/${A}/benchmarks/${ALPHA_BENCHMARK.id}/cases`,
      ),
    );

    await click(button("switch to B"));
    await waitFor(() => whereIs(router) === "/benchmark");
    expect(
      server.fetch.requests.filter((r) =>
        r.path.startsWith(`/api/projects/${B}/benchmarks/${ALPHA_BENCHMARK.id}`),
      ),
    ).toEqual([]);
  });

  it("an organization Sessions answer for the Project just left does not replace the current one's", async () => {
    const org = (projectId: string) =>
      ({ projectId, orgId: "org", name: projectId }) as unknown as OrganizationSummary;
    const desks = (projectId: string) =>
      ({ desks: [], tickets: [], temp: [], projectId }) as unknown as OrgSessionsResponse;
    const heldA: { release?: () => void } = {};
    stubFetch(async (request) => {
      const projectId = /^\/api\/projects\/([^/]+)\//.exec(request.path)?.[1] ?? "";
      if (projectId === A) await new Promise<void>((resolve) => (heldA.release = resolve));
      return json(desks(projectId));
    });
    const store = createCompanyStore({ serverEnabled: true });
    store.setState({ organizations: [org(A), org(B)] });

    const leftBehind = store.getState().reloadOrgSessions(A);
    await store.getState().reloadOrgSessions(B);
    await run(() => {
      heldA.release?.();
      return leftBehind;
    });
    expect([...store.getState().orgSessions.keys()]).toEqual([`${B}/org`]);
  });
});
