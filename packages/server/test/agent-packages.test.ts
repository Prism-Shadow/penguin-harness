/**
 * Agent packages: an Agent's definition to a gist and back — what is packaged, what is
 * refused, and that installing writes only inside the Agent it creates.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as tar from "tar";
import { agentDir } from "@prismshadow/penguin-core";
import type {
  AgentPackagePreviewResponse,
  AgentPackagePublishResponse,
  AgentPackageResponse,
} from "../src/api/types.js";
import { GhError } from "../src/packages/gh.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "owner-pkg";
const AGENT = "default_agent";

/** A tarball of `files` under one top-level folder, the way npm and GitHub ship them. */
async function tarballOf(top: string, files: Record<string, string>): Promise<Buffer> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-test-tgz-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const target = path.join(tmp, top, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    }
    const file = path.join(tmp, "out.tgz");
    await tar.c({ gzip: true, cwd: tmp, file }, [top]);
    return await fs.readFile(file);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** An Agent directory as a source would ship it — no manifest, just the folders. */
const AGENT_TREE = {
  "agent_state/system_config.yaml": "name: Packaged\nversion: 1\n",
  "agent_state/AGENTS.md": "# packaged\n",
  "workflows/todo/package.json": "{}\n",
  "workflows/todo/ui/index.html": "<h1>todo</h1>\n",
  "workflows/todo/state.json": '{"private":true}',
  "README.md": "not part of the agent\n",
};

/** A fake gists API plus the npm registry, GitHub releases/tarballs and a plain tarball URL. */
function fakeGithub() {
  const gists = new Map<string, Record<string, { content: string }>>();
  const calls: Array<{ url: string; method: string; auth: string | null }> = [];
  const tarballs = new Map<string, Buffer>();
  let nextId = 1;
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: input, method, auth: headers["authorization"] ?? null });
    if (input.startsWith("https://registry.npmjs.org/") && !/\.tgz$/.test(input)) {
      const name = decodeURIComponent(input.slice("https://registry.npmjs.org/".length));
      if (!tarballs.has(`npm:${name}`)) return new Response("", { status: 404 });
      return Response.json({
        "dist-tags": { latest: "1.2.0" },
        versions: {
          "1.2.0": { dist: { tarball: `https://registry.npmjs.org/${name}/-/x-1.2.0.tgz` } },
        },
      });
    }
    if (/\/-\/x-1\.2\.0\.tgz$/.test(input)) {
      const name = decodeURIComponent(input.slice("https://registry.npmjs.org/".length)).replace(
        /\/-\/.*$/,
        "",
      );
      return new Response(new Uint8Array(tarballs.get(`npm:${name}`)!));
    }
    const release =
      /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases\/(latest|tags\/[^/]+)$/.exec(
        input,
      );
    if (release) {
      const key = `release:${release[1]}`;
      if (!tarballs.has(key)) return new Response("", { status: 404 });
      return Response.json({
        tag_name: "v2",
        tarball_url: `https://api.github.com/repos/${release[1]}/tarball/v2`,
        assets: [
          {
            name: "agent-v2.tgz",
            browser_download_url: `https://github.com/${release[1]}/releases/download/v2/agent-v2.tgz`,
          },
        ],
      });
    }
    const asset = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\//.exec(input);
    if (asset) return new Response(new Uint8Array(tarballs.get(`release:${asset[1]}`)!));
    const repo = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/tarball(?:\/(.+))?$/.exec(
      input,
    );
    if (repo) {
      const key = `repo:${repo[1]}#${repo[2] ?? "default"}`;
      if (!tarballs.has(key)) return new Response("", { status: 404 });
      return new Response(new Uint8Array(tarballs.get(key)!));
    }
    if (tarballs.has(input)) return new Response(new Uint8Array(tarballs.get(input)!));
    const match = /\/gists(?:\/([^/?]+))?$/.exec(input);
    const id = match?.[1];
    if (method === "POST") {
      if (headers["authorization"] === undefined) return new Response("", { status: 401 });
      const body = JSON.parse(String(init?.body)) as { files: Record<string, { content: string }> };
      const gistId = id ?? `a1b2c${nextId++}`;
      gists.set(gistId, { ...(gists.get(gistId) ?? {}), ...body.files });
      return Response.json({ id: gistId, html_url: `https://gist.github.com/u/${gistId}` });
    }
    if (id === undefined || !gists.has(id)) return new Response("", { status: 404 });
    return Response.json({ id, html_url: `https://gist.github.com/u/${id}`, files: gists.get(id) });
  };
  return { fetch, gists, calls, tarballs };
}

