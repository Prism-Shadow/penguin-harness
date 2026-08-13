/**
 * workspace-registry.ts unit tests: manually-added Workspaces (the header's 新建工作区
 * browse pick) persisted per Project and merged into the sidebar's workspace grouping
 * as EMPTY groups — a picked directory shows up immediately, Sessions or not. Entries
 * are `{ path, alias? }`: the alias (重命名工作区) replaces the basename as the group
 * label — for session-backed groups too — and a blank alias reverts to the basename;
 * loads keep accepting the branch's earlier string-only stored shape. 删除工作区
 * unregisters the entry only (sidebar-side; disk and Sessions untouched — a group with
 * Sessions simply persists as session-derived). Paths normalize (trim + trailing
 * separators dropped, root kept) so picker output dedups against server-resolved
 * Session paths; storage is tolerant of junk; temp-shaped paths never form a group.
 */
import { describe, expect, it } from "vitest";
import {
  loadWorkspaceRegistry,
  mergeRegisteredWorkspaces,
  normalizeWorkspacePath,
  registerWorkspace,
  saveWorkspaceRegistry,
  setWorkspaceAlias,
  unregisterWorkspace,
  workspaceRegistryKey,
} from "../src/lib/workspace-registry";
import type { WorkspaceEntry, WorkspaceRegistryStorage } from "../src/lib/workspace-registry";
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

  it("a win32 DRIVE root keeps its separator (stripping it would make the path drive-relative)", () => {
    // `C:` resolves against the drive's current directory, so the registry would hold a
    // different location than the user picked — and never dedup with Sessions keyed `C:\`.
    expect(normalizeWorkspacePath("C:\\")).toBe("C:\\");
    expect(normalizeWorkspacePath("c:/")).toBe("c:/");
    expect(normalizeWorkspacePath("  D:\\  ")).toBe("D:\\");
    // Deeper win32 paths still lose their trailing separator.
    expect(normalizeWorkspacePath("C:\\work\\")).toBe("C:\\work");
  });
});

describe("registerWorkspace / unregisterWorkspace", () => {
  it("register prepends the normalized pick (newest first) and dedups by normalized form with a same-reference fast exit", () => {
    const empty: readonly WorkspaceEntry[] = [];
    const one = registerWorkspace(empty, "/srv/app/");
    expect(one).toEqual([{ path: "/srv/app" }]);
    const two = registerWorkspace(one, "/srv/beta");
    expect(two.map((e) => e.path)).toEqual(["/srv/beta", "/srv/app"]);
    // Already registered (under a trailing-separator variant) or empty: the INPUT array returns.
    expect(registerWorkspace(two, "/srv/app///")).toBe(two);
    expect(registerWorkspace(two, "   ")).toBe(two);
  });

  it("rejects a temporary-workspace path: the merge can never group it, so an entry would be an unremovable ghost", () => {
    const entries: readonly WorkspaceEntry[] = [];
    const temp = "/home/u/.penguin/agents/a/workspaces/tmp-0123abcd";
    expect(registerWorkspace(entries, temp)).toBe(entries);
    expect(registerWorkspace(entries, `${temp}/`)).toBe(entries);
  });

  it("unregister drops the entry — alias and all — and returns the SAME array when the path isn't registered", () => {
    const entries: readonly WorkspaceEntry[] = [{ path: "/a", alias: "Alpha" }, { path: "/b" }];
    expect(unregisterWorkspace(entries, "/a")).toEqual([{ path: "/b" }]);
    expect(unregisterWorkspace(entries, "/zzz")).toBe(entries);
  });
});

describe("setWorkspaceAlias", () => {
  const entries: readonly WorkspaceEntry[] = [{ path: "/a" }, { path: "/b" }];

  it("sets a trimmed alias, clears it on blank (revert to basename), and never mutates the input", () => {
    const named = setWorkspaceAlias(entries, "/a", "  My App  ");
    expect(named).toEqual([{ path: "/a", alias: "My App" }, { path: "/b" }]);
    expect(entries[0]).toEqual({ path: "/a" }); // input untouched (React state discipline)
    expect(setWorkspaceAlias(named, "/a", "   ")).toEqual([{ path: "/a" }, { path: "/b" }]);
  });

  it("same-reference fast exit: unknown path, unchanged alias, or clearing an alias that isn't set", () => {
    expect(setWorkspaceAlias(entries, "/zzz", "X")).toBe(entries);
    expect(setWorkspaceAlias(entries, "/a", "")).toBe(entries);
    const named = setWorkspaceAlias(entries, "/a", "X");
    expect(setWorkspaceAlias(named, "/a", " X ")).toBe(named);
  });
});

