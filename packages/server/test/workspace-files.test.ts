/**
 * Unit tests for the Workspace files service: directory-listing order, read/write,
 * move / delete / search, path confinement (`..` traversal and symlink escape), size-limit
 * protection, batch existence checks (files/stat); and the Agent delete route (default_agent
 * cannot be deleted, owner-only, directory and index cleanup).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SEARCH_MAX_HITS,
  SEARCH_MAX_QUERY_LEN,
  WorkspaceFilesService,
} from "../src/services/workspace-files-service.js";
import type {
  AgentCreateResponse,
  ProjectCreateResponse,
  SessionCreateResponse,
  WorkspaceSearchResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, makeTempRoot, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("workspace-files-service", () => {
  let ws: string;
  let outside: string;
  const svc = new WorkspaceFilesService();

  beforeEach(async () => {
    ws = await makeTempRoot();
    outside = await makeTempRoot();
    await fs.mkdir(path.join(ws, "sub"));
    await fs.writeFile(path.join(ws, "b.txt"), "hello");
    await fs.writeFile(path.join(ws, "sub", "c.md"), "# md");
    await fs.writeFile(path.join(outside, "secret.txt"), "secret");
  });
  afterEach(async () => {
    await fs.rm(ws, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("directory listing: dirs first, sorted by name; subdirectory paths work", async () => {
    const root = await svc.list(ws, "");
    expect(root.entries.map((e) => `${e.kind}:${e.name}`)).toEqual(["dir:sub", "file:b.txt"]);
    const sub = await svc.list(ws, "sub");
    expect(sub.entries.map((e) => e.name)).toEqual(["c.md"]);
  });

  it("file read: content and content-type; directories / missing files error", async () => {
    const file = await svc.read(ws, "sub/c.md");
    expect(file.data.toString()).toBe("# md");
    expect(file.contentType).toContain("markdown");
    const preview = await svc.read(ws, "sub/c.md", { maxBytes: 2 });
    expect(preview.data.toString()).toBe("# ");
    expect(preview.truncated).toBe(true);
    await expect(svc.read(ws, "sub")).rejects.toMatchObject({ status: 400 });
    await expect(svc.read(ws, "nope.txt")).rejects.toMatchObject({ status: 404 });
  });

  it("file write: overwrites; missing parent directories are auto-created (folder uploads keep their structure)", async () => {
    await svc.write(ws, "sub/new.txt", Buffer.from("data"));
    expect(await fs.readFile(path.join(ws, "sub", "new.txt"), "utf8")).toBe("data");
    await svc.write(ws, "missing/deep/x.txt", Buffer.from("d"));
    expect(await fs.readFile(path.join(ws, "missing", "deep", "x.txt"), "utf8")).toBe("d");
  });

  it("path confinement: `..` traversal and absolute paths are both rejected", async () => {
    await expect(svc.list(ws, "../")).rejects.toMatchObject({ status: 400 });
    await expect(svc.read(ws, `../${path.basename(outside)}/secret.txt`)).rejects.toMatchObject({
      status: 400,
    });
    await expect(svc.write(ws, "../escape.txt", Buffer.from("x"))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("Workspace at the filesystem root: subdirectories still drill down (prefix-joining '//' regression)", async () => {
    const root = path.parse(ws).root;
    const sub = await svc.list(root, path.relative(root, path.join(ws, "sub")));
    expect(sub.entries.map((e) => e.name)).toEqual(["c.md"]);
  });

  it("a symlink to a directory inside the Workspace: kind is dir and it can be drilled into", async () => {
    await fs.symlink(path.join(ws, "sub"), path.join(ws, "link-sub"));
    const root = await svc.list(ws, "");
    expect(root.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      "dir:link-sub",
      "dir:sub",
      "file:b.txt",
    ]);
    const viaLink = await svc.list(ws, "link-sub");
    expect(viaLink.entries.map((e) => e.name)).toEqual(["c.md"]);
  });

  it("symlink escape: reads and writes are both rejected when the link points outside the Workspace", async () => {
    await fs.symlink(outside, path.join(ws, "link-out"));
    const root = await svc.list(ws, "");
    expect(root.entries.map((entry) => entry.name)).not.toContain("link-out");
    await expect(svc.list(ws, "link-out")).rejects.toMatchObject({ status: 400 });
    await expect(svc.read(ws, "link-out/secret.txt")).rejects.toMatchObject({ status: 400 });
    // Writing outside via a directory symlink: caught by the parent-directory realpath check.
    await expect(svc.write(ws, "link-out/evil.txt", Buffer.from("x"))).rejects.toMatchObject({
      status: 400,
    });
    // Auto-creation under a missing path is equally restricted: if the nearest
    // existing ancestor is a symlink pointing outside, mkdir must not be used to escape.
    await expect(svc.write(ws, "link-out/new/evil.txt", Buffer.from("x"))).rejects.toMatchObject({
      status: 400,
    });
    expect(
      await fs
        .stat(path.join(outside, "new"))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it("writing through a last-segment symlink: O_NOFOLLOW refuses to overwrite files outside the Workspace by proxy", async () => {
    // The Agent has a symlink inside the Workspace pointing to an outside file; an upload attempts to overwrite it.
    const victim = path.join(outside, "secret.txt");
    await fs.symlink(victim, path.join(ws, "report.pdf"));
    await expect(svc.write(ws, "report.pdf", Buffer.from("PWNED"))).rejects.toMatchObject({
      status: 400,
    });
    // The outside file's content is unchanged.
    expect(await fs.readFile(victim, "utf8")).toBe("secret");
  });

  it("write precondition: a matching version writes, one the file has moved past is refused with nothing written", async () => {
    const { version } = await svc.read(ws, "b.txt");
    // The Agent rewrites the same file while the user is editing it. mtime resolution can be
    // coarse, so the size differs too — either half of the marker moving is a mismatch.
    await fs.writeFile(path.join(ws, "b.txt"), "agent wrote this");

    await expect(svc.write(ws, "b.txt", Buffer.from("user typed this"), version)).rejects.toEqual(
      expect.objectContaining({ status: 409, code: "file_changed" }),
    );
    expect(await fs.readFile(path.join(ws, "b.txt"), "utf8")).toBe("agent wrote this");

    // Re-reading picks up the new version, and the same save then goes through — and the
    // file is truncated to the new content, not left with a tail of the longer old one.
    const fresh = await svc.read(ws, "b.txt");
    await svc.write(ws, "b.txt", Buffer.from("user typed this"), fresh.version);
    expect(await fs.readFile(path.join(ws, "b.txt"), "utf8")).toBe("user typed this");
  });

  it("write precondition: no marker creates a file that was never there, a marker on a deleted file is refused and creates nothing", async () => {
    // An upload reads no version and so carries no marker: unconditional create.
    await svc.write(ws, "fresh.txt", Buffer.from("new"));
    expect(await fs.readFile(path.join(ws, "fresh.txt"), "utf8")).toBe("new");

    // The editor's marker says a file was read; the file being gone is a change like any
    // other — and a refused write must not leave the empty file O_CREAT would have made.
    const { version } = await svc.read(ws, "fresh.txt");
    await fs.rm(path.join(ws, "fresh.txt"));
    await expect(svc.write(ws, "fresh.txt", Buffer.from("x"), version)).rejects.toEqual(
      expect.objectContaining({ status: 409, code: "file_changed" }),
    );
    expect(await fs.stat(path.join(ws, "fresh.txt")).catch(() => null)).toBeNull();
  });

  it("move: a rename inside a directory, a move across directories, and a destination parent created on the way", async () => {
    await svc.move(ws, "b.txt", "renamed.txt");
    expect(await fs.readFile(path.join(ws, "renamed.txt"), "utf8")).toBe("hello");
    expect(await fs.stat(path.join(ws, "b.txt")).catch(() => null)).toBeNull();

    await svc.move(ws, "sub/c.md", "sub/notes.md");
    expect(await fs.readFile(path.join(ws, "sub", "notes.md"), "utf8")).toBe("# md");

    // Across directories, into a parent that does not exist yet — created under the same
    // checks an upload's auto-creation runs.
    await svc.move(ws, "sub/notes.md", "archive/2026/notes.md");
    expect(await fs.readFile(path.join(ws, "archive", "2026", "notes.md"), "utf8")).toBe("# md");
    expect(await fs.stat(path.join(ws, "sub", "notes.md")).catch(() => null)).toBeNull();
  });

  it("move: an occupied destination is refused rather than overwritten; a missing source is 404; moving onto its own path is a 400", async () => {
    await expect(svc.move(ws, "b.txt", "sub/c.md")).rejects.toEqual(
      expect.objectContaining({ status: 409, code: "target_exists" }),
    );
    // Neither file moved: the destination still holds what it held, the source is still there.
    expect(await fs.readFile(path.join(ws, "sub", "c.md"), "utf8")).toBe("# md");
    expect(await fs.readFile(path.join(ws, "b.txt"), "utf8")).toBe("hello");

    // A directory sitting at the destination is equally occupied.
    await expect(svc.move(ws, "b.txt", "sub")).rejects.toMatchObject({ status: 409 });

    await expect(svc.move(ws, "nope.txt", "x.txt")).rejects.toEqual(
      expect.objectContaining({ status: 404, code: "path_not_found" }),
    );
    // A source whose whole parent directory is gone is the same 404, not a 500.
    await expect(svc.move(ws, "gone/nope.txt", "x.txt")).rejects.toMatchObject({ status: 404 });

    // Same path spelled differently: a 400, not a success that did nothing.
    await expect(svc.move(ws, "b.txt", "./b.txt")).rejects.toMatchObject({ status: 400 });
    await expect(svc.move(ws, "sub/c.md", "sub/../sub/c.md")).rejects.toMatchObject({
      status: 400,
    });
  });

  it("move precondition: a stale marker moves nothing, a vanished source under one is a conflict, and a directory has no marker to offer at all", async () => {
    const { version } = await svc.read(ws, "b.txt");
    await fs.writeFile(path.join(ws, "b.txt"), "agent wrote this");

    await expect(svc.move(ws, "b.txt", "moved.txt", version)).rejects.toEqual(
      expect.objectContaining({ status: 409, code: "file_changed" }),
    );
    expect(await fs.readFile(path.join(ws, "b.txt"), "utf8")).toBe("agent wrote this");
    expect(await fs.stat(path.join(ws, "moved.txt")).catch(() => null)).toBeNull();

    // Re-reading picks up the new version and the same move goes through.
    const fresh = await svc.read(ws, "b.txt");
    await svc.move(ws, "b.txt", "moved.txt", fresh.version);
    expect(await fs.readFile(path.join(ws, "moved.txt"), "utf8")).toBe("agent wrote this");

    // The file the caller read is gone: a change like any other, the same 409 `write` gives.
    const stale = await svc.read(ws, "moved.txt");
    await fs.rm(path.join(ws, "moved.txt"));
    await expect(svc.move(ws, "moved.txt", "again.txt", stale.version)).rejects.toEqual(
      expect.objectContaining({ status: 409, code: "file_changed" }),
    );

    // A directory is refused outright: it carries no single version marker, so no
    // precondition could protect the tree under it.
    await expect(svc.move(ws, "sub", "sub2")).rejects.toMatchObject({ status: 400 });
    expect((await fs.stat(path.join(ws, "sub"))).isDirectory()).toBe(true);
    expect(await fs.stat(path.join(ws, "sub2")).catch(() => null)).toBeNull();
  });

  it("delete: the file goes; a stale marker keeps it; a directory and a missing file are both refused", async () => {
    await svc.remove(ws, "b.txt");
    expect(await fs.stat(path.join(ws, "b.txt")).catch(() => null)).toBeNull();

    const { version } = await svc.read(ws, "sub/c.md");
    await fs.writeFile(path.join(ws, "sub", "c.md"), "# the agent rewrote this");
    await expect(svc.remove(ws, "sub/c.md", version)).rejects.toEqual(
      expect.objectContaining({ status: 409, code: "file_changed" }),
    );
    expect(await fs.readFile(path.join(ws, "sub", "c.md"), "utf8")).toBe(
      "# the agent rewrote this",
    );

    const fresh = await svc.read(ws, "sub/c.md");
    await svc.remove(ws, "sub/c.md", fresh.version);
    expect(await fs.stat(path.join(ws, "sub", "c.md")).catch(() => null)).toBeNull();

    // A directory is refused for the same reason a move refuses one, and stays put.
    await expect(svc.remove(ws, "sub")).rejects.toMatchObject({ status: 400 });
    expect((await fs.stat(path.join(ws, "sub"))).isDirectory()).toBe(true);

    await expect(svc.remove(ws, "nope.txt")).rejects.toEqual(
      expect.objectContaining({ status: 404, code: "path_not_found" }),
    );
    // With a marker, a file that is not there is a conflict rather than a 404.
    await expect(svc.remove(ws, "nope.txt", 'W/"1-1"')).rejects.toMatchObject({
      status: 409,
      code: "file_changed",
    });
  });

  it("move and delete confinement: `..` at either end, a symlinked destination directory, and a symlink at the final segment are all refused", async () => {
    const outsideName = path.basename(outside);
    await fs.symlink(outside, path.join(ws, "link-out"));

    // `..` in the source: the file outside is neither read nor moved in.
    await expect(svc.move(ws, `../${outsideName}/secret.txt`, "stolen.txt")).rejects.toMatchObject({
      status: 400,
    });
    expect(await fs.stat(path.join(ws, "stolen.txt")).catch(() => null)).toBeNull();

    // `..` in the destination: nothing lands outside the Workspace.
    await expect(svc.move(ws, "b.txt", "../escape.txt")).rejects.toMatchObject({ status: 400 });
    expect(await fs.stat(path.join(path.dirname(ws), "escape.txt")).catch(() => null)).toBeNull();
    expect(await fs.readFile(path.join(ws, "b.txt"), "utf8")).toBe("hello");

    // A destination parent that is a symlink pointing outside: caught by the same
    // canonical-parent check an upload runs, including through a directory it would create.
    await expect(svc.move(ws, "b.txt", "link-out/evil.txt")).rejects.toMatchObject({ status: 400 });
    await expect(svc.move(ws, "b.txt", "link-out/new/evil.txt")).rejects.toMatchObject({
      status: 400,
    });
    expect(await fs.stat(path.join(outside, "evil.txt")).catch(() => null)).toBeNull();

    // `..` in a delete: the file outside survives.
    await expect(svc.remove(ws, `../${outsideName}/secret.txt`)).rejects.toMatchObject({
      status: 400,
    });
    expect(await fs.readFile(path.join(outside, "secret.txt"), "utf8")).toBe("secret");

    // A symlink at the final segment — the Agent's "preset a link, act on it by proxy"
    // pattern: O_NOFOLLOW refuses it, so neither the link's target nor the link is touched.
    await fs.symlink(path.join(outside, "secret.txt"), path.join(ws, "report.pdf"));
    await expect(svc.move(ws, "report.pdf", "sub/report.pdf")).rejects.toMatchObject({
      status: 400,
    });
    await expect(svc.remove(ws, "report.pdf")).rejects.toMatchObject({ status: 400 });
    expect(await fs.readFile(path.join(outside, "secret.txt"), "utf8")).toBe("secret");
    expect((await fs.lstat(path.join(ws, "report.pdf"))).isSymbolicLink()).toBe(true);
  });

  it("search: finds a file several directories down that no listing ever reached, reports it as a tree row would, and matches the name rather than the path", async () => {
    await fs.mkdir(path.join(ws, "a", "b", "c"), { recursive: true });
    await fs.writeFile(path.join(ws, "a", "b", "c", "needle.txt"), "found me");
    await fs.mkdir(path.join(ws, "logs"));
    await fs.writeFile(path.join(ws, "logs", "report.md"), "r");

    const deep = await svc.search(ws, "needle");
    expect(deep.truncated).toBe(false);
    expect(deep.hits).toEqual([
      {
        path: "a/b/c/needle.txt",
        kind: "file",
        sizeBytes: 8,
        mtime: (await fs.stat(path.join(ws, "a", "b", "c", "needle.txt"))).mtime.toISOString(),
      },
    ]);

    // Case-insensitive.
    expect((await svc.search(ws, "NeEdLe")).hits.map((h) => h.path)).toEqual(["a/b/c/needle.txt"]);

    // The match is on the NAME: "logs" finds the directory, not everything under it. And a
    // hit reports its own size and mtime, not the enclosing directory's.
    const byDir = await svc.search(ws, "logs");
    const dirStat = await fs.stat(path.join(ws, "logs"));
    expect(byDir.hits).toEqual([
      {
        path: "logs",
        kind: "dir",
        sizeBytes: dirStat.size,
        mtime: dirStat.mtime.toISOString(),
      },
    ]);
    const byFile = await svc.search(ws, "report");
    expect(byFile.hits.map((h) => h.path)).toEqual(["logs/report.md"]);
    // The figures are the hit's own, not the enclosing directory's.
    expect(byFile.hits[0]!.sizeBytes).toBe(1);
    expect(byFile.hits[0]!.mtime).toBe(
      (await fs.stat(path.join(ws, "logs", "report.md"))).mtime.toISOString(),
    );

    // A path fragment is not a name and so matches nothing.
    expect((await svc.search(ws, "logs/report")).hits).toEqual([]);
  });

  it("search: shallow matches come first, directories ahead of files at the same depth", async () => {
    await fs.mkdir(path.join(ws, "sub", "deep"), { recursive: true });
    await fs.mkdir(path.join(ws, "match-dir"));
    await fs.writeFile(path.join(ws, "match.txt"), "1");
    await fs.writeFile(path.join(ws, "sub", "match.txt"), "2");
    await fs.writeFile(path.join(ws, "sub", "deep", "match.txt"), "3");

    const res = await svc.search(ws, "match");
    expect(res.hits.map((h) => `${h.kind}:${h.path}`)).toEqual([
      "dir:match-dir",
      "file:match.txt",
      "file:sub/match.txt",
      "file:sub/deep/match.txt",
    ]);
  });

  it("search confinement: an out-of-bounds symlink is never walked into and never appears as a hit, and a link back to the root cannot spin the walk", async () => {
    await fs.writeFile(path.join(outside, "secret-needle.txt"), "s");
    await fs.symlink(outside, path.join(ws, "link-out"));
    // A cycle: the Workspace root reachable from inside itself, twice over.
    await fs.symlink(ws, path.join(ws, "self"));
    await fs.symlink(ws, path.join(ws, "sub", "back"));

    // Nothing outside is reachable, and the link that points there is not itself a hit.
    expect((await svc.search(ws, "secret")).hits).toEqual([]);
    expect((await svc.search(ws, "link-out")).hits).toEqual([]);

    // The walk terminates and reports each in-bounds entry once.
    const all = await svc.search(ws, "b.txt");
    expect(all.hits.map((h) => h.path)).toEqual(["b.txt"]);
    expect(all.truncated).toBe(false);
    // A self-link is an in-bounds directory, so it is a legitimate hit — it is only never
    // descended into a second time.
    expect((await svc.search(ws, "self")).hits.map((h) => h.path)).toEqual(["self"]);
  });

  it("search: the hit cap truncates and says so; an empty or oversize query is a 400", async () => {
    await Promise.all(
      Array.from({ length: SEARCH_MAX_HITS + 5 }, (_, i) =>
        fs.writeFile(path.join(ws, `cap-${String(i).padStart(3, "0")}.txt`), "x"),
      ),
    );
    const capped = await svc.search(ws, "cap-");
    expect(capped.hits).toHaveLength(SEARCH_MAX_HITS);
    expect(capped.truncated).toBe(true);

    // A search that fits reports the whole truth.
    const whole = await svc.search(ws, "cap-001");
    expect(whole.hits.map((h) => h.path)).toEqual(["cap-001.txt"]);
    expect(whole.truncated).toBe(false);

    await expect(svc.search(ws, "")).rejects.toMatchObject({ status: 400 });
    await expect(svc.search(ws, "   ")).rejects.toMatchObject({ status: 400 });
    await expect(svc.search(ws, "x".repeat(SEARCH_MAX_QUERY_LEN + 1))).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("files/stat route (batch existence check)", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let sessionId: string;
  let workspace: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    const b = await provisionUser(t.app, "outsider");
    owner = apiClient(t.app, a.cookie);
    outsider = apiClient(t.app, b.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner-stat", name: "project" })
    ).json()) as ProjectCreateResponse;
    const projectId = created.project.projectId;
    await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
    const sess = (await (
      await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {})
    ).json()) as SessionCreateResponse;
    sessionId = sess.session.sessionId;
    workspace = sess.session.workspace;
    await fs.mkdir(path.join(sess.session.workspace, "sub"));
    await fs.writeFile(path.join(sess.session.workspace, "a.txt"), "A");
    await fs.writeFile(path.join(sess.session.workspace, "sub", "b.md"), "B");
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("files/content on html: inline stays text/plain; preview=1 keeps text/html under a CSP sandbox; download keeps the real type with no CSP", async () => {
    await fs.writeFile(path.join(workspace, "page.html"), "<!doctype html><script>1</script>");
    const url = `/api/sessions/${sessionId}/files/content?path=page.html`;

    const inline = await owner.get(url);
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-type")).toContain("text/plain");
    expect(inline.headers.get("content-security-policy")).toBeNull();

    const preview = await owner.get(`${url}&preview=1`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toContain("text/html");
    const csp = preview.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox");
    expect(csp).not.toContain("allow-same-origin");
    expect(preview.headers.get("content-disposition")).toContain("inline");

    // download wins over preview: attachment + real type, no CSP needed.
    const download = await owner.get(`${url}&download=1&preview=1`);
    expect(download.headers.get("content-type")).toContain("text/html");
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(download.headers.get("content-security-policy")).toBeNull();

    // Non-scriptable files are unaffected by preview.
    const txt = await owner.get(`/api/sessions/${sessionId}/files/content?path=a.txt&preview=1`);
    expect(txt.headers.get("content-type")).toContain("text/plain");
    expect(txt.headers.get("content-security-policy")).toBeNull();
  });

  it("files/content on svg: inline keeps image/svg+xml under a sandbox CSP, so an <img> renders it and a direct visit stays inert", async () => {
    await fs.writeFile(
      path.join(workspace, "chart.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>1</script></svg>',
    );
    const url = `/api/sessions/${sessionId}/files/content?path=chart.svg`;

    // The real type is what makes it renderable at all: downgraded to text/plain, every
    // <img> pointing at it — a Markdown preview's included — was a broken image.
    const inline = await owner.get(url);
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-type")).toContain("image/svg+xml");
    // What the type re-opens is a direct visit rendering it as a same-origin document:
    // the sandbox denies both scripting and the origin, and is ignored for a subresource.
    const csp = inline.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox");
    expect(csp).not.toContain("allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(inline.headers.get("x-content-type-options")).toBe("nosniff");

    // A download is an attachment either way — nothing renders it, so no CSP is needed.
    const download = await owner.get(`${url}&download=1`);
    expect(download.headers.get("content-type")).toContain("image/svg+xml");
    expect(download.headers.get("content-security-policy")).toBeNull();

    // HTML keeps its own handling: still plain text inline.
    await fs.writeFile(path.join(workspace, "p.html"), "<b>x</b>");
    const html = await owner.get(`/api/sessions/${sessionId}/files/content?path=p.html`);
    expect(html.headers.get("content-type")).toContain("text/plain");
  });

  it("files/content is never cached: the path holds whatever the Agent last wrote", async () => {
    const res = await owner.get(`/api/sessions/${sessionId}/files/content?path=a.txt`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("files/content: the read carries a version the write demands back — a save over an Agent's rewrite is 409, not a silent overwrite", async () => {
    const url = `/api/sessions/${sessionId}/files/content?path=a.txt`;
    const read = await owner.get(url);
    const version = read.headers.get("etag");
    expect(version).toMatch(/^W\/"\d+-\d+"$/);

    // The user is editing a.txt when the Agent rewrites it mid-turn.
    await fs.writeFile(path.join(workspace, "a.txt"), "written by the agent");

    const stale = await owner.put(url, {
      dataBase64: Buffer.from("typed by the user").toString("base64"),
      ifVersion: version,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: { code: "file_changed", message: expect.any(String) },
    });
    expect(await fs.readFile(path.join(workspace, "a.txt"), "utf8")).toBe("written by the agent");

    // The current version is accepted; so is a write that carries no version at all (an
    // upload, which read none) — that absence is what makes a first write of a new file work.
    const current = (await owner.get(url)).headers.get("etag");
    const saved = await owner.put(url, {
      dataBase64: Buffer.from("typed by the user").toString("base64"),
      ifVersion: current,
    });
    expect(saved.status).toBe(204);
    expect(await fs.readFile(path.join(workspace, "a.txt"), "utf8")).toBe("typed by the user");

    const uploaded = await owner.put(`/api/sessions/${sessionId}/files/content?path=new.txt`, {
      dataBase64: Buffer.from("uploaded").toString("base64"),
    });
    expect(uploaded.status).toBe(204);
    expect(await fs.readFile(path.join(workspace, "new.txt"), "utf8")).toBe("uploaded");

    // A non-string marker is a bad request, not a silently dropped precondition.
    const bad = await owner.put(url, { dataBase64: "", ifVersion: 7 });
    expect(bad.status).toBe(400);
  });

  it("existing files return in order, deduplicated; missing / directory / out-of-bounds all count as nonexistent, always 200", async () => {
    const res = await owner.post(`/api/sessions/${sessionId}/files/stat`, {
      paths: ["sub/b.md", "a.txt", "sub/b.md", "nope.txt", "sub", "../escape.txt", "/etc/passwd"],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ existing: ["sub/b.md", "a.txt"] });

    const empty = await owner.post(`/api/sessions/${sessionId}/files/stat`, { paths: [] });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ existing: [] });
  });

  it("invalid body → 400: non-array / non-string entries / too many / too long", async () => {
    const url = `/api/sessions/${sessionId}/files/stat`;
    expect((await owner.post(url, { paths: "a.txt" })).status).toBe(400);
    expect((await owner.post(url, { paths: [1] })).status).toBe(400);
    const tooMany = Array.from({ length: 101 }, () => "a.txt");
    expect((await owner.post(url, { paths: tooMany })).status).toBe(400);
    expect((await owner.post(url, { paths: ["x".repeat(513)] })).status).toBe(400);
  });

  it("outsider access → 404 (no existence leak)", async () => {
    const res = await outsider.post(`/api/sessions/${sessionId}/files/stat`, {
      paths: ["a.txt"],
    });
    expect(res.status).toBe(404);
  });
});

describe("files/move, files/search and the files/content delete", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let sessionId: string;
  let workspace: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    const b = await provisionUser(t.app, "outsider");
    owner = apiClient(t.app, a.cookie);
    outsider = apiClient(t.app, b.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner-ops", name: "project" })
    ).json()) as ProjectCreateResponse;
    const projectId = created.project.projectId;
    await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
    const sess = (await (
      await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {})
    ).json()) as SessionCreateResponse;
    sessionId = sess.session.sessionId;
    workspace = sess.session.workspace;
    await fs.mkdir(path.join(workspace, "sub"));
    await fs.writeFile(path.join(workspace, "a.txt"), "A");
    await fs.writeFile(path.join(workspace, "sub", "b.md"), "B");
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("files/move: 204 and the file is where it was sent; an occupied destination is 409 target_exists; a directory is a 400", async () => {
    const url = `/api/sessions/${sessionId}/files/move`;
    const moved = await owner.post(url, { from: "a.txt", to: "archive/notes/a.txt" });
    expect(moved.status).toBe(204);
    expect(await fs.readFile(path.join(workspace, "archive", "notes", "a.txt"), "utf8")).toBe("A");
    expect(await fs.stat(path.join(workspace, "a.txt")).catch(() => null)).toBeNull();

    const occupied = await owner.post(url, { from: "archive/notes/a.txt", to: "sub/b.md" });
    expect(occupied.status).toBe(409);
    expect(await occupied.json()).toEqual({
      error: { code: "target_exists", message: expect.any(String) },
    });
    expect(await fs.readFile(path.join(workspace, "sub", "b.md"), "utf8")).toBe("B");

    const missing = await owner.post(url, { from: "nope.txt", to: "x.txt" });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe(
      "path_not_found",
    );

    // A directory carries no version marker, so no precondition could protect the move.
    expect((await owner.post(url, { from: "sub", to: "sub2" })).status).toBe(400);
    // A missing or non-string field is a 400 before anything touches the filesystem.
    expect((await owner.post(url, { from: "a.txt" })).status).toBe(400);
    expect((await owner.post(url, { from: "a.txt", to: "b.txt", ifVersion: 7 })).status).toBe(400);
  });

  it("files/content DELETE: the marker the read returned is honoured — a stale one is 409 file_changed with the file left alone, a fresh one removes it", async () => {
    const url = `/api/sessions/${sessionId}/files/content?path=a.txt`;
    const version = (await owner.get(url)).headers.get("etag")!;

    // The Agent rewrites the file while the panel is still showing the old one.
    await fs.writeFile(path.join(workspace, "a.txt"), "written by the agent");
    const stale = await owner.delete(`${url}&ifVersion=${encodeURIComponent(version)}`);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: { code: "file_changed", message: expect.any(String) },
    });
    expect(await fs.readFile(path.join(workspace, "a.txt"), "utf8")).toBe("written by the agent");

    const current = (await owner.get(url)).headers.get("etag")!;
    const gone = await owner.delete(`${url}&ifVersion=${encodeURIComponent(current)}`);
    expect(gone.status).toBe(204);
    expect(await fs.stat(path.join(workspace, "a.txt")).catch(() => null)).toBeNull();

    // Without a marker the delete is unconditional, which is what an already-missing file
    // answers as a plain 404 rather than a conflict.
    const missing = await owner.delete(`/api/sessions/${sessionId}/files/content?path=a.txt`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe(
      "path_not_found",
    );
    expect((await owner.delete(`/api/sessions/${sessionId}/files/content?path=sub`)).status).toBe(
      400,
    );
  });

  it("files/search: hits come back shallow-first carrying what a tree row draws; an empty q is a 400", async () => {
    await fs.mkdir(path.join(workspace, "sub", "deep"), { recursive: true });
    await fs.writeFile(path.join(workspace, "sub", "deep", "b.md"), "deep");
    const res = await owner.get(`/api/sessions/${sessionId}/files/search?q=b.m`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspaceSearchResponse;
    expect(body.truncated).toBe(false);
    expect(body.hits.map((h) => h.path)).toEqual(["sub/b.md", "sub/deep/b.md"]);
    expect(body.hits[0]).toEqual({
      path: "sub/b.md",
      kind: "file",
      sizeBytes: 1,
      mtime: expect.any(String),
    });

    expect((await owner.get(`/api/sessions/${sessionId}/files/search?q=`)).status).toBe(400);
    expect((await owner.get(`/api/sessions/${sessionId}/files/search`)).status).toBe(400);
    expect(
      (await owner.get(`/api/sessions/${sessionId}/files/search?q=${"x".repeat(101)}`)).status,
    ).toBe(400);
  });

  it("outsider access → 404 on all three (no existence leak, and no Workspace touched)", async () => {
    expect(
      (await outsider.post(`/api/sessions/${sessionId}/files/move`, { from: "a.txt", to: "x.txt" }))
        .status,
    ).toBe(404);
    expect(
      (await outsider.delete(`/api/sessions/${sessionId}/files/content?path=a.txt`)).status,
    ).toBe(404);
    expect((await outsider.get(`/api/sessions/${sessionId}/files/search?q=a`)).status).toBe(404);
    expect(await fs.readFile(path.join(workspace, "a.txt"), "utf8")).toBe("A");
  });
});

describe("agent delete route", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    const b = await provisionUser(t.app, "outsider");
    owner = apiClient(t.app, a.cookie);
    outsider = apiClient(t.app, b.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner-ws", name: "project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("owner deletes an Agent: 204, the directory and list entry disappear; default_agent 409; outsiders 404", async () => {
    const created = (await (
      await owner.post(`/api/projects/${projectId}/agents`, { agentId: "temp_agent", name: "temp" })
    ).json()) as AgentCreateResponse;
    const agentId = created.agent.agentId;
    const dir = path.join(t.root, projectId, "agents", agentId);
    await fs.access(dir); // directory exists after creation

    const outsiderRes = await outsider.delete(`/api/projects/${projectId}/agents/${agentId}`);
    expect(outsiderRes.status).toBe(404); // no access → don't leak existence

    const res = await owner.delete(`/api/projects/${projectId}/agents/${agentId}`);
    expect(res.status).toBe(204);
    await expect(fs.access(dir)).rejects.toThrow();
    const list = (await (await owner.get(`/api/projects/${projectId}/agents`)).json()) as {
      agents: Array<{ agentId: string }>;
    };
    expect(list.agents.some((x) => x.agentId === agentId)).toBe(false);

    const def = await owner.delete(`/api/projects/${projectId}/agents/default_agent`);
    expect(def.status).toBe(409);
  });
});
