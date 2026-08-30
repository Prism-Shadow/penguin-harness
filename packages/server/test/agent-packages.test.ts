/**
 * Agent packages: an Agent's definition to a gist and back — what is packaged, what is
 * refused, and that installing writes only inside the Agent it creates.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { agentDir } from "@prismshadow/penguin-core";
import type {
  AgentPackagePreviewResponse,
  AgentPackagePublishResponse,
  AgentPackageResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "owner-pkg";
const AGENT = "default_agent";

/** A fake gists API: records what was sent, serves what it holds. */
function fakeGithub() {
  const gists = new Map<string, Record<string, { content: string }>>();
  const calls: Array<{ url: string; method: string; auth: string | null }> = [];
  let nextId = 1;
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: input, method, auth: headers["authorization"] ?? null });
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
  return { fetch, gists, calls };
}

describe("agent packages", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let github: ReturnType<typeof fakeGithub>;
  let dir: string;

  beforeEach(async () => {
    github = fakeGithub();
    t = await createTestApp({ fetch: github.fetch });
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
    // No token configured yet: the UI is told, rather than the button failing later.
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

    // Republishing updates the same gist rather than making a second one.
    const again = (await (
      await owner.post(`/api/projects/${PROJECT}/agents/${AGENT}/package/publish`, {
        gistId: published.url,
      })
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
