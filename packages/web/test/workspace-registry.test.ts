/**
 * workspace-registry.ts unit tests: manually-added Workspaces (the header's 新建工作区
 * browse pick) persisted per Project and merged into the sidebar's workspace grouping
 * as EMPTY groups — a picked directory shows up immediately, Sessions or not. Paths
 * normalize (trim + trailing separators dropped, root kept) so picker output dedups
 * against server-resolved Session paths; storage is tolerant of junk; registered paths
 * whose group already exists dedup away at merge time, and temp-shaped paths never
 * form a group. Entries deliberately never auto-prune: once a group's Sessions are
 * deleted, the entry is what keeps the Workspace visible.
 */
import { describe, expect, it } from "vitest";
import {
  loadWorkspaceRegistry,
  mergeRegisteredWorkspaces,
  normalizeWorkspacePath,
  registerWorkspace,
  saveWorkspaceRegistry,
  workspaceRegistryKey,
} from "../src/lib/workspace-registry";
import type { WorkspaceRegistryStorage } from "../src/lib/workspace-registry";
import { TEMP_WORKSPACE_GROUP_KEY } from "../src/lib/session-grouping";
import type { WorkspaceGroup } from "../src/lib/session-grouping";

/** In-memory storage (vitest runs in a Node environment, no localStorage; draft-cache.test.ts convention). */
function memStorage(): WorkspaceRegistryStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

/** Minimal session-derived group (only the fields the merge reads matter). */
function group(key: string, over: Partial<WorkspaceGroup<{ id: string }>> = {}) {
  return {
    key,
    label: key.split("/").filter(Boolean).pop() ?? "/",
    fullPath: key,
    temp: false,
    sessions: [] as { id: string }[],
    ...over,
  };
}

describe("normalizeWorkspacePath", () => {
  it("trims and drops trailing separators; the filesystem root survives; empty stays empty", () => {
    expect(normalizeWorkspacePath("  /srv/app/  ")).toBe("/srv/app");
    expect(normalizeWorkspacePath("/srv/app///")).toBe("/srv/app");
    expect(normalizeWorkspacePath("C:\\work\\repo\\")).toBe("C:\\work\\repo");
    expect(normalizeWorkspacePath("/")).toBe("/");
    expect(normalizeWorkspacePath("   ")).toBe("");
  });
});

describe("registerWorkspace", () => {
  it("prepends the normalized pick (newest first) and dedups by normalized form with a same-reference fast exit", () => {
    const empty: readonly string[] = [];
    const one = registerWorkspace(empty, "/srv/app/");
    expect(one).toEqual(["/srv/app"]);
    const two = registerWorkspace(one, "/srv/beta");
    expect(two).toEqual(["/srv/beta", "/srv/app"]);
    // Already registered (under a trailing-separator variant) or empty: the INPUT array returns.
    expect(registerWorkspace(two, "/srv/app///")).toBe(two);
    expect(registerWorkspace(two, "   ")).toBe(two);
  });
});

describe("persisted registry (per-Project localStorage)", () => {
  it("round-trips per Project; nothing stored / no Project is empty; reading never writes", () => {
    const s = memStorage();
    expect(loadWorkspaceRegistry("p1", s)).toEqual([]);
    expect(loadWorkspaceRegistry(null, s)).toEqual([]);
    expect(s.map.size).toBe(0);
    saveWorkspaceRegistry(null, ["/x"], s);
    expect(s.map.size).toBe(0);
    saveWorkspaceRegistry("p1", ["/srv/beta", "/srv/app"], s);
    saveWorkspaceRegistry("p2", ["/other"], s);
    expect(loadWorkspaceRegistry("p1", s)).toEqual(["/srv/beta", "/srv/app"]);
    expect(loadWorkspaceRegistry("p2", s)).toEqual(["/other"]);
  });

  it("malformed values degrade to empty; junk elements are dropped and stored entries re-normalize + dedup", () => {
    const s = memStorage();
    for (const raw of ["{not json", '"x"', "42", "null", "{}", ""]) {
      s.map.set(workspaceRegistryKey("p1"), raw);
      expect(loadWorkspaceRegistry("p1", s)).toEqual([]);
    }
    s.map.set(workspaceRegistryKey("p1"), '["/srv/app/", 7, null, "  ", "/srv/app", "/b"]');
    expect(loadWorkspaceRegistry("p1", s)).toEqual(["/srv/app", "/b"]);
  });

  it("storage throwing (quota/private mode): save does not throw, load yields empty", () => {
    const broken: WorkspaceRegistryStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => saveWorkspaceRegistry("p1", ["/x"], broken)).not.toThrow();
    expect(loadWorkspaceRegistry("p1", broken)).toEqual([]);
  });
});

describe("mergeRegisteredWorkspaces", () => {
  it("registered-only paths become empty groups prepended in registration order; session-backed paths dedup away", () => {
    const groups = [group("/srv/app", { sessions: [{ id: "s1" }] }), group("/srv/beta")];
    const merged = mergeRegisteredWorkspaces(groups, ["/new/ws", "/srv/app", "/another"]);
    expect(merged.map((g) => g.key)).toEqual(["/new/ws", "/another", "/srv/app", "/srv/beta"]);
    const empty = merged[0]!;
    expect(empty.sessions).toEqual([]);
    expect(empty.label).toBe("ws");
    expect(empty.fullPath).toBe("/new/ws");
    expect(empty.temp).toBe(false);
    // Session-derived groups pass through untouched (same members, same order).
    expect(merged[2]!.sessions).toEqual([{ id: "s1" }]);
  });

  it("temp-shaped registered paths never form a group (the merged temp group owns that space); no registrations = groups pass through", () => {
    const tempPath = "/home/u/.penguin/agents/a/workspaces/tmp-0123abcd";
    const groups = [group(TEMP_WORKSPACE_GROUP_KEY, { temp: true, fullPath: null, label: "" })];
    expect(mergeRegisteredWorkspaces(groups, [tempPath]).map((g) => g.key)).toEqual([
      TEMP_WORKSPACE_GROUP_KEY,
    ]);
    expect(mergeRegisteredWorkspaces(groups, []).map((g) => g.key)).toEqual([
      TEMP_WORKSPACE_GROUP_KEY,
    ]);
  });
});
