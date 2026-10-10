/**
 * Contributed skills (plugin/skills.ts): a plugin that carries code DECLARES the skill
 * directories its package ships on `PluginSkillsProvider.skills` — manifest data, listed
 * and checked without running the package — and while the package is enabled (a Project's
 * `[plugins]` lists it), those skills install onto an Agent through the plugin install
 * route: the same route, the same `installSkill` writer, the same runtime invalidation.
 *
 * - The declaration is per entry and non-fatal: a path that escapes the package, a
 *   directory without a readable SKILL.md, a name the pattern refuses, a module with no
 *   package behind it — each is skipped with its reason and the rest stays installable.
 * - End to end, through the machinery a deployment really uses: a Project lists the
 *   package, the process loads it, the installed-plugins row offers its skills, the
 *   install writes them to the Agent's agent_state — and once no Project lists the
 *   package, the name answers nothing: the row is gone, the install is refused, and the
 *   copy already installed stays.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import { skillsDir } from "@prismshadow/penguin-core";
import type {
  AgentPluginsInstallResponse,
  InstalledPluginsResponse,
} from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import type { PluginSkills } from "../src/plugin/skills.js";
import { apiClient, createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { decorators, lower, writeShippedIndex } from "./plugin-fixtures.js";

/** A SKILL.md whose directory is its name, the library's rule. */
const GOOD = `---
name: good-skill
description: Makes a tune.
---

# Good skill
`;

/**
 * A plugin package on disk, its skill directories inside it: `skills` maps directory name →
 * SKILL.md. The entry file itself is never imported here — only walked up from, to the
 * package.json that names the package the declarations read from.
 */
async function packageOnDisk(skills: Record<string, string>): Promise<string> {
  const root = await makeTempRoot();
  const dir = path.join(root, "pkg");
  await fs.mkdir(path.join(dir, "dist"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "@acme/skills-pkg",
      version: "1.0.0",
      type: "module",
      main: "./dist/index.js",
    }),
  );
  for (const [name, content] of Object.entries(skills)) {
    await fs.mkdir(path.join(dir, "skills", name), { recursive: true });
    await fs.writeFile(path.join(dir, "skills", name, "SKILL.md"), content);
  }
  return path.join(dir, "dist", "index.js");
}

/**
 * The host of plugins that declare skills: each `{ file, entries }` is one plugin, `file`
 * the entry its package sits behind (null = nothing on disk behind the module).
 */
function declaring(
  plugins: ReadonlyArray<{
    file: string | null;
    entries: ReadonlyArray<{ id: string; path: string }>;
  }>,
): PluginHost {
  const host = new PluginHost();
  plugins.forEach((p, i) => {
    const def = {
      // A plugin module declaring its skills: pure data, the way ifaces.json carries it.
      manifest: parseManifest({
        name: `AcmeSkills${i === 0 ? "" : i}`,
        requires: {},
        provides: {},
        contributes: { "PluginSkillsProvider.skills": [...p.entries] },
        children: [],
      }),
      create: () => ({ api: {} }),
    };
    host.use({
      specifier: i === 0 ? "@acme/skills-pkg" : `@acme/unplaced-${i}`,
      modules: [def],
      replaces: [],
      ...(p.file !== null ? { file: p.file } : {}),
    });
  });
  return host;
}

