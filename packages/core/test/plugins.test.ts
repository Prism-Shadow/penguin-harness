/**
 * Core's plugin library reader, on fixture libraries: a package's npm fields, the contributions its
 * generated table declares (ifaces.json), and the files they name. The shipped library itself is
 * the server's suite (its package is the library's host); see packages/server/test/plugin-library.test.ts.
 *
 * Shipped packages, on a fixture library a temp host package carries (usePushedPluginLibrary):
 * - A plugin's version is its npm version; each skill keeps its own dated version through the
 *   loader's stamp; the hook package's manifest carries the contribution's version and commands,
 *   the npm description and the card's Chinese one.
 * - Only what is declared is read: a skill directory nothing names, a `hooks/` without a hooks
 *   contribution, and the contributions of a module the default export does not list install
 *   nothing — and for a shipped package each is a fault.
 * - A shipped skill without a dated version, a shipped package that was never built (no
 *   ifaces.json), and any other warning-level fault (a card field of the wrong type, an MCP server
 *   the resolver refuses) fail the load naming the package, rather than a smaller library.
 *
 * What the operator installed on the server, on a fixture prefix (useInstalledPluginPrefix):
 * - A package of Skills the prefix depends on joins the library as installed, under its name
 *   without the scope, and is never preinstalled.
 * - A package of server modules alone (a card and a code entry), a name the build ships, a
 *   package whose table contributes nothing, and what npm installed beside the prefix's own
 *   packages stay out.
 * - A package still written with the retired `penguin` block, and no ifaces.json, stays out with
 *   one warning saying so; one whose table will not read stays out with a warning; neither stops
 *   the library from loading.
 * - Missing is missing: a package with only a name, a version and a skill lists it with no
 *   description, no category (Other), no icon and no quick start, and nothing is warned.
 * - What a shipped package fails on, an installed one lists through, with the field missing and
 *   one warning: a malformed card field, a quick start naming skills it does not ship, a hook
 *   package without a dated version (the skills still list), a skill without a version
 *   (unversioned, never flagged behind), an unsafe or oversized icon, a skill entry whose name is
 *   not a skill name or not its directory's, a binary file in a skill (left out; the text beside it
 *   installs byte for byte). A safe icon is kept from its `<svg>` root on.
 * - A package of MCP servers alone is a library plugin: it lists its servers, each with every
 *   vault key its config references — declared ones with their labels first — and whether it
 *   offers OAuth sign-in. A server the resolver refuses, a bad or repeated name and a setup key
 *   nothing references are dropped, one warning each.
 * - readLibraryPackage reads a local directory the way the library will, refusing one without a
 *   release version, or one never built.
 *
 * What kind a package is (libraryParts), by its table: a content package carries Skills, hooks,
 * MCP servers or workbenches and no server modules; a package whose table lists modules is a
 * server module only with a code entry; a card alone is neither; an unbuilt package is neither.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  comparePluginVersions,
  groupPlugins,
  isSafeIconSvg,
  libraryParts,
  libraryPlugin,
  libraryPluginPackage,
  loadLibraryPlugins,
  loadPluginGroups,
  loadPreinstalledPlugins,
  parseSkillFrontmatter,
  readLibraryPackage,
  useInstalledPluginPrefix,
  usePushedPluginLibrary,
  workspacePluginRoot,
  type LibraryPlugin,
} from "../src/index.js";
import { formatFrontmatter } from "@prismshadow/skills";
import {
  libraryHost,
  pluginPackage,
  pluginTable,
  skillFile,
  writeFiles,
  type PluginContent,
} from "./helpers/plugin-packages.js";

/** Minimal LibraryPlugin for groupPlugins unit tests. */
const fakePlugin = (name: string, category?: string): LibraryPlugin => ({
  name,
  packageName: `@penguinharness/${name}`,
  description: `Do ${name}.`,
  version: "0.2.13",
  preinstall: true,
  skills: [],
  mcpServers: [],
  ...(category !== undefined ? { category } : {}),
});