describe("persisted registry (per-Project localStorage)", () => {
  it("round-trips entries (alias included) per Project; nothing stored / no Project is empty; reading never writes", () => {
    const s = memStorage();
    expect(loadWorkspaceRegistry("p1", s)).toEqual([]);
    expect(loadWorkspaceRegistry(null, s)).toEqual([]);
    expect(s.map.size).toBe(0);
    saveWorkspaceRegistry(null, [{ path: "/x" }], s);
    expect(s.map.size).toBe(0);
    saveWorkspaceRegistry("p1", [{ path: "/srv/beta", alias: "Beta" }, { path: "/srv/app" }], s);
    saveWorkspaceRegistry("p2", [{ path: "/other" }], s);
    expect(loadWorkspaceRegistry("p1", s)).toEqual([
      { path: "/srv/beta", alias: "Beta" },
      { path: "/srv/app" },
    ]);
    expect(loadWorkspaceRegistry("p2", s)).toEqual([{ path: "/other" }]);
  });

  it("still loads the branch's earlier string-only shape, mixed with entry objects", () => {
    const s = memStorage();
    s.map.set(
      workspaceRegistryKey("p1"),
      '["/old/one/", {"path": "/new/two", "alias": " Two "}, "/old/one"]',
    );
    expect(loadWorkspaceRegistry("p1", s)).toEqual([
      { path: "/old/one" },
      { path: "/new/two", alias: "Two" },
    ]);
  });

  it("malformed values degrade to empty; junk elements and junk aliases are dropped", () => {
    const s = memStorage();
    for (const raw of ["{not json", '"x"', "42", "null", "{}", ""]) {
      s.map.set(workspaceRegistryKey("p1"), raw);
      expect(loadWorkspaceRegistry("p1", s)).toEqual([]);
    }
    s.map.set(
      workspaceRegistryKey("p1"),
      '[7, null, "  ", {"alias": "orphan"}, {"path": "/a", "alias": 5}, {"path": "/b", "alias": "  "}]',
    );
    expect(loadWorkspaceRegistry("p1", s)).toEqual([{ path: "/a" }, { path: "/b" }]);
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
    expect(() => saveWorkspaceRegistry("p1", [{ path: "/x" }], broken)).not.toThrow();
    expect(loadWorkspaceRegistry("p1", broken)).toEqual([]);
  });

  it("storage whose GETTER throws (blocked site data) degrades instead of escaping the useState initializer", () => {
    const hostile = {
      get getItem(): never {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    } as unknown as WorkspaceRegistryStorage;
    expect(() => loadWorkspaceRegistry("p1", hostile)).not.toThrow();
    expect(loadWorkspaceRegistry("p1", hostile)).toEqual([]);
  });
});

describe("mergeRegisteredWorkspaces", () => {
  it("empty registered groups sort AFTER the session-backed ones, so real conversations keep the capped window", () => {
    // Fronting them pushed every group holding chats behind 更多分组 (10-group cap) as
    // soon as a few Workspaces were registered.
    const groups = [group("/srv/app", { sessions: [{ id: "s1" }] }), group("/srv/beta")];
    const merged = mergeRegisteredWorkspaces(groups, [
      { path: "/new/ws", alias: "Fancy" },
      { path: "/srv/app" },
      { path: "/another" },
    ]);
    expect(merged.map((g) => g.key)).toEqual(["/srv/app", "/srv/beta", "/new/ws", "/another"]);
    // Session-derived groups pass through untouched (same members, same order) …
    expect(merged[0]!.sessions).toEqual([{ id: "s1" }]);
    // … and the registered-only ones follow in registration order, labelled alias ?? basename.
    expect(merged[2]).toMatchObject({ label: "Fancy", fullPath: "/new/ws", temp: false });
    expect(merged[2]!.sessions).toEqual([]);
    expect(merged[3]!.label).toBe("another");
  });

  it("an alias relabels a session-backed group too (the entry dedups away but its name wins)", () => {
    const groups = [group("/srv/app", { sessions: [{ id: "s1" }] })];
    const merged = mergeRegisteredWorkspaces(groups, [{ path: "/srv/app", alias: "Prod" }]);
    expect(merged.map((g) => g.key)).toEqual(["/srv/app"]);
    expect(merged[0]!.label).toBe("Prod");
    expect(merged[0]!.fullPath).toBe("/srv/app"); // tooltip keeps the full path
  });

  it("temp-shaped registered paths never form a group (the merged temp group owns that space); no registrations = groups pass through", () => {
    const tempPath = "/home/u/.penguin/agents/a/workspaces/tmp-0123abcd";
    const groups = [group(TEMP_WORKSPACE_GROUP_KEY, { temp: true, fullPath: null, label: "" })];
    expect(mergeRegisteredWorkspaces(groups, [{ path: tempPath }]).map((g) => g.key)).toEqual([
      TEMP_WORKSPACE_GROUP_KEY,
    ]);
    expect(mergeRegisteredWorkspaces(groups, []).map((g) => g.key)).toEqual([
      TEMP_WORKSPACE_GROUP_KEY,
    ]);
  });
});
