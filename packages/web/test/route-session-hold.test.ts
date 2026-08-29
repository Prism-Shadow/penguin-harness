/**
 * The routed Session survives a list refetch that momentarily stops naming it
 * (features/chat/session-project.ts).
 *
 * The chat page derives the open conversation from the Session list, and reload() rebuilds
 * that list wholesale — so between the fetches landing and the merged array being set, a
 * live conversation is not in it. Reading that tick as "gone" is what drew the skeleton over
 * a conversation being read, once per completed turn. What is pinned here is the pair of
 * facts that release the hold, because a hold that never released would be the worse bug:
 * a deleted Session stuck on screen forever.
 */
import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { heldRouteSession } from "../src/features/chat/session-project";

const row = (sessionId: string) => ({ sessionId }) as SessionInfo;

describe("heldRouteSession", () => {
  it("takes the listed row whenever the list names one", () => {
    const fresh = row("s1");
    expect(heldRouteSession(row("s1"), fresh, "s1", false)).toBe(fresh);
  });

  it("holds the last answer while the list has momentarily stopped naming it", () => {
    // The refetch is in flight and the merged array is not set yet. Nothing has said this
    // Session is gone, so the conversation stays on screen.
    const held = row("s1");
    expect(heldRouteSession(held, null, "s1", false)).toBe(held);
  });

  it("lets go the moment the direct lookup says the Session is not there", () => {
    // A Session deleted (here or in another tab) must still leave the screen — the probe
    // failing is the one answer that outranks the hold.
    expect(heldRouteSession(row("s1"), null, "s1", true)).toBeNull();
  });

  it("lets go when the route moves to another Session", () => {
    // Holding across a navigation would show the previous conversation under the new URL.
    expect(heldRouteSession(row("s1"), null, "s2", false)).toBeNull();
  });

  it("holds nothing on a route that never had a Session", () => {
    expect(heldRouteSession(null, null, "s1", false)).toBeNull();
    expect(heldRouteSession(row("s1"), null, null, false)).toBeNull();
  });
});
