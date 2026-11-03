/**
 * Agent State export and import.
 *
 * - Any member exports (auto-packaged, `.vault.toml` left out); only the owner imports.
 * - Re-importing the same or an older version needs confirmation (409, then success), replaces
 *   agent_state and keeps the current vault; a newer package imports directly and records its
 *   version; a `.vault.toml` inside a package is ignored; an invalid package is a 400.
 * - Snapshots are written to snapshots/v<N>.tar.gz; initializing and seeding one are mutually
 *   exclusive.
 * - A snapshot leaves out the State's git repository and each workbench's `.build/` and
 *   `node_modules/`; the source, `state.json` and `.gitignore` travel.
 * - An import keeps the Agent's own repository (a version recorded before it is still listed),
 *   takes none from the package, and releases the Agent's workbenches while the previous State
 *   is still in place.
 * - An import on an Agent whose workbenches were never migrated migrates them first.
 * - Creating an Agent from a package takes its state, name and version (explicit name and
 *   description win); an invalid package fails the creation and leaves no Agent behind.
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { agentDir, agentStateDir, snapshotsDir } from "@prismshadow/penguin-core";
import type { Workbenches } from "../src/mechanisms/workbenches.js";
import { AgentStateRepo } from "../src/workbenches/repo.js";
import type {
  AgentCreateResponse,
  AgentImportResponse,
  AgentsResponse,
  ProjectCreateResponse,
  VaultResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("agent export/import", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let projectId: string;
  let base: string;

  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The default Agent's State repository, holding one version of `demo` as a load records it. */
  async function recordedDemo(state: string) {
    const repo = () =>
      new AgentStateRepo({ stateDir: state, now: () => new Date(), log: () => {} });
    const files = { "package.json": '{"name":"demo"}', "index.ts": "export default {};" };
    await fs.mkdir(path.join(state, "workbenches", "demo"), { recursive: true });
    for (const [rel, text] of Object.entries(files)) {
      await fs.writeFile(path.join(state, "workbenches", "demo", rel), text);
    }
    const { commit } = await repo().commitPath(
      "workbenches/demo",
      Object.entries(files).map(([rel, text]) => ({ rel, body: Buffer.from(text) })),
      "workbench demo @1",
    );
    return {
      commit,
      listed: async () => (await repo().history("workbenches/demo")).map((v) => v.commit),
    };
  }

  async function entriesOf(archive: Buffer): Promise<string[]> {
    const file = path.join(t.root, `entries-${projectId}.tar.gz`);
    await fs.writeFile(file, archive);
    const out: string[] = [];
    await tar.list({ file, onReadEntry: (entry) => void out.push(entry.path) });
    return out;
  }

  // Every case works in a Project of its own.
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await owner.post("/api/projects", {
        projectId: `owner_a-snap_${projects}`,
        name: "Snapshot project",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    base = `/api/projects/${projectId}/agents/default_agent`;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });

  it("reimport same version: confirm required, agent_state replaced, vault kept", async () => {
    // First set a vault key (must be preserved after import).
    expect(
      (await owner.put(`${base}/vault`, { entries: [{ key: "TOKEN", value: "secret-1" }] })).status,
    ).toBe(200);

    // Members can export; the snapshot is auto-packaged and written to snapshots/v1.tar.gz.
    const exportRes = await member.get(`${base}/export`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("content-type")).toBe("application/gzip");
    expect(exportRes.headers.get("content-disposition")).toContain("default_agent-v1.tar.gz");
    const archive = Buffer.from(await exportRes.arrayBuffer());
    expect(archive.byteLength).toBeGreaterThan(0);
    const snapFile = path.join(snapshotsDir(t.root, projectId, "default_agent"), "v1.tar.gz");
    await expect(fs.access(snapFile)).resolves.toBeUndefined();
    // The snapshot excludes the vault (rough gzip check: the archive contents don't contain the plaintext value).
    expect(archive.includes(Buffer.from("secret-1"))).toBe(false);

    // Leave a change marker in agent_state after exporting.
    const marker = path.join(agentStateDir(t.root, projectId, "default_agent"), "marker.txt");
    await fs.writeFile(marker, "dirty", "utf8");

    // Importing the same version (v1): owner only; without confirm -> 409, with confirm it succeeds and replaces agent_state.
    const body = { dataBase64: archive.toString("base64") };
    expect((await member.post(`${base}/import`, body)).status).toBe(403);
    expect((await owner.post(`${base}/import`, body)).status).toBe(409);
    const imported = await owner.post(`${base}/import`, { ...body, confirm: true });
    expect(imported.status).toBe(200);
    expect(((await imported.json()) as AgentImportResponse).version).toBe(1);
    await expect(fs.access(marker)).rejects.toThrow(); // The marker has been overwritten.

    // The current vault is preserved (not from the package, and not cleared either).
    const vault = (await (await owner.get(`${base}/vault`)).json()) as VaultResponse;
    expect(vault.entries.map((e) => e.key)).toEqual(["TOKEN"]);
  });

  it("newer-version package imports directly, persists version; invalid package 400", async () => {
    // Bump the current agent_state's version to 3, then export to get the v3 package.
    const configPath = path.join(
      agentStateDir(t.root, projectId, "default_agent"),
      "system_config.yaml",
    );
    const yaml = await fs.readFile(configPath, "utf8");
    await fs.writeFile(configPath, yaml.replace(/^version: .*$/m, "version: 3"), "utf8");
    const archive = Buffer.from(await (await owner.get(`${base}/export`)).arrayBuffer());

    // Roll version back to 1: the v3 package is newer than current, so it imports directly without confirmation.
    await fs.writeFile(configPath, yaml.replace(/^version: .*$/m, "version: 1"), "utf8");
    const res = await owner.post(`${base}/import`, { dataBase64: archive.toString("base64") });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AgentImportResponse).version).toBe(3);

    expect(
      (await owner.post(`${base}/import`, { dataBase64: Buffer.from("junk").toString("base64") }))
        .status,
    ).toBe(400);
  });

  it("a .vault.toml in the package is ignored; the current vault survives import", async () => {
    expect(
      (await owner.put(`${base}/vault`, { entries: [{ key: "TOKEN", value: "current" }] })).status,
    ).toBe(200);

    // Manually craft a v9 package containing a forged agent_state/.vault.toml.
    const src = path.join(t.root, "crafted");
    await fs.mkdir(path.join(src, "agent_state"), { recursive: true });
    await fs.writeFile(
      path.join(src, "agent_state", "system_config.yaml"),
      'system_prompt: "hi"\nversion: 9\n',
      "utf8",
    );
    await fs.writeFile(path.join(src, "agent_state", ".vault.toml"), 'EVIL = "1"\n', "utf8");
    const crafted = path.join(t.root, "crafted.tar.gz");
    await tar.create({ gzip: true, cwd: src, file: crafted }, ["agent_state"]);

    // v9 is newer than the current v1, so it imports directly without confirmation.
    const res = await owner.post(`${base}/import`, {
      dataBase64: (await fs.readFile(crafted)).toString("base64"),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AgentImportResponse).version).toBe(9);

    const vault = (await (await owner.get(`${base}/vault`)).json()) as VaultResponse;
    expect(vault.entries.map((e) => e.key)).toEqual(["TOKEN"]);
  });

  it("creates a new agent from an exported package: state, name and version come from it", async () => {
    // Give the source agent a distinct name/description/version and a state marker, then export.
    expect(
      (
        await owner.put(`${base}/config`, {
          config: { name: "Tuned Agent", description: "Tuned description" },
        })
      ).status,
    ).toBe(200);
    const configPath = path.join(
      agentStateDir(t.root, projectId, "default_agent"),
      "system_config.yaml",
    );
    const yaml = await fs.readFile(configPath, "utf8");
    await fs.writeFile(configPath, yaml.replace(/^version: .*$/m, "version: 3"), "utf8");
    const marker = path.join(agentStateDir(t.root, projectId, "default_agent"), "marker.txt");
    await fs.writeFile(marker, "seeded", "utf8");
    const archive = Buffer.from(await (await owner.get(`${base}/export`)).arrayBuffer());

    // Members can create from a package: creating overwrites nothing, unlike import.
    const created = await member.post(`/api/projects/${projectId}/agents`, {
      agentId: "cloned_agent",
      dataBase64: archive.toString("base64"),
    });
    expect(created.status).toBe(201);
    const summary = ((await created.json()) as AgentCreateResponse).agent;
    // Name, description and version come from the package (no id fallback for the name).
    expect(summary.name).toBe("Tuned Agent");
    expect(summary.description).toBe("Tuned description");
    expect(summary.version).toBe(3);

    // The package's state landed, and no pre-import snapshot of the template state was taken.
    const clonedMarker = path.join(agentStateDir(t.root, projectId, "cloned_agent"), "marker.txt");
    await expect(fs.readFile(clonedMarker, "utf8")).resolves.toBe("seeded");
    await expect(fs.access(snapshotsDir(t.root, projectId, "cloned_agent"))).rejects.toThrow();
  });

  it("explicit name/description override the package's values on create", async () => {
    const archive = Buffer.from(await (await owner.get(`${base}/export`)).arrayBuffer());
    const created = await owner.post(`/api/projects/${projectId}/agents`, {
      agentId: "renamed_agent",
      name: "Renamed",
      dataBase64: archive.toString("base64"),
    });
    expect(created.status).toBe(201);
    const summary = ((await created.json()) as AgentCreateResponse).agent;
    expect(summary.name).toBe("Renamed");
  });

  it("an invalid package fails the whole creation and leaves no agent behind", async () => {
    const res = await owner.post(`/api/projects/${projectId}/agents`, {
      agentId: "broken_agent",
      dataBase64: Buffer.from("junk").toString("base64"),
    });
    expect(res.status).toBe(400);
    const list = (await (
      await owner.get(`/api/projects/${projectId}/agents`)
    ).json()) as AgentsResponse;
    expect(list.agents.map((a) => a.agentId)).not.toContain("broken_agent");
    // The id is immediately reusable: the failed creation left no orphaned directory.
    expect(
      (await owner.post(`/api/projects/${projectId}/agents`, { agentId: "broken_agent" })).status,
    ).toBe(201);
  });

  it("snapshot initialization and seeding are mutually exclusive", async () => {
    const archive = Buffer.from(await (await owner.get(`${base}/export`)).arrayBuffer());
    const res = await owner.post(`/api/projects/${projectId}/agents`, {
      agentId: "mixed_agent",
      plugins: ["anything"],
      dataBase64: archive.toString("base64"),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "snapshot_with_plugins",
    );
  });

  it("a snapshot leaves out the repository and each workbench's .build/ and node_modules/", async () => {
    const state = agentStateDir(t.root, projectId, "default_agent");
    await recordedDemo(state);
    const demo = path.join(state, "workbenches", "demo");
    for (const rel of ["state.json", ".build/0123abcd/index.js", "node_modules/dep/index.js"]) {
      await fs.mkdir(path.dirname(path.join(demo, rel)), { recursive: true });
      await fs.writeFile(path.join(demo, rel), "{}");
    }

    const entries = await entriesOf(
      Buffer.from(await (await owner.get(`${base}/export`)).arrayBuffer()),
    );

    expect(entries.filter((e) => /(^|\/)(\.git|\.build|node_modules)(\/|$)/.test(e))).toEqual([]);
    expect(entries).toEqual(
      expect.arrayContaining([
        "agent_state/.gitignore",
        "agent_state/workbenches/demo/index.ts",
        "agent_state/workbenches/demo/state.json",
      ]),
    );
  });

  it("an import keeps the Agent's repository, takes none from the package, and releases its workbenches first", async () => {
    const state = agentStateDir(t.root, projectId, "default_agent");
    const history = await recordedDemo(state);
    const marker = path.join(state, "marker.txt");
    await fs.writeFile(marker, "previous State", "utf8");
    // What the Agent's workbenches hold is let go while the previous State is still there.
    const workbenches = t.deps.tree.api<Workbenches>("WorkbenchesModule", "Workbenches");
    const release = workbenches.releaseAgent.bind(workbenches);
    const seen: string[] = [];
    vi.spyOn(workbenches, "releaseAgent").mockImplementation(async (p, a) => {
      seen.push(await fs.readFile(marker, "utf8").catch(() => "swapped"));
      return release(p, a);
    });

    // A newer package that carries a repository of its own.
    const src = path.join(t.root, `with-repo-${projectId}`);
    await fs.mkdir(path.join(src, "agent_state", ".git"), { recursive: true });
    await fs.writeFile(
      path.join(src, "agent_state", "system_config.yaml"),
      'system_prompt: "hi"\nversion: 9\n',
    );
    await fs.writeFile(path.join(src, "agent_state", ".git", "HEAD"), "ref: refs/heads/theirs\n");
    await tar.create({ gzip: true, cwd: src, file: `${src}.tar.gz` }, ["agent_state"]);
    const res = await owner.post(`${base}/import`, {
      dataBase64: (await fs.readFile(`${src}.tar.gz`)).toString("base64"),
    });

    expect(res.status).toBe(200);
    expect(seen).toEqual(["previous State"]);
    await expect(fs.access(marker)).rejects.toThrow();
    expect(await history.listed()).toEqual([history.commit]);
    expect(await fs.readFile(path.join(state, ".git", "HEAD"), "utf8")).toContain(
      "refs/heads/main",
    );
  });

  it("an import on an Agent whose workbenches were never migrated migrates them first", async () => {
    const dir = agentDir(t.root, projectId, "default_agent");
    const legacy = path.join(dir, "workflows", "desk");
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, "package.json"), '{"name":"Desk"}');
    await fs.writeFile(path.join(legacy, "state.json"), '{"kept":true}');
    const archive = Buffer.from(await (await owner.get(`${base}/export`)).arrayBuffer());

    const res = await owner.post(`${base}/import`, {
      dataBase64: archive.toString("base64"),
      confirm: true,
    });

    expect(res.status).toBe(200);
    await expect(fs.stat(path.join(dir, "workflows"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await fs.readFile(
        path.join(dir, ".workbench-migration", "backup", "workflows", "desk", "state.json"),
        "utf8",
      ),
    ).toBe('{"kept":true}');
  });
});
