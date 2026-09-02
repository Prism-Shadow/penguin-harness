/**
 * The one rule that decides which machine a call reaches.
 *
 * There is no window-wide "active server" any more, and its absence is the point: pointing a
 * whole window at another machine put every request behind a tunnel — `/api/me` included —
 * so a dropped tunnel left the app unable to say whether anyone was logged in, with the way
 * back rendered inside a layout that never mounted. Naming the machine per call cannot do
 * that: a dead tunnel breaks exactly the request that needed it.
 */
import { describe, expect, it } from "vitest";
import { apiUrl } from "../src/lib/server-context";

const ID = "noeSE0FFHhNXl2J5";

describe("apiUrl", () => {
  it("leaves a call alone when no machine is named — the default is here", () => {
    expect(apiUrl("/api/me")).toBe("/api/me");
    expect(apiUrl("/api/me", null)).toBe("/api/me");
  });

  it("re-roots a named call onto that machine's proxy prefix", () => {
    expect(apiUrl("/api/projects/p/dirs?path=/srv", ID)).toBe(
      `/server/${ID}/api/projects/p/dirs?path=/srv`,
    );
  });

  it("needs no encoding — a machine id is path-safe by construction", () => {
    expect(apiUrl("/api/me", ID)).not.toContain("%");
  });

  it("touches ONLY /api paths: the frontend and previews are always local", () => {
    // The window never leaves this origin, and a remote's pages are never proxied.
    for (const path of ["/", "/assets/app.js", "/preview/tok/index.html", "/machines"]) {
      expect(apiUrl(path, ID)).toBe(path);
    }
  });

  it("cannot strand a window: an unknown machine breaks one call, not the app", () => {
    // /api/me is never re-rooted unless a caller asks for it, and nothing does.
    expect(apiUrl("/api/me")).toBe("/api/me");
  });
});

describe("a 401 from another machine", () => {
  it("is that machine's answer, not this server's", () => {
    // The rule lives in client.ts (`options.server ?? null` decides), and this is the case
    // it exists for: clicking a remote host in a picker used to bounce the window to the
    // login page of a server it was still perfectly signed in to. Pinned here as the
    // statement of intent, since the transport itself is not unit-reachable.
    expect(apiUrl("/api/me", "noeSE0FFHhNXl2J5")).toBe("/server/noeSE0FFHhNXl2J5/api/me");
    expect(apiUrl("/api/me")).toBe("/api/me");
  });
});
