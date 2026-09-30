/**
 * The directory browser behind the Workspace picker: folders and files come back with their
 * kind and modification time, and a folder the service may not read is a distinguishable
 * error rather than an empty listing — on macOS an unanswered privacy prompt looks exactly
 * like that, and an empty list hid it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DirListResponse, ProjectCreateResponse } from "../src/api/types.js";
import { dirReadError } from "../src/http/routes/dirs.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const errno = (code: string) => Object.assign(new Error(code), { code });

describe("dirReadError", () => {
  it("gives a refusal its own code, whichever errno the OS used for it", () => {
    for (const code of ["EACCES", "EPERM"]) {
      const err = dirReadError(errno(code), "/Users/me/Downloads/x");
      expect([err.status, err.code]).toEqual([403, "dir_permission_denied"]);
    }
  });

  it("keeps absence a 404", () => {
    const err = dirReadError(errno("ENOENT"), "/gone");
    expect([err.status, err.code]).toEqual([404, "dir_not_found"]);
  });
});

describe("dirs api", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  let dir: string;

  const listUrl = (p: string) => `/api/projects/${projectId}/dirs?path=${encodeURIComponent(p)}`;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_dirs");
    owner = apiClient(t.app, a.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_dirs-browse", name: "dirs project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "penguin-dirs-")));
  });

  afterEach(async () => {
    try {
      await fs.chmod(path.join(dir, "locked"), 0o755).catch(() => undefined);
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } finally {
      await t.cleanup();
    }
  });

  it("lists folders and files with their kind and modification time", async () => {
    await fs.mkdir(path.join(dir, "src"));
    await fs.writeFile(path.join(dir, "notes.txt"), "x");
    const res = await owner.get(listUrl(dir));
    expect(res.status).toBe(200);
    const body = (await res.json()) as DirListResponse;
    expect(body.path).toBe(dir);
    expect(body.platform).toBe(process.platform);
    expect(body.entries.map((e) => [e.name, e.kind])).toEqual([
      ["notes.txt", "file"],
      ["src", "dir"],
    ]);
    expect(body.entries.every((e) => typeof e.mtime === "number")).toBe(true);
  });

  // POSIX permission bits: meaningless on win32, and root reads through them.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "answers a folder it may not read with dir_permission_denied, not an empty list",
    async () => {
      const locked = path.join(dir, "locked");
      await fs.mkdir(locked);
      await fs.writeFile(path.join(locked, "inside.txt"), "x");
      await fs.chmod(locked, 0o000);
      const res = await owner.get(listUrl(locked));
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "dir_permission_denied",
      );
    },
  );
});
