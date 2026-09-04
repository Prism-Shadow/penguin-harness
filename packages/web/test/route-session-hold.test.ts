/**
 * The chat page keeps showing the routed Session through a refetch that momentarily stops
 * listing it (features/chat/session-project.ts, heldRouteSession). The list is rebuilt
 * wholesale by every reload, so "not in the list" is two facts wearing one face — gone, or
 * one tick old — and only the direct lookup failing, or the route moving on, may release the
 * hold.
 */
import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { heldRouteSession } from "../src/features/chat/session-project";

const row = (sessionId: string) => ({ sessionId }) as SessionInfo;

describe("heldRouteSession", () => {
  it("the listed row always wins", () => {
    expect(heldRouteSession(row("old"), row("s1"), "s1", false)).toEqual(row("s1"));
  });

  it("holds the previous answer while the list momentarily does not name the route", () => {
    expect(heldRouteSession(row("s1"), null, "s1", false)).toEqual(row("s1"));
  });

  it("lets go when the route moved to another Session", () => {
    expect(heldRouteSession(row("s1"), null, "s2", false)).toBeNull();
    expect(heldRouteSession(row("s1"), null, null, false)).toBeNull();
  });

  it("lets go when the direct lookup says the Session is gone", () => {
    expect(heldRouteSession(row("s1"), null, "s1", true)).toBeNull();
  });

  it("has nothing to hold on a first render", () => {
    expect(heldRouteSession(null, null, "s1", false)).toBeNull();
  });
});