describe("comparePluginVersions", () => {
  it("orders by date, then by sequence number numerically; non-versions sort before every version", () => {
    expect(comparePluginVersions("2026.08.29.1", "2026.08.29.1")).toBe(0);
    expect(comparePluginVersions("2026.08.29.2", "2026.08.29.10")).toBeLessThan(0);
    expect(comparePluginVersions("2026.09.01.1", "2026.08.29.9")).toBeGreaterThan(0);
    expect(comparePluginVersions("", "2026.08.29.1")).toBeLessThan(0);
    expect(comparePluginVersions("7", "2026.08.29.1")).toBeLessThan(0);
    expect(comparePluginVersions("", "")).toBe(0);
  });

  it("reads the legacy spelling as the same version a copy installed earlier carries", () => {
    expect(comparePluginVersions("2026-08-29.1", "2026.08.29.1")).toBe(0);
    expect(comparePluginVersions("2026.09.10.2", "2026.09.10.1")).toBeGreaterThan(0);
    expect(comparePluginVersions("2026.09.10.1", "2026-09-09.9")).toBeGreaterThan(0);
    expect(comparePluginVersions("2026-09-09.9", "2026.09.09.10")).toBeLessThan(0);
  });
});

describe("groupPlugins", () => {
  it("groups by category in manifest order, members sorted, empty categories omitted, unknown ones in Other", () => {
    const groups = groupPlugins([
      fakePlugin("b", "ai-app-development"),
      fakePlugin("a", "ai-app-development"),
      fakePlugin("z"),
      fakePlugin("y", "made-up"),
      fakePlugin("h", "office-productivity"),
    ]);
    expect(groups.map((g) => [g.id, g.plugins.map((p) => p.name)])).toEqual([
      ["office-productivity", ["h"]],
      ["ai-app-development", ["a", "b"]],
      ["other", ["y", "z"]],
    ]);
    expect(groups[2]).toMatchObject({ title: "Other", titleZh: "其他" });
  });
});

describe("shipped packages, on a fixture library", () => {
  let root: string | null = null;

  afterEach(async () => {
    usePushedPluginLibrary(null);
    if (root !== null) await fs.rm(root, { recursive: true, force: true });
    root = null;
  });

  /** A host package holding one plugin, `@penguinharness/sample`, made of `files`; the library is pointed at it. */
  async function library(files: Record<string, string>): Promise<void> {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-plugin-versions-"));
    await libraryHost(root, { "@penguinharness/sample": files });
    usePushedPluginLibrary(root);
  }

  /** The sample package: its npm fields, a card with the short descriptions, and `content`. */
  const sample = (content: PluginContent = {}) =>
    pluginPackage(
      { name: "@penguinharness/sample", version: "3.1.4", description: "Sample." },
      {
        ...content,
        card: { shortDescription: "Short.", shortDescriptionZh: "短。", ...content.card },
      },
    );

  it("keeps each skill's own dated version through the stamp, gives the hook package its contribution's version and commands, and the plugin its npm version", async () => {
    await library({
      ...sample({
        card: { descriptionZh: "示例。" },
        skills: ["one", "two"],
        hooks: { version: "2026.09.02.3", stop: [{ command: "stop.mjs", timeout: 30 }] },
      }),
      "skills/one/SKILL.md": skillFile("one", "2026.09.01.2"),
      "skills/two/SKILL.md": skillFile("two", "2026.08.15.1"),
      "hooks/stop.mjs": "export {};\n",
    });
    const plugin = libraryPlugin("sample")!;
    expect(plugin.version).toBe("3.1.4");
    expect(plugin.skills.map((s) => [s.name, s.version])).toEqual([
      ["one", "2026.09.01.2"],
      ["two", "2026.08.15.1"],
    ]);
    // What an install writes carries the same version, beside the stamped short description.
    for (const skill of plugin.skills) {
      expect(parseSkillFrontmatter(skill.content)).toMatchObject({
        version: skill.version,
        shortDescription: "Short.",
      });
    }
    // The hooks.json an install writes, field for field.
    expect(plugin.hooks).toEqual({
      manifest: {
        name: "sample",
        description: "Sample.",
        description_zh: "示例。",
        version: "2026.09.02.3",
        stop: [{ command: "stop.mjs", timeout: 30 }],
        pre_tool_use: [],
        user_prompt: [],
      },
      files: { "stop.mjs": "export {};\n" },
    });
  });

  it("reads only what is declared: an undeclared skill, an undeclared hooks/ and an unlisted module's contributions fail a shipped package", async () => {
    await library({
      ...sample({ skills: ["one"] }),
      "skills/one/SKILL.md": skillFile("one", "2026.09.01.2"),
      "skills/stray/SKILL.md": skillFile("stray", "2026.09.01.2"),
    });
    expect(() => libraryPlugin("sample")).toThrow(
      /skills\/stray is not declared by a skills contribution/,
    );
    await fs.rm(root!, { recursive: true, force: true });

    await library({ ...sample({ skills: [] }), "hooks/stop.mjs": "export {};\n" });
    expect(() => libraryPlugin("sample")).toThrow(
      /hooks\/ is not declared by a hooks contribution/,
    );
    await fs.rm(root!, { recursive: true, force: true });

    // A module the default export does not list is not booted, so it is not the package's either.
    const table = pluginTable("@penguinharness/sample", { skills: ["one"] });
    (table.plugin as { modules: string[] }).modules = [];
    await library({
      ...sample(),
      "ifaces.json": JSON.stringify(table),
      "skills/one/SKILL.md": skillFile("one", "2026.09.01.2"),
    });
    expect(() => libraryPlugin("sample")).toThrow(/skills\/one is not declared/);
  });

  it("refuses a shipped skill without a dated version, and a shipped package that was never built, naming the file", async () => {
    await library({ ...sample({ skills: ["one"] }), "skills/one/SKILL.md": skillFile("one") });
    expect(() => libraryPlugin("sample")).toThrow(/skills[/\\]one[/\\]SKILL\.md: version/);
    await fs.rm(root!, { recursive: true, force: true });

    const { "ifaces.json": _table, ...unbuilt } = sample({ skills: ["one"] });
    await library({ ...unbuilt, "skills/one/SKILL.md": skillFile("one", "2026.09.01.2") });
    expect(() => loadLibraryPlugins()).toThrow(/has no ifaces\.json: build the package/);
  });

  it("fails the library for a shipped package with any warning-level fault, naming the entry", async () => {
    await library({
      ...sample({ card: { category: 7 }, skills: ["one"] }),
      "skills/one/SKILL.md": skillFile("one", "2026.09.01.2"),
    });
    expect(() => loadLibraryPlugins()).toThrow(
      /FixturePlugin\.contributes\["PluginLibraryModule\.cards"\]\[0\]\.category must be a string/,
    );
    await fs.rm(root!, { recursive: true, force: true });

    await library({
      ...sample({
        skills: ["one"],
        mcpServers: [{ name: "nowhere", config: { transport: "ws" } }],
      }),
      "skills/one/SKILL.md": skillFile("one", "2026.09.01.2"),
    });
    expect(() => loadLibraryPlugins()).toThrow(/the MCP server "nowhere"/);
  });
});

