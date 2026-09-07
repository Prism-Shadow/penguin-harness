/**
 * The boot prefetch (lib/boot-prefetch.ts): the first round trip leaves at once, and each
 * answer is handed out exactly once, to the consumer it was asked for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../src/api/endpoints", () => ({
  getMe: () => {
    calls.push("me");
    return Promise.resolve({ user: { userId: "admin" } });
  },
  listProjects: () => {
    calls.push("projects");
    return Promise.resolve({ projects: [] });
  },
  listAgents: (projectId: string) => {
    calls.push(`agents:${projectId}`);
    return projectId === "gone"
      ? Promise.reject(new Error("404"))
      : Promise.resolve({ agents: [] });
  },
}));

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
});

const prefetch = await import("../src/lib/boot-prefetch");

describe("boot prefetch", () => {
  beforeEach(() => {
    calls.length = 0;
    storage.clear();
    prefetch.resetBootPrefetch();
  });
  afterEach(() => prefetch.resetBootPrefetch());

  it("asks for the user, the Projects and the remembered Project's Agents in one go", () => {
    storage.set("penguin.lastProjectId", "p1");
    prefetch.prefetchBoot();
    expect(calls).toEqual(["me", "projects", "agents:p1"]);
  });

  it("asks only for the user on the login page, and nothing for an unremembered Project", () => {
    prefetch.prefetchBoot({ signedOut: true });
    expect(calls).toEqual(["me"]);
    prefetch.resetBootPrefetch();
    calls.length = 0;
    prefetch.prefetchBoot();
    expect(calls).toEqual(["me", "projects"]);
  });

  it("starts once however often it is called", () => {
    prefetch.prefetchBoot();
    prefetch.prefetchBoot();
    expect(calls).toEqual(["me", "projects"]);
  });

  it("hands each answer out once, then nothing", async () => {
    storage.set("penguin.lastProjectId", "p1");
    prefetch.prefetchBoot();
    await expect(prefetch.takePrefetchedMe()).resolves.toEqual({ user: { userId: "admin" } });
    expect(prefetch.takePrefetchedMe()).toBeNull();
    await expect(prefetch.takePrefetchedProjects()).resolves.toEqual({ projects: [] });
    expect(prefetch.takePrefetchedProjects()).toBeNull();
    await expect(prefetch.takePrefetchedAgents("p1")).resolves.toEqual({ agents: [] });
    expect(prefetch.takePrefetchedAgents("p1")).toBeNull();
  });

  it("keeps an Agent list for the Project it was asked for, not whichever store asks", () => {
    storage.set("penguin.lastProjectId", "p1");
    prefetch.prefetchBoot();
    expect(prefetch.takePrefetchedAgents("p2")).toBeNull();
    expect(prefetch.takePrefetchedAgents("p1")).not.toBeNull();
  });

  it("lets a failed Agent request reject to its taker, and to nobody else", async () => {
    storage.set("penguin.lastProjectId", "gone");
    prefetch.prefetchBoot();
    await expect(prefetch.takePrefetchedAgents("gone")).rejects.toThrow("404");
  });

  it("holds nothing before the boot asked", () => {
    expect(prefetch.takePrefetchedMe()).toBeNull();
    expect(prefetch.takePrefetchedProjects()).toBeNull();
    expect(prefetch.takePrefetchedAgents("p1")).toBeNull();
  });
});
