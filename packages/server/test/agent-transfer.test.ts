/**
 * Overwriting an Agent's State from a tar.gz snapshot package, and what an export or an import
 * does around the swap.
 *
 * - A `.vault.toml` inside a package is ignored; the current vault survives.
 * - An import leaves the Agent's history as it was, extracts nothing under a `.git` of any
 *   spelling (a drive prefix or another case included), and releases the Agent's workbenches
 *   while the previous State is still in place.
 * - While an import runs, a request for the Agent's workbenches waits for it to end.
 * - An export or an import of an Agent whose workbenches were never migrated migrates them first.
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { agentDir, agentStateDir } from "@prismshadow/penguin-core";
import type { Workbenches } from "../src/mechanisms/workbenches.js";
import { AgentStateRepo, agentStateRepoDir, isGitName } from "../src/workbenches/repo.js";

/** A gzipped tar holding exactly these entries under exactly these names, as a crafted package would. */
function rawPackage(entries: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, text] of Object.entries(entries)) {
    const body = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.write("        ", 148);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

/** Every path under `dir`, relative and `/`-separated. */
async function pathsUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true });
  return entries.map((entry) => entry.replaceAll("\\", "/"));
}
import type {
  AgentArchiveImportResponse,
  ProjectCreateResponse,
  VaultResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("agent export/import", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  let base: string;
  const overwrite = (archive: Uint8Array) =>
    owner.upload(
      `/api/projects/${projectId}/agents/import?agentId=default_agent&overwrite=1`,
      archive,
    );
  const exported = async () =>
    new Uint8Array(await (await owner.get(`${base}/archive`)).arrayBuffer());

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "owner_a")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The default Agent's repository, holding one version of `demo` as a load records it. */
  async function recordedDemo(state: string) {
    const gitdir = agentStateRepoDir(path.dirname(state));
    const repo = () => new AgentStateRepo({ gitdir, now: () => new Date(), log: () => {} });
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

    const res = await overwrite(await fs.readFile(crafted));
    expect(res.status).toBe(201);
    expect(((await res.json()) as AgentArchiveImportResponse).version).toBe(9);

    const vault = (await (await owner.get(`${base}/vault`)).json()) as VaultResponse;
    expect(vault.entries.map((e) => e.key)).toEqual(["TOKEN"]);
  });

  it("an import keeps the history, extracts no .git of any spelling, and releases the workbenches first", async () => {
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

    const res = await overwrite(
      rawPackage({
        "agent_state/system_config.yaml": 'system_prompt: "hi"\nversion: 9\n',
        "agent_state/skills/kept/SKILL.md": "# kept\n",
        "agent_state/.git/config": "[core]\n\tfsmonitor = touch planted\n",
        "C:agent_state/.git/hooks/post-checkout": "touch planted\n",
        "agent_state/.GIT/HEAD": "ref: refs/heads/theirs\n",
        "agent_state/skills/kept/GIT~1/config": "[core]\n",
      }),
    );

    expect(res.status, await res.text()).toBe(201);
    expect(seen).toEqual(["previous State"]);
    expect(await fs.readFile(path.join(state, "skills", "kept", "SKILL.md"), "utf8")).toBe(
      "# kept\n",
    );
    expect((await pathsUnder(state)).filter((rel) => rel.split("/").some(isGitName))).toEqual([]);
    expect(await history.listed()).toEqual([history.commit]);
  });

  it("an export of an Agent whose workbenches were never migrated migrates them first", async () => {
    const dir = agentDir(t.root, projectId, "default_agent");
    await fs.mkdir(path.join(dir, "workflows", "desk"), { recursive: true });
    await fs.writeFile(path.join(dir, "workflows", "desk", "package.json"), '{"name":"Desk"}');

    expect((await owner.get(`${base}/archive`)).status).toBe(200);

    await expect(fs.stat(path.join(dir, "workflows"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("an import on an Agent whose workbenches were never migrated migrates them first", async () => {
    const dir = agentDir(t.root, projectId, "default_agent");
    const legacy = path.join(dir, "workflows", "desk");
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, "package.json"), '{"name":"Desk"}');
    await fs.writeFile(path.join(legacy, "state.json"), '{"kept":true}');
    const res = await overwrite(await exported());

    expect(res.status).toBe(201);
    await expect(fs.stat(path.join(dir, "workflows"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await fs.readFile(
        path.join(dir, ".workbench-migration", "backup", "workflows", "desk", "state.json"),
        "utf8",
      ),
    ).toBe('{"kept":true}');
  });

  it("while an import runs, a request for the Agent's workbenches waits for it to end", async () => {
    const archive = await exported();
    const real = t.deps.snapshots.importArchive.bind(t.deps.snapshots);
    let swapping!: () => void;
    const started = new Promise<void>((resolve) => (swapping = resolve));
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    vi.spyOn(t.deps.snapshots, "importArchive").mockImplementation(async (...args) => {
      swapping();
      await held;
      return real(...args);
    });
    const order: string[] = [];

    const imported = (async () => {
      order.push(`import ${(await overwrite(archive)).status}`);
    })();
    await started;
    const listed = (async () => {
      order.push(`list ${(await owner.get(`${base}/workbenches`)).status}`);
    })();
    finish();
    await Promise.all([imported, listed]);

    expect(order).toEqual(["import 201", "list 200"]);
  });
});