describe("packages the operator installed on the server", () => {
  let root: string | null = null;

  afterEach(async () => {
    usePushedPluginLibrary(null);
    useInstalledPluginPrefix(null);
    vi.restoreAllMocks();
    if (root !== null) await fs.rm(root, { recursive: true, force: true });
    root = null;
  });

  /**
   * A shipped library of one plugin (`@penguinharness/sample`) and a server prefix whose
   * package.json depends on `installed`; every package is written under node_modules.
   */
  async function setUp(
    installed: string[],
    packages: Record<string, Record<string, string | Uint8Array>>,
  ): Promise<void> {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-installed-plugins-"));
    const host = await libraryHost(path.join(root, "host"), {
      "@penguinharness/sample": {
        ...pluginPackage(
          { name: "@penguinharness/sample", description: "Sample." },
          { skills: ["sample"] },
        ),
        "skills/sample/SKILL.md": skillFile("sample", "2026.09.01.1", "Body.\n"),
      },
    });
    const prefix = path.join(root, "prefix");
    await writeFiles(prefix, {
      "package.json": JSON.stringify({
        name: "penguin-plugins",
        private: true,
        dependencies: Object.fromEntries(installed.map((name) => [name, "*"])),
      }),
    });
    for (const [name, files] of Object.entries(packages)) {
      await writeFiles(path.join(prefix, "node_modules", ...name.split("/")), files);
    }
    usePushedPluginLibrary(host);
    useInstalledPluginPrefix(prefix);
  }

  /** An operator's package of one skill, `notes`, with `content` declared beside it. */
  const notes = (name: string, content: PluginContent = {}): Record<string, string> => ({
    ...pluginPackage(
      { name, version: "2.0.0", description: "Notes." },
      { skills: ["notes"], ...content, card: { preinstall: true, ...content.card } },
    ),
    "skills/notes/SKILL.md": skillFile("notes", "2026.10.01.1", "Body.\n"),
  });

  /** The warnings the loader logged, as one string. */
  const logged = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls.map((call) => String(call[0])).join("\n");

  it("lists a package of Skills the operator installed, as installed and never preinstalled", async () => {
    await setUp(["@acme/notes"], { "@acme/notes": notes("@acme/notes") });
    expect(loadLibraryPlugins().map((p) => [p.name, p.packageName, p.source])).toEqual([
      ["notes", "@acme/notes", "installed"],
      ["sample", "@penguinharness/sample", undefined],
    ]);
    expect(libraryPlugin("notes")).toMatchObject({ version: "2.0.0", preinstall: false });
    expect(loadPreinstalledPlugins().map((p) => p.name)).toEqual(["sample"]);
    expect(libraryPluginPackage("notes")).toMatchObject({
      packageName: "@acme/notes",
      version: "2.0.0",
    });
  });

  it("leaves out a package of server modules alone, a name the build ships, a table that contributes nothing, and npm's own dependencies", async () => {
    await setUp(["@acme/sandbox-x", "@other/sample", "@acme/nothing"], {
      // A server module's card, beside its code: nothing to install into an Agent.
      "@acme/sandbox-x": {
        ...pluginPackage(
          { name: "@acme/sandbox-x", main: "./index.js" },
          { card: { category: "sandbox" } },
        ),
        "index.js": "export default {};\n",
      },
      "@other/sample": notes("@other/sample"),
      // An empty server list is no content.
      "@acme/nothing": pluginPackage({ name: "@acme/nothing" }, { mcpServers: [] }),
      // Installed by npm beside the packages the prefix asked for, not by the operator.
      "left-pad": notes("left-pad"),
    });
    expect(loadLibraryPlugins().map((p) => [p.name, p.packageName])).toEqual([
      ["sample", "@penguinharness/sample"],
    ]);
  });

  it("leaves out a package still written with the retired penguin block, and one whose table will not read, each with a warning, and still loads the library", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await setUp(["@ported/cloudflare", "@acme/garbled", "@acme/notes"], {
      // The shape every package had before its content became contributions: no ifaces.json.
      "@ported/cloudflare": {
        "package.json": JSON.stringify({
          name: "@ported/cloudflare",
          version: "0.1.2",
          penguin: { mcp_servers: [{ name: "cf", config: { url: "https://cf.example.com" } }] },
        }),
        "skills/cf/SKILL.md": skillFile("cf", "2026.10.01.1"),
      },
      "@acme/garbled": { ...notes("@acme/garbled"), "ifaces.json": "{ not json" },
      "@acme/notes": notes("@acme/notes"),
    });
    expect(loadLibraryPlugins().map((p) => p.name)).toEqual(["notes", "sample"]);
    expect(libraryPlugin("cloudflare")).toBeUndefined();
    const said = logged(warn);
    expect(said).toContain(
      "@ported/cloudflare uses the retired `penguin` manifest and is not listed: port it again with the plugin-porting Skill",
    );
    expect(said).toContain("@acme/garbled is installed but not listed");
  });

  it("leaves an installed package that will not read out, with a warning, and still loads the library", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await setUp(["@acme/broken", "@acme/notes"], {
      // No release version: nothing can say which version of it is installed.
      "@acme/broken": {
        ...notes("@acme/broken"),
        "package.json": JSON.stringify({ name: "@acme/broken", description: "Broken." }),
      },
      "@acme/notes": notes("@acme/notes"),
    });
    expect(loadLibraryPlugins().map((p) => p.name)).toEqual(["notes", "sample"]);
    expect(libraryPlugin("broken")).toBeUndefined();
    expect(logged(warn)).toContain("@acme/broken is installed but not listed");
  });

  it("reads a package that carries only a name, a version and a skill: its skill, and nothing invented", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await setUp(["bare"], {
      bare: {
        ...pluginPackage({ name: "bare", version: "0.1.0" }, { skills: ["bare"] }),
        "skills/bare/SKILL.md": skillFile("bare", "2026.10.01.1"),
      },
    });
    const bare = libraryPlugin("bare")!;
    expect(bare).toMatchObject({ name: "bare", version: "0.1.0", description: "" });
    for (const key of ["title", "shortDescription", "category", "icon", "quickStart", "hooks"]) {
      expect(bare, key).not.toHaveProperty(key);
    }
    expect(bare.skills.map((s) => s.name)).toEqual(["bare"]);
    expect(
      loadPluginGroups()
        .find((g) => g.id === "other")
        ?.plugins.map((p) => p.name),
    ).toContain("bare");
    // Absent is not a fault: nothing to warn about.
    expect(warn).not.toHaveBeenCalled();
  });

  it("lists through what a shipped package fails on, with the field missing and a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await setUp(["@acme/notes"], {
      "@acme/notes": notes("@acme/notes", {
        card: {
          category: ["office-productivity"],
          title: "Notes",
          quickStart: { prompt: "Take a note.", skills: ["notes", "elsewhere"] },
        },
      }),
    });
    const plugin = libraryPlugin("notes")!;
    expect(plugin.title).toBe("Notes");
    expect(plugin).not.toHaveProperty("category");
    expect(plugin.quickStart).toEqual({ prompt: "Take a note.", skills: ["notes"] });
    expect(logged(warn)).toContain(".category must be a string; ignored");
    expect(logged(warn)).toContain("names skills the package does not ship (elsewhere)");
  });

  it("lists the skills of a package whose hook package has no dated version, and no hook package", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await setUp(["@acme/notes"], {
      "@acme/notes": {
        ...notes("@acme/notes", { hooks: { version: "soon", stop: [{ command: "stop.mjs" }] } }),
        "hooks/stop.mjs": "export {};\n",
      },
    });
    const plugin = libraryPlugin("notes")!;
    expect(plugin.skills.map((s) => s.name)).toEqual(["notes"]);
    expect(plugin.hooks).toBeUndefined();
    expect(logged(warn)).toContain('.version must be YYYY.MM.DD.N, got "soon"');
  });

  it("reads a skill without a version as unversioned, which its installed copy is never behind", async () => {
    await setUp(["@acme/notes"], {
      "@acme/notes": { ...notes("@acme/notes"), "skills/notes/SKILL.md": skillFile("notes") },
    });
    const [skill] = libraryPlugin("notes")!.skills;
    expect(skill!.version).toBe("");
    // What an install writes carries no version either, and compares equal to the library's.
    const installed = parseSkillFrontmatter(skill!.content)!;
    expect(skill!.content).not.toMatch(/^version:/m);
    expect(comparePluginVersions(installed.version, skill!.version)).toBe(0);
  });

  it("drops an icon with a script, an event handler or over 64 KiB, and keeps a plain one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plain = `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>\n`;
    const unsafe = {
      script: `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
      handler: `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0"/></svg>`,
      large: `<svg xmlns="http://www.w3.org/2000/svg"><path d="${"M0 0 ".repeat(14_000)}"/></svg>`,
      link: `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/t.png"/></svg>`,
    };
    await setUp(
      ["@acme/plain", ...Object.keys(unsafe).map((k) => `@acme/${k}`)],
      Object.fromEntries([
        ["@acme/plain", { ...notes("@acme/plain"), "icon.svg": plain }],
        ...Object.entries(unsafe).map(([k, svg]) => [
          `@acme/${k}`,
          { ...notes(`@acme/${k}`, { card: { icon: "art/logo.svg" } }), "art/logo.svg": svg },
        ]),
      ]),
    );
    const icons = Object.fromEntries(loadLibraryPlugins().map((p) => [p.name, p.icon]));
    // Kept from its <svg> root on: the Web App inlines only markup that begins there.
    expect(icons.plain).toBe(plain.slice(plain.indexOf("<svg")));
    for (const name of Object.keys(unsafe)) expect(icons[name], name).toBeUndefined();
    // A skill of a package without an icon installs without one (the book glyph).
    expect(libraryPlugin("script")!.skills[0]).not.toHaveProperty("icon");
    expect(logged(warn)).toContain("is larger than 64 KiB");
    expect(isSafeIconSvg(unsafe.script)).toBe(false);
  });

  it("leaves a binary file out of a skill, and installs the text files beside it as they are, a byte-order mark included", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);
    await setUp(["@acme/notes"], {
      "@acme/notes": {
        ...notes("@acme/notes"),
        "skills/notes/assets/logo.png": png,
        "skills/notes/references/api.md": "# API\n",
        "skills/notes/scripts/setup.ps1": "﻿Write-Output 'ready'\n",
      },
    });
    const [skill] = libraryPlugin("notes")!.skills;
    expect(Object.keys(skill!.files ?? {}).sort()).toEqual([
      "references/api.md",
      "scripts/setup.ps1",
    ]);
    expect(skill!.files?.["scripts/setup.ps1"]).toBe("﻿Write-Output 'ready'\n");
    expect(logged(warn)).toContain("skills/notes/assets/logo.png is not a text file");
  });

  it("leaves out a skill entry whose name is not a skill name, or not its directory's, with a warning, and lists the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await setUp(["@acme/notes"], {
      "@acme/notes": {
        ...notes("@acme/notes", {
          skills: ["notes", "pdf.tools", { name: "elsewhere", path: "skills/other" }],
        }),
        "skills/pdf.tools/SKILL.md": skillFile("pdf.tools", "2026.10.01.1"),
        "skills/other/SKILL.md": skillFile("other", "2026.10.01.1"),
      },
    });
    // What the library lists is what an install writes: nothing an Agent's skills folder refuses.
    expect(libraryPlugin("notes")!.skills.map((s) => s.name)).toEqual(["notes"]);
    const said = logged(warn);
    expect(said).toContain('[1].name is not a skill name (letters, digits, "_" and "-")');
    expect(said).toContain(
      'the skill name "elsewhere" is not the name of its directory skills/other',
    );
  });

  it("lists a package of MCP servers alone, each server with every vault key it references", async () => {
    const config = {
      transport: "http",
      url: "https://mail.example.com/mcp",
      headers: { "X-Team": "${MAIL_TEAM}" },
      oauth: {
        scopes: ["mail.read"],
        client_id: "${MAIL_CLIENT_ID}",
        client_secret: "${MAIL_CLIENT_SECRET}",
      },
    };
    const setup = [
      {
        key: "MAIL_CLIENT_ID",
        label: "OAuth client ID",
        labelZh: "OAuth 客户端 ID",
        help: "https://console.example.com/credentials",
      },
    ];
    await setUp(["@acme/mail"], {
      "@acme/mail": pluginPackage(
        { name: "@acme/mail", version: "0.1.9", description: "Mail." },
        { mcpServers: [{ name: "mail", config, setup }] },
      ),
    });
    const mail = libraryPlugin("mail")!;
    expect(mail).toMatchObject({ source: "installed", version: "0.1.9", skills: [] });
    expect(mail.hooks).toBeUndefined();
    expect(mail.mcpServers).toEqual([
      {
        name: "mail",
        config,
        oauth: true,
        setup: [...setup, { key: "MAIL_TEAM" }, { key: "MAIL_CLIENT_SECRET" }],
      },
    ]);
  });

  it("drops a server entry the resolver refuses, a bad or repeated server name and an unreferenced setup key, one warning each", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await setUp(["@acme/tools"], {
      "@acme/tools": pluginPackage(
        { name: "@acme/tools" },
        {
          mcpServers: [
            { name: "local", config: { command: "node", args: ["${PLUGIN_ROOT}/server.mjs"] } },
            { name: "nowhere", config: { transport: "ws", url: "wss://tools.example.com" } },
            { name: "moving", config: { url: "https://${TOOLS_HOST}/mcp" } },
            { name: "bad name", config: { command: "x" } },
            { name: "local", config: { command: "again" } },
            { name: "extra", config: { command: "x" }, setup: [{ key: "UNUSED" }] },
          ],
        },
      ),
    });
    expect(libraryPlugin("tools")!.mcpServers.map((s) => [s.name, s.setup])).toEqual([
      ["local", []],
      ["extra", []],
    ]);
    const said = logged(warn);
    expect(said).toContain('the MCP server "nowhere": unknown transport');
    expect(said).toContain('the MCP server "moving"');
    expect(said).toContain('["PluginLibraryModule.mcpServers"][3].name must be a server name');
    expect(said).toContain('the server name "local" is used twice');
    expect(said).toContain("setup key UNUSED, which its config never references");
  });

  it("reads a local package directory the way the library will (readLibraryPackage), refusing one without a release version or never built", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-library-package-"));
    await writeFiles(path.join(root, "ok"), notes("@acme/notes"));
    const { "ifaces.json": _table, ...unbuilt } = notes("@acme/unbuilt");
    await writeFiles(path.join(root, "unbuilt"), unbuilt);
    await writeFiles(path.join(root, "bad"), {
      ...notes("@acme/bad"),
      "package.json": JSON.stringify({ name: "@acme/bad", version: "next" }),
    });
    expect(readLibraryPackage(path.join(root, "ok"))).toMatchObject({
      name: "notes",
      packageName: "@acme/notes",
      source: "installed",
    });
    expect(() => readLibraryPackage(path.join(root!, "bad"))).toThrow(
      /package\.json: the package carries no release version/,
    );
    expect(() => readLibraryPackage(path.join(root!, "unbuilt"))).toThrow(/has no ifaces\.json/);
  });
});

