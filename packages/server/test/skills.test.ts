/**
 * Integration tests for the Skill routes: library catalog structure (any logged-in user), member
 * install/uninstall with 404 for outsiders, 404 for unknown skills, installed
 * files matching the library content, idempotent update on reinstall, the
 * directory disappearing after uninstall, and default_agent starting with all
 * skills installed while a newly created plain Agent has none.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { skillsDir } from "@prismshadow/penguin-core";
import { librarySkill, loadLibrarySkills } from "@prismshadow/penguin-skills";
import type {
  AgentSkillsResponse,
  ProjectCreateResponse,
  SkillLibraryResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("skills api", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  const base = (agentId: string) => `/api/projects/${projectId}/agents/${agentId}/skills`;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_s");
    const b = await provisionUser(t.app, "member_s");
    const c = await provisionUser(t.app, "outsider_s");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_s-skills", name: "skills project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_s" })).status,
    ).toBe(201);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  /** Creates a plain Agent with no Skills preinstalled. */
  async function createPlainAgent(agentId: string): Promise<void> {
    const res = await owner.post(`/api/projects/${projectId}/agents`, { agentId });
    expect(res.status).toBe(201);
  }

  it("GET /api/skills: groups with metadata, short descriptions, and icons, without sending bodies", async () => {
    const res = await member.get("/api/skills");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SkillLibraryResponse;
    expect(body.groups.map((g) => g.id)).toEqual([
      "agent-development",
      "data-analysis",
      "penguin-development",
      "web-development",
      "web-research",
      "software-engineering",
    ]);
    for (const group of body.groups) {
      expect(group.title.length).toBeGreaterThan(0);
      // The Chinese group title is passed through from the skills package (the UI
      // picks a language); groups no longer carry a description.
      expect(group.titleZh).toBeTruthy();
      expect("description" in group).toBe(false);
    }
    // Members within a group follow the SKILL_GROUPS list order (as ungrouped by loadSkillGroups).
    expect(body.groups[0]!.skills.map((s) => s.name)).toEqual([
      "agent-creation",
      "benchmark-design",
      "agent-evaluation",
      "agent-optimization",
    ]);
    expect(body.groups[1]!.skills.map((s) => s.name)).toEqual(["data-analysis"]);
    expect(body.groups[2]!.skills.map((s) => s.name)).toEqual([
      "penguin-sdk",
      "penguin-cli",
      "agenthub-models",
    ]);
    expect(body.groups[3]!.skills.map((s) => s.name)).toEqual(["web-design"]);
    expect(body.groups[4]!.skills.map((s) => s.name)).toEqual(["firecrawl"]);
    expect(body.groups[5]!.skills.map((s) => s.name)).toEqual(["software-engineering"]);
    const skills = body.groups.flatMap((g) => g.skills);
    for (const skill of skills) {
      expect(skill.name.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeGreaterThan(0);
      // The short description (preferred in compact spots like cards) and custom
      // icon (raw icon.svg) are passed through conditionally for every returned skill.
      expect(skill.shortDescription, skill.name).toBeTruthy();
      expect(skill.shortDescriptionZh, skill.name).toBeTruthy();
      expect(skill.icon, skill.name).toContain("<svg");
      expect(skill.icon).not.toContain("<script");
      expect(skill.version).toBeGreaterThanOrEqual(1);
      expect(skill.updated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
      // The library catalog sends only metadata: the SKILL.md body is written to disk on install and read by the model on demand.
      expect("content" in skill).toBe(false);
    }
  });

  it("members can install and uninstall; installs land verbatim on disk, the directory disappears after uninstall", async () => {
    await createPlainAgent("bare_agent");
    const url = base("bare_agent");

    // Member installs two Skills: 201 returns the updated list (sorted by name).
    const res = await member.post(url, { names: ["penguin-sdk", "agent-creation"] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AgentSkillsResponse;
    expect(body.skills.map((s) => s.name)).toEqual(["agent-creation", "penguin-sdk"]);
    // The installed list likewise passes through the short description and icon
    // (icon.svg is copied on install, identical to the library's original).
    const installed = body.skills.find((s) => s.name === "penguin-sdk")!;
    expect(installed.shortDescription).toBeTruthy();
    expect(installed.icon).toBe(librarySkill("penguin-sdk")!.icon);

    // The on-disk content matches the library's SKILL.md verbatim (including
    // frontmatter), and icon.svg is written alongside it.
    const skillFile = (name: string) =>
      path.join(skillsDir(t.root, projectId, "bare_agent"), name, "SKILL.md");
    expect(await fs.readFile(skillFile("penguin-sdk"), "utf8")).toBe(
      librarySkill("penguin-sdk")!.content,
    );
    expect(
      await fs.readFile(
        path.join(skillsDir(t.root, projectId, "bare_agent"), "penguin-sdk", "icon.svg"),
        "utf8",
      ),
    ).toBe(librarySkill("penguin-sdk")!.icon);

    // Member uninstalls: 204, the whole skills/<name>/ directory disappears, and the list is updated.
    expect((await member.delete(`${url}/penguin-sdk`)).status).toBe(204);
    await expect(fs.access(path.dirname(skillFile("penguin-sdk")))).rejects.toThrow();
    const after = (await (await member.get(url)).json()) as AgentSkillsResponse;
    expect(after.skills.map((s) => s.name)).toEqual(["agent-creation"]);

    // Deleting a Skill that isn't installed (or was already uninstalled) → 404.
    expect((await member.delete(`${url}/penguin-sdk`)).status).toBe(404);
  });

  it("reinstall is an idempotent update: hand-edited on-disk content is restored to the library content", async () => {
    await createPlainAgent("update_agent");
    const url = base("update_agent");
    expect((await owner.post(url, { names: ["penguin-cli"] })).status).toBe(201);

    // Simulate stale/tampered on-disk content.
    const file = path.join(skillsDir(t.root, projectId, "update_agent"), "penguin-cli", "SKILL.md");
    await fs.writeFile(file, "---\nname: penguin-cli\nversion: 0\n---\nstale\n", "utf8");

    const res = await owner.post(url, { names: ["penguin-cli"] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AgentSkillsResponse;
    expect(body.skills.map((s) => s.name)).toEqual(["penguin-cli"]);
    expect(await fs.readFile(file, "utf8")).toBe(librarySkill("penguin-cli")!.content);
  });

  it("unknown skill 404 unknown_skill, with no half-installed state", async () => {
    await createPlainAgent("strict_agent");
    const url = base("strict_agent");
    const res = await owner.post(url, { names: ["penguin-sdk", "no-such-skill"] });
    expect(res.status).toBe(404);
    const err = (await res.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("unknown_skill");
    expect(err.error.message).toContain("no-such-skill");
    // Whole request rejected: even the valid library skill was not written to disk.
    const list = (await (await owner.get(url)).json()) as AgentSkillsResponse;
    expect(list.skills).toEqual([]);
  });

  it("request body validation 400: names missing / empty array / non-string entries", async () => {
    await createPlainAgent("valid_agent");
    const url = base("valid_agent");
    for (const body of [{}, { names: [] }, { names: ["penguin-sdk", 1] }, { names: [""] }]) {
      expect((await owner.post(url, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("outsiders always get 404 (read, install, uninstall); a missing Agent is 404", async () => {
    const url = base("default_agent");
    expect((await outsider.get(url)).status).toBe(404);
    expect((await outsider.post(url, { names: ["penguin-sdk"] })).status).toBe(404);
    expect((await outsider.delete(`${url}/penguin-sdk`)).status).toBe(404);
    // The library catalog isn't scoped under a Project prefix: any logged-in user can read it.
    expect((await outsider.get("/api/skills")).status).toBe(200);
    // Agent doesn't exist: even a member gets 404.
    expect((await member.get(base("no_such_agent"))).status).toBe(404);
  });

  it("default_agent starts with every library skill installed; a new plain Agent has none", async () => {
    const res = await member.get(base("default_agent"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AgentSkillsResponse;
    // loadLibrarySkills itself sorts by name, matching the installed-list ordering.
    expect(body.skills.map((s) => s.name)).toEqual(loadLibrarySkills().map((s) => s.name));
    // The installed list likewise passes through the Chinese description and the
    // short description/icon (listInstalledSkills parses these from the on-disk
    // frontmatter and icon.svg).
    for (const skill of body.skills) {
      expect(skill.shortDescription, skill.name).toBeTruthy();
      expect(skill.shortDescriptionZh, skill.name).toBeTruthy();
      expect(skill.icon, skill.name).toContain("<svg");
    }

    await createPlainAgent("fresh_agent");
    const fresh = (await (await member.get(base("fresh_agent"))).json()) as AgentSkillsResponse;
    expect(fresh.skills).toEqual([]);
  });
});
