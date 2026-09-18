import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectStore } from "../src/state/project";

const project = (projectId: string) => ({
  projectId,
  name: projectId,
  role: "owner" as const,
  ownerUserId: "author",
  createdAt: "2026-09-19",
});

afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  let projects = [project("one"), project("two")];
  const storage = new Map([["penguin.lastProjectId", "one"]]);
  const requests: { url: string; method: string }[] = [];
  let agents: () => Promise<Response> = async () => Response.json({ agents: [] });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit) => {
      const method = options.method ?? "GET";
      requests.push({ url, method });
      if (url.endsWith("/agents")) return agents();
      if (method === "DELETE") {
        projects = projects.filter((item) => !url.endsWith(`/${item.projectId}`));
        return new Response(null, { status: 204 });
      }
      return Response.json(url === "/api/projects" ? { projects } : {});
    }),
  );
  const store = createProjectStore();
  await store.getState().reloadProjects();
  return {
    store,
    storage,
    requests,
    removeCurrent: () => {
      projects = [project("two")];
    },
    pendingAgents: (read: () => Promise<Response>) => {
      agents = read;
    },
  };
}

describe("Project selection and local editor guards", () => {
  it("detaches a removed selection after declining fallback, without retaining access or changing preferences", async () => {
    const f = await fixture();
    const guard = vi.fn(() => false);
    f.store.getState().registerProjectChangeGuard(guard);
    f.removeCurrent();
    await f.store.getState().reloadProjects();
    expect(f.store.getState()).toMatchObject({
      currentProjectId: null,
      unavailableProjectId: "one",
      projects: [project("two")],
      agents: [],
      currentAgentId: null,
    });
    await f.store.getState().reloadProjects();
    f.store.getState().setCurrentProjectId("two");
    expect(f.store.getState().unavailableProjectId).toBe("one");
    expect(f.storage.get("penguin.lastProjectId")).toBe("one");
    expect(f.requests.filter((request) => request.method === "PUT")).toEqual([]);
    guard.mockReturnValue(true);
    f.store.getState().setCurrentProjectId("two");
    expect(f.store.getState()).toMatchObject({
      currentProjectId: "two",
      unavailableProjectId: null,
    });
    expect(f.storage.get("penguin.lastProjectId")).toBe("two");
  });

  it("asks before DELETE, and applies an approved deletion without asking after the Project is gone", async () => {
    const f = await fixture();
    const guard = vi.fn(() => false);
    f.store.getState().registerProjectChangeGuard(guard);
    expect(await f.store.getState().deleteProject("one")).toBe(false);
    expect(f.requests.some((request) => request.method === "DELETE")).toBe(false);
    expect(f.store.getState().currentProjectId).toBe("one");
    guard.mockReturnValue(true);
    expect(await f.store.getState().deleteProject("one")).toBe(true);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(f.store.getState()).toMatchObject({
      currentProjectId: "two",
      unavailableProjectId: null,
    });
    expect(f.store.getState().projects).toEqual([project("two")]);
  });

  it("drops a late agent response after access to its Project disappears", async () => {
    const f = await fixture();
    let resolve!: (response: Response) => void;
    f.pendingAgents(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = f.store.getState().reloadAgents();
    f.store.getState().registerProjectChangeGuard(() => false);
    f.removeCurrent();
    await f.store.getState().reloadProjects();
    resolve(Response.json({ agents: [{ agentId: "old-agent" }] }));
    await pending;
    expect(f.store.getState()).toMatchObject({
      currentProjectId: null,
      agents: [],
      currentAgentId: null,
      agentsLoading: false,
    });
  });
});
