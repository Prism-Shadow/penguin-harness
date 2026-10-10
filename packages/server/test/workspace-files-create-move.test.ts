/**
 * New files and folders, folder moves, the version a save hands back, and the Files panel's
 * directory-addressed routes.
 *
 * Over a Session (`/api/sessions/:sessionId/files…`):
 * - Creating a folder makes it; creating it again is refused with 409 target_exists and nothing
 *   is written.
 * - Creating a text file makes it empty; a name already taken — by a file, a folder or a dangling
 *   link — is refused, and whatever was there is left untouched.
 * - A new path's missing parents are made; a path that leaves the Workspace (`..`, or through a
 *   symlinked folder pointing out) creates nothing anywhere.
 * - Renaming a folder moves everything under it; an occupied destination is refused with nothing
 *   moved; a folder cannot move into itself, and no half-made directory is left behind; a
 *   version marker sent for a folder is refused.
 * - A save answers with the version it wrote: a second save carrying it lands, and one carrying
 *   it after the Agent rewrote the file is refused with the Agent's text kept.
 *
 * By directory (`/api/projects/:projectId/workspace-files…?workspace=`):
 * - A Project member lists, reads, creates, writes, moves and searches a directory no Session
 *   was ever created in; paths stay confined to it, and inline HTML is still served as text.
 * - An outsider to the Project gets 404 with nothing touched; a relative or missing directory is
 *   400 workspace_not_found.
 *
 * One app for the file; every case works in a Workspace directory of its own.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  ProjectCreateResponse,
  SessionCreateResponse,
  WorkspaceFilesResponse,
  WorkspaceSearchResponse,
} from "../src/api/types.js";
import {
  apiClient,
  canCreateSymlink,
  createTestApp,
  makeTempRoot,
  provisionUser,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";

const itWithSymlinks = it.skipIf(!canCreateSymlink());

let t: TestApp;
let owner: ReturnType<typeof apiClient>;
let outsider: ReturnType<typeof apiClient>;
let projectId: string;

beforeAll(async () => {
  t = await createTestApp();
  owner = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
  outsider = apiClient(t.app, (await provisionUser(t.app, "outsider")).cookie);
  const created = (await (
    await owner.post("/api/projects", { projectId: "owner-folders", name: "project" })
  ).json()) as ProjectCreateResponse;
  projectId = created.project.projectId;
  await owner.put(`/api/projects/${projectId}/models`, {
    defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
    models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
  });
});
afterAll(async () => {
  await t.cleanup();
});

/** A Workspace directory of the case's own, holding `a.txt` and `docs/guide/intro.md`. */
let workspace: string;
let outside: string;
beforeEach(async () => {
  workspace = await makeTempRoot();
  outside = await makeTempRoot();
  await fs.mkdir(path.join(workspace, "docs", "guide"), { recursive: true });
  await fs.writeFile(path.join(workspace, "a.txt"), "A");
  await fs.writeFile(path.join(workspace, "docs", "guide", "intro.md"), "# Intro");
});
afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

const exists = (p: string): Promise<boolean> =>
  fs.lstat(p).then(
    () => true,
    () => false,
  );