describe("libraryParts: what kind a package is, by its table", () => {
  let root: string | null = null;
  afterEach(async () => {
    if (root !== null) await fs.rm(root, { recursive: true, force: true });
    root = null;
  });

  async function parts(files: Record<string, string>) {
    root ??= await fs.mkdtemp(path.join(os.tmpdir(), "penguin-library-parts-"));
    const dir = await fs.mkdtemp(path.join(root, "pkg-"));
    await writeFiles(dir, files);
    return libraryParts(dir);
  }

  it("reads a content package's parts, and no server modules without a code entry", async () => {
    expect(
      await parts(
        pluginPackage(
          { name: "@acme/notes" },
          {
            skills: ["notes"],
            hooks: { version: "2026.10.01.1" },
            mcpServers: [{ name: "m", config: { command: "x" } }],
          },
        ),
      ),
    ).toEqual({ skills: true, hooks: true, mcp: true, workbenches: false, modules: false });
  });

  it("reads server modules from a table that lists them beside a code entry, and a card alone as nothing an Agent installs", async () => {
    expect(
      await parts({
        ...pluginPackage(
          { name: "@acme/box", main: "./dist/index.js" },
          { card: { title: "Box" } },
        ),
        "dist/index.js": "export default {};\n",
      }),
    ).toEqual({ skills: false, hooks: false, mcp: false, workbenches: false, modules: true });
    expect(
      await parts(pluginPackage({ name: "@acme/box", main: "./dist/index.js" }, { card: {} })),
    ).toEqual({ skills: false, hooks: false, mcp: false, workbenches: false, modules: false });
  });

  it("reads an unbuilt package, or one whose table will not read, as carrying nothing", async () => {
    const none = { skills: false, hooks: false, mcp: false, workbenches: false, modules: false };
    expect(
      await parts({ "package.json": JSON.stringify({ name: "x", version: "1.0.0" }) }),
    ).toEqual(none);
    expect(
      await parts({
        "package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
        "ifaces.json": "[]",
      }),
    ).toEqual(none);
  });
});

