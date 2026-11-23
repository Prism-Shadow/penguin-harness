/**
 * The scripts the `plugin-porting` skill runs on a plugin it ports
 * (plugins/skill-porting/skills/plugin-porting/scripts/), run as the Agent runs them: Node on a
 * directory.
 *
 * normalize-skills.mjs, on the package being built:
 * - A ported skill's frontmatter becomes exactly `name`, a one-line `description` and a
 *   `version`: a block scalar is flattened, `when_to_use` is merged in, and every other key —
 *   lists included — is dropped and named; the body is kept as it was.
 * - A dated version the skill already carries is kept; otherwise the given one is stamped.
 * - Another tool's display metadata and every file that is not text leave the skill; the text
 *   files beside SKILL.md stay.
 * - A folder without a SKILL.md is removed; a folder whose name is not a skill name is renamed —
 *   by its frontmatter name when nothing of the folder name is left, else `skill`, and never onto
 *   a name another skill has.
 *
 * port-mcp.mjs, on the upstream plugin:
 * - A Codex `.mcp.json`'s servers become `mcpServers` contribution entries, each with the id
 *   `<plugin>.mcp.<name>`: an angle-bracket placeholder and each `env_vars` name become a `${KEY}`
 *   reference listed in the server's setup, a literal OAuth client secret is not carried (a
 *   reference and a note instead), a literal client id is kept, another client's callback
 *   settings are left behind, and the upstream note is passed on.
 * - A Claude Code `mcpServers` map, with or without its wrapper: `${CLAUDE_PLUGIN_ROOT}` becomes
 *   `${PLUGIN_ROOT}`, a `${VAR}` stays a reference, a literal token in a header is not carried.
 * - A stdio server's relative command, `./` arguments and `cwd` are rooted in the package, each
 *   file named to be carried; a command or an argument leaving the plugin — however its path
 *   spells the way out — an address that is not http(s) and a server whose transport cannot be
 *   told are not carried, and a `cwd` leaving the plugin is dropped. A server map the manifest
 *   names outside the plugin is not read.
 * - `--oauth` and `--bearer` mark what only the upstream prose says: the server signs in with
 *   OAuth, and a token is the alternative.
 *
 * The chain, as the skill runs it on a Codex plugin — normalize-skills.mjs, port-mcp.mjs,
 * write-module.mjs, then the package's build (the real generator, penguin-gen-ifaces):
 * - The package it leaves is read by the plugin library with no warning: its Skills as
 *   normalized, its MCP servers as port-mcp.mjs printed them, its card as written; its
 *   package.json builds with the generator of the PenguinHarness version it was ported for.
 * - write-module.mjs drops a key that is no card field, naming it; without the PenguinHarness
 *   version, or with nothing to declare, it writes nothing.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LibraryPlugin } from "../src/index.js";
import { parseSkillFrontmatter, readLibraryPackage } from "../src/index.js";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../../plugins/skill-porting/skills/plugin-porting/scripts/normalize-skills.mjs",
);

let pkg: string | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  if (pkg !== null) await fs.rm(pkg, { recursive: true, force: true });
  pkg = null;
});

/** A package directory being built: a package.json and `files` (paths relative to it). */
async function building(files: Record<string, string | Uint8Array>): Promise<string> {
  pkg = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-porting-"));
  await fs.writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "@ported/demo", version: "0.1.2", description: "Demo." }),
  );
  for (const [rel, data] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(pkg, rel)), { recursive: true });
    await fs.writeFile(path.join(pkg, rel), data);
  }
  return pkg;
}

const normalize = (dir: string) => {
  const run = spawnSync(process.execPath, [SCRIPT, dir, "--version", "2026.10.10.1"], {
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
};

const read = (rel: string) => fs.readFile(path.join(pkg!, rel), "utf8");

const PORT_MCP = path.resolve(
  import.meta.dirname,
  "../../../plugins/skill-porting/skills/plugin-porting/scripts/port-mcp.mjs",
);

/** An upstream plugin folder made of `files`; the scripts read it, nothing writes it. */
async function upstream(files: Record<string, string>): Promise<string> {
  pkg = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-port-mcp-"));
  for (const [rel, data] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(pkg, rel)), { recursive: true });
    await fs.writeFile(path.join(pkg, rel), data);
  }
  return pkg;
}

