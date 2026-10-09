/**
 * The app's surfaces: every one in exactly one group, named in both dictionaries, opening on a
 * route the demo store can answer, and the ones the contract names all present.
 */
import { describe, expect, it } from "vitest";
import { IDS } from "../src/app/mock/ids";
import { resetStore } from "../src/app/mock/store";
import {
  HOME_SURFACE,
  isSurfaceId,
  SURFACE_GROUP_IDS,
  SURFACE_GROUPS,
  SURFACE_IDS,
  SURFACES,
  surfaceById,
} from "../src/app/surfaces";
import { zh } from "../src/strings";
import { en } from "../src/strings-en";

describe("the surfaces", () => {
  it("are each in exactly one group, the groups in their fixed order", () => {
    const placed = SURFACE_GROUPS.flatMap((group) => group.surfaces.map((s) => s.id));
    expect([...placed].sort()).toEqual([...SURFACE_IDS].sort());
    expect(new Set(placed).size).toBe(placed.length);
    expect(SURFACE_GROUPS.map((group) => group.id)).toEqual([...SURFACE_GROUP_IDS]);
    for (const group of SURFACE_GROUPS) expect(group.surfaces.length, group.id).toBeGreaterThan(0);
  });

  it("cover the surfaces the owner named, and the home page frames one of them", () => {
    for (const id of [
      "chat",
      "chat-streaming",
      "agents",
      "plugins",
      "models",
      "usage",
      "benchmark",
      "schedules",
      "settings",
      "login",
    ]) {
      expect(isSurfaceId(id), id).toBe(true);
    }
    expect(surfaceById(HOME_SURFACE)).toBeDefined();
    expect(surfaceById("nope")).toBeUndefined();
  });

  it("have a title, a description and a how-to in both languages, and a group name", () => {
    for (const surface of SURFACES) {
      for (const dict of [zh, en]) {
        const copy = dict.surfaces[surface.id];
        expect(copy.title.trim(), surface.id).not.toBe("");
        expect(copy.description.trim(), surface.id).not.toBe("");
        expect(copy.how.trim(), surface.id).not.toBe("");
      }
    }
    for (const id of SURFACE_GROUP_IDS) {
      expect(zh.surfaceGroups[id].trim(), id).not.toBe("");
      expect(en.surfaceGroups[id].trim(), id).not.toBe("");
    }
  });

  it("open on routes the demo store answers: the Sessions, Agents, plugins and Benchmarks they name exist", () => {
    const store = resetStore({ lang: "en", signedIn: true });
    for (const surface of SURFACES) {
      expect(surface.route.startsWith("/"), surface.id).toBe(true);
      const session = /^\/chat\/([^/?]+)/.exec(surface.route)?.[1];
      if (session) expect(store.session(session), surface.id).toBeDefined();
      const agent = /^\/agents\/([^/?]+)/.exec(surface.route)?.[1];
      if (agent)
        expect(
          store.f.agents.some((a) => a.agentId === agent),
          surface.id,
        ).toBe(true);
      const benchmark = /^\/benchmark\/([^/?]+)/.exec(surface.route)?.[1];
      if (benchmark)
        expect(
          store.f.benchmarks.some((b) => b.id === benchmark),
          surface.id,
        ).toBe(true);
      const plugin = /^\/plugins\/registry\/(.+)$/.exec(surface.route)?.[1];
      if (plugin) {
        expect(
          store.f.library.groups.some((g) => g.plugins.some((p) => p.name === plugin)),
          surface.id,
        ).toBe(true);
      }
    }
    // The login surface is the one that starts signed out; the settings one opens its dialog.
    expect(surfaceById("login")?.signedOut).toBe(true);
    expect(surfaceById("settings")?.open).toBe("settings");
    expect(surfaceById("settings-appearance")?.open).toBe("settings.appearance");
    expect(SURFACES.filter((s) => s.signedOut).map((s) => s.id)).toEqual(["login"]);
  });

  it("spell the store's ids in their routes exactly (the file carries no import, so Node can read it)", () => {
    expect(surfaceById("chat")?.route).toBe(`/chat/${IDS.sessions.done}`);
    expect(surfaceById("chat-running")?.route).toBe(`/chat/${IDS.sessions.runningTool}`);
    expect(surfaceById("chat-thinking")?.route).toBe(`/chat/${IDS.sessions.thinking}`);
    expect(surfaceById("chat-streaming")?.route).toBe(`/chat/${IDS.sessions.streaming}`);
    expect(surfaceById("chat-approval")?.route).toBe(`/chat/${IDS.sessions.approval}`);
    expect(surfaceById("chat-harness")?.route).toBe(`/chat/${IDS.sessions.harness}`);
    expect(surfaceById("chat-org")?.route).toBe(`/chat/${IDS.sessions.orgDesk}`);
    expect(surfaceById("settings")?.route).toBe(`/chat/${IDS.sessions.done}`);
    expect(surfaceById("agent-settings")?.route).toBe(`/agents/${IDS.agents.docs}`);
    expect(surfaceById("schedules")?.route).toBe(`/agents/${IDS.agents.docs}?tab=schedules`);
    expect(surfaceById("benchmark-detail")?.route).toBe(`/benchmark/${IDS.benchmarks.docs}`);
  });
});
