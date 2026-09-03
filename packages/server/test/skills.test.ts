/**
 * Integration tests for the Skill routes: library catalog structure (any logged-in user), member
 * install/uninstall with 404 for outsiders, 404 for unknown skills, installed
 * files matching the library content, idempotent update on reinstall, the
 * directory disappearing after uninstall, default_agent starting with the
 * preinstalled library set (preinstall: false skills stay manual-install)
 * while a newly created plain Agent has none, Agent creation seeding the Skills picked in the
 * create dialog (unknown name = 404 with no Agent created), and the zip
 * archive install/export (layouts, zip-slip and limit rejections, 409
 * skill_exists + overwrite replace, byte-identical export round-trip), and the Agent list's
 * `pluginUpdates` — the Skill-library badge gate, which rides along on that list.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { skillsDir, librarySkill, loadPreinstalledPlugins } from "@prismshadow/penguin-core";
import type {
  AgentCreateResponse,
  AgentsResponse,
  AgentSkillsResponse,
  PluginFilesResponse,
  PluginLibraryResponse,
  ProjectCreateResponse,
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
  const plugins = (agentId: string) => `/api/projects/${projectId}/agents/${agentId}/plugins`;
  /** The plugins route beside a skills route: library installs go through plugins. */
  const toPlugins = (skillsUrl: string) => skillsUrl.replace(/\/skills$/, "/plugins");
  /** The skill names the preinstalled plugins ship, sorted — the installed-list order. */
  const preinstalledSkillNames = () =>
    loadPreinstalledPlugins()
      .flatMap((p) => p.skills.map((s) => s.name))
      .sort();

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

  it("GET /api/plugins: categories with plugin metadata, skills and hook points, without sending bodies", async () => {
    const res = await member.get("/api/plugins");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PluginLibraryResponse;
    expect(body.groups.map((g) => g.id)).toEqual([
      "office-productivity",
      "software-development",
      "ai-app-development",
    ]);
    for (const group of body.groups) {
      expect(group.title.length).toBeGreaterThan(0);
      // The Chinese category title is passed through from the plugins package (the UI picks a language).
      expect(group.titleZh).toBeTruthy();
      // Members are name-sorted within their category.
      expect(group.plugins.map((p) => p.name)).toEqual(
        [...group.plugins.map((p) => p.name)].sort(),
      );
    }
    const plugins = body.groups.flatMap((g) => g.plugins);
    for (const plugin of plugins) {
      expect(plugin.description.length, plugin.name).toBeGreaterThan(0);
      expect(plugin.version, plugin.name).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
      expect(plugin.skills.length > 0 || plugin.hooks.length > 0, plugin.name).toBe(true);
      for (const skill of plugin.skills) {
        // The short description (preferred in compact spots like cards) is passed through for
        // every returned skill; a skill's icon is its plugin's, sent once on the plugin item;
        // bodies never are.
        expect(skill.shortDescription, skill.name).toBeTruthy();
        expect(skill.shortDescriptionZh, skill.name).toBeTruthy();
        expect(skill.icon, skill.name).toBeUndefined();
        expect(skill.version).toBe(plugin.version);
        expect("content" in skill).toBe(false);
      }
    }
    const goal = plugins.find((p) => p.name === "goal")!;
    expect(goal).toMatchObject({ hooks: ["user_prompt", "stop"], skills: [] });
    expect(goal.descriptionZh).toBeTruthy();
    expect("files" in goal).toBe(false);
    expect(plugins.find((p) => p.name === "continual-learning")).toMatchObject({
      hooks: ["stop"],
    });
    expect(plugins.find((p) => p.name === "humanizer")).toMatchObject({
      hooks: [],
    });
  });

  it("GET /api/plugins/:plugin/files: what a plugin ships, keyed by path — skills' installable files and hook scripts", async () => {
    const dev = await member.get("/api/plugins/software-development/files");
    expect(dev.status).toBe(200);
    const devFiles = ((await dev.json()) as PluginFilesResponse).files;
    expect(Object.keys(devFiles)).toEqual([
      "skills/software-engineering/SKILL.md",
      "skills/web-design/SKILL.md",
    ]);
    // The installable copy (frontmatter stamped), the same text an install writes.
    expect(devFiles["skills/web-design/SKILL.md"]).toBe(librarySkill("web-design")!.skill.content);

    const goal = await member.get("/api/plugins/goal/files");
    expect(Object.keys(((await goal.json()) as PluginFilesResponse).files).sort()).toEqual([
      "hooks/lib.mjs",
      "hooks/start.mjs",
      "hooks/stop.mjs",
    ]);

    // A skill's auxiliary files keep their subdirectory path.
    const humanizer = await member.get("/api/plugins/humanizer/files");
    const humanizerFiles = ((await humanizer.json()) as PluginFilesResponse).files;
    expect(Object.keys(humanizerFiles)).toContain("skills/humanizer/reference/tells.md");

    expect((await member.get("/api/plugins/no-such-plugin/files")).status).toBe(404);
  });

  it("members can install and uninstall; installs land verbatim on disk, the directory disappears after uninstall", async () => {
    await createPlainAgent("bare_agent");
    const url = base("bare_agent");

    // Member installs two plugins: 201 returns the updated skill list (sorted by name); a
    // multi-skill plugin lands every one of its skills.
    const res = await member.post(toPlugins(url), {
      names: ["data-analysis", "software-development"],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AgentSkillsResponse;
    expect(body.skills.map((s) => s.name)).toEqual([
      "data-analysis",
      "software-engineering",
      "web-design",
    ]);
    // The installed list likewise passes through the short description and the icon — the
    // plugin's, written as icon.svg beside SKILL.md on install (a skill has none of its own).
    const installed = body.skills.find((s) => s.name === "web-design")!;
    expect(installed.shortDescription).toBeTruthy();
    const pluginIcon = librarySkill("web-design")!.plugin.icon;
    expect(pluginIcon).toBeDefined();
    expect(installed.icon).toBe(pluginIcon);

    // The on-disk content matches the library's SKILL.md verbatim (including frontmatter),
    // and the icon beside it is the plugin's.
    const skillFile = (name: string) =>
      path.join(skillsDir(t.root, projectId, "bare_agent"), name, "SKILL.md");
    expect(await fs.readFile(skillFile("web-design"), "utf8")).toBe(
      librarySkill("web-design")!.skill.content,
    );
    expect(
      await fs.readFile(
        path.join(skillsDir(t.root, projectId, "bare_agent"), "web-design", "icon.svg"),
        "utf8",
      ),
    ).toBe(pluginIcon);

    // Member uninstalls one skill: 204, the whole skills/<name>/ directory disappears, and the list is updated.
    expect((await member.delete(`${url}/web-design`)).status).toBe(204);
    await expect(fs.access(path.dirname(skillFile("web-design")))).rejects.toThrow();
    const after = (await (await member.get(url)).json()) as AgentSkillsResponse;
    expect(after.skills.map((s) => s.name)).toEqual(["data-analysis", "software-engineering"]);

    // Deleting a Skill that isn't installed (or was already uninstalled) → 404.
    expect((await member.delete(`${url}/web-design`)).status).toBe(404);
  });

  it("reinstall is an idempotent update: hand-edited on-disk content is restored to the library content", async () => {
    await createPlainAgent("update_agent");
    const url = base("update_agent");
    expect((await owner.post(toPlugins(url), { names: ["agent-development"] })).status).toBe(201);

    // Simulate stale/tampered on-disk content.
    const file = path.join(
      skillsDir(t.root, projectId, "update_agent"),
      "penguin-config",
      "SKILL.md",
    );
    await fs.writeFile(file, "---\nname: penguin-config\nversion: 0\n---\nstale\n", "utf8");

    const res = await owner.post(toPlugins(url), { names: ["agent-development"] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AgentSkillsResponse;
    expect(body.skills.map((s) => s.name)).toEqual([
      "penguin-config",
      "penguin-orchestration",
      "penguin-sdk",
      "unified-llm-api",
    ]);
    expect(await fs.readFile(file, "utf8")).toBe(librarySkill("penguin-config")!.skill.content);
  });

  it("unknown skill 404 unknown_skill, with no half-installed state", async () => {
    await createPlainAgent("strict_agent");
    const url = base("strict_agent");
    const res = await owner.post(toPlugins(url), { names: ["data-analysis", "no-such-skill"] });
    expect(res.status).toBe(404);
    const err = (await res.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("unknown_plugin");
    expect(err.error.message).toContain("no-such-skill");
    // Whole request rejected: even the valid library skill was not written to disk.
    const list = (await (await owner.get(url)).json()) as AgentSkillsResponse;
    expect(list.skills).toEqual([]);
  });

  it("request body validation 400: names missing / empty array / non-string entries", async () => {
    await createPlainAgent("valid_agent");
    const url = base("valid_agent");
    for (const body of [{}, { names: [] }, { names: ["data-analysis", 1] }, { names: [""] }]) {
      expect((await owner.post(toPlugins(url), body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("outsiders always get 404 (read, install, uninstall); a missing Agent is 404", async () => {
    const url = base("default_agent");
    expect((await outsider.get(url)).status).toBe(404);
    expect((await outsider.post(toPlugins(url), { names: ["penguin-sdk"] })).status).toBe(404);
    expect((await outsider.post(`${url}/archive`, { dataBase64: "AAAA" })).status).toBe(404);
    expect((await outsider.get(`${url}/penguin-sdk/archive`)).status).toBe(404);
    expect((await outsider.delete(`${url}/penguin-sdk`)).status).toBe(404);
    // The library catalog isn't scoped under a Project prefix: any logged-in user can read it.
    expect((await outsider.get("/api/plugins")).status).toBe(200);
    // Agent doesn't exist: even a member gets 404.
    expect((await member.get(base("no_such_agent"))).status).toBe(404);
  });

  it("default_agent starts with the preinstalled library set; preinstall:false skills stay manual-install", async () => {
    const res = await member.get(base("default_agent"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AgentSkillsResponse;
    // loadPreinstalledSkills keeps loadLibrarySkills' name sort, matching the installed-list ordering.
    expect(body.skills.map((s) => s.name)).toEqual(preinstalledSkillNames());
    // use-claude-code and humanizer ship in the library marked `preinstall: false`: their skills are not present here.
    expect(body.skills.map((s) => s.name)).not.toContain("remote-claude-code");
    expect(body.skills.map((s) => s.name)).not.toContain("humanizer");
    // The installed list likewise passes through the Chinese and short descriptions
    // (listInstalledSkills parses these from the on-disk frontmatter) and the icon each
    // install wrote beside SKILL.md — its plugin's.
    for (const skill of body.skills) {
      expect(skill.shortDescription, skill.name).toBeTruthy();
      expect(skill.shortDescriptionZh, skill.name).toBeTruthy();
      expect(skill.icon, skill.name).toBe(librarySkill(skill.name)!.plugin.icon);
    }

    // Manual install from the library still works for a preinstall:false skill.
    const manual = await member.post(plugins("default_agent"), {
      names: ["use-claude-code"],
    });
    expect(manual.status).toBe(201);
    const withManual = (await manual.json()) as AgentSkillsResponse;
    expect(withManual.skills.map((s) => s.name)).toContain("remote-claude-code");
    // A multi-file skill: the file its SKILL.md references is installed alongside SKILL.md,
    // byte-identical to the library source (subdirectory preserved).
    const aux = "reference/persistent-session.md";
    const refPath = path.join(
      skillsDir(t.root, projectId, "default_agent"),
      "remote-claude-code",
      "reference",
      "persistent-session.md",
    );
    expect(await fs.readFile(refPath, "utf8")).toBe(
      librarySkill("remote-claude-code")!.skill.files![aux],
    );

    await createPlainAgent("fresh_agent");
    const fresh = (await (await member.get(base("fresh_agent"))).json()) as AgentSkillsResponse;
    expect(fresh.skills).toEqual([]);
  });

  it("agent create seeds the picked library skills; the files land verbatim and the card count follows", async () => {
    const created = await owner.post(`/api/projects/${projectId}/agents`, {
      agentId: "seeded_agent",
      name: "Seeded",
      plugins: ["agent-development", "software-development"],
    });
    expect(created.status).toBe(201);
    const summary = (await created.json()) as AgentCreateResponse;
    expect(summary.agent.skillCount).toBe(6);

    // The installed list is the same shape a library install produces (name-sorted):
    // every skill of both merged plugins.
    const listed = (await (await member.get(base("seeded_agent"))).json()) as AgentSkillsResponse;
    expect(listed.skills.map((s) => s.name)).toEqual([
      "penguin-config",
      "penguin-orchestration",
      "penguin-sdk",
      "software-engineering",
      "unified-llm-api",
      "web-design",
    ]);
    // Installed through the same writer as the Skills tab: SKILL.md is the library file verbatim.
    const onDisk = await fs.readFile(
      path.join(skillsDir(t.root, projectId, "seeded_agent"), "penguin-sdk", "SKILL.md"),
      "utf8",
    );
    expect(onDisk).toBe(librarySkill("penguin-sdk")!.skill.content);
  });

  it("agent create with an unknown skill is 404 unknown_skill and creates no Agent", async () => {
    const res = await owner.post(`/api/projects/${projectId}/agents`, {
      agentId: "ghost_agent",
      plugins: ["penguin-sdk", "no-such-plugin"],
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unknown_plugin");
    // Nothing was created: the id is still free, and no directory was left behind.
    await expect(
      fs.stat(path.join(skillsDir(t.root, projectId, "ghost_agent"), "..")),
    ).rejects.toThrow();
    expect(
      (await owner.post(`/api/projects/${projectId}/agents`, { agentId: "ghost_agent" })).status,
    ).toBe(201);
  });

  it("agent create without skills stays a plain Agent; a non-array skills field is 400", async () => {
    await createPlainAgent("plain_seed");
    const plain = (await (await member.get(base("plain_seed"))).json()) as AgentSkillsResponse;
    expect(plain.skills).toEqual([]);
    const bad = await owner.post(`/api/projects/${projectId}/agents`, {
      agentId: "bad_seed",
      plugins: "penguin-sdk",
    });
    expect(bad.status).toBe(400);
  });

  // ---- POST .../skills/archive: install one skill from an uploaded zip ----

  const ZIP_SKILL_MD =
    "---\nname: zip-skill\ndescription: Zip demo skill\nshort_description: Zip demo\nversion: 2026-08-01.2\n---\n\n# Zip skill\nBody.\n";

  /** Builds an in-memory zip and returns it base64-encoded (the request wire format). */
  const zipB64 = (files: Record<string, Uint8Array>): string =>
    Buffer.from(zipSync(files)).toString("base64");

  it("archive: nested top-dir layout — all files written (subdirs preserved), directory name wins over frontmatter", async () => {
    await createPlainAgent("zip_agent");
    const url = `${base("zip_agent")}/archive`;
    // Frontmatter says zip-skill, but the top-level directory is dir-skill: the directory
    // name is the identity (same rule as listInstalledSkills). The explicit directory
    // entry ("dir-skill/") must be ignored, not treated as a file.
    const res = await member.post(url, {
      dataBase64: zipB64({
        "dir-skill/": new Uint8Array(0),
        "dir-skill/SKILL.md": strToU8(ZIP_SKILL_MD),
        "dir-skill/ref/notes.md": strToU8("notes\n"),
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AgentSkillsResponse;
    expect(body.skills.map((s) => s.name)).toEqual(["dir-skill"]);
    expect(body.skills[0]!.version).toBe("2026-08-01.2");
    expect(body.skills[0]!.shortDescription).toBe("Zip demo");
    const dir = path.join(skillsDir(t.root, projectId, "zip_agent"), "dir-skill");
    expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf8")).toBe(ZIP_SKILL_MD);
    expect(await fs.readFile(path.join(dir, "ref", "notes.md"), "utf8")).toBe("notes\n");
  });

  it("archive: root layout takes the name from frontmatter; uninstall works on the archive-installed skill", async () => {
    await createPlainAgent("zip_root_agent");
    const url = base("zip_root_agent");
    const res = await member.post(`${url}/archive`, {
      dataBase64: zipB64({ "SKILL.md": strToU8(ZIP_SKILL_MD) }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AgentSkillsResponse;
    expect(body.skills.map((s) => s.name)).toEqual(["zip-skill"]);
    // Uninstall goes through the same DELETE route as library skills: 204, directory gone.
    expect((await member.delete(`${url}/zip-skill`)).status).toBe(204);
    await expect(
      fs.access(path.join(skillsDir(t.root, projectId, "zip_root_agent"), "zip-skill")),
    ).rejects.toThrow();
    const after = (await (await member.get(url)).json()) as AgentSkillsResponse;
    expect(after.skills).toEqual([]);
  });

  it("archive: zip-slip and unsafe entry paths are rejected with 400, nothing written", async () => {
    await createPlainAgent("zip_slip_agent");
    const url = base("zip_slip_agent");
    const unsafe = ["../evil.md", "/abs.md", "C:/win.md", "a\\b.md"];
    for (const entry of unsafe) {
      const res = await owner.post(`${url}/archive`, {
        dataBase64: zipB64({
          "zip-skill/SKILL.md": strToU8(ZIP_SKILL_MD),
          [entry]: strToU8("x"),
        }),
      });
      expect(res.status, entry).toBe(400);
    }
    const list = (await (await owner.get(url)).json()) as AgentSkillsResponse;
    expect(list.skills).toEqual([]);
  });

  it("archive: invalid skill names are rejected (top-level dir and frontmatter name)", async () => {
    await createPlainAgent("zip_name_agent");
    const url = `${base("zip_name_agent")}/archive`;
    // Top-level directory name with a space fails SKILL_NAME_PATTERN.
    const badDir = await owner.post(url, {
      dataBase64: zipB64({ "bad name/SKILL.md": strToU8(ZIP_SKILL_MD) }),
    });
    expect(badDir.status).toBe(400);
    // Root layout: the frontmatter name is the skill name and must pass the same rule.
    const badMeta = await owner.post(url, {
      dataBase64: zipB64({
        "SKILL.md": strToU8("---\nname: bad/name\ndescription: d\n---\nbody\n"),
      }),
    });
    expect(badMeta.status).toBe(400);
  });

  it("archive: malformed bodies and layouts are rejected with 400", async () => {
    await createPlainAgent("zip_shape_agent");
    const url = `${base("zip_shape_agent")}/archive`;
    const cases: Array<[string, Record<string, unknown>]> = [
      ["dataBase64 missing", {}],
      ["not a zip", { dataBase64: Buffer.from("not a zip").toString("base64") }],
      [
        "two top-level directories",
        {
          dataBase64: zipB64({
            "one/SKILL.md": strToU8(ZIP_SKILL_MD),
            "two/readme.md": strToU8("x"),
          }),
        },
      ],
      ["no SKILL.md anywhere", { dataBase64: zipB64({ "sub/readme.md": strToU8("x") }) }],
      [
        "frontmatter without name",
        { dataBase64: zipB64({ "SKILL.md": strToU8("no frontmatter here\n") }) },
      ],
    ];
    for (const [label, body] of cases) {
      expect((await owner.post(url, body)).status, label).toBe(400);
    }
  });

  it("archive: uncompressed limits — file count, per-file size, total size", async () => {
    await createPlainAgent("zip_limit_agent");
    const url = `${base("zip_limit_agent")}/archive`;
    // > 200 files.
    const many: Record<string, Uint8Array> = { "zip-skill/SKILL.md": strToU8(ZIP_SKILL_MD) };
    for (let i = 0; i < 201; i++) many[`zip-skill/f${i}.txt`] = strToU8("x");
    expect((await owner.post(url, { dataBase64: zipB64(many) })).status).toBe(400);
    // Per-file > 5MB uncompressed (zeros compress tiny, so the wire stays small).
    const big: Record<string, Uint8Array> = {
      "zip-skill/SKILL.md": strToU8(ZIP_SKILL_MD),
      "zip-skill/big.bin": new Uint8Array(5 * 1024 * 1024 + 1),
    };
    expect((await owner.post(url, { dataBase64: zipB64(big) })).status).toBe(400);
    // Total > 20MB uncompressed across files that each stay under the per-file cap.
    const total: Record<string, Uint8Array> = { "zip-skill/SKILL.md": strToU8(ZIP_SKILL_MD) };
    for (let i = 0; i < 5; i++) {
      total[`zip-skill/part${i}.bin`] = new Uint8Array(4200 * 1024);
    }
    expect((await owner.post(url, { dataBase64: zipB64(total) })).status).toBe(400);
  });

  it("archive: already installed is 409 skill_exists; overwrite replaces the directory (stale files removed)", async () => {
    await createPlainAgent("zip_over_agent");
    const url = `${base("zip_over_agent")}/archive`;
    const first = await member.post(url, {
      dataBase64: zipB64({
        "zip-skill/SKILL.md": strToU8(ZIP_SKILL_MD),
        "zip-skill/old.txt": strToU8("old\n"),
      }),
    });
    expect(first.status).toBe(201);

    // Same name again without overwrite: 409 with the name in the message (the web tab
    // reads it from there for the overwrite confirmation copy).
    const again = await member.post(url, {
      dataBase64: zipB64({ "zip-skill/SKILL.md": strToU8(ZIP_SKILL_MD) }),
    });
    expect(again.status).toBe(409);
    const err = (await again.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("skill_exists");
    expect(err.error.message).toMatch(/: zip-skill$/);

    // overwrite: true replaces the whole directory: old.txt is gone, new.txt appears.
    const updatedMd = ZIP_SKILL_MD.replace("version: 2026-08-01.2", "version: 2026-08-01.3");
    const res = await member.post(url, {
      dataBase64: zipB64({
        "zip-skill/SKILL.md": strToU8(updatedMd),
        "zip-skill/new.txt": strToU8("new\n"),
      }),
      overwrite: true,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AgentSkillsResponse;
    expect(body.skills.find((s) => s.name === "zip-skill")!.version).toBe("2026-08-01.3");
    const dir = path.join(skillsDir(t.root, projectId, "zip_over_agent"), "zip-skill");
    expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf8")).toBe(updatedMd);
    expect(await fs.readFile(path.join(dir, "new.txt"), "utf8")).toBe("new\n");
    await expect(fs.access(path.join(dir, "old.txt"))).rejects.toThrow();
  });

  it("archive export: single-top-dir zip round-trips byte-identically; a non-installed name is 404", async () => {
    await createPlainAgent("zip_export_agent");
    const url = base("zip_export_agent");
    // Install a multi-file skill through the archive route (nested subdir + icon.svg).
    const files: Record<string, Uint8Array> = {
      "zip-skill/SKILL.md": strToU8(ZIP_SKILL_MD),
      "zip-skill/icon.svg": strToU8('<svg viewBox="0 0 24 24"><path d="M2 2h20"/></svg>\n'),
      "zip-skill/ref/notes.md": strToU8("notes\n"),
    };
    expect((await member.post(`${url}/archive`, { dataBase64: zipB64(files) })).status).toBe(201);

    // Export it: a direct binary attachment (application/zip), like the snapshot export.
    // The frontmatter declares a version explicitly, so the filename carries -v<version>.
    const res = await member.get(`${url}/zip-skill/archive`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''zip-skill-v2026-08-01.2.zip",
    );
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    // Single-top-dir layout with every installed file, byte-identical to the upload — the
    // export feeds back into the POST archive route unchanged.
    const fileNames = Object.keys(entries).filter((n) => !n.endsWith("/"));
    expect(fileNames.sort()).toEqual(Object.keys(files).sort());
    for (const [name, data] of Object.entries(files)) {
      expect(Buffer.from(entries[name]!)).toEqual(Buffer.from(data));
    }

    // Exporting a skill that isn't installed → 404 (same criterion as uninstall).
    expect((await member.get(`${url}/no-such-skill/archive`)).status).toBe(404);

    // Without an explicit frontmatter version: field the filename stays <name>.zip —
    // parseSkillFrontmatter's defaulted 1 must not be presented as a declared version.
    const noVersion = "---\nname: nover-skill\ndescription: No version field\n---\nbody\n";
    expect(
      (
        await member.post(`${url}/archive`, {
          dataBase64: zipB64({ "SKILL.md": strToU8(noVersion) }),
        })
      ).status,
    ).toBe(201);
    const plain = await member.get(`${url}/nover-skill/archive`);
    expect(plain.status).toBe(200);
    expect(plain.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''nover-skill.zip",
    );
  });

  /**
   * The Skill-library badge gate. It is computed from the files on disk against the bundled
   * library, so the cases that matter are the three ways a directory can fail to be an update:
   * already current, not in the library at all, and unreadable.
   */
  describe("pluginUpdates on the Agent list", () => {
    const listAgents = async (): Promise<AgentsResponse["agents"]> =>
      ((await (await owner.get(`/api/projects/${projectId}/agents`)).json()) as AgentsResponse)
        .agents;
    /** Rewrites an installed SKILL.md's frontmatter version, which is what "behind" means. */
    const setInstalledVersion = async (agentId: string, name: string, version: string) => {
      const file = path.join(skillsDir(t.root, projectId, agentId), name, "SKILL.md");
      const raw = await fs.readFile(file, "utf8");
      await fs.writeFile(file, raw.replace(/^version:.*$/m, `version: ${version}`), "utf8");
    };

    it("is empty for a freshly installed Skill, and names the library version once it falls behind", async () => {
      await createPlainAgent("bare_updates");
      expect(
        (await owner.post(plugins("bare_updates"), { names: ["agent-development"] })).status,
      ).toBe(201);

      const fresh = (await listAgents()).find((a) => a.agentId === "bare_updates")!;
      expect(fresh.skillCount).toBe(4);
      expect(fresh.pluginUpdates).toEqual([]);

      // Age one installed copy: the library now carries a higher version than the disk does.
      // The update is reported once, by PLUGIN, however many of its skills lag.
      await setInstalledVersion("bare_updates", "penguin-sdk", "2000-01-01.1");
      const behind = (await listAgents()).find((a) => a.agentId === "bare_updates")!;
      expect(behind.pluginUpdates).toEqual([
        { name: "agent-development", version: librarySkill("penguin-sdk")!.plugin.version },
      ]);
      // Reinstalling IS the update, so the badge clears with the same request the trail ends on.
      expect(
        (await owner.post(plugins("bare_updates"), { names: ["agent-development"] })).status,
      ).toBe(201);
      expect((await listAgents()).find((a) => a.agentId === "bare_updates")!.pluginUpdates).toEqual(
        [],
      );
    });

    it("never lists a Skill the library does not carry, however old it looks", async () => {
      await createPlainAgent("byo_updates");
      const zip = zipSync({
        "SKILL.md": strToU8(
          "---\nname: byo-skill\ndescription: hand written\nversion: 1\n---\nbody\n",
        ),
      });
      const res = await owner.post(`${base("byo_updates")}/archive`, {
        dataBase64: Buffer.from(zip).toString("base64"),
      });
      expect(res.status).toBe(201);
      const agent = (await listAgents()).find((a) => a.agentId === "byo_updates")!;
      expect(agent.skillCount).toBe(1);
      // Nothing to be behind: there is no library copy to reinstall over it.
      expect(agent.pluginUpdates).toEqual([]);
    });

    it("counts a directory with no readable SKILL.md as neither installed nor an update", async () => {
      await createPlainAgent("broken_updates");
      await fs.mkdir(path.join(skillsDir(t.root, projectId, "broken_updates"), "penguin-sdk"), {
        recursive: true,
      });
      const agent = (await listAgents()).find((a) => a.agentId === "broken_updates")!;
      expect(agent.skillCount).toBe(0);
      expect(agent.pluginUpdates).toEqual([]);
    });
  });
});
