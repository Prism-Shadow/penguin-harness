/**
 * Removing a Workspace hides its sidebar group without changing its conversations.
 *
 * - Given a registered Workspace with conversations, removal survives a reload; adding
 *   the same directory again restores the original conversations.
 * - Given a group whose registration was already removed, it can still be hidden.
 * - Given an empty removed Workspace, conversations arriving later do not resurrect it.
 * - Given one path on different machines and in different Projects, removal is isolated
 *   to the selected machine and Project.
 * - Given a removed group known only through server counts, it stays hidden while its
 *   conversations have not loaded yet.
 * - Equivalent directory spellings restore the same group; repeated actions and temporary
 *   paths leave the visibility state alone.
 * - Missing, malformed or blocked storage starts with no hidden groups; no Project writes
 *   nothing, and a failed storage write does not throw.
 */
import { describe, expect, it } from "vitest";
import {
  loadHiddenWorkspaces,
  saveHiddenWorkspaces,
  setWorkspaceHidden,
  visibleWorkspaceGroups,
} from "../src/features/session-list/workspace-visibility";
import {
  loadWorkspaceRegistry,
  mergeRegisteredWorkspaces,
  registerWorkspace,
  saveWorkspaceRegistry,
  unregisterWorkspace,
} from "../src/features/session-list/workspace-registry";
import {
  completeWorkspaceGroups,
  groupSessionsByWorkspace,
  workspaceGroupKey,
} from "../src/lib/session-grouping";
import { blockedStorage, memoryStorage } from "./helpers/storage";

const path = "/srv/app";
const conversations = [{ id: "original-chat", workspace: path, createdAt: "2026-11-01T00:00:00Z" }];

describe("Workspace removal", () => {
  it("stays hidden after reload and re-adding restores the same conversations", () => {
    const storage = memoryStorage();
    const registered = registerWorkspace([], path);
    const groups = groupSessionsByWorkspace(conversations);
    const hidden = setWorkspaceHidden(new Set(), path, null, true);
    saveWorkspaceRegistry("p", unregisterWorkspace(registered, path), storage);
    saveHiddenWorkspaces("p", hidden, storage);

    const reloaded = loadHiddenWorkspaces("p", storage);
    const entries = loadWorkspaceRegistry("p", storage);
    expect(visibleWorkspaceGroups(mergeRegisteredWorkspaces(groups, entries), reloaded)).toEqual(
      [],
    );

    const restored = setWorkspaceHidden(reloaded, path, null, false);
    saveHiddenWorkspaces("p", restored, storage);
    saveWorkspaceRegistry("p", registerWorkspace(entries, path), storage);
    const visible = visibleWorkspaceGroups(
      mergeRegisteredWorkspaces(groups, loadWorkspaceRegistry("p", storage)),
      loadHiddenWorkspaces("p", storage),
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]!.sessions).toEqual(conversations);
    expect(groups[0]!.sessions).toEqual(conversations);
  });

  it("hides a conversation-derived group with no registration", () => {
    const groups = mergeRegisteredWorkspaces(groupSessionsByWorkspace(conversations), []);
    expect(visibleWorkspaceGroups(groups, new Set())).toHaveLength(1);
    expect(visibleWorkspaceGroups(groups, setWorkspaceHidden(new Set(), path, null, true))).toEqual(
      [],
    );
    expect(groups[0]!.sessions).toEqual(conversations);
  });

  it("keeps an empty removed Workspace hidden when conversations arrive later", () => {
    const hidden = setWorkspaceHidden(new Set(), path, null, true);
    expect(visibleWorkspaceGroups(mergeRegisteredWorkspaces([], [{ path }]), hidden)).toEqual([]);
    expect(visibleWorkspaceGroups(groupSessionsByWorkspace(conversations), hidden)).toEqual([]);
  });

  it("isolates removal by machine and Project", () => {
    const storage = memoryStorage();
    const groups = mergeRegisteredWorkspaces(
      [],
      [{ path }, { path, machineId: "remote-a" }, { path, machineId: "remote-b" }],
    );
    const hidden = setWorkspaceHidden(new Set(), path, "remote-a", true);
    saveHiddenWorkspaces("one", hidden, storage);
    expect(
      visibleWorkspaceGroups(groups, loadHiddenWorkspaces("one", storage)).map((g) => g.machineId),
    ).toEqual([null, "remote-b"]);
    expect(visibleWorkspaceGroups(groups, loadHiddenWorkspaces("two", storage))).toEqual(groups);
    expect(
      visibleWorkspaceGroups(groups, setWorkspaceHidden(hidden, path, null, false)),
    ).toHaveLength(2);
    expect(
      visibleWorkspaceGroups(groups, setWorkspaceHidden(hidden, path, "remote-a", false)),
    ).toEqual(groups);
  });

  it("hides a group known through counts before any of its conversations are loaded", () => {
    const key = workspaceGroupKey(path, "remote-a");
    const groups = completeWorkspaceGroups(
      [],
      new Map([
        [
          key,
          {
            totals: { active: 12, archived: 0 },
            agents: { active: ["agent"], archived: [] },
          },
        ],
      ]),
      new Map(),
    );
    expect(groups).toHaveLength(1);
    expect(
      visibleWorkspaceGroups(groups, setWorkspaceHidden(new Set(), path, "remote-a", true)),
    ).toEqual([]);
  });

  it("normalizes a restored directory and ignores repeated actions and temporary paths", () => {
    const original = new Set<string>();
    const hidden = setWorkspaceHidden(original, " /srv/app/// ", null, true);
    expect(original.size).toBe(0);
    expect(setWorkspaceHidden(hidden, path, null, true)).toBe(hidden);
    const restored = setWorkspaceHidden(hidden, "/srv/app/", null, false);
    expect(visibleWorkspaceGroups(groupSessionsByWorkspace(conversations), restored)).toHaveLength(
      1,
    );
    expect(setWorkspaceHidden(restored, path, null, false)).toBe(restored);
    for (const temporary of ["", "/home/u/.penguin/agents/a/workspaces/tmp-0123abcd"]) {
      expect(setWorkspaceHidden(hidden, temporary, null, true)).toBe(hidden);
    }
  });

  it("handles missing, malformed and blocked storage without touching another Project", () => {
    const storage = memoryStorage({ "penguin.sidebarHiddenWorkspaces.p": "{broken" });
    expect(loadHiddenWorkspaces("p", storage).size).toBe(0);
    expect(loadHiddenWorkspaces(null, storage).size).toBe(0);
    const before = [...storage.map];
    saveHiddenWorkspaces(null, new Set([path]), storage);
    expect([...storage.map]).toEqual(before);
    expect(loadHiddenWorkspaces("p", blockedStorage()).size).toBe(0);
    expect(() => saveHiddenWorkspaces("p", new Set([path]), blockedStorage())).not.toThrow();
  });
});
