/**
 * Unit tests for Workspace validation: only requires an existing directory;
 * location is not constrained to the Project directory (reachability is
 * governed by file permissions).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "../src/http/errors.js";
import { assertWorkspaceAllowed } from "../src/services/workspace-guard.js";
import { makeTempRoot } from "./helpers.js";

describe("workspace-guard", () => {
  let root: string;
  let projectA: string;

  beforeEach(async () => {
    root = await makeTempRoot();
    projectA = path.join(root, "project-aaaa0001");
    await fs.mkdir(path.join(projectA, "workdir"), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const guard = (workspace: string) => assertWorkspaceAllowed({ workspace });

  it("已存在的目录放行并返回 realpath", async () => {
    const ws = await guard(path.join(projectA, "workdir"));
    expect(ws).toBe(await fs.realpath(path.join(projectA, "workdir")));
  });

  it("Project 目录之外的任意目录同样放行", async () => {
    const outside = path.join(root, "elsewhere");
    await fs.mkdir(outside, { recursive: true });
    await expect(guard(outside)).resolves.toBe(await fs.realpath(outside));
  });

  it("符号链接解析为 realpath 后返回", async () => {
    const outside = path.join(root, "linked");
    await fs.mkdir(outside, { recursive: true });
    const link = path.join(projectA, "escape");
    await fs.symlink(outside, link, "dir");
    await expect(guard(link)).resolves.toBe(await fs.realpath(outside));
  });

  it("不存在的路径 → 400 workspace_not_found", async () => {
    const err = await guard(path.join(projectA, "ghost")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    expect((err as HttpError).code).toBe("workspace_not_found");
  });

  it("文件（非目录）→ 400 workspace_not_found", async () => {
    const file = path.join(projectA, "a-file.txt");
    await fs.writeFile(file, "x", "utf8");
    const err = await guard(file).catch((e: unknown) => e);
    expect((err as HttpError).status).toBe(400);
    expect((err as HttpError).code).toBe("workspace_not_found");
  });
});
