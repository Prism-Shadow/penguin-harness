/**
 * Install scope (lib/install-scope.ts): browser state that names one data root's entities is
 * swept when the server starts serving a different root, and nothing else ever is.
 *
 * - Every `penguin.*` key the source persists is classified — checked against the source, since
 *   a key added to the app and forgotten here is the one way this module silently stops working;
 *   each deliberate exclusion is still a key the source contains.
 * - An exact preference is never captured by a family that shares its stem
 *   (`penguin.sidebarCollapsed` beside `penguin.sidebarCollapsedGroups.`, `penguin.terminal.theme`
 *   beside `penguin.terminal.page.id`); the rule table is well formed.
 * - A changed install id sweeps the install-scoped keys, orphans of every earlier root included,
 *   and keeps the preferences and every key no rule covers.
 * - An unchanged id (every ordinary restart) sweeps nothing; a first sight adopts without
 *   sweeping, and the next boot is an ordinary one.
 * - A sweep whose marker cannot be written back is reported apart from one that stuck; a store
 *   that throws only on enumeration sweeps nothing rather than half of it.
 * - Asking the server: an unreachable server, a null identity, a 401 and a server that never
 *   answers (three seconds) all sweep nothing; blocked site data still lets boot proceed.
 * - A swept boot reloads, and the second pass cannot resurrect the dock; every other outcome
 *   mounts, a sweep that could not be recorded included.
 * - A tab left open across the wipe sweeps what it re-persisted when another tab records a
 *   different root, and ignores a first recording, a clear, a rewrite and every other key.
 */
import { describe, expect, it, vi } from "vitest";
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
import { apiError, json, stubFetch } from "./helpers/fetch";
import { expectEveryRootScanned, scanSources } from "./helpers/roots";
import type { SourceScan } from "./helpers/roots";
import { blockedStorage, memoryStorage, stubLocalStorage } from "./helpers/storage";
import type { MemoryStorage } from "./helpers/storage";

/** State that names the data root's Projects, Sessions, Workspaces and terminals. */
const INSTALL_STATE: Record<string, string> = {
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
  "penguin.orgTempSessions.admin.default_project.acme":
    '[{"sessionId":"session-2","agentId":"acme_dev","title":"Build the site"}]',
};

/** This browser's preferences, whatever root it talks to. */
const PREFERENCES: Record<string, string> = {
  "penguin.theme": "dark",
  "penguin.themeId": "geek",
  "penguin.textSize": "l",
  "penguin.fontScale": "lg",
  "penguin.fontLatin": "mona-sans",
  "penguin.fontCjk": "noto-sans-sc",
  "penguin.accent": "violet",
  "penguin.currency": "CNY",
  "penguin.terminal.theme": "dark",
  "penguin.lang": "en",
  "penguin.sidebarCollapsed": "1",
  "penguin.panelWidth": "420",
  "penguin.sidebarGroupMode": "agent",
  "penguin.sidebarSortMode": "manual",
  "penguin.sidebarNavGroupCollapsed": "collapsed",
  "penguin.sidebarNavPinned": '{"models":false}',
  "penguin.steerMode": "followup",
  "penguin.dock.launcherY": "0.25",
  "penguin.dock.launcherHidden": "1",
  "penguin.files.treeVisible": "0",
  "penguin.files.treeWidth": "220",
  "penguin.files.editorWrap": "1",
  "penguin.notifications": "1",
  "penguin.keybindings": '{"v":1,"linux":{"terminal.close":"Mod+Alt+KeyW"}}',
};

/** A store holding both halves, with `marker` recorded as the install id when given. */
function populated(marker?: string): MemoryStorage {
  return memoryStorage({
    ...INSTALL_STATE,
    ...PREFERENCES,
    ...(marker === undefined ? {} : { [INSTALL_ID_KEY]: marker }),
  });
}

/** Order-independent snapshot of a store, so assertions do not depend on Map insertion order. */
function snap(entries: Iterable<[string, string]>): [string, string][] {
  return [...entries].sort(([a], [b]) => a.localeCompare(b));
}

/** `before` with the marker set to `installId`. */
function marked(before: [string, string][], installId: string): [string, string][] {
  const entries = new Map(before);
  entries.set(INSTALL_ID_KEY, installId);
  return snap(entries);
}

/** What a populated store holds once swept onto `installId`: the preferences and the marker. */
function sweptOnto(installId: string): [string, string][] {
  return marked(Object.entries(PREFERENCES), installId);
}

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
 * Every `penguin.*` key literal in the scanned source, mapped to the file it was found in.
 *
 * Block comments are stripped first, and a match must follow a quote or backtick: prose
 * names key PREFIXES (`penguin.terminal.`), a family without its dot, and the product's own
 * domain in an example URL (`penguin.ooo`), and none of those is a storage key.
 */
