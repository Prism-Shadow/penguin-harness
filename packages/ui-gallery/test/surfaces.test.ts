/**
 * The app's surfaces: every one in exactly one group, found by its id, and opening on a route the
 * demo store can answer.
 */
import { describe, expect, it } from "vitest";
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

describe("the surfaces", () => {
  it("are each in exactly one group, the groups in their fixed order", () => {
    const placed = SURFACE_GROUPS.flatMap((group) => group.surfaces.map((s) => s.id));
    expect([...placed].sort()).toEqual([...SURFACE_IDS].sort());
    expect(new Set(placed).size).toBe(placed.length);
    expect(SURFACE_GROUPS.map((group) => group.id)).toEqual([...SURFACE_GROUP_IDS]);
    for (const group of SURFACE_GROUPS) expect(group.surfaces.length, group.id).toBeGreaterThan(0);
  });

  it("are found by their id, and an unknown id finds none", () => {
    expect(surfaceById(HOME_SURFACE)?.id).toBe(HOME_SURFACE);
    expect(isSurfaceId("nope")).toBe(false);
    expect(surfaceById("nope")).toBeUndefined();
  });

  it("open on routes the demo store answers: the Sessions, Agents, apps, plugins and Benchmarks they name exist", () => {
    const store = resetStore({ lang: "en", signedIn: true });
    for (const surface of SURFACES) {
      expect(surface.route.startsWith("/"), surface.id).toBe(true);
      // `/chat/new` is the draft, which names no Session.
      const session = /^\/chat\/([^/?]+)/.exec(surface.route)?.[1];
      if (session && session !== "new") expect(store.session(session), surface.id).toBeDefined();
      const agent = /^\/agents\/([^/?]+)/.exec(surface.route)?.[1];
      if (agent)
        expect(
          store.f.agents.some((a) => a.agentId === agent),
          surface.id,
        ).toBe(true);
      // An App Center window names an app the App Center lists, and a place inside it the app
      // can show: for the Self-Evolution Workbench, a Benchmark it holds.
      const address = new URL(surface.route, "http://gallery.invalid");
      const app = address.pathname === "/apps" ? address.searchParams.get("app") : null;
      if (app)
        expect(
          store.f.appCenter.shortcuts.some((s) => `${s.agentId}/${s.workbenchId}` === app),
          surface.id,
        ).toBe(true);
      const benchmark =
        app === "default_agent/benchmark"
          ? /^\/([^/?]+)/.exec(address.searchParams.get("at") ?? "")?.[1]
          : undefined;
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
  });
});
