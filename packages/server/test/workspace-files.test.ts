/**
 * Unit tests for the Workspace files service: directory-listing order, read/write,
 * path confinement (`..` traversal and symlink escape), size-limit protection,
 * batch existence checks (files/stat); and the Agent delete route (default_agent
 * cannot be deleted, owner-only, directory and index cleanup).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceFilesService } from "../src/services/workspace-files-service.js";
import type {
  AgentCreateResponse,
  ProjectCreateResponse,
  SessionCreateResponse,
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