const errorCode = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe("over a Session", () => {
  let base: string;
  beforeEach(async () => {
    const sess = (await (
      await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, { workspace })
    ).json()) as SessionCreateResponse;
    base = `/api/sessions/${sess.session.sessionId}/files`;
  });

  it("creating a folder makes it, and creating it again is refused with nothing written", async () => {
    const made = await owner.post(`${base}/create`, { path: "docs/drafts", kind: "dir" });
    expect(made.status).toBe(204);
    expect((await fs.stat(path.join(workspace, "docs", "drafts"))).isDirectory()).toBe(true);
    await fs.writeFile(path.join(workspace, "docs", "drafts", "keep.txt"), "kept");

    const again = await owner.post(`${base}/create`, { path: "docs/drafts", kind: "dir" });
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe("target_exists");
    expect(await fs.readFile(path.join(workspace, "docs", "drafts", "keep.txt"), "utf8")).toBe(
      "kept",
    );
  });

  it("creating a text file makes it empty, and a taken name is refused with what was there untouched", async () => {
    const made = await owner.post(`${base}/create`, { path: "notes/untitled.txt", kind: "file" });
    expect(made.status).toBe(204);
    expect(await fs.readFile(path.join(workspace, "notes", "untitled.txt"), "utf8")).toBe("");

    const overFile = await owner.post(`${base}/create`, { path: "a.txt", kind: "file" });
    expect(overFile.status).toBe(409);
    expect(await errorCode(overFile)).toBe("target_exists");
    expect(await fs.readFile(path.join(workspace, "a.txt"), "utf8")).toBe("A");

    const overFolder = await owner.post(`${base}/create`, { path: "docs", kind: "file" });
    expect(overFolder.status).toBe(409);
    expect((await fs.stat(path.join(workspace, "docs"))).isDirectory()).toBe(true);

    const fileOverFile = await owner.post(`${base}/create`, { path: "a.txt", kind: "dir" });
    expect(fileOverFile.status).toBe(409);
    expect(await fs.readFile(path.join(workspace, "a.txt"), "utf8")).toBe("A");
  });

  itWithSymlinks("a dangling link at the path counts as taken and is not followed", async () => {
    const target = path.join(outside, "planted.txt");
    await fs.symlink(target, path.join(workspace, "link.txt"));
    const res = await owner.post(`${base}/create`, { path: "link.txt", kind: "file" });
    expect(res.status).toBe(409);
    expect(await exists(target)).toBe(false);
  });

  it("a path out of the Workspace creates nothing anywhere", async () => {
    const escape = `../${path.basename(outside)}/evil`;
    expect((await owner.post(`${base}/create`, { path: escape, kind: "dir" })).status).toBe(400);
    expect((await owner.post(`${base}/create`, { path: escape, kind: "file" })).status).toBe(400);
    expect(await exists(path.join(outside, "evil"))).toBe(false);
    expect((await owner.post(`${base}/create`, { path: "", kind: "dir" })).status).toBe(400);
    expect((await owner.post(`${base}/create`, { path: "x", kind: "link" })).status).toBe(400);
  });

  itWithSymlinks("a symlinked folder pointing out cannot be created through", async () => {
    await fs.symlink(outside, path.join(workspace, "out"));
    expect((await owner.post(`${base}/create`, { path: "out/new", kind: "dir" })).status).toBe(400);
    expect(
      (await owner.post(`${base}/create`, { path: "out/deep/new.txt", kind: "file" })).status,
    ).toBe(400);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it("renaming a folder moves everything under it, and the old path is gone", async () => {
    const res = await owner.post(`${base}/move`, { from: "docs", to: "handbook/docs-2026" });
    expect(res.status).toBe(204);
    expect(
      await fs.readFile(path.join(workspace, "handbook", "docs-2026", "guide", "intro.md"), "utf8"),
    ).toBe("# Intro");
    expect(await exists(path.join(workspace, "docs"))).toBe(false);
  });

  it("a folder is not moved onto an occupied destination, into itself, or with a version marker", async () => {
    await fs.mkdir(path.join(workspace, "taken"));
    const occupied = await owner.post(`${base}/move`, { from: "docs", to: "taken" });
    expect(occupied.status).toBe(409);
    expect(await errorCode(occupied)).toBe("target_exists");
    const ontoFile = await owner.post(`${base}/move`, { from: "docs", to: "a.txt" });
    expect(ontoFile.status).toBe(409);
    expect(await fs.readFile(path.join(workspace, "a.txt"), "utf8")).toBe("A");

    const intoItself = await owner.post(`${base}/move`, {
      from: "docs",
      to: "docs/guide/new/docs",
    });
    expect(intoItself.status).toBe(400);
    // Refused before any missing parent of the destination was made.
    expect(await exists(path.join(workspace, "docs", "guide", "new"))).toBe(false);

    const marked = await owner.post(`${base}/move`, {
      from: "docs",
      to: "d2",
      ifVersion: 'W/"1-1"',
    });
    expect(marked.status).toBe(400);
    // Every refusal left the tree where it was.
    expect(await fs.readFile(path.join(workspace, "docs", "guide", "intro.md"), "utf8")).toBe(
      "# Intro",
    );
  });

  it("a save answers with the version it wrote, which the next save carries until the Agent rewrites the file", async () => {
    const url = `${base}/content?path=a.txt`;
    const read = (await owner.get(url)).headers.get("etag")!;
    const first = await owner.put(url, {
      dataBase64: Buffer.from("first").toString("base64"),
      ifVersion: read,
    });
    expect(first.status).toBe(204);
    const written = first.headers.get("etag")!;
    expect(written).toBe((await owner.get(url)).headers.get("etag"));

    const second = await owner.put(url, {
      dataBase64: Buffer.from("second, longer").toString("base64"),
      ifVersion: written,
    });
    expect(second.status).toBe(204);
    expect(await fs.readFile(path.join(workspace, "a.txt"), "utf8")).toBe("second, longer");

    await fs.writeFile(path.join(workspace, "a.txt"), "the agent's text");
    const stale = await owner.put(url, {
      dataBase64: Buffer.from("third").toString("base64"),
      ifVersion: second.headers.get("etag")!,
    });
    expect(stale.status).toBe(409);
    expect(await fs.readFile(path.join(workspace, "a.txt"), "utf8")).toBe("the agent's text");
  });
});

describe("by directory", () => {
  const at = (suffix: string, query: string): string =>
    `/api/projects/${projectId}/workspace-files${suffix}?workspace=${encodeURIComponent(workspace)}${query}`;

  it("a member browses, creates, writes, moves and searches a directory no Session was created in", async () => {
    const listing = (await (
      await owner.get(at("", "&path=docs"))
    ).json()) as WorkspaceFilesResponse;
    expect(listing.entries.map((e) => `${e.kind}:${e.name}`)).toEqual(["dir:guide"]);

    const read = await owner.get(at("/content", "&path=a.txt"));
    expect(await read.text()).toBe("A");

    expect((await owner.post(at("/create", ""), { path: "src", kind: "dir" })).status).toBe(204);
    expect(
      (await owner.post(at("/create", ""), { path: "src/untitled.txt", kind: "file" })).status,
    ).toBe(204);
    const empty = await owner.get(at("/content", "&path=src/untitled.txt"));
    expect(await empty.text()).toBe("");
    const written = await owner.put(at("/content", "&path=src/untitled.txt"), {
      dataBase64: Buffer.from("hello").toString("base64"),
      ifVersion: empty.headers.get("etag")!,
    });
    expect(written.status).toBe(204);
    expect(await fs.readFile(path.join(workspace, "src", "untitled.txt"), "utf8")).toBe("hello");

    expect((await owner.post(at("/move", ""), { from: "src", to: "lib" })).status).toBe(204);
    expect(await fs.readFile(path.join(workspace, "lib", "untitled.txt"), "utf8")).toBe("hello");

    const search = (await (
      await owner.get(at("/search", "&q=intro"))
    ).json()) as WorkspaceSearchResponse;
    expect(search.hits.map((h) => h.path)).toEqual(["docs/guide/intro.md"]);
  });

  it("paths stay inside the named directory, and inline HTML is still served as text", async () => {
    await fs.writeFile(path.join(outside, "secret.txt"), "secret");
    const escape = `&path=${encodeURIComponent(`../${path.basename(outside)}/secret.txt`)}`;
    expect((await owner.get(at("/content", escape))).status).toBe(400);

    await fs.writeFile(path.join(workspace, "page.html"), "<script>1</script>");
    const html = await owner.get(at("/content", "&path=page.html"));
    expect(html.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("an outsider gets 404 and touches nothing; a relative or missing directory is refused", async () => {
    const res = await outsider.post(at("/create", ""), { path: "intruder", kind: "dir" });
    expect(res.status).toBe(404);
    expect(await exists(path.join(workspace, "intruder"))).toBe(false);
    expect((await outsider.get(at("", ""))).status).toBe(404);

    const relative = await owner.get(`/api/projects/${projectId}/workspace-files?workspace=docs`);
    expect(relative.status).toBe(400);
    expect(await errorCode(relative)).toBe("workspace_not_found");
    const missing = await owner.get(
      `/api/projects/${projectId}/workspace-files?workspace=${encodeURIComponent(path.join(workspace, "nope"))}`,
    );
    expect(missing.status).toBe(400);
    expect(await errorCode(missing)).toBe("workspace_not_found");
  });
});
