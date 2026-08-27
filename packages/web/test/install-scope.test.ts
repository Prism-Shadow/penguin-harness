/**
 * install-scope.ts unit tests: reconciling browser-persisted UI state against the data root
 * the server is actually serving.
 *
 * The decision table, in full — a changed install id sweeps the keys that reference server
 * entities and leaves browser preferences alone; an unchanged id (every ordinary restart)
 * touches nothing; a first sight with keys and no recorded id ADOPTS without sweeping, so
 * upgrading into this release never destroys legitimate state; an unknown id changes
 * nothing at all. Plus the two matching traps the classification exists to avoid
 * (`penguin.sidebarCollapsed` under `penguin.sidebarCollapsedGroups.`,
 * `penguin.terminal.theme` beside `penguin.terminal.page.id`), and storage that throws.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INSTALL_ID_KEY,
  KEY_RULES,
  reconcileInstallScope,
  scopeOfKey,
  syncInstallScope,
} from "../src/lib/install-scope";
import type { InstallScopeStorage } from "../src/lib/install-scope";

/** In-memory storage (vitest runs in a Node environment, no localStorage; pinned-sessions.test.ts convention). */
function memStorage(entries: Record<string, string> = {}): InstallScopeStorage & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** A representative populated store: install-scoped state on the left, preferences on the right. */
function populated(): ReturnType<typeof memStorage> {
  return memStorage({
    "penguin.chatDraft.admin.default_project": '{"workspace":"/srv/app","agentId":"default_agent"}',
    "penguin.chatDraft.session.admin.session-1": '{"text":"half a sentence"}',
    "penguin.chatDrafts.admin.default_project": '[{"id":"draft-abcd1234"}]',
    "penguin.sidebarWorkspaces.default_project": '[{"path":"/srv/app"}]',
    "penguin.pinnedSessions.default_project": '["session-1"]',
    "penguin.sessionOrder.default_project.workspace": '["session-1"]',
    "penguin.sessionSeen.default_project": '{"session-1":"2026-08-26T00:00:00Z"}',
    "penguin.groupOrder.default_project.workspace": '["/srv/app"]',
    "penguin.sidebarCollapsedGroups.default_project": '["/srv/app"]',
    "penguin.sidebarPinnedGroups.default_project": '["/srv/app"]',
    "penguin.lastProjectId": "default_project",
    "penguin.lastAgentId.default_project": "default_agent",
    "penguin.memoryCollapsed.admin.default_project.default_agent": '["project"]',
    "penguin.modelsExpandedGroups.default_project": '["anthropic"]',
    "penguin.modelsGroupOrder.default_project": '["anthropic"]',
    "penguin.dock.layout": '{"scopes":{"session-1":{}},"bottomRatio":0.4}',
    "penguin.terminal.page.id": "term-1",

    "penguin.theme": "dark",
    "penguin.fontScale": "lg",
    "penguin.accent": "violet",
    "penguin.currency": "CNY",
    "penguin.terminal.theme": "dark",
    "penguin.lang": "en",
    "penguin.sidebarCollapsed": "1",
    "penguin.panelWidth": "420",
    "penguin.sidebarGroupMode": "agent",
    "penguin.sidebarSortMode": "manual",
    "penguin.sidebarNavGroupCollapsed": "collapsed",
    "penguin.steerMode": "followup",
  });
}