describe("agent packages", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let github: ReturnType<typeof fakeGithub>;
  let dir: string;

  beforeEach(async () => {
    github = fakeGithub();
    // No `gh` on this server unless a test says otherwise: the token path stays the default
    // under test, and the gh path is exercised where it is the subject.
    t = await createTestApp({
      fetch: github.fetch,
      gh: { available: async () => false, api: async () => ({}) },
    });
    const a = await provisionUser(t.app, "owner");
    owner = apiClient(t.app, a.cookie);
    expect((await owner.post("/api/projects", { projectId: PROJECT, name: "pkg" })).status).toBe(
      201,
    );
    dir = agentDir(t.root, PROJECT, AGENT);
    // Definition …
    await fs.mkdir(path.join(dir, "agent_state", "skills", "demo"), { recursive: true });
    await fs.writeFile(path.join(dir, "agent_state", "skills", "demo", "SKILL.md"), "# demo\n");
    await fs.mkdir(path.join(dir, "workflows", "todo", "ui"), { recursive: true });
    await fs.writeFile(path.join(dir, "workflows", "todo", "package.json"), "{}\n");
    await fs.writeFile(path.join(dir, "workflows", "todo", "ui", "index.html"), "<h1>todo</h1>\n");
    // … and state, which must not travel.
    await fs.writeFile(
      path.join(dir, "workflows", "todo", "state.json"),
      '{"items":["SENTINEL_STATE_9f3"]}',
    );
    await fs.mkdir(path.join(dir, "agent_state", "memory"), { recursive: true });
    await fs.writeFile(path.join(dir, "agent_state", "memory", "note.md"), "remembered\n");
    await fs.writeFile(path.join(dir, "agent_state", ".vault.toml"), 'SECRET = "shh"\n');
    await fs.mkdir(path.join(dir, "workspaces", "w1"), { recursive: true });
    await fs.writeFile(path.join(dir, "workspaces", "w1", "scratch.txt"), "work\n");
  });

  afterEach(async () => {
    await t.cleanup();
  });

  const pkg = async () =>
    (await (
      await owner.get(`/api/projects/${PROJECT}/agents/${AGENT}/package`)
    ).json()) as AgentPackageResponse;

  it("packages the definition and leaves state, memory and the vault behind", async () => {
    const { manifest, canPublish } = await pkg();
    const paths = manifest.files.map((f) => f.path);
    expect(paths).toContain("agent_state/system_config.yaml");
    expect(paths).toContain("agent_state/skills/demo/SKILL.md");
    expect(paths).toContain("workflows/todo/ui/index.html");
    expect(paths.some((p) => p.includes("state.json"))).toBe(false);
    expect(paths.some((p) => p.startsWith("agent_state/memory/"))).toBe(false);
    expect(paths.some((p) => p.includes("vault"))).toBe(false);
    expect(paths.some((p) => p.startsWith("workspaces/"))).toBe(false);
    // No identity configured yet: the UI is told, rather than the button failing later.
    expect(canPublish).toBe(false);
    expect(
      (await owner.post(`/api/projects/${PROJECT}/agents/${AGENT}/package/publish`, {})).status,
    ).toBe(400);
  });

  it("publishes to a gist, updates that same gist, and installs it as a new Agent", async () => {
    // The token is a server setting: an admin stores it, and the Project's owner publishes.
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect((await admin.put("/api/admin/settings", { githubToken: "ghp_test" })).status).toBe(200);
    const settings = (await (await admin.get("/api/admin/settings")).json()) as {
      settings: { githubTokenSet: boolean };
    };
    expect(settings.settings.githubTokenSet).toBe(true);
    expect(JSON.stringify(settings)).not.toContain("ghp_test");

    const published = (await (
      await owner.post(`/api/projects/${PROJECT}/agents/${AGENT}/package/publish`, {})
    ).json()) as AgentPackagePublishResponse;
    expect(published.url).toContain("gist.github.com");
    const files = github.gists.get(published.gistId)!;
    // Flattened names, and the manifest that maps them back.
    expect(Object.keys(files)).toContain("penguin-agent.json");
    expect(Object.keys(files)).toContain("workflows--todo--ui--index.html");
    expect(JSON.stringify(files)).not.toContain("SENTINEL_STATE_9f3");

    // Republishing updates the same gist rather than making a second one — with no id from
    // the caller at all, because the server remembered it.
    const again = (await (
      await owner.post(`/api/projects/${PROJECT}/agents/${AGENT}/package/publish`, {})
    ).json()) as AgentPackagePublishResponse;
    expect(again.gistId).toBe(published.gistId);
    expect(github.gists.size).toBe(1);

    const preview = (await (
      await owner.post("/api/agent-packages/preview", { gist: published.url })
    ).json()) as AgentPackagePreviewResponse;
    expect(preview.manifest.agentId).toBe(AGENT);
    expect(preview.manifest.files.length).toBe(published.files);

    const installed = await owner.post("/api/agent-packages/install", {
      gist: published.gistId,
      projectId: PROJECT,
      agentId: "copy_agent",
    });
    expect(installed.status).toBe(201);
    const copy = agentDir(t.root, PROJECT, "copy_agent");
    expect(await fs.readFile(path.join(copy, "workflows/todo/ui/index.html"), "utf8")).toBe(
      "<h1>todo</h1>\n",
    );
    expect(await fs.readFile(path.join(copy, "agent_state/skills/demo/SKILL.md"), "utf8")).toBe(
      "# demo\n",
    );
    // The copy starts empty: no state, no memory, no vault.
    await expect(fs.stat(path.join(copy, "workflows/todo/state.json"))).rejects.toThrow();
    await expect(fs.stat(path.join(copy, "agent_state/memory/note.md"))).rejects.toThrow();
    await expect(fs.stat(path.join(copy, "agent_state/.vault.toml"))).rejects.toThrow();
  });

  it("refuses a gist that is not a package, and one whose paths escape the Agent", async () => {
    github.gists.set("abcde01", { "notes.txt": { content: "hello" } });
    const notPackage = await owner.post("/api/agent-packages/preview", { gist: "abcde01" });
    expect(notPackage.status).toBe(400);
    expect(await notPackage.text()).toContain("penguin-agent.json");

    github.gists.set("e0e0e0", {
      "penguin-agent.json": {
        content: JSON.stringify({
          format: 1,
          agentId: "x",
          name: "x",
          description: "",
          packagedBy: "0",
          packagedAt: "now",
          files: [{ path: "../../escape.txt", file: "..--..--escape.txt", encoding: "utf8" }],
        }),
      },
      "..--..--escape.txt": { content: "pwned" },
    });
    const escaping = await owner.post("/api/agent-packages/preview", { gist: "e0e0e0" });
    expect(escaping.status).toBe(400);
    expect(
      (
        await owner.post("/api/agent-packages/install", {
          gist: "e0e0e0",
          projectId: PROJECT,
          agentId: "evil_agent",
        })
      ).status,
    ).toBe(400);
    await expect(fs.stat(path.join(t.root, "escape.txt"))).rejects.toThrow();

    expect((await owner.post("/api/agent-packages/preview", { gist: "not a gist" })).status).toBe(
      400,
    );
    expect((await owner.post("/api/agent-packages/preview", { gist: "deadbeef" })).status).toBe(
      404,
    );
  });

  it("publishes through the server's gh login when there is one, and needs no token", async () => {
    const calls: Array<{ path: string; method: string; body: unknown }> = [];
    let minted = 0;
    const gh = await createTestApp({
      fetch: github.fetch,
      gh: {
        available: async () => true,
        api: async (path: string, method: string, body?: unknown) => {
          calls.push({ path, method, body });
          const target = path === "/gists" ? null : path.split("/").pop()!;
          if (target !== null && !github.gists.has(target))
            throw new GhError("HTTP 404: Not Found");
          const id = target ?? `beef0${++minted}`;
          github.gists.set(id, (body as { files: Record<string, { content: string }> }).files);
          return { id, html_url: `https://gist.github.com/u/${id}` };
        },
      },
    });
    try {
      const a = await provisionUser(gh.app, "owner");
      const ghOwner = apiClient(gh.app, a.cookie);
      expect(
        (await ghOwner.post("/api/projects", { projectId: PROJECT, name: "pkg" })).status,
      ).toBe(201);
      const view = (await (
        await ghOwner.get(`/api/projects/${PROJECT}/agents/${AGENT}/package`)
      ).json()) as AgentPackageResponse;
      expect(view.canPublish).toBe(true);
      expect(view.publishVia).toBe("gh");
      expect(view.publishedGist).toBeNull();

      const first = (await (
        await ghOwner.post(`/api/projects/${PROJECT}/agents/${AGENT}/package/publish`, {})
      ).json()) as AgentPackagePublishResponse;
      expect(calls[0]).toMatchObject({ path: "/gists", method: "POST" });
      // Republishing needs no id from the caller: the server remembers this Agent's gist.
      const again = (await (
        await ghOwner.post(`/api/projects/${PROJECT}/agents/${AGENT}/package/publish`, {})
      ).json()) as AgentPackagePublishResponse;
      expect(again.gistId).toBe(first.gistId);
      expect(calls[1]).toMatchObject({ path: `/gists/${first.gistId}`, method: "POST" });
      expect(github.gists.size).toBe(1);

      const after = (await (
        await ghOwner.get(`/api/projects/${PROJECT}/agents/${AGENT}/package`)
      ).json()) as AgentPackageResponse;
      expect(after.publishedGist?.gistId).toBe(first.gistId);

      // The remembered gist was deleted on GitHub: the next publish creates a new one
      // rather than failing on a target that no longer exists.
      github.gists.delete(first.gistId);
      const recreated = (await (
        await ghOwner.post(`/api/projects/${PROJECT}/agents/${AGENT}/package/publish`, {})
      ).json()) as AgentPackagePublishResponse;
      expect(recreated.gistId).not.toBe(first.gistId);
      // The record lives beside the Agent, and is a dotfile so it never travels in a package.
      expect(after.manifest.files.some((f) => f.path.includes(".penguin-publish"))).toBe(false);
    } finally {
      await gh.cleanup();
    }
  });

  it("installs from npm, a GitHub release, a GitHub repository, a tarball URL and a git clone", async () => {
    const tgz = await tarballOf("package", AGENT_TREE);
    github.tarballs.set("npm:@acme/agent", tgz);
    github.tarballs.set("release:acme/agent", await tarballOf("agent-v2", AGENT_TREE));
    github.tarballs.set(
      "repo:acme/agent#default",
      await tarballOf("acme-agent-abc123", AGENT_TREE),
    );
    github.tarballs.set("repo:acme/agent#dev", await tarballOf("acme-agent-def456", AGENT_TREE));
    github.tarballs.set("https://example.com/agent.tgz", tgz);

    // A git repository on disk, cloned through file:// like any other git URL.
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-test-git-"));
    for (const [rel, content] of Object.entries(AGENT_TREE)) {
      await fs.mkdir(path.dirname(path.join(repoDir, rel)), { recursive: true });
      await fs.writeFile(path.join(repoDir, rel), content);
    }
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: repoDir,
        stdio: "pipe",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@t",
        },
      });
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("commit", "-q", "-m", "agent");

    const cases: Array<[string, string, string]> = [
      ["npm:@acme/agent", "npm", "npm:@acme/agent@1.2.0"],
      [
        "https://github.com/acme/agent/releases/latest",
        "github-release",
        "github-release:acme/agent#v2",
      ],
      ["github:acme/agent", "github", "github:acme/agent"],
      ["https://github.com/acme/agent/tree/dev", "github", "github:acme/agent#dev"],
      ["https://example.com/agent.tgz", "url", "https://example.com/agent.tgz"],
      [`git+file://${repoDir}`, "git", `git:file://${repoDir}`],
    ];
    try {
      for (const [source, kind, origin] of cases) {
        const previewRes = await owner.post("/api/agent-packages/preview", { source });
        expect(previewRes.status, `${source}: ${await previewRes.clone().text()}`).toBe(200);
        const preview = (await previewRes.json()) as AgentPackagePreviewResponse;
        expect(preview.kind, source).toBe(kind);
        expect(preview.source, source).toBe(origin);
        const paths = preview.manifest.files.map((f) => f.path);
        expect(paths, source).toContain("workflows/todo/ui/index.html");
        expect(paths, source).not.toContain("workflows/todo/state.json");
        expect(paths, source).not.toContain("README.md");
      }
      const installed = await owner.post("/api/agent-packages/install", {
        source: "npm:@acme/agent",
        projectId: PROJECT,
        agentId: "from_npm",
      });
      expect(installed.status, await installed.clone().text()).toBe(201);
      const copy = agentDir(t.root, PROJECT, "from_npm");
      expect(await fs.readFile(path.join(copy, "agent_state/AGENTS.md"), "utf8")).toBe(
        "# packaged\n",
      );
      await expect(fs.stat(path.join(copy, "workflows/todo/state.json"))).rejects.toThrow();
    } finally {
      await fs.rm(repoDir, { recursive: true, force: true });
    }

    // Shapes that are not sources, and sources that are not Agents.
    expect(
      (await owner.post("/api/agent-packages/preview", { source: "just-a-name" })).status,
    ).toBe(400);
    expect((await owner.post("/api/agent-packages/preview", { source: "npm:nope" })).status).toBe(
      404,
    );
    github.tarballs.set(
      "https://example.com/plain.tgz",
      await tarballOf("plain", { "README.md": "x" }),
    );
    const notAgent = await owner.post("/api/agent-packages/preview", {
      source: "https://example.com/plain.tgz",
    });
    expect(notAgent.status).toBe(400);
    expect(await notAgent.text()).toContain("not an Agent");
  });

  it("is scoped: a non-member sees nothing, and only an owner publishes or installs", async () => {
    const other = apiClient(t.app, (await provisionUser(t.app, "other")).cookie);
    expect((await other.get(`/api/projects/${PROJECT}/agents/${AGENT}/package`)).status).toBe(404);
    expect(
      (await other.post(`/api/projects/${PROJECT}/agents/${AGENT}/package/publish`, {})).status,
    ).toBe(404);
    expect(
      (
        await other.post("/api/agent-packages/install", {
          gist: "whatever",
          projectId: PROJECT,
          agentId: "nope_agent",
        })
      ).status,
    ).toBe(404);
  });
});
