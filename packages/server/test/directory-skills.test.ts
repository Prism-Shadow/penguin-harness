/**
 * Importing Skills from a directory the user picked.
 *
 * - Discovery reads `.agents/skills` and `.claude/skills` and says which layout each Skill came
 *   from; a `.claude` that is a symlink to `.agents` offers nothing twice; `.agents` wins a
 *   name both layouts carry.
 * - Passed over rather than offered: a Skill with no frontmatter, a symlinked Skill directory,
 *   an unsafe name, one past the size caps. `SKILL.md` and `icon.svg` are read only when they
 *   are regular files the Skill directory owns, so a symlink cannot hand back a file outside
 *   it, and one unreadable Skill does not take the rest of the directory with it.
 * - An empty directory is an empty list; a relative path, a missing directory and an outsider
 *   are refused.
 * - Creating an Agent installs the picked names, files and icon included, a directory Skill
 *   shadowing a library Skill of the same name; a picked Skill that is gone is a 404 with no
 *   Agent created; a relative skillsDirectory and half of the directory pair are refused.
 *
 * One app and one Project for the file; every case works in a scratch directory and Agents of
 * its own.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { skillsDir, librarySkill } from "@prismshadow/penguin-core";
import type {
  AgentCreateResponse,
  AgentsResponse,
  AgentSkillsResponse,
  DirectorySkillsResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import { apiClient, canCreateSymlink, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

// Symlink creation needs a privilege or Developer Mode on Windows; canCreateSymlink()
// probes once and caches, so these cases still run where the capability exists.
const itWithSymlinks = it.skipIf(!canCreateSymlink());

const skillMd = (name: string, description = `${name} does a thing`) =>
  `---\nname: ${name}\ndescription: ${description}\nversion: 2026.08.23.3\n---\n\nBody of ${name}.\n`;

describe("directory skills api", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  let dir: string;

  const listUrl = (p: string) =>
    `/api/projects/${projectId}/dir-skills?path=${encodeURIComponent(p)}`;

  /** Writes `<dir>/<layout>/<name>/SKILL.md`, plus any auxiliary files. */
  const writeSkill = async (
    layout: string,
    name: string,
    opts: { description?: string; files?: Record<string, string>; icon?: string } = {},
  ) => {
    const target = path.join(dir, layout, name);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "SKILL.md"), skillMd(name, opts.description));
    if (opts.icon) await fs.writeFile(path.join(target, "icon.svg"), opts.icon);
    for (const [rel, data] of Object.entries(opts.files ?? {})) {
      await fs.mkdir(path.dirname(path.join(target, rel)), { recursive: true });
      await fs.writeFile(path.join(target, rel), data);
    }
  };

  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_d");
    const b = await provisionUser(t.app, "outsider_d");
    owner = apiClient(t.app, a.cookie);
    outsider = apiClient(t.app, b.cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // Every case picks a directory of its own and installs into the one Project, in Agents that
  // go with the case (a retry finds their names free).
  beforeAll(async () => {
    const created = (await (
      await owner.post("/api/projects", {
        projectId: "owner_d-dirskills",
        name: "directory skills project",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-dirskills-"));
  });
  afterEach(async () => {
    const listed = (await (
      await owner.get(`/api/projects/${projectId}/agents`)
    ).json()) as AgentsResponse;
    for (const { agentId } of listed.agents) {
      if (agentId !== "default_agent") {
        await owner.delete(`/api/projects/${projectId}/agents/${agentId}`);
      }
    }
    // A scratch checkout can resist removal on Windows for a moment; same retry discipline as
    // helpers.ts.
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("finds Skills in both layouts and says which one each came from", async () => {
    await writeSkill(".agents/skills", "alpha");
    await writeSkill(".claude/skills", "beta");
    const res = (await (await owner.get(listUrl(dir))).json()) as DirectorySkillsResponse;
    expect(res.skills.map((s) => [s.name, s.source])).toEqual([
      ["alpha", ".agents/skills"],
      ["beta", ".claude/skills"],
    ]);
    // Metadata comes from the frontmatter, and content never crosses the wire.
    expect(res.skills[0]!.description).toBe("alpha does a thing");
    expect(res.skills[0]!.version).toBe("2026.08.23.3");
    expect(res.skills[0]).not.toHaveProperty("content");
  });

  itWithSymlinks("offers each Skill once when .claude is a symlink to .agents", async () => {
    await writeSkill(".agents/skills", "alpha");
    await writeSkill(".agents/skills", "gamma");
    await fs.symlink(path.join(dir, ".agents"), path.join(dir, ".claude"));
    const res = (await (await owner.get(listUrl(dir))).json()) as DirectorySkillsResponse;
    expect(res.skills.map((s) => s.name)).toEqual(["alpha", "gamma"]);
    expect(res.skills.every((s) => s.source === ".agents/skills")).toBe(true);
  });

  it("lets .agents win when both layouts carry the same name as real directories", async () => {
    await writeSkill(".agents/skills", "dup", { description: "from agents" });
    await writeSkill(".claude/skills", "dup", { description: "from claude" });
    const res = (await (await owner.get(listUrl(dir))).json()) as DirectorySkillsResponse;
    expect(res.skills).toHaveLength(1);
    expect(res.skills[0]!.description).toBe("from agents");
    expect(res.skills[0]!.source).toBe(".agents/skills");
  });

  itWithSymlinks(
    "passes over what is not an installable Skill instead of offering it",
    async () => {
      await writeSkill(".agents/skills", "real");
      // No SKILL.md at all.
      await fs.mkdir(path.join(dir, ".agents/skills/empty-dir"), { recursive: true });
      // A SKILL.md with no frontmatter.
      await fs.mkdir(path.join(dir, ".agents/skills/no-frontmatter"), { recursive: true });
      await fs.writeFile(path.join(dir, ".agents/skills/no-frontmatter/SKILL.md"), "just prose\n");
      // A name the installer would reject.
      await fs.mkdir(path.join(dir, ".agents/skills/bad name"), { recursive: true });
      await fs.writeFile(path.join(dir, ".agents/skills/bad name/SKILL.md"), skillMd("bad name"));
      // A symlinked Skill directory: how a tree outside the layout would otherwise be read.
      const outside = path.join(dir, "outside-skill");
      await fs.mkdir(outside, { recursive: true });
      await fs.writeFile(path.join(outside, "SKILL.md"), skillMd("linked"));
      await fs.symlink(outside, path.join(dir, ".agents/skills/linked"));

      const res = (await (await owner.get(listUrl(dir))).json()) as DirectorySkillsResponse;
      expect(res.skills.map((s) => s.name)).toEqual(["real"]);
    },
  );

  itWithSymlinks(
    "does not follow a symlinked SKILL.md or icon.svg out of the Skill directory",
    async () => {
      const secret = path.join(dir, "outside", "id_rsa");
      await fs.mkdir(path.dirname(secret), { recursive: true });
      await fs.writeFile(secret, "-----BEGIN PRIVATE KEY-----\nSECRET\n");

      // A real Skill whose icon.svg is a link to that file: the Skill is still offered, without an
      // icon — the link's target never reaches the response, nor the Agent it would be installed on.
      await writeSkill(".agents/skills", "linked-icon");
      await fs.rm(path.join(dir, ".agents/skills/linked-icon/icon.svg"), { force: true });
      await fs.symlink(secret, path.join(dir, ".agents/skills/linked-icon/icon.svg"));
      // A Skill whose SKILL.md is itself a link is not a Skill at all.
      const outsideMd = path.join(dir, "outside", "SKILL.md");
      await fs.writeFile(outsideMd, skillMd("linked-md"));
      await fs.mkdir(path.join(dir, ".agents/skills/linked-md"), { recursive: true });
      await fs.symlink(outsideMd, path.join(dir, ".agents/skills/linked-md/SKILL.md"));

      const res = (await (await owner.get(listUrl(dir))).json()) as DirectorySkillsResponse;
      expect(res.skills.map((s) => s.name)).toEqual(["linked-icon"]);
      expect(res.skills[0]).not.toHaveProperty("icon");
      expect(JSON.stringify(res)).not.toContain("SECRET");

      const created = await owner.post(`/api/projects/${projectId}/agents`, {
        agentId: "no_link_agent",
        skillsDirectory: dir,
        directorySkills: ["linked-icon"],
      });
      expect(created.status).toBe(201);
      await expect(
        fs.readFile(
          path.join(skillsDir(t.root, projectId, "no_link_agent"), "linked-icon", "icon.svg"),
          "utf8",
        ),
      ).rejects.toThrow();
    },
  );

  it("passes over a Skill that busts the size caps instead of hiding the whole directory", async () => {
    await writeSkill(".agents/skills", "small");
    await writeSkill(".agents/skills", "fat", {
      // One auxiliary file over the 5MB per-file cap.
      files: { "blob.bin": "x".repeat(6 * 1024 * 1024) },
    });
    const res = await owner.get(listUrl(dir));
    expect(res.status).toBe(200);
    expect(((await res.json()) as DirectorySkillsResponse).skills.map((s) => s.name)).toEqual([
      "fat",
      "small",
    ]);
    // Picking the oversized one is still refused, and no Agent is left behind.
    const created = await owner.post(`/api/projects/${projectId}/agents`, {
      agentId: "fat_agent",
      skillsDirectory: dir,
      directorySkills: ["fat"],
    });
    expect(created.status).toBe(413);
    expect(
      (await owner.post(`/api/projects/${projectId}/agents`, { agentId: "fat_agent" })).status,
    ).toBe(201);
  });

  it("answers an empty list for a directory that carries no Skills", async () => {
    const res = await owner.get(listUrl(dir));
    expect(res.status).toBe(200);
    expect(((await res.json()) as DirectorySkillsResponse).skills).toEqual([]);
  });

  it("rejects a relative path, a missing directory, and an outsider", async () => {
    expect((await owner.get(listUrl("relative/path"))).status).toBe(400);
    expect((await owner.get(listUrl(path.join(dir, "nope")))).status).toBe(404);
    expect((await outsider.get(listUrl(dir))).status).toBe(404);
  });

  it("installs the picked directory Skills at creation, files and icon included", async () => {
    await writeSkill(".agents/skills", "alpha", {
      icon: "<svg/>",
      files: { "reference/api.md": "aux body\n" },
    });
    await writeSkill(".claude/skills", "beta");
    const created = await owner.post(`/api/projects/${projectId}/agents`, {
      agentId: "dir_agent",
      skillsDirectory: dir,
      directorySkills: ["alpha", "beta"],
    });
    expect(created.status).toBe(201);
    expect(((await created.json()) as AgentCreateResponse).agent.skillCount).toBe(2);

    const installed = skillsDir(t.root, projectId, "dir_agent");
    expect(await fs.readFile(path.join(installed, "alpha", "SKILL.md"), "utf8")).toBe(
      skillMd("alpha"),
    );
    expect(await fs.readFile(path.join(installed, "alpha", "icon.svg"), "utf8")).toBe("<svg/>");
    expect(await fs.readFile(path.join(installed, "alpha", "reference", "api.md"), "utf8")).toBe(
      "aux body\n",
    );
    const listed = (await (
      await owner.get(`/api/projects/${projectId}/agents/dir_agent/skills`)
    ).json()) as AgentSkillsResponse;
    expect(listed.skills.map((s) => s.name)).toEqual(["alpha", "beta"]);
  });

  it("lets a directory Skill shadow a library Skill of the same name", async () => {
    await writeSkill(".agents/skills", "penguin-sdk", { description: "the checkout's own" });
    const created = await owner.post(`/api/projects/${projectId}/agents`, {
      agentId: "shadow_agent",
      skills: ["penguin-sdk"],
      skillsDirectory: dir,
      directorySkills: ["penguin-sdk"],
    });
    expect(created.status).toBe(201);
    const onDisk = await fs.readFile(
      path.join(skillsDir(t.root, projectId, "shadow_agent"), "penguin-sdk", "SKILL.md"),
      "utf8",
    );
    expect(onDisk).toBe(skillMd("penguin-sdk", "the checkout's own"));
    expect(onDisk).not.toBe(librarySkill("penguin-sdk")!.skill.content);
  });

  it("is 404 with no Agent created when a picked directory Skill is gone", async () => {
    await writeSkill(".agents/skills", "alpha");
    const res = await owner.post(`/api/projects/${projectId}/agents`, {
      agentId: "ghost_dir_agent",
      skillsDirectory: dir,
      directorySkills: ["alpha", "vanished"],
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unknown_skill");
    // The id is still free: nothing was written before the whole batch resolved.
    expect(
      (await owner.post(`/api/projects/${projectId}/agents`, { agentId: "ghost_dir_agent" }))
        .status,
    ).toBe(201);
  });

  it("rejects a relative skillsDirectory on create, like the discovery route does", async () => {
    const res = await owner.post(`/api/projects/${projectId}/agents`, {
      agentId: "rel_agent",
      skillsDirectory: "relative/path",
      directorySkills: ["alpha"],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("dir_not_absolute");
  });

  it("rejects half of the directory pair rather than ignoring it", async () => {
    expect(
      (
        await owner.post(`/api/projects/${projectId}/agents`, {
          agentId: "half_a",
          skillsDirectory: dir,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await owner.post(`/api/projects/${projectId}/agents`, {
          agentId: "half_b",
          directorySkills: ["alpha"],
        })
      ).status,
    ).toBe(400);
  });
});