/** Order-independent snapshot of a store, so assertions do not depend on Map insertion order. */
function snap(map: Map<string, string>): [string, string][] {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const PREFERENCE_KEYS = [
  "penguin.theme",
  "penguin.fontScale",
  "penguin.accent",
  "penguin.currency",
  "penguin.terminal.theme",
  "penguin.lang",
  "penguin.sidebarCollapsed",
  "penguin.panelWidth",
  "penguin.sidebarGroupMode",
  "penguin.sidebarSortMode",
  "penguin.sidebarNavGroupCollapsed",
  "penguin.steerMode",
];

describe("install-scope classification", () => {
  it("covers every key the populated fixture holds, with no key both scopes", () => {
    for (const key of populated().map.keys()) {
      expect(scopeOfKey(key), key).not.toBeNull();
    }
    for (const key of PREFERENCE_KEYS) {
      expect(scopeOfKey(key), key).toBe("browser");
    }
  });

  it("an exact preference is not captured by a family that shares its stem", () => {
    // The two traps plain prefix matching would fall into.
    expect(scopeOfKey("penguin.sidebarCollapsed")).toBe("browser");
    expect(scopeOfKey("penguin.sidebarCollapsedGroups.default_project")).toBe("install");
    expect(scopeOfKey("penguin.terminal.theme")).toBe("browser");
    expect(scopeOfKey("penguin.terminal.page.id")).toBe("install");
  });

  it("an unclassified key has no scope, so the sweep leaves it alone", () => {
    expect(scopeOfKey("penguin.somethingAddedLater")).toBeNull();
    expect(scopeOfKey("unrelated-app-key")).toBeNull();
    expect(scopeOfKey(INSTALL_ID_KEY)).toBeNull();
  });

  it("rules are well formed: penguin-namespaced, families dotted, no duplicates", () => {
    const seen = new Set<string>();
    for (const rule of KEY_RULES) {
      expect(rule.key.startsWith("penguin."), rule.key).toBe(true);
      expect(rule.why.length, rule.key).toBeGreaterThan(0);
      if (rule.kind === "family") expect(rule.key.endsWith("."), rule.key).toBe(true);
      expect(seen.has(rule.key), rule.key).toBe(false);
      seen.add(rule.key);
    }
  });
});

describe("reconcileInstallScope", () => {
  it("a changed install id sweeps install-scoped keys and keeps preferences", () => {
    const storage = populated();
    storage.map.set(INSTALL_ID_KEY, "root-a");

    expect(reconcileInstallScope("root-b", storage)).toBe("swept");

    for (const key of storage.map.keys()) {
      expect(scopeOfKey(key), `${key} survived the sweep`).not.toBe("install");
    }
    for (const key of PREFERENCE_KEYS) {
      expect(storage.map.has(key), key).toBe(true);
    }
    expect(storage.map.get("penguin.theme")).toBe("dark");
    expect(storage.map.get(INSTALL_ID_KEY)).toBe("root-b");
  });

  it("the sweep collects orphans from every earlier root, not just the last one", () => {
    // Keys are id-suffixed, so a Project or Session that no longer exists leaves an entry
    // nothing would ever read again. Walking the store is what reaches them.
    const storage = memStorage({
      [INSTALL_ID_KEY]: "root-a",
      "penguin.chatDraft.admin.default_project": "{}",
      "penguin.pinnedSessions.long_gone_project": '["session-9"]',
      "penguin.sessionSeen.another_dead_project": "{}",
      "penguin.theme": "dark",
    });

    expect(reconcileInstallScope("root-b", storage)).toBe("swept");
    expect([...storage.map.keys()].sort()).toEqual([INSTALL_ID_KEY, "penguin.theme"]);
  });

  it("an unchanged install id sweeps nothing (the ordinary server restart)", () => {
    const storage = populated();
    storage.map.set(INSTALL_ID_KEY, "root-a");
    const before = new Map(storage.map);

    expect(reconcileInstallScope("root-a", storage)).toBe("unchanged");
    expect(snap(storage.map)).toEqual(snap(before));
  });

  it("first sight — keys but no recorded id — adopts without sweeping", () => {
    const storage = populated();
    const before = new Map(storage.map);

    expect(reconcileInstallScope("root-a", storage)).toBe("adopted");
    expect(storage.map.get(INSTALL_ID_KEY)).toBe("root-a");
    storage.map.delete(INSTALL_ID_KEY);
    expect(snap(storage.map)).toEqual(snap(before));
  });

  it("an adopted id makes the very next boot an ordinary unchanged one", () => {
    const storage = populated();
    expect(reconcileInstallScope("root-a", storage)).toBe("adopted");
    expect(reconcileInstallScope("root-a", storage)).toBe("unchanged");
    expect(reconcileInstallScope("root-b", storage)).toBe("swept");
  });

  it("an unknown id (server could not establish one) changes nothing at all", () => {
    const storage = populated();
    const before = new Map(storage.map);

    expect(reconcileInstallScope(null, storage)).toBe("unknown");
    expect(snap(storage.map)).toEqual(snap(before));
  });

  it("a throwing store degrades instead of escaping", () => {
    const throwing: InstallScopeStorage = {
      get length(): number {
        throw new Error("site data is blocked");
      },
      key: () => {
        throw new Error("site data is blocked");
      },
      getItem: () => {
        throw new Error("site data is blocked");
      },
      setItem: () => {
        throw new Error("site data is blocked");
      },
      removeItem: () => {
        throw new Error("site data is blocked");
      },
    };
    // getItem throwing reads as "nothing recorded", so this is a first sight that adopts;
    // the adopting write throws too and is swallowed.
    expect(() => reconcileInstallScope("root-a", throwing)).not.toThrow();
    expect(reconcileInstallScope("root-a", throwing)).toBe("adopted");
  });

  it("a store that throws only on enumeration sweeps nothing rather than half of it", () => {
    const storage = populated();
    storage.map.set(INSTALL_ID_KEY, "root-a");
    const before = new Map(storage.map);
    const half: InstallScopeStorage = {
      ...storage,
      get length(): number {
        throw new Error("site data is blocked");
      },
      setItem: (k, v) => storage.setItem(k, v),
    };

    expect(reconcileInstallScope("root-b", half)).toBe("swept");
    before.set(INSTALL_ID_KEY, "root-b");
    expect(snap(storage.map)).toEqual(snap(before));
  });
});

describe("syncInstallScope", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reconciles against the id the server reports", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ installId: "root-b" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const storage = populated();
    storage.map.set(INSTALL_ID_KEY, "root-a");

    expect(await syncInstallScope(storage)).toBe("swept");
    expect(storage.map.has("penguin.chatDraft.admin.default_project")).toBe(false);
    expect(storage.map.get("penguin.theme")).toBe("dark");
  });

  it("a server that cannot be reached sweeps nothing and never rejects", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connection refused");
    });
    const storage = populated();
    storage.map.set(INSTALL_ID_KEY, "root-a");
    const before = new Map(storage.map);

    await expect(syncInstallScope(storage)).resolves.toBe("unknown");
    expect(snap(storage.map)).toEqual(snap(before));
  });

  it("a server reporting a null identity sweeps nothing", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ installId: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const storage = populated();
    storage.map.set(INSTALL_ID_KEY, "root-a");
    const before = new Map(storage.map);

    await expect(syncInstallScope(storage)).resolves.toBe("unknown");
    expect(snap(storage.map)).toEqual(snap(before));
  });

  it("a storage that throws on every access still lets boot proceed", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ installId: "root-b" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const exploding = new Proxy({} as InstallScopeStorage, {
      get() {
        throw new Error("site data is blocked");
      },
    });

    // Every read reads as empty, so this looks like a first sight and adopts — an adoption
    // that stores nothing, because the write throws too. Nothing is destroyed and boot
    // continues, which is the whole requirement.
    await expect(syncInstallScope(exploding)).resolves.toBe("adopted");
  });
});