function storageKeysIn(scan: SourceScan): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of scan.files) {
    const code = file.text.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of code.matchAll(/["'`](penguin\.[A-Za-z0-9_.]*)/g)) {
      const key = match[1]!;
      if (!found.has(key)) found.set(key, file.id);
    }
  }
  return found;
}

describe("install-scope classification", () => {
  it("classifies every penguin.* key the source persists, and each exclusion is still one of them", () => {
    const scan = scanSources([".ts", ".tsx"]);
    expectEveryRootScanned(scan);
    const found = storageKeysIn(scan);
    // A scan that finds nothing would pass every assertion below without checking anything.
    expect(found.size).toBeGreaterThan(20);
    for (const [key, file] of found) {
      if (key in UNCLASSIFIED_ON_PURPOSE) continue;
      expect(scopeOfKey(key), `${key} (${file}) is missing from KEY_RULES`).not.toBeNull();
    }
    for (const key of Object.keys(UNCLASSIFIED_ON_PURPOSE)) {
      expect(found.has(key), `${key} is no longer in the source`).toBe(true);
    }
  });

  it("an exact preference is not captured by a family that shares its stem", () => {
    // The two traps plain prefix matching would fall into.
    expect(scopeOfKey("penguin.sidebarCollapsed")).toBe("browser");
    expect(scopeOfKey("penguin.sidebarCollapsedGroups.default_project")).toBe("install");
    expect(scopeOfKey("penguin.terminal.theme")).toBe("browser");
    expect(scopeOfKey("penguin.terminal.page.id")).toBe("install");
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
  it("a changed install id sweeps the install-scoped keys and keeps the preferences", () => {
    const storage = populated("root-a");

    expect(reconcileInstallScope("root-b", storage)).toBe("swept");
    expect(snap(storage.map)).toEqual(sweptOnto("root-b"));
  });

  it("the sweep collects orphans of every earlier root, and leaves keys no rule covers", () => {
    // Keys are id-suffixed, so a Project or Session that no longer exists leaves an entry
    // nothing would ever read again. Walking the store is what reaches them.
    const storage = memoryStorage({
      [INSTALL_ID_KEY]: "root-a",
      "penguin.chatDraft.admin.default_project": "{}",
      "penguin.pinnedSessions.long_gone_project": '["session-9"]',
      "penguin.sessionSeen.another_dead_project": "{}",
      "penguin.theme": "dark",
      "penguin.somethingAddedLater": "1",
      "unrelated-app-key": "1",
    });

    expect(reconcileInstallScope("root-b", storage)).toBe("swept");
    expect([...storage.map.keys()].sort()).toEqual(
      [INSTALL_ID_KEY, "penguin.somethingAddedLater", "penguin.theme", "unrelated-app-key"].sort(),
    );
  });

  it("an unchanged install id sweeps nothing (the ordinary server restart)", () => {
    const storage = populated("root-a");
    const before = snap(storage.map);

    expect(reconcileInstallScope("root-a", storage)).toBe("unchanged");
    expect(snap(storage.map)).toEqual(before);
  });

  it("first sight — keys but no recorded id — adopts without sweeping, and the next boot is an ordinary one", () => {
    const storage = populated();
    const before = snap(storage.map);

    expect(reconcileInstallScope("root-a", storage)).toBe("adopted");
    expect(snap(storage.map)).toEqual(marked(before, "root-a"));
    expect(reconcileInstallScope("root-a", storage)).toBe("unchanged");
    expect(reconcileInstallScope("root-b", storage)).toBe("swept");
  });

  it("a sweep whose marker cannot be recorded is reported apart from one that stuck", () => {
    const storage = populated("root-a");
    const readOnlyMarker: InstallScopeStorage = {
      ...storage,
      get length(): number {
        return storage.length;
      },
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };

    // The keys still go; only the marker fails to land, so the next load compares again.
    expect(reconcileInstallScope("root-b", readOnlyMarker)).toBe("swept-unrecorded");
    expect(snap(storage.map)).toEqual(sweptOnto("root-a"));
  });

  it("a store that throws only on enumeration sweeps nothing rather than half of it", () => {
    const storage = populated("root-a");
    const before = snap(storage.map);
    const half: InstallScopeStorage = {
      ...storage,
      get length(): number {
        throw new Error("site data is blocked");
      },
    };

    expect(reconcileInstallScope("root-b", half)).toBe("swept");
    expect(snap(storage.map)).toEqual(marked(before, "root-b"));
  });
});

describe("syncInstallScope", () => {
  it("a server that cannot be reached sweeps nothing and never rejects", async () => {
    stubFetch(() => {
      throw new Error("connection refused");
    });
    const storage = populated("root-a");
    const before = snap(storage.map);

    await expect(syncInstallScope(storage)).resolves.toBe("unknown");
    expect(snap(storage.map)).toEqual(before);
  });

  it("a server reporting a null identity sweeps nothing", async () => {
    stubFetch(() => json({ installId: null }));
    const storage = populated("root-a");
    const before = snap(storage.map);

    await expect(syncInstallScope(storage)).resolves.toBe("unknown");
    expect(snap(storage.map)).toEqual(before);
  });

  it("a non-2xx answer sweeps nothing", async () => {
    stubFetch(() => apiError(401, "unauthorized", "Not signed in."));
    // apiFetch takes a different branch from the network failure above: it parses the error
    // body and, for a 401 outside /api/auth/, calls the global sign-out hook. Nothing is
    // registered at this point in the boot — AuthProvider installs one during the first
    // render, which has not happened — so the probe stays invisible; the spy pins that the
    // hook is reached at all, since registering one EARLIER would then sign the user out.
    const signedOut = vi.fn();
    setUnauthorizedHandler(signedOut);
    const storage = populated("root-a");
    const before = snap(storage.map);

    try {
      await expect(syncInstallScope(storage)).resolves.toBe("unknown");
      expect(signedOut).toHaveBeenCalledTimes(1);
      expect(snap(storage.map)).toEqual(before);
    } finally {
      setUnauthorizedHandler(null);
    }
  });

  it("gives up on a server that never answers, after three seconds, having swept nothing", async () => {
    vi.useFakeTimers();
    try {
      // A request that never settles: the page renders nothing until this resolves, so the
      // bound is the whole reason the timeout exists.
      stubFetch(() => new Promise<Response>(() => {}));
      const storage = populated("root-a");
      const before = snap(storage.map);

      const pending = syncInstallScope(storage);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(2999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toBe("unknown");
      expect(snap(storage.map)).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocked site data still lets boot proceed", async () => {
    stubFetch(() => json({ installId: "root-b" }));

    // Every read reads as empty, so this looks like a first sight and adopts — an adoption
    // that stores nothing, because the write throws too. Nothing is destroyed and boot
    // continues, which is the whole requirement.
    await expect(syncInstallScope(blockedStorage())).resolves.toBe("adopted");
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

  const serverReports = (installId: string | null) => stubFetch(() => json({ installId }));

  it("a swept boot reloads instead of rendering, and the second pass cannot resurrect the dock", async () => {
    const storage = stubLocalStorage(
      memoryStorage({
        [INSTALL_ID_KEY]: "root-a",
        "penguin.dock.layout": DOCK_FROM_ROOT_A,
        "penguin.theme": "dark",
      }),
    );
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
    stubLocalStorage(memoryStorage({ [INSTALL_ID_KEY]: "root-a" }));
    serverReports("root-a");
    expect(await bootInstallScope()).toBe("mount");

    stubLocalStorage(memoryStorage({ "penguin.theme": "dark" }));
    serverReports("root-a");
    expect(await bootInstallScope()).toBe("mount");

    stubLocalStorage(memoryStorage({ [INSTALL_ID_KEY]: "root-a" }));
    serverReports(null);
    expect(await bootInstallScope()).toBe("mount");

    // The reload would otherwise repeat forever: sweep, fail to record, reload, sweep again.
    const backing = memoryStorage({ [INSTALL_ID_KEY]: "root-a", "penguin.lastProjectId": "p1" });
    stubLocalStorage({
      ...backing,
      get length(): number {
        return backing.length;
      },
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
    const storage = populated("root-b"); // the other tab already recorded it

    const stale = reactToInstallIdChange(
      { key: INSTALL_ID_KEY, oldValue: "root-a", newValue: "root-b" },
      storage,
    );

    expect(stale).toBe(true);
    expect(snap(storage.map)).toEqual(sweptOnto("root-b"));
  });

  it("ignores the other tab's FIRST recording, which swept nothing itself", () => {
    const storage = populated();
    const before = snap(storage.map);

    expect(
      reactToInstallIdChange({ key: INSTALL_ID_KEY, oldValue: null, newValue: "root-a" }, storage),
    ).toBe(false);
    expect(snap(storage.map)).toEqual(before);
  });

  it("ignores site data being cleared, and a rewrite of the same id", () => {
    const storage = populated();
    const before = snap(storage.map);

    expect(
      reactToInstallIdChange({ key: INSTALL_ID_KEY, oldValue: "root-a", newValue: null }, storage),
    ).toBe(false);
    expect(
      reactToInstallIdChange(
        { key: INSTALL_ID_KEY, oldValue: "root-a", newValue: "root-a" },
        storage,
      ),
    ).toBe(false);
    expect(snap(storage.map)).toEqual(before);
  });

  it("ignores every other key, including the ones it would otherwise sweep", () => {
    const storage = populated();
    const before = snap(storage.map);

    expect(
      reactToInstallIdChange(
        { key: "penguin.pinnedSessions.default_project", oldValue: "[]", newValue: '["s1"]' },
        storage,
      ),
    ).toBe(false);
    expect(reactToInstallIdChange({ key: null, oldValue: null, newValue: null }, storage)).toBe(
      false,
    );
    expect(snap(storage.map)).toEqual(before);
  });
});
