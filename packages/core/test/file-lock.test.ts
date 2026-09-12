/**
 * Behavior tests for the per-file mutex behind edit_file / write_file: callers are served in
 * arrival order, a failing or an interrupted caller leaves the queue intact, the map holding
 * the queues comes back empty, and one file gets one key no matter which name reaches it —
 * including a name that does not exist yet, which is the key a write_file creating the file
 * and an edit_file following it have to share.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileLockKey, pendingFileLocks, withFileLock } from "../src/internal/file-lock.js";

/** A promise plus its resolver, so a test decides when the holder of the lock finishes. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "penguin-filelock-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("withFileLock", () => {
  it("runs callers one at a time, in arrival order", async () => {
    const order: string[] = [];
    const held = gate();
    const first = withFileLock("k", async () => {
      order.push("first-in");
      await held.wait;
      order.push("first-out");
    });
    const second = withFileLock("k", async () => {
      order.push("second");
    });
    const third = withFileLock("k", async () => {
      order.push("third");
    });
    held.open();
    await Promise.all([first, second, third]);
    expect(order).toEqual(["first-in", "first-out", "second", "third"]);
  });

  it("reports a caller's failure to that caller and still serves the next one", async () => {
    const failing = withFileLock("k", async () => {
      throw new Error("boom");
    });
    const next = withFileLock("k", async () => "next");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("next");
  });

  it("rejects a caller interrupted while it waits, without running it", async () => {
    const held = gate();
    let ran = false;
    const holder = withFileLock("k", () => held.wait);
    const controller = new AbortController();
    const interrupted = withFileLock(
      "k",
      async () => {
        ran = true;
      },
      controller.signal,
    );
    const behind = withFileLock("k", async () => "behind");
    controller.abort();
    const err = await interrupted.then(
      () => new Error("the interrupted caller resolved"),
      (e: unknown) => e,
    );
    expect((err as Error).name).toBe("AbortError");
    held.open();
    await holder;
    // The interrupted caller dropped out of the queue; the one behind it still got its turn.
    await expect(behind).resolves.toBe("behind");
    expect(ran).toBe(false);
  });

  it("keeps no entry for a key once its queue has drained", async () => {
    await withFileLock("k", async () => undefined);
    expect(pendingFileLocks()).toBe(0);
    const held = gate();
    const holder = withFileLock("k", () => held.wait);
    const waiter = withFileLock("k", async () => undefined);
    expect(pendingFileLocks()).toBe(1);
    held.open();
    await Promise.all([holder, waiter]);
    expect(pendingFileLocks()).toBe(0);
  });
});

describe("fileLockKey", () => {
  it("gives a file that does not exist yet the key it will have once created", async () => {
    const target = path.join(dir, "later.txt");
    const beforeCreation = await fileLockKey(target);
    await writeFile(target, "created\n");
    expect(beforeCreation).toBe(await fileLockKey(target));
    expect(beforeCreation).toBe(await realpath(target));
  });

  it("folds a symlink onto the file it points at", async () => {
    await writeFile(path.join(dir, "real.txt"), "x\n");
    await symlink("real.txt", path.join(dir, "link.txt"));
    expect(await fileLockKey(path.join(dir, "link.txt"))).toBe(
      await fileLockKey(path.join(dir, "real.txt")),
    );
  });

  it("keys an unresolvable path on itself instead of failing", async () => {
    // A link cycle: the tools report ELOOP in their own wording, so the key must not throw
    // before they get there.
    await symlink("b.txt", path.join(dir, "a.txt"));
    await symlink("a.txt", path.join(dir, "b.txt"));
    expect(await fileLockKey(path.join(dir, "a.txt"))).toBe(
      path.join(await realpath(dir), "a.txt"),
    );
  });
});
