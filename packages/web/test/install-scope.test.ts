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
 *
 * The classification is also checked against the SOURCE rather than against a fixture: a key
 * added to the app and forgotten here is the one way this module silently stops working.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setUnauthorizedHandler } from "../src/api/client";
import {
  bootInstallScope,
  INSTALL_ID_KEY,
  KEY_RULES,
  reactToInstallIdChange,
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
    "penguin.todoDismissed.default_project": '{"errors":"2026-08-26T00:00:00.000Z"}',
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

const WEB_SRC = fileURLToPath(new URL("../src", import.meta.url));

/**
 * Keys the source contains that KEY_RULES deliberately does not classify, each with the
 * reason. Anything else the scan finds has to be in the table: a key the sweep does not
 * recognise is left alone, which is exactly how the bug this module fixes comes back.
 */
const UNCLASSIFIED_ON_PURPOSE: Record<string, string> = {
  "penguin.installId": "the marker itself — it is what the comparison reads, never swept",
  "penguin.chatRouteApplied.":
    "sessionStorage: scoped to one tab's history, so it cannot outlive a data root",
};

/**
 * Every `penguin.*` key literal in the web source, mapped to the file it was found in.
 *
 * Block comments are stripped first, and a match must follow a quote or backtick: prose
 * names key PREFIXES (`penguin.terminal.`), a family without its dot, and the product's own
 * domain in an example URL (`penguin.ooo`), and none of those is a storage key.
 */
function storageKeysInSource(): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        const code = fs.readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        for (const match of code.matchAll(/["'`](penguin\.[A-Za-z0-9_.]*)/g)) {
          const key = match[1]!;
          if (!found.has(key)) found.set(key, path.relative(WEB_SRC, full));
        }
      }
    }
  };
  walk(WEB_SRC);
  return found;
}

