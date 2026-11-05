/**
 * Compatibility: an Agent State package written before the zip export (`agent_state/` as a
 * `.tar.gz`) still imports through the archive import, until 1.0 (agent-archive/tar-compat.ts).
 *
 * - Given an old package and a free id, a new Agent is made from it: its state, name and version,
 *   and no backup.
 * - Given an old package and the owner's overwrite, the Agent's State is replaced after a backup,
 *   the package's version is adopted, the Agent's vault is kept (a vault inside the package is
 *   never extracted), and what its State holds beyond the archive format stays.
 * - Given an old package without an `agentId`, the import is a 400 (the package names no Agent).
 * - Given a file that is no package at all, the import is a 400 and leaves the id free.
 * - Given a package with `.git` entries under several spellings, none is extracted, the Agent's
 *   history is as it was, and its workbenches are let go while the previous State is in place.
 * - Given a package whose agent_state is a link, or holds a link that leaves agent_state, points
 *   at nothing or was absolute, the import is a 400 and the Agent is untouched.
 * - Given a package with a relative link inside agent_state, the Agent created from it reads
 *   through the link.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import * as tar from "tar";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agentDir, agentStateDir, agentVaultPath, agentsDir } from "@prismshadow/penguin-core";
import type {
  AgentArchiveImportResponse,
  ProjectCreateResponse,
  VaultResponse,
} from "../src/api/types.js";
import type { Workbenches } from "../src/mechanisms/workbenches.js";
import { AgentStateRepo, agentStateRepoDir, isGitName } from "../src/workbenches/repo.js";
import { apiClient, canCreateSymlink, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const CONFIG = 'system_prompt: "candidate"\nname: Packaged\nversion: 7\n';

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

describe("Agent archive: old .tar.gz packages", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  let packages = 0;
  const agentBase = (id: string) => `/api/projects/${projectId}/agents/${id}`;
  const importUrl = (query: string) => `/api/projects/${projectId}/agents/import${query}`;

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "owner_a")).cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-compat", name: "Compat" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterAll(async () => {
    await t.cleanup();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A package built from a folder the way the old snapshot export packed one. */
  async function pack(
    build: (src: string) => Promise<void>,
    entries = ["agent_state"],
  ): Promise<Buffer> {
    const src = path.join(t.root, `package_${++packages}`);
    await fs.mkdir(src, { recursive: true });
    await build(src);
    await tar.create({ gzip: true, cwd: src, file: `${src}.tar.gz` }, entries);
    return fs.readFile(`${src}.tar.gz`);
  }

  async function candidate(src: string): Promise<void> {
    await fs.mkdir(path.join(src, "agent_state", "skills"), { recursive: true });
    await fs.writeFile(path.join(src, "agent_state", "system_config.yaml"), CONFIG);
    await fs.writeFile(path.join(src, "agent_state", "lesson.md"), "Keep this lesson\n");
    await fs.writeFile(path.join(src, "agent_state", ".vault.toml"), 'EVIL = "1"\n');
  }

  async function newAgent(id: string): Promise<string> {
    expect((await owner.post(`/api/projects/${projectId}/agents`, { agentId: id })).status).toBe(
      201,
    );
    return agentStateDir(t.root, projectId, id);
  }

  it("an old package and a free id make a new Agent with its state, name and version, and no backup", async () => {
    const res = await owner.upload(importUrl("?agentId=from_tar"), await pack(candidate));

    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as AgentArchiveImportResponse;
    expect(body).toMatchObject({ mode: "created", version: 7, agent: { name: "Packaged" } });
    expect(body.backup).toBeUndefined();
    const state = agentStateDir(t.root, projectId, "from_tar");
    expect(await fs.readFile(path.join(state, "lesson.md"), "utf8")).toBe("Keep this lesson\n");
    await expect(fs.access(agentVaultPath(t.root, projectId, "from_tar"))).rejects.toThrow();
  });

  it("an old package with overwrite replaces the State after a backup, adopts its version and keeps the vault", async () => {
    const state = await newAgent("tar_target");
    await fs.writeFile(path.join(state, "marker.txt"), "the Agent's own\n");
    await owner.put(`${agentBase("tar_target")}/vault`, {
      entries: [{ key: "TOKEN", value: "kept" }],
    });

    const res = await owner.upload(
      importUrl("?agentId=tar_target&overwrite=1"),
      await pack(candidate),
    );

    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as AgentArchiveImportResponse;
    expect(body).toMatchObject({ mode: "overwritten", previousVersion: 1, version: 7 });
    await expect(
      fs.access(path.join(agentDir(t.root, projectId, "tar_target"), body.backup!)),
    ).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(state, "lesson.md"), "utf8")).toBe("Keep this lesson\n");
    expect(await fs.readFile(path.join(state, "marker.txt"), "utf8")).toBe("the Agent's own\n");
    const vault = (await (
      await owner.get(`${agentBase("tar_target")}/vault`)
    ).json()) as VaultResponse;
    expect(vault.entries.map((e) => e.key)).toEqual(["TOKEN"]);
  });

  it("an old package without an agentId is a 400", async () => {
    const res = await owner.upload(importUrl(""), await pack(candidate));

    expect(res.status).toBe(400);
  });

  it("a file that is no package is a 400 and leaves the id free", async () => {
    const res = await owner.upload(importUrl("?agentId=junk_agent"), gzipSync(Buffer.from("junk")));

    expect(res.status).toBe(400);
    const names = await fs.readdir(agentsDir(t.root, projectId));
    expect(names.filter((n) => n === "junk_agent" || n.startsWith(".import-"))).toEqual([]);
    expect(
      (await owner.post(`/api/projects/${projectId}/agents`, { agentId: "junk_agent" })).status,
    ).toBe(201);
  });

  it("no .git of any spelling is extracted, the history stays, and the workbenches are let go while the previous State is in place", async () => {
    const state = await newAgent("git_target");
    const gitdir = agentStateRepoDir(path.dirname(state));
    const repo = () => new AgentStateRepo({ gitdir, now: () => new Date(0), log: () => {} });
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
    const marker = path.join(state, "marker.txt");
    await fs.writeFile(marker, "previous State", "utf8");
    const workbenches = t.deps.tree.api<Workbenches>("WorkbenchesModule", "Workbenches");
    const release = workbenches.releaseAgent.bind(workbenches);
    const seen: string[] = [];
    vi.spyOn(workbenches, "releaseAgent").mockImplementation(async (p, a) => {
      seen.push(await fs.readFile(marker, "utf8").catch(() => "swapped"));
      return release(p, a);
    });

    const res = await owner.upload(
      importUrl("?agentId=git_target&overwrite=1"),
      rawPackage({
        "agent_state/system_config.yaml": 'system_prompt: "hi"\nversion: 9\n',
        "agent_state/skills/kept/SKILL.md": "# kept\n",
        "agent_state/.git/config": "[core]\n\tfsmonitor = touch planted\n",
        "C:agent_state/.git/hooks/post-checkout": "touch planted\n",
        "agent_state/.GIT/HEAD": "ref: refs/heads/theirs\n",
        "agent_state/skills/kept/GIT~1/config": "[core]\n",
      }),
    );

    expect(res.status, await res.clone().text()).toBe(201);
    expect(seen[0]).toBe("previous State");
    expect(await fs.readFile(path.join(state, "skills", "kept", "SKILL.md"), "utf8")).toBe(
      "# kept\n",
    );
    expect((await pathsUnder(state)).filter((rel) => rel.split("/").some(isGitName))).toEqual([]);
    expect((await repo().history("workbenches/demo")).map((v) => v.commit)).toEqual([commit]);
  });

  describe.skipIf(!canCreateSymlink())("package links", () => {
    it.each([
      {
        name: "agent_state is itself a link",
        entries: ["payload", "agent_state"],
        build: async (src: string) => {
          await fs.mkdir(path.join(src, "payload"));
          await fs.writeFile(path.join(src, "payload", "system_config.yaml"), CONFIG);
          await fs.symlink("payload", path.join(src, "agent_state"), "dir");
        },
      },
      {
        name: "a link leaves agent_state for a file the package carries beside it",
        entries: ["config.yaml", "agent_state"],
        build: async (src: string) => {
          await fs.writeFile(path.join(src, "config.yaml"), CONFIG);
          await fs.mkdir(path.join(src, "agent_state"));
          await fs.symlink("../config.yaml", path.join(src, "agent_state", "system_config.yaml"));
        },
      },
      {
        name: "a link points at nothing",
        entries: ["agent_state"],
        build: async (src: string) => {
          await candidate(src);
          await fs.symlink(
            "../../nowhere",
            path.join(src, "agent_state", "skills", "linked"),
            "dir",
          );
        },
      },
      {
        name: "a link was absolute",
        entries: ["agent_state"],
        build: async (src: string) => {
          await candidate(src);
          await fs.mkdir(path.join(src, "guidance"));
          await fs.symlink(
            path.join(src, "guidance"),
            path.join(src, "agent_state", "skills", "linked"),
            "dir",
          );
        },
      },
    ])(
      "a package where $name is refused and the Agent is untouched",
      async ({ name, build, entries }) => {
        const id = `linked_${name.replace(/[^a-z]+/g, "_").slice(0, 30)}`;
        const state = await newAgent(id);
        const before = await fs.readFile(path.join(state, "system_config.yaml"), "utf8");

        const res = await owner.upload(
          importUrl(`?agentId=${id}&overwrite=1`),
          await pack(build, entries),
        );

        expect(res.status).toBe(400);
        expect(await fs.readFile(path.join(state, "system_config.yaml"), "utf8")).toBe(before);
        const staged = (await fs.readdir(agentDir(t.root, projectId, id))).filter((n) =>
          n.startsWith(".import-"),
        );
        expect(staged).toEqual([]);
      },
    );

    it("a relative link inside agent_state survives creating an Agent from the package", async () => {
      const zip = await pack(async (src) => {
        await candidate(src);
        await fs.mkdir(path.join(src, "agent_state", "guidance"));
        await fs.writeFile(path.join(src, "agent_state", "guidance", "SKILL.md"), "# Guidance\n");
        await fs.symlink("../guidance", path.join(src, "agent_state", "skills", "linked"), "dir");
      });

      const res = await owner.upload(importUrl("?agentId=link_keeper"), zip);

      expect(res.status, await res.clone().text()).toBe(201);
      const state = agentStateDir(t.root, projectId, "link_keeper");
      await expect(
        fs.readFile(path.join(state, "skills", "linked", "SKILL.md"), "utf8"),
      ).resolves.toBe("# Guidance\n");
    });
  });
});