interface PortedServers {
  mcpServers: Array<{
    id: string;
    name: string;
    config: Record<string, unknown>;
    setup?: Array<{ key: string; label?: string }>;
  }>;
  notes: string[];
}

const portMcp = (dir: string, ...flags: string[]): PortedServers => {
  const run = spawnSync(process.execPath, [PORT_MCP, dir, ...flags], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as PortedServers;
};

describe("normalize-skills.mjs", () => {
  it("rewrites the frontmatter to name, a one-line description and a version, naming what it drops", async () => {
    const dir = await building({
      "skills/agents/SKILL.md": [
        "---",
        "name: agents",
        "description: |",
        "  Builds agents on the platform.",
        "",
        '  Use when: the user wants "an agent".',
        "when_to_use: The user asks for a stateful agent.",
        "references:",
        "  - workers",
        "  - d1",
        "allowed-tools: [Read, Bash]",
        "---",
        "",
        "# Agents",
        "",
        "Body: kept as it was.",
        "",
      ].join("\n"),
    });
    const out = normalize(dir);
    const text = await read("skills/agents/SKILL.md");
    expect(text.split("\n").slice(0, 5)).toEqual([
      "---",
      "name: agents",
      'description: Builds agents on the platform. Use when: the user wants "an agent". Use when: The user asks for a stateful agent.',
      "version: 2026.10.10.1",
      "---",
    ]);
    expect(text.endsWith("\n# Agents\n\nBody: kept as it was.\n")).toBe(true);
    expect(out).toContain("dropped frontmatter keys: references, allowed-tools");
  });

  it("keeps a dated version the skill already carries", async () => {
    const dir = await building({
      "skills/kept/SKILL.md":
        "---\nname: kept\ndescription: Kept.\nversion: 2026.09.01.3\n---\n\nBody.\n",
    });
    normalize(dir);
    expect(parseSkillFrontmatter(await read("skills/kept/SKILL.md"))?.version).toBe("2026.09.01.3");
  });

  it("removes another tool's display metadata and every file that is not text, and keeps the text beside SKILL.md", async () => {
    const dir = await building({
      "skills/web/SKILL.md": "---\nname: web\ndescription: Web.\n---\n\nBody.\n",
      "skills/web/agents/openai.yaml": "interface:\n  display_name: Web\n",
      "skills/web/assets/logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00]),
      "skills/web/assets/logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>\n",
      "skills/web/references/api.md": "# API\n",
      "skills/web/LICENSE.txt": "MIT\n",
    });
    const out = normalize(dir);
    expect(existsSync(path.join(dir, "skills/web/agents"))).toBe(false);
    expect(existsSync(path.join(dir, "skills/web/assets/logo.png"))).toBe(false);
    for (const kept of ["assets/logo.svg", "references/api.md", "LICENSE.txt"]) {
      expect(existsSync(path.join(dir, "skills/web", kept)), kept).toBe(true);
    }
    expect(out).toContain("removed: agents/openai.yaml, assets/logo.png");
  });

  it("removes a folder without a SKILL.md and renames one whose name is not a skill name", async () => {
    const dir = await building({
      "skills/notes only/README.md": "Nothing to install.\n",
      "skills/my.skill/SKILL.md": "---\nname: my.skill\ndescription: Mine.\n---\n\nBody.\n",
    });
    normalize(dir);
    expect((await fs.readdir(path.join(dir, "skills"))).sort()).toEqual(["my-skill"]);
    expect(parseSkillFrontmatter(await read("skills/my-skill/SKILL.md"))?.name).toBe("my-skill");
  });

  it("renames a folder that keeps no letter or digit by its frontmatter name, else skill, and never onto another skill's name", async () => {
    const dir = await building({
      "skills/writing/SKILL.md": "---\nname: writing\ndescription: Already here.\n---\n\nBody.\n",
      // Chinese folder names leave nothing under the name rule.
      "skills/写作/SKILL.md": "---\nname: writing\ndescription: Write.\n---\n\nBody.\n",
      "skills/翻译/SKILL.md": "---\nname: 翻译\ndescription: Translate.\n---\n\nBody.\n",
      "skills/校对/SKILL.md": "---\nname: 校对\ndescription: Proofread.\n---\n\nBody.\n",
    });
    normalize(dir);
    const folders = (await fs.readdir(path.join(dir, "skills"))).sort();
    const described: Record<string, string | undefined> = {};
    for (const folder of folders) {
      const meta = parseSkillFrontmatter(await read(`skills/${folder}/SKILL.md`));
      expect(meta?.name).toBe(folder);
      described[folder] = meta?.description;
    }
    expect(folders).toEqual(["skill", "skill-2", "writing", "writing-2"]);
    expect(described.writing).toBe("Already here.");
    expect(described["writing-2"]).toBe("Write.");
    expect([described.skill, described["skill-2"]].sort()).toEqual(["Proofread.", "Translate."]);
  });
});

describe("port-mcp.mjs", () => {
  it("turns a Codex .mcp.json into mcpServers entries: placeholders and env_vars become references, a literal client secret is not carried", async () => {
    const dir = await upstream({
      ".codex-plugin/plugin.json": JSON.stringify({ name: "mail", mcpServers: "./.mcp.json" }),
      ".mcp.json": JSON.stringify({
        mcpServers: {
          gmail: {
            type: "http",
            url: "https://gmailmcp.googleapis.com/mcp/v1",
            scopes: ["https://mail.google.com/"],
            oauth: {
              callback_port: 12798,
              client_id: "<GMAIL_PUBLIC_CLIENT_ID>",
              client_secret: "<GMAIL_CLIENT_SECRET>",
            },
          },
          github: {
            type: "http",
            url: "https://api.githubcopilot.com/mcp/",
            oauth: {
              client_id: "Iv23liPublicId",
              client_secret: "literal-secret-from-upstream",
              callback_url: "http://127.0.0.1:12799/callback/x",
            },
            note: "Signs in with GitHub.",
          },
          security: {
            command: "python3",
            args: ["--stdio"],
            env_vars: ["OPENAI_API_KEY", "bad-name"],
          },
        },
      }),
    });
    const { mcpServers: servers, notes } = portMcp(dir);
    expect(servers).toEqual([
      {
        id: "mail.mcp.gmail",
        name: "gmail",
        config: {
          transport: "http",
          url: "https://gmailmcp.googleapis.com/mcp/v1",
          oauth: {
            scopes: ["https://mail.google.com/"],
            client_id: "${GMAIL_PUBLIC_CLIENT_ID}",
            client_secret: "${GMAIL_CLIENT_SECRET}",
          },
        },
        setup: [
          { key: "GMAIL_PUBLIC_CLIENT_ID", label: "Gmail public client ID" },
          { key: "GMAIL_CLIENT_SECRET", label: "Gmail client secret" },
        ],
      },
      {
        id: "mail.mcp.github",
        name: "github",
        config: {
          transport: "http",
          url: "https://api.githubcopilot.com/mcp/",
          oauth: { client_id: "Iv23liPublicId", client_secret: "${GITHUB_CLIENT_SECRET}" },
        },
        setup: [{ key: "GITHUB_CLIENT_SECRET", label: "Github OAuth client secret" }],
      },
      {
        id: "mail.mcp.security",
        name: "security",
        config: {
          transport: "stdio",
          command: "python3",
          args: ["--stdio"],
          env: { OPENAI_API_KEY: "${OPENAI_API_KEY}" },
        },
        setup: [{ key: "OPENAI_API_KEY" }],
      },
    ]);
    expect(JSON.stringify(servers)).not.toContain("literal-secret-from-upstream");
    expect(notes.join("\n")).toContain("publishes a client secret");
    expect(notes.join("\n")).toContain("github: upstream note: Signs in with GitHub.");
    expect(notes.join("\n")).toContain('env_vars entry "bad-name" is not a vault key');
  });

  it("reads a Claude Code map with or without its wrapper: the plugin root, ${VAR} references and no literal token", async () => {
    const wrapped = await upstream({
      ".claude-plugin/plugin.json": JSON.stringify({
        name: "db",
        mcpServers: {
          db: {
            command: "${CLAUDE_PLUGIN_ROOT}/servers/db-server",
            args: ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"],
            env: { DB_URL: "${DB_URL}", REGION: "${REGION:-us-east-1}" },
          },
          // The plugin root, then out of it.
          climb: { command: "${CLAUDE_PLUGIN_ROOT}/../../bin/tool" },
        },
      }),
    });
    const db = portMcp(wrapped);
    expect(db.notes).toContain(
      "climb: its command ${PLUGIN_ROOT}/../../bin/tool lies outside the plugin; not carried",
    );
    expect(db.mcpServers).toEqual([
      {
        id: "db.mcp.db",
        name: "db",
        config: {
          transport: "stdio",
          command: "${PLUGIN_ROOT}/servers/db-server",
          args: ["--config", "${PLUGIN_ROOT}/config.json"],
          env: { DB_URL: "${DB_URL}", REGION: "${REGION}" },
        },
        setup: [{ key: "DB_URL" }, { key: "REGION" }],
      },
    ]);
    expect(db.notes.join("\n")).toContain('defaulted REGION to "us-east-1"');
    expect(db.notes.join("\n")).toContain("carry servers/db-server into the package");

    await fs.rm(wrapped, { recursive: true, force: true });
    const bare = await upstream({
      ".mcp.json": JSON.stringify({
        github: {
          type: "http",
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" },
        },
        tracker: {
          type: "http",
          url: "https://tracker.example.com/mcp",
          headers: { Authorization: "Bearer abcdefghijklmnopqrstuvwxyz0123456789" },
        },
      }),
    });
    const remote = portMcp(bare);
    expect(remote.mcpServers.map((s) => [s.name, s.config.headers, s.setup])).toEqual([
      [
        "github",
        { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" },
        [{ key: "GITHUB_PERSONAL_ACCESS_TOKEN" }],
      ],
      [
        "tracker",
        { Authorization: "Bearer ${TRACKER_TOKEN}" },
        [{ key: "TRACKER_TOKEN", label: "Tracker token" }],
      ],
    ]);
    expect(JSON.stringify(remote)).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("roots a stdio server's files in the package, and leaves out what cannot be carried", async () => {
    const dir = await upstream({
      ".codex-plugin/plugin.json": JSON.stringify({ name: "local" }),
      ".mcp.json": JSON.stringify({
        mcpServers: {
          "Local Widgets": {
            command: "node",
            args: ["./mcp/server.cjs", "--stdio"],
            cwd: ".",
          },
          launcher: { command: "./scripts/launch", cwd: "work" },
          escape: { command: "../outside/run" },
          // The same escape spelled so that it does not start with "../".
          dotted: { command: "./../outside/run" },
          nested: { command: "bin/../../outside/run" },
          argument: { command: "node", args: ["./../outside/server.cjs"] },
          climber: { command: "node", args: ["--stdio"], cwd: "./.." },
          legacy: { type: "ws", url: "ws://example.com" },
          plain: { type: "http", url: "ftp://example.com/mcp" },
        },
      }),
    });
    const { mcpServers: servers, notes } = portMcp(
      dir,
      "--root",
      "https://github.com/o/r/tree/abc/plugins/local",
    );
    expect(servers).toEqual([
      {
        id: "local.mcp.local-widgets",
        name: "local-widgets",
        config: {
          transport: "stdio",
          command: "node",
          args: ["${PLUGIN_ROOT}/mcp/server.cjs", "--stdio"],
          cwd: "${PLUGIN_ROOT}",
        },
      },
      {
        id: "local.mcp.launcher",
        name: "launcher",
        config: {
          transport: "stdio",
          command: "${PLUGIN_ROOT}/scripts/launch",
          cwd: "${PLUGIN_ROOT}/work",
        },
      },
      {
        id: "local.mcp.climber",
        name: "climber",
        config: { transport: "stdio", command: "node", args: ["--stdio"] },
      },
    ]);
    const said = notes.join("\n");
    expect(said).toContain(
      "carry mcp/server.cjs into the package at the same path (text only; read it in full): https://github.com/o/r/tree/abc/plugins/local/mcp/server.cjs",
    );
    expect(said).toContain("carry scripts/launch into the package");
    expect(said).toContain(
      "escape: its command ../outside/run lies outside the plugin; not carried",
    );
    expect(said).toContain(
      "dotted: its command ./../outside/run lies outside the plugin; not carried",
    );
    expect(said).toContain(
      "nested: its command bin/../../outside/run lies outside the plugin; not carried",
    );
    expect(said).toContain(
      "argument: its argument ./../outside/server.cjs lies outside the plugin; not carried",
    );
    expect(said).toContain("climber: its cwd ./.. lies outside the plugin; dropped");
    expect(said).not.toContain("carry ../");
    expect(said).toContain("legacy: its transport cannot be told; not carried");
    expect(said).toContain("plain: its address");
  });

  it("reads the server map only from inside the plugin", async () => {
    const dir = await upstream({
      "plugin/.codex-plugin/plugin.json": JSON.stringify({
        name: "reach",
        mcpServers: "../outside.json",
      }),
      "outside.json": JSON.stringify({
        mcpServers: { borrowed: { type: "http", url: "https://example.com/mcp" } },
      }),
    });
    const { mcpServers: servers, notes } = portMcp(path.join(dir, "plugin"));
    expect(servers).toEqual([]);
    expect(notes).toEqual([
      "../outside.json, which the manifest names for its MCP servers, lies outside the plugin; not read",
    ]);
  });

  it("marks what only the upstream prose says: an OAuth sign-in, and a token as its alternative", async () => {
    const dir = await upstream({
      ".codex-plugin/plugin.json": JSON.stringify({ name: "cloudflare" }),
      ".mcp.json": JSON.stringify({
        mcpServers: {
          "cloudflare-api": {
            type: "http",
            url: "https://mcp.cloudflare.com/mcp",
            note: "Uses OAuth on first connection, with optional bearer-token auth for automation.",
          },
        },
      }),
    });
    const ported = portMcp(dir, "--oauth", "cloudflare-api", "--bearer", "cloudflare-api");
    expect(ported.mcpServers).toEqual([
      {
        id: "cloudflare.mcp.cloudflare-api",
        name: "cloudflare-api",
        config: {
          transport: "http",
          url: "https://mcp.cloudflare.com/mcp",
          headers: { Authorization: "Bearer ${CLOUDFLARE_API_TOKEN}" },
          oauth: {},
        },
        setup: [{ key: "CLOUDFLARE_API_TOKEN", label: "Cloudflare API token" }],
      },
    ]);
  });
});

const WRITE_MODULE = path.resolve(
  import.meta.dirname,
  "../../../plugins/skill-porting/skills/plugin-porting/scripts/write-module.mjs",
);
/** The package's build line, `penguin-gen-ifaces --project tsconfig.json --out ifaces.json`. */
const GENERATOR = path.resolve(import.meta.dirname, "../bin/gen-ifaces.mjs");
/** A hook's budget for one generator run: a cold runner's first node spawn plus loading typescript. */
const BUILD_BUDGET = 30_000;

const writeModule = (dir: string, ...flags: string[]) =>
  spawnSync(process.execPath, [WRITE_MODULE, dir, ...flags], { encoding: "utf8" });

describe("the porting chain on a Codex plugin", () => {
  let work: string;
  let built: string;
  let ported: PortedServers;
  let plugin: LibraryPlugin;
  let warned: unknown[][];
  beforeAll(async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-porting-chain-"));
    const src = path.join(work, "upstream");
    built = path.join(work, "cloudflare");
    const files: Record<string, string> = {
      ".codex-plugin/plugin.json": JSON.stringify({ name: "cloudflare", version: "1.2.0" }),
      ".mcp.json": JSON.stringify({
        mcpServers: { "cloudflare-api": { type: "http", url: "https://mcp.cloudflare.com/mcp" } },
      }),
      "skills/workers/SKILL.md":
        "---\nname: workers\ndescription: >-\n  Build on\n  Workers.\n---\n\nBody.\n",
      "skills/d1/SKILL.md": "# D1\n\nQuery the database.\n",
    };
    for (const [rel, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(src, rel)), { recursive: true });
      await fs.writeFile(path.join(src, rel), text);
    }
    // 1. Skills, copied and normalized; 2. MCP servers; 4. package.json, the card, the module.
    await fs.cp(path.join(src, "skills"), path.join(built, "skills"), { recursive: true });
    normalize(built);
    ported = portMcp(src, "--oauth", "cloudflare-api", "--bearer", "cloudflare-api");
    await fs.writeFile(path.join(work, "mcp.json"), JSON.stringify(ported));
    await fs.writeFile(
      path.join(built, "package.json"),
      JSON.stringify({ name: "@ported/cloudflare", version: "1.2.0", description: "Cloudflare." }),
    );
    await fs.writeFile(
      path.join(work, "card.json"),
      JSON.stringify({
        title: "Cloudflare",
        category: "software-development",
        quickStart: { prompt: "Deploy a Worker." },
        interface: { brandColor: "#F38020" },
      }),
    );
    const wrote = writeModule(
      built,
      "--core",
      "v0.2.19-3-gabc1234",
      "--card",
      path.join(work, "card.json"),
      "--mcp",
      path.join(work, "mcp.json"),
    );
    expect(wrote.status, wrote.stderr).toBe(0);
    expect(wrote.stdout).toContain("card: dropped interface (not card fields)");
    // 5. The build, as `npm run build` runs it.
    const build = spawnSync(
      process.execPath,
      [GENERATOR, "--project", "tsconfig.json", "--out", "ifaces.json"],
      { cwd: built, encoding: "utf8" },
    );
    expect(build.status, build.stderr).toBe(0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    plugin = readLibraryPackage(built);
    warned = warn.mock.calls;
    warn.mockRestore();
  }, BUILD_BUDGET);
  afterAll(async () => {
    await fs.rm(work, { recursive: true, force: true });
  });

  it("leaves a package the plugin library reads with no warning: its Skills, its MCP servers, its card", () => {
    expect(warned).toEqual([]);
    expect(plugin.skills.map((s) => [s.name, s.description, s.version])).toEqual([
      ["d1", "Query the database.", "2026.10.10.1"],
      ["workers", "Build on Workers.", "2026.10.10.1"],
    ]);
    const { id: _id, ...server } = ported.mcpServers[0]!;
    expect(plugin.mcpServers).toEqual([{ ...server, oauth: true }]);
    expect(plugin).toMatchObject({
      title: "Cloudflare",
      category: "software-development",
      quickStart: { prompt: "Deploy a Worker." },
    });
  });

  it("builds with the generator of the PenguinHarness version it was ported for", async () => {
    const pkgJson = JSON.parse(await fs.readFile(path.join(built, "package.json"), "utf8"));
    expect(pkgJson).toMatchObject({
      type: "module",
      scripts: { build: "penguin-gen-ifaces --project tsconfig.json --out ifaces.json" },
      devDependencies: { "@prismshadow/penguin-core": "^0.2.19", typescript: "^5.6.0" },
    });
  });

  it("writes nothing without the PenguinHarness version, or with nothing to declare", async () => {
    const empty = path.join(work, "empty");
    await fs.mkdir(empty);
    await fs.writeFile(path.join(empty, "package.json"), JSON.stringify({ name: "@ported/empty" }));
    const unversioned = writeModule(built, "--card", path.join(work, "card.json"));
    expect(unversioned.status).toBe(1);
    expect(unversioned.stderr).toContain("--core needs the PenguinHarness version");
    const bare = writeModule(empty, "--core", "v0.2.19");
    expect(bare.status).toBe(1);
    expect(bare.stderr).toContain("nothing to declare");
    expect(existsSync(path.join(empty, "src"))).toBe(false);
  });
});