describe("install-scope classification", () => {
  it("classifies every penguin.* key the web source actually persists", () => {
    const found = storageKeysInSource();
    // A scan that finds nothing would pass every assertion below without checking anything.
    expect(found.size).toBeGreaterThan(20);
    for (const [key, file] of found) {
      if (key in UNCLASSIFIED_ON_PURPOSE) continue;
      expect(scopeOfKey(key), `${key} (src/${file}) is missing from KEY_RULES`).not.toBeNull();
    }
  });

  it("keeps the deliberate exclusions honest: each is still a key the source contains", () => {
    const found = storageKeysInSource();
    for (const key of Object.keys(UNCLASSIFIED_ON_PURPOSE)) {
      expect(found.has(key), `${key} is no longer in the source`).toBe(true);
    }
  });

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

  it("a sweep whose marker cannot be recorded is reported apart from one that stuck", () => {
    const storage = populated();
    storage.map.set(INSTALL_ID_KEY, "root-a");
    const readOnlyMarker: InstallScopeStorage = {
      ...storage,
      get length(): number {
        return storage.length;
      },
      key: (i) => storage.key(i),
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };

    // The keys still go; only the marker fails to land, so the next load compares again.
    expect(reconcileInstallScope("root-b", readOnlyMarker)).toBe("swept-unrecorded");
    expect(storage.map.has("penguin.chatDraft.admin.default_project")).toBe(false);
    expect(storage.map.get(INSTALL_ID_KEY)).toBe("root-a");
    expect(storage.map.get("penguin.theme")).toBe("dark");
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

  it("a non-2xx answer sweeps nothing", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ error: { code: "unauthorized", message: "Not signed in." } }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );
    // apiFetch takes a different branch from the network failure above: it parses the error
    // body and, for a 401 outside /api/auth/, calls the global sign-out hook. Nothing is
    // registered at this point in the boot — AuthProvider installs one during the first
    // render, which has not happened — so the probe stays invisible; the spy pins that the
    // hook is reached at all, since registering one EARLIER would then sign the user out.
    const signedOut = vi.fn();
    setUnauthorizedHandler(signedOut);
    const storage = populated();
    storage.map.set(INSTALL_ID_KEY, "root-a");
    const before = new Map(storage.map);

    try {
      await expect(syncInstallScope(storage)).resolves.toBe("unknown");
      expect(signedOut).toHaveBeenCalledTimes(1);
      expect(snap(storage.map)).toEqual(snap(before));
    } finally {
      setUnauthorizedHandler(null);
    }
  });

  it("gives up on a server that never answers, after three seconds, having swept nothing", async () => {
    vi.useFakeTimers();
    try {
      // A request that never settles: the page renders nothing until this resolves, so the
      // bound is the whole reason the timeout exists.
      vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
      const storage = populated();
      storage.map.set(INSTALL_ID_KEY, "root-a");
      const before = new Map(storage.map);

      const pending = syncInstallScope(storage);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(2999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toBe("unknown");
      expect(snap(storage.map)).toEqual(snap(before));
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The two-pass boot. dock-state.ts parses `penguin.dock.layout` into module state AT MODULE
 * EVALUATION, which ES semantics put before main.tsx's first statement — so these tests
 * install the storage global first and import that module dynamically, in the order a
 * browser does it.
 */
describe("bootInstallScope", () => {
  /** A bottom dock holding one terminal tab, arranged against the root that is about to go. */
  const DOCK_FROM_ROOT_A = JSON.stringify({
    scopes: {
      "session-1": {
        right: { tabs: [], active: null, open: false },
        bottom: { tabs: ["terminal:term-abc"], active: "terminal:term-abc", open: true },
        focus: "bottom",
      },
    },
    bottomRatio: 0.4,
  });

  function installStorageGlobal(storage: InstallScopeStorage): void {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  }

  function serverReports(installId: string | null): void {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ installId }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "localStorage");
    vi.resetModules();
  });

  it("a swept boot reloads instead of rendering, and the second pass cannot resurrect the dock", async () => {
    const storage = memStorage({
      [INSTALL_ID_KEY]: "root-a",
      "penguin.dock.layout": DOCK_FROM_ROOT_A,
      "penguin.theme": "dark",
    });
    installStorageGlobal(storage);
    serverReports("root-b");

    // Pass one. Every module evaluates before main.tsx runs a statement, so dock-state is
    // already holding the pre-wipe map — including a terminal tab whose shell died with the
    // old root — and its first scope switch would write the whole thing back.
    vi.resetModules();
    await import("../src/features/dock/dock-state");

    expect(await bootInstallScope()).toBe("reload");
    expect(storage.map.has("penguin.dock.layout")).toBe(false);

    // Pass two — the reload. Every module re-evaluates against the swept store.
    vi.resetModules();
    const dock = await import("../src/features/dock/dock-state");
    expect(await bootInstallScope()).toBe("mount");

    // The first route resolution's setDockScope is what persisted the old map; here it can
    // only persist what the fresh evaluation read, which is nothing.
    dock.setDockScope("new");
    const persisted = storage.map.get("penguin.dock.layout") ?? "";
    expect(persisted).not.toContain("term-abc");
    expect(persisted).not.toContain("session-1");
    expect(storage.map.get("penguin.theme")).toBe("dark");
  });

  it("mounts on every outcome that swept nothing, and on a sweep that could not be recorded", async () => {
    const unchanged = memStorage({ [INSTALL_ID_KEY]: "root-a" });
    installStorageGlobal(unchanged);
    serverReports("root-a");
    expect(await bootInstallScope()).toBe("mount");

    const firstSight = memStorage({ "penguin.theme": "dark" });
    installStorageGlobal(firstSight);
    serverReports("root-a");
    expect(await bootInstallScope()).toBe("mount");

    const unknown = memStorage({ [INSTALL_ID_KEY]: "root-a" });
    installStorageGlobal(unknown);
    serverReports(null);
    expect(await bootInstallScope()).toBe("mount");

    // The reload would otherwise repeat forever: sweep, fail to record, reload, sweep again.
    const backing = memStorage({ [INSTALL_ID_KEY]: "root-a", "penguin.lastProjectId": "p1" });
    installStorageGlobal({
      ...backing,
      get length(): number {
        return backing.length;
      },
      key: (i) => backing.key(i),
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    serverReports("root-b");
    expect(await bootInstallScope()).toBe("mount");
    expect(backing.map.has("penguin.lastProjectId")).toBe(false);
  });
});

describe("a tab left open across the wipe", () => {
  it("sweeps its own re-persisted state when another tab records a different root", () => {
    const storage = populated();
    storage.map.set(INSTALL_ID_KEY, "root-b"); // the other tab already recorded it

    const stale = reactToInstallIdChange(
      { key: INSTALL_ID_KEY, oldValue: "root-a", newValue: "root-b" },
      storage,
    );

    expect(stale).toBe(true);
    for (const key of storage.map.keys()) {
      expect(scopeOfKey(key), `${key} survived the sweep`).not.toBe("install");
    }
    expect(storage.map.get("penguin.theme")).toBe("dark");
  });

  it("ignores the other tab's FIRST recording, which swept nothing itself", () => {
    const storage = populated();
    const before = new Map(storage.map);

    expect(
      reactToInstallIdChange({ key: INSTALL_ID_KEY, oldValue: null, newValue: "root-a" }, storage),
    ).toBe(false);
    expect(snap(storage.map)).toEqual(snap(before));
  });

  it("ignores site data being cleared, and a rewrite of the same id", () => {
    const storage = populated();
    const before = new Map(storage.map);

    expect(
      reactToInstallIdChange({ key: INSTALL_ID_KEY, oldValue: "root-a", newValue: null }, storage),
    ).toBe(false);
    expect(
      reactToInstallIdChange(
        { key: INSTALL_ID_KEY, oldValue: "root-a", newValue: "root-a" },
        storage,
      ),
    ).toBe(false);
    expect(snap(storage.map)).toEqual(snap(before));
  });

  it("ignores every other key, including the ones it would otherwise sweep", () => {
    const storage = populated();
    const before = new Map(storage.map);

    expect(
      reactToInstallIdChange(
        { key: "penguin.pinnedSessions.default_project", oldValue: "[]", newValue: '["s1"]' },
        storage,
      ),
    ).toBe(false);
    expect(reactToInstallIdChange({ key: null, oldValue: null, newValue: null }, storage)).toBe(
      false,
    );
    expect(snap(storage.map)).toEqual(snap(before));
  });
});
