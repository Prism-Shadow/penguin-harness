/**
 * The state directories agent-desktop keeps refs in.
 *
 * - Given a Session, its directory is its own and private; given no Session, the user's is.
 * - Given an id that is not a plain name, it never becomes a path outside the state root.
 * - Given directories unused for longer than the limit, a sweep removes them and keeps the rest.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDirFor, stateRootOf, sweepStateDirs } from "../src/state.js";
import { tempDir } from "./helpers.js";

describe("state directories", () => {
  it("are one per Session, else one per user, inside the state root", async () => {
    const root = await tempDir();
    const session = await stateDirFor(root, { sessionId: "s1", userId: "ann" });
    const user = await stateDirFor(root, { userId: "ann" });
    const odd = await stateDirFor(root, { sessionId: "../../escape", userId: "ann" });
    expect(session).toBe(path.join(stateRootOf(root), "sessions", "s1"));
    expect(user).toBe(path.join(stateRootOf(root), "users", "ann"));
    expect(path.dirname(odd)).toBe(path.join(stateRootOf(root), "sessions"));
    if (process.platform !== "win32") {
      expect((await fs.stat(session)).mode & 0o777).toBe(0o700);
    }
  });

  it("unused past the limit are swept, and recent ones kept", async () => {
    const root = await tempDir();
    const old = await stateDirFor(root, { sessionId: "old", userId: "ann" });
    const recent = await stateDirFor(root, { sessionId: "recent", userId: "ann" });
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await fs.utimes(old, longAgo, longAgo);
    expect(await sweepStateDirs(root)).toBe(1);
    await expect(fs.access(old)).rejects.toThrow();
    await fs.access(recent);
  });
});