describe("parseSkillFrontmatter", () => {
  it("parses name/description/version and the optional short descriptions; values may contain colons", () => {
    const meta = parseSkillFrontmatter(
      "---\nname: x\ndescription: a: b\nshort_description: s\nshort_description_zh: 中\nversion: 2026.08.29.3\n---\nbody",
    );
    expect(meta).toEqual({
      name: "x",
      description: "a: b",
      shortDescription: "s",
      shortDescriptionZh: "中",
      version: "2026.08.29.3",
    });
  });

  it("keeps the legacy version spelling an installed copy from before the rename carries", () => {
    expect(parseSkillFrontmatter("---\nname: x\nversion: 2026-08-29.3\n---\nbody")).toEqual({
      name: "x",
      description: "",
      version: "2026-08-29.3",
    });
  });

  it("tolerates a BOM and CRLF, drops a malformed version to the empty string, and needs a name", () => {
    expect(parseSkillFrontmatter("﻿---\r\nname: x\r\nversion: 9\r\n---\r\nbody")).toEqual({
      name: "x",
      description: "",
      version: "",
    });
    expect(parseSkillFrontmatter("no frontmatter")).toBeNull();
    expect(parseSkillFrontmatter("---\ndescription: d\n---\n")).toBeNull();
  });

  it("reads frontmatter as YAML: a quoted value is read without its quotes", () => {
    expect(
      parseSkillFrontmatter(
        "---\nname: x\ndescription: \"Use it when: the user asks\"\nshort_description: 's: t'\nversion: 2026.08.29.3\n---\nbody",
      ),
    ).toEqual({
      name: "x",
      description: "Use it when: the user asks",
      shortDescription: "s: t",
      version: "2026.08.29.3",
    });
    // A multi-line YAML value is read whole, not cut at its first line.
    expect(
      parseSkillFrontmatter(
        "---\nname: x\ndescription: >-\n  first line\n  second line\nshort_description: |-\n  a\n  b\n---\nbody",
      ),
    ).toEqual({
      name: "x",
      description: "first line second line",
      shortDescription: "a\nb",
      version: "",
    });
    // A block that is not a mapping is no frontmatter.
    expect(parseSkillFrontmatter("---\n- name\n---\nbody")).toBeNull();
  });

  it("still reads an older installed copy whose unquoted value is not valid YAML", () => {
    // Written by the line-based stamper before frontmatter was YAML: the unquoted ": " is a
    // YAML error, so the block is read line by line as before.
    const old =
      "---\nname: penguin-sdk\ndescription: Build agents: the SDK, its hooks: and more\nshort_description: SDK\nversion: 2026.09.20.2\n---\n\n# Body\n";
    expect(() => parseYaml(/^---\n([\s\S]*?)\n---/.exec(old)![1]!)).toThrow();
    expect(parseSkillFrontmatter(old)).toEqual({
      name: "penguin-sdk",
      description: "Build agents: the SDK, its hooks: and more",
      shortDescription: "SDK",
      version: "2026.09.20.2",
    });
  });

  it("stamps the installed copy's frontmatter as YAML that reads back to the same metadata", () => {
    const fields = {
      name: "x",
      description: `Use it when: the user says "go" and 'stop' — ${"a long description ".repeat(12)}`,
      short_description: "- starts with a dash",
      short_description_zh: "中文：说明 #1",
      version: "2026.08.29.3",
    };
    const front = formatFrontmatter(fields);
    expect(front.startsWith("---\n")).toBe(true);
    expect(front.endsWith("\n---")).toBe(true);
    // One line per field, in order: a long description is not folded.
    expect(front.split("\n").map((line) => line.split(":")[0])).toEqual([
      "---",
      "name",
      "description",
      "short_description",
      "short_description_zh",
      "version",
      "---",
    ]);
    expect(parseYaml(front.slice(4, -3))).toEqual(fields);
    expect(parseSkillFrontmatter(`${front}\n\n# Body\n`)).toEqual({
      name: "x",
      description: fields.description,
      shortDescription: fields.short_description,
      shortDescriptionZh: fields.short_description_zh,
      version: "2026.08.29.3",
    });
    // An absent optional field is left out.
    expect(formatFrontmatter({ name: "x", description: "d", short_description: undefined })).toBe(
      "---\nname: x\ndescription: d\n---",
    );
  });
});