describe("plugin skills (the contributes slot)", () => {
  let t: TestApp | undefined;
  const programEntry = process.argv[1];

  afterEach(async () => {
    if (programEntry !== undefined) process.argv[1] = programEntry;
    await t?.cleanup();
    t = undefined;
  });

  it("lists a loaded plugin's declared skills, and skips each malformed declaration with its reason", async () => {
    const file = await packageOnDisk({
      "good-skill": GOOD,
      shapeless: "no frontmatter here\n",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      t = await createTestApp({
        plugins: declaring([
          {
            file,
            entries: [
              { id: "acme.good", path: "skills/good-skill" },
              { id: "acme.escape", path: "../outside" },
              { id: "acme.spaced", path: "skills/not a name" },
              { id: "acme.missing", path: "skills/missing" },
              { id: "acme.shapeless", path: "skills/shapeless" },
            ],
          },
          // A module with no package behind it: its declaration is skipped, not the boot.
          { file: null, entries: [{ id: "acme.orphan", path: "skills/good-skill" }] },
        ]),
      });
      const skills = t.deps.tree.api<PluginSkills>("ApiModule", "PluginSkills");
      // Metadata only — no body, no auxiliary payload — and the good one alone is in it.
      expect(await skills.list()).toEqual([
        {
          specifier: "@acme/skills-pkg",
          skills: [{ name: "good-skill", description: "Makes a tune.", version: "" }],
        },
      ]);
      const logged = warn.mock.calls.flat().join("\n");
      // Dropped while the declarations were read, at the provider's setup:
      expect(logged).toMatch(
        /'AcmeSkills' contribution 'acme\.escape' skipped: '\.\.\/outside' does not stay inside the package/,
      );
      expect(logged).toMatch(
        /'AcmeSkills' contribution 'acme\.spaced' skipped: 'skills\/not a name' does not end in a skill name/,
      );
      expect(logged).toMatch(
        /'AcmeSkills1' contribution 'acme\.orphan' skipped: the current plugin generation does not hold '@acme\/unplaced-1'/,
      );
      // Dropped at read time, per skill:
      expect(logged).toMatch(
        /skill 'acme\.missing' \(skills\/missing\) skipped: no readable SKILL\.md at skills\/missing\/SKILL\.md/,
      );
      expect(logged).toMatch(
        /skill 'acme\.shapeless' \(skills\/shapeless\) skipped: skills\/shapeless\/SKILL\.md has no frontmatter with a name/,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("installs a declared skill onto an Agent through the plugin install route, verbatim", async () => {
    const file = await packageOnDisk({ "good-skill": GOOD });
    t = await createTestApp({
      plugins: declaring([
        { file, entries: [{ id: "acme.good", path: "skills/good-skill" }] },
      ]),
    });
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const res = await admin.post("/api/projects/default_project/agents/default_agent/plugins", {
      names: ["@acme/skills-pkg"],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AgentPluginsInstallResponse;
    expect(body.skills.find((s) => s.name === "good-skill")).toMatchObject({
      description: "Makes a tune.",
    });
    // The same writer the library's skills take: SKILL.md verbatim, under the skill's own name.
    expect(
      await fs.readFile(
        path.join(skillsDir(t.root, "default_project", "default_agent"), "good-skill", "SKILL.md"),
        "utf8",
      ),
    ).toBe(GOOD);
  });

  it("refuses a name no enabled code plugin answers to, and writes nothing", async () => {
    t = await createTestApp({ plugins: new PluginHost() });
    const skills = t.deps.tree.api<PluginSkills>("ApiModule", "PluginSkills");
    expect(await skills.list()).toEqual([]);
    await expect(skills.resolve(["@acme/skills-pkg"])).rejects.toThrow(
      /Plugin is not in the library and not an enabled code plugin: @acme\/skills-pkg/,
    );
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const res = await admin.post("/api/projects/default_project/agents/default_agent/plugins", {
      names: ["@acme/skills-pkg"],
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "unknown_plugin" } });
    // Nothing was written: every name is resolved before anything installs.
    expect(
      await fs.readdir(skillsDir(t.root, "default_project", "default_agent")),
    ).not.toContain("good-skill");
  });

  it("offers the skills on an enabled plugin's row, and stops offering once no Project lists it", async () => {
    t = await createTestApp();
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    // A plugin package the way the build ships one: a class paired with its generated
    // table, the table declaring the skill on the slot, the skill directory inside it.
    process.argv[1] = path.join(t.root, "install", "bin", "server.js");
    const prefix = path.join(t.root, "install", "plugins");
    const dir = path.join(prefix, "node_modules", "@acme", "skills-pkg");
    await fs.mkdir(path.join(dir, "skills", "good-skill"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "@acme/skills-pkg",
        version: "1.0.0",
        type: "module",
        main: "./index.js",
      }),
    );
    await fs.writeFile(
      path.join(dir, "ifaces.json"),
      JSON.stringify({
        ifaces: {},
        types: {},
        modules: {
          AcmeSkills: {
            name: "AcmeSkills",
            requires: {},
            provides: {},
            contributes: {
              "PluginSkillsProvider.skills": [{ id: "acme.good", path: "skills/good-skill" }],
            },
            children: [],
          },
        },
        plugin: { modules: ["AcmeSkills"], replaces: [] },
      }),
    );
    await fs.writeFile(
      path.join(dir, "index.js"),
      lower(`
        import { Component } from ${JSON.stringify(decorators)};
        @Component({
          contributes: {
            "PluginSkillsProvider.skills": [{ id: "acme.good", path: "skills/good-skill" }],
          },
        })
        export class AcmeSkills {}
        export default { modules: [AcmeSkills] };
      `),
    );
    await fs.writeFile(path.join(dir, "skills", "good-skill", "SKILL.md"), GOOD);
    await fs.writeFile(
      path.join(prefix, "package.json"),
      JSON.stringify({
        name: "prefix",
        private: true,
        dependencies: { "@acme/skills-pkg": "1.0.0" },
      }),
    );
    await writeShippedIndex(prefix);

    // The Project asks for it: the re-assembly loads the package, and the row turns active,
    // offering the skill as installable onto an Agent.
    const listed = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/skills-pkg"],
    });
    expect(listed.status).toBe(200);
    const on = (await (
      await admin.get("/api/projects/default_project/plugins/installed")
    ).json()) as InstalledPluginsResponse;
    expect(on.plugins.find((p) => p.specifier === "@acme/skills-pkg")).toMatchObject({
      active: true,
    });
    expect(
      (on.plugins.find((p) => p.specifier === "@acme/skills-pkg")?.skills ?? []),
    ).toEqual([{ name: "good-skill", description: "Makes a tune.", version: "" }]);

    // Installable through the plugin install route, by the package name, onto the Agent.
    const installed = await admin.post(
      "/api/projects/default_project/agents/default_agent/plugins",
      { names: ["@acme/skills-pkg"] },
    );
    expect(installed.status).toBe(201);
    expect(
      await fs.readFile(
        path.join(skillsDir(t.root, "default_project", "default_agent"), "good-skill", "SKILL.md"),
        "utf8",
      ),
    ).toBe(GOOD);

    // Unlisted: no Project asks for it, so the process stops running it — the row is gone,
    // the name answers no install, and what the Agent already had stays.
    const dropped = await admin.delete(
      "/api/projects/default_project/plugins/installed?specifier=@acme/skills-pkg",
    );
    expect(dropped.status).toBe(200);
    const off = (await (
      await admin.get("/api/projects/default_project/plugins/installed")
    ).json()) as InstalledPluginsResponse;
    expect(off.plugins.find((p) => p.specifier === "@acme/skills-pkg")).toBeUndefined();
    const refused = await admin.post("/api/projects/default_project/agents/default_agent/plugins", {
      names: ["@acme/skills-pkg"],
    });
    expect(refused.status).toBe(404);
    expect(await fs.readFile(
      path.join(skillsDir(t.root, "default_project", "default_agent"), "good-skill", "SKILL.md"),
      "utf8",
    )).toBe(GOOD);
  });
});
