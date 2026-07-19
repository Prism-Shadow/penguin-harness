/**
 * Temporary Workspace creation:
 *
 * - The directory name is the workspace_id, shaped like `tmp-<8hex>`, created under
 *   `<agent>/workspaces/`.
 * - The id is checked for collisions within `workspaces/`: on conflict with an existing
 *   directory (EEXIST), it regenerates rather than reusing the existing directory; once
 *   retries are exhausted, it throws instead of silently falling back to an old temp Workspace.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempWorkspace } from "../src/internal/session-support.js";
import { workspacesDir } from "../src/state/paths.js";

const mocked = vi.hoisted(() => ({ uuids: [] as string[] }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    // When the queue has values, dequeue from it (tests inject fixed ids), otherwise fall back
    // to the real implementation.
    randomUUID: () => mocked.uuids.shift() ?? actual.randomUUID(),
  };
});

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-workspace-"));
  mocked.uuids.length = 0;
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("createTempWorkspace", () => {
  it("在 workspaces/ 下创建 tmp-<8hex> 目录并返回路径", async () => {
    const dir = await createTempWorkspace(tmpRoot, "proj", "agent");
    expect(path.dirname(dir)).toBe(workspacesDir(tmpRoot, "proj", "agent"));
    expect(path.basename(dir)).toMatch(/^tmp-[0-9a-f]{8}$/);
    expect((await fs.stat(dir)).isDirectory()).toBe(true);
  });

  it("id 与已有目录冲突时重新生成，不复用已有目录", async () => {
    const base = workspacesDir(tmpRoot, "proj", "agent");
    await fs.mkdir(path.join(base, "tmp-aaaaaaaa"), { recursive: true });
    await fs.writeFile(path.join(base, "tmp-aaaaaaaa", "keep.txt"), "old");
    mocked.uuids.push(
      "aaaaaaaa-1111-4111-8111-111111111111",
      "bbbbbbbb-2222-4222-8222-222222222222",
    );

    const dir = await createTempWorkspace(tmpRoot, "proj", "agent");

    expect(path.basename(dir)).toBe("tmp-bbbbbbbb");
    expect(await fs.readdir(dir)).toEqual([]);
    // The existing directory is neither reused nor modified.
    await expect(fs.readFile(path.join(base, "tmp-aaaaaaaa", "keep.txt"), "utf8")).resolves.toBe(
      "old",
    );
  });

  it("重试耗尽时报错，而非复用已有目录", async () => {
    const base = workspacesDir(tmpRoot, "proj", "agent");
    await fs.mkdir(path.join(base, "tmp-cccccccc"), { recursive: true });
    mocked.uuids.push(...Array.from({ length: 16 }, () => "cccccccc-3333-4333-8333-333333333333"));

    await expect(createTempWorkspace(tmpRoot, "proj", "agent")).rejects.toThrow(
      /unique temp workspace id/,
    );
  });
});
