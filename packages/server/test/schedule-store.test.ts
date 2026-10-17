/**
 * Schedule-file delete: missing versus unreadable.
 *
 * - Given no file, delete returns false (the caller may 404).
 * - Given a file, delete removes it and returns true.
 * - Given a path that exists but cannot be unlinked, the error is thrown: the
 *   caller must not report the schedule as missing.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scheduleDir } from "@prismshadow/penguin-core";
import { deleteScheduleFile } from "../src/runtime/schedule-store.js";

describe("deleteScheduleFile", () => {
  let root: string;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("returns false when the schedule file does not exist", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-schedule-unlink-"));
    expect(await deleteScheduleFile(root, "proj", "agent", "daily")).toBe(false);
  });

  it("removes an existing file and returns true", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-schedule-unlink-"));
    const dir = scheduleDir(root, "proj", "agent");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "daily.toml"), 'prompt = "p"\n');
    expect(await deleteScheduleFile(root, "proj", "agent", "daily")).toBe(true);
    await expect(fs.access(path.join(dir, "daily.toml"))).rejects.toThrow();
  });

  it("rethrows when the path exists but cannot be unlinked", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-schedule-unlink-"));
    const dir = scheduleDir(root, "proj", "agent");
    const blocked = path.join(dir, "daily.toml");
    // A directory at the file path makes unlink fail (EISDIR / EPERM) — not ENOENT.
    await fs.mkdir(blocked, { recursive: true });
    await expect(deleteScheduleFile(root, "proj", "agent", "daily")).rejects.toThrow();
    expect((await fs.stat(blocked)).isDirectory()).toBe(true);
  });
});