describe("workspacePluginRoot (a checkout reads plugins from the repo's plugins/ directory)", () => {
  /** A workspace checkout as pnpm lays it out: the repo root, its plugins/, and an injected copy of a plugin under .pnpm. */
  async function checkout(opts: { workspaceFile: boolean; packageName: string }) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-plugin-root-"));
    if (opts.workspaceFile)
      await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n");
    const source = path.join(root, "plugins", "sample");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(
      path.join(source, "package.json"),
      JSON.stringify({ name: opts.packageName }),
    );
    const injected = path.join(
      root,
      "node_modules/.pnpm/@penguinharness+sample@file+plugins+sample/node_modules/@penguinharness/sample",
    );
    await fs.mkdir(injected, { recursive: true });
    // Where the host package sits in that checkout.
    const host = path.join(root, "packages", "server");
    await fs.mkdir(host, { recursive: true });
    return { root, source, injected, host };
  }

  it("prefers the repo's plugins/<name>/ over pnpm's injected copy inside a workspace checkout", async () => {
    const c = await checkout({ workspaceFile: true, packageName: "@penguinharness/sample" });
    try {
      expect(workspacePluginRoot("sample", c.injected, c.host)).toBe(c.source);
    } finally {
      await fs.rm(c.root, { recursive: true, force: true });
    }
  });

  it("keeps the resolved copy outside a workspace: an npm install and the packed app have no workspace file", async () => {
    const c = await checkout({ workspaceFile: false, packageName: "@penguinharness/sample" });
    try {
      expect(workspacePluginRoot("sample", c.injected, c.host)).toBe(c.injected);
    } finally {
      await fs.rm(c.root, { recursive: true, force: true });
    }
  });

  it("keeps the resolved copy when the workspace directory is not that package", async () => {
    const c = await checkout({ workspaceFile: true, packageName: "@penguinharness/other" });
    try {
      expect(workspacePluginRoot("sample", c.injected, c.host)).toBe(c.injected);
    } finally {
      await fs.rm(c.root, { recursive: true, force: true });
    }
  });
});
