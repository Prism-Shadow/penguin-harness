/**
 * The Agent archive: a zip export holding the parts the caller picks, and an import that creates
 * an Agent from one or replaces an Agent's State with it.
 *
 * - Given an Agent with skills, hooks, memory, a workbench with its data, a schedule, a vault and
 *   an MCP server holding a token, a default export holds the config, the skills, hooks, memory
 *   and the workbench's source and data, and no schedule, vault, `.build`, `node_modules`,
 *   staging file or `.git` entry.
 * - Given the same Agent, the MCP token is blank in the exported config and named in the
 *   manifest, a `${KEY}` vault reference travels as written, and the vault's key names are in the
 *   manifest while its values are in no entry.
 * - Given part flags, the preview reports per part the files and bytes the zip then holds.
 * - Given a malformed parts query, the export and the preview answer 400.
 * - Given an export imported under a new id, the new Agent has the same skills, hooks, memory
 *   files, workbench and version, and the import names the vault keys and the blanked token as
 *   what to fill.
 * - Given a taken id without overwrite, the import is 409 `agent_exists` naming the id, whether
 *   the id came from the query or the manifest, and the Agent is as it was.
 * - Given a member's overwrite, the answer is 403.
 * - Given the owner's overwrite with an export that leaves memory and workbenches out, the State
 *   is replaced, a backup of the replaced State is written, and the Agent keeps its vault, API
 *   key, Traces, MCP token and the memory and workbench the zip left out.
 * - Given a malformed archive — a zip-slip path, a link entry, an entry declaring more than the
 *   entry cap, a directory declaring more entries than the cap, an entry that inflates past what
 *   it declares, no config and no definition, a SKILL.md without frontmatter, a hooks.json naming
 *   a script outside its package — the import refuses before anything is written, and the id
 *   stays free.
 * - Given a zip made by macOS's Archive Utility (a `__MACOSX/` folder beside the Agent's), it
 *   imports.
 * - Given a hand-written zip (a definition, instructions and a skill, no parts), the Agent is
 *   created from the template with its MCP server, model level, instructions and skill; a tool
 *   this install lacks is noted and the vault key it names is to fill.
 * - While an overwrite swaps the State, a request for the Agent's workbenches waits for it.
 * - An export, or an overwrite, of an Agent whose workbenches were never migrated migrates them.
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Zippable } from "fflate";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { agentDir, agentStateDir, agentsDir } from "@prismshadow/penguin-core";
import type {
  AgentApiResponse,
  AgentArchiveImportResponse,
  AgentArchiveManifest,
  AgentArchivePreview,
  AgentConfigResponse,
  AgentsResponse,
  ProjectCreateResponse,
  VaultResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const NOW = new Date(2026, 10, 4, 12, 0, 0);
const MCP_SERVERS = [
  {
    name: "github",
    config: {
      command: "node",
      args: ["server.js"],
      env: { GITHUB_TOKEN: "ghp_live_value", REGION: "eu", API_KEY: "${GH_KEY}" },
    },
  },
];
const SKILL_MD = "---\nname: notes\ndescription: Keeps notes\n---\n\n# Notes\n";
const HOOKS_JSON = JSON.stringify({ name: "guard", stop: [{ command: "stop.mjs", timeout: 5 }] });
const PARTS_ALL = {
  skills: true,
  hooks: true,
  memory: true,
  workbenches: true,
  workbenchData: true,
  schedules: false,
  traces: { kind: "none" },
};

/** The zip's entries by their path below its one top-level directory. */
function entriesOf(bytes: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    out[name.slice(name.indexOf("/") + 1)] = data;
  }
  return out;
}

/** Rewrites one entry's declared uncompressed size in the central directory, which the import reads first. */
function declareSize(zip: Uint8Array, entry: string, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  const want = strToU8(entry);
  for (let i = 0; i + 46 <= out.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50 || view.getUint16(i + 28, true) !== want.length) {
      continue;
    }
    if (want.every((byte, k) => out[i + 46 + k] === byte)) {
      expect(view.getUint16(i + 10, true)).toBe(8); // Deflated: what an inflate counter must catch.
      view.setUint32(i + 24, size, true);
    }
  }
  return out;
}

/** Rewrites the entry count the end-of-central-directory record declares. */
function declareCount(zip: Uint8Array, count: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  const end = out.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  view.setUint16(end + 8, count, true);
  view.setUint16(end + 10, count, true);
  return out;
}

/** A hand-made archive under `crafted/`: a manifest, a config unless left out, and `files`. */
function crafted(files: Zippable, opts: { manifest?: object; config?: boolean } = {}): Uint8Array {
  const manifest = {
    format: "penguin-agent-zip/1",
    agentId: "crafted",
    parts: PARTS_ALL,
    vaultKeys: [],
    redacted: [],
    ...opts.manifest,
  };
  return zipSync({
    "crafted/manifest.json": strToU8(JSON.stringify(manifest)),
    ...(opts.config === false
      ? {}
      : { "crafted/agent_state/system_config.yaml": strToU8('system_prompt: "hi"\nversion: 2\n') }),
    ...files,
  });
}

describe("Agent archive", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let projectId: string;
  const agentBase = (id: string) => `/api/projects/${projectId}/agents/${id}`;
  const importUrl = (query = "") => `/api/projects/${projectId}/agents/import${query}`;

  beforeAll(async () => {
    t = await createTestApp({ now: () => NOW });
    owner = apiClient(t.app, (await provisionUser(t.app, "owner_a")).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "member_b")).cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-zip", name: "Zip project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function newAgent(id: string): Promise<string> {
    const res = await owner.post(`/api/projects/${projectId}/agents`, { agentId: id });
    expect(res.status, await res.clone().text()).toBe(201);
    return agentStateDir(t.root, projectId, id);
  }

  async function write(state: string, files: Record<string, string>): Promise<void> {
    for (const [rel, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(state, rel)), { recursive: true });
      await fs.writeFile(path.join(state, rel), text);
    }
  }

  /** An Agent holding something of every part, an MCP token, a vault and version 3. */
  async function furnishedAgent(id: string): Promise<string> {
    const state = await newAgent(id);
    await write(state, {
      "skills/notes/SKILL.md": SKILL_MD,
      "skills/notes/ref.md": "reference\n",
      "skills/notes/.git/config": "[core]\n",
      "hooks/guard/hooks.json": HOOKS_JSON,
      "hooks/guard/stop.mjs": "process.exit(0);\n",
      "memory/user/topic.md": "remembered\n",
      "workbenches/todo/package.json": '{"name":"todo","penguin":{"modules":["index.ts"]}}',
      "workbenches/todo/index.ts": "export default {};\n",
      "workbenches/todo/state.json": '{"items":1}',
      "workbenches/todo/.build/out.js": "built\n",
      "workbenches/todo/node_modules/dep/index.js": "dep\n",
      "workbenches/todo/notes.penguin-tmpab12cd": "staged\n",
      "schedule/daily.toml": 'prompt = "p"\nenabled = false\nstart_at = "2030-01-01T00:00:00Z"\n',
      "tools/custom.json": "{}\n",
    });
    const config = await owner.put(`${agentBase(id)}/config`, {
      config: { name: "Notes Agent", mcpServers: MCP_SERVERS },
    });
    expect(config.status, await config.clone().text()).toBe(200);
    const vault = await owner.put(`${agentBase(id)}/vault`, {
      entries: [
        { key: "GH_KEY", value: "vault_value_1" },
        { key: "OTHER", value: "vault_value_2" },
      ],
    });
    expect(vault.status).toBe(200);
    const file = path.join(state, "system_config.yaml");
    await fs.writeFile(
      file,
      (await fs.readFile(file, "utf8")).replace(/^version: .*$/m, "version: 3"),
    );
    return state;
  }

  async function exported(id: string, query = ""): Promise<Uint8Array> {
    const res = await member.get(`${agentBase(id)}/archive${query}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function card(id: string) {
    const list = (await (
      await owner.get(`/api/projects/${projectId}/agents`)
    ).json()) as AgentsResponse;
    return list.agents.find((a) => a.agentId === id);
  }

  it("a default export holds the config, skills, hooks, memory and workbench with its data, and nothing that never travels", async () => {
    await furnishedAgent("full_agent");

    const res = await member.get(`${agentBase("full_agent")}/archive`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="full_agent-20261104.zip"',
    );
    const names = Object.keys(entriesOf(new Uint8Array(await res.arrayBuffer())));
    expect(names).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "agent_state/system_config.yaml",
        "agent_state/AGENTS.md",
        "agent_state/tools/custom.json",
        "agent_state/skills/notes/SKILL.md",
        "agent_state/skills/notes/ref.md",
        "agent_state/hooks/guard/hooks.json",
        "agent_state/hooks/guard/stop.mjs",
        "agent_state/memory/user/topic.md",
        "agent_state/workbenches/todo/package.json",
        "agent_state/workbenches/todo/index.ts",
        "agent_state/workbenches/todo/state.json",
      ]),
    );
    expect(
      names.filter((n) =>
        /schedule\/|\.vault\.toml|\.build\/|node_modules\/|penguin-tmp|\.git\/|^traces\//.test(n),
      ),
    ).toEqual([]);
  });

  it("a literal MCP token is blanked and named, a vault reference travels, and vault values never do", async () => {
    await furnishedAgent("secret_agent");

    const entries = entriesOf(await exported("secret_agent"));

    const manifest = JSON.parse(strFromU8(entries["manifest.json"]!)) as AgentArchiveManifest;
    expect(manifest.redacted).toEqual(["mcp:github:env:GITHUB_TOKEN"]);
    expect(manifest.vaultKeys).toEqual(["GH_KEY", "OTHER"]);
    expect(manifest.source).toEqual({ projectId, agentId: "secret_agent", version: 3 });
    const config = parseYaml(strFromU8(entries["agent_state/system_config.yaml"]!)) as {
      tools: { mcpServers: Array<{ config: { env: Record<string, string> } }> };
    };
    expect(config.tools.mcpServers[0]!.config.env).toEqual({
      GITHUB_TOKEN: "",
      REGION: "eu",
      API_KEY: "${GH_KEY}",
    });
    const everything = Object.values(entries)
      .map((bytes) => strFromU8(bytes))
      .join("\n");
    for (const secret of ["ghp_live_value", "vault_value_1", "vault_value_2"]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("the preview reports per part what the zip with the same parts holds", async () => {
    await furnishedAgent("preview_agent");
    const query = "?schedules=1&memory=0&workbenchData=0";

    const res = await member.get(`${agentBase("preview_agent")}/archive/preview${query}`);
    const entries = entriesOf(await exported("preview_agent", query));

    expect(res.status).toBe(200);
    const preview = (await res.json()) as AgentArchivePreview;
    const under = (prefix: string) => {
      const files = Object.entries(entries).filter(([name]) => name.startsWith(prefix));
      return { files: files.length, bytes: files.reduce((sum, [, b]) => sum + b.byteLength, 0) };
    };
    expect(preview.parts).toEqual({
      skills: under("agent_state/skills/"),
      hooks: under("agent_state/hooks/"),
      memory: { files: 0, bytes: 0 },
      workbenches: under("agent_state/workbenches/"),
      schedules: under("agent_state/schedule/"),
    });
    expect(preview.parts.schedules.files).toBe(1);
    expect(Object.keys(entries)).not.toContain("agent_state/workbenches/todo/state.json");
    expect(preview.totalBytes).toBe(
      Object.values(entries).reduce((sum, bytes) => sum + bytes.byteLength, 0),
    );
    expect(preview.vaultKeys).toEqual(["GH_KEY", "OTHER"]);
    expect(preview.traces).toMatchObject({ sessions: 0, files: 0, newest: null });
  });

  it.each([
    "?skills=yes",
    "?traces=last:0",
    "?traces=last:501",
    "?traces=2026-02-30..2026-03-01",
    "?traces=2026-03-02..2026-03-01",
    "?traces=all",
  ])("a malformed parts query %s is a 400 on both routes", async (query) => {
    const id = "default_agent";
    expect((await member.get(`${agentBase(id)}/archive${query}`)).status).toBe(400);
    expect((await member.get(`${agentBase(id)}/archive/preview${query}`)).status).toBe(400);
  });

  it("an export imported under a new id has the same skills, hooks, memory, workbench and version, and names what to fill", async () => {
    await furnishedAgent("source_agent");
    const zip = await exported("source_agent");

    const res = await member.upload(importUrl("?agentId=copy_agent"), zip);

    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as AgentArchiveImportResponse;
    expect(body.mode).toBe("created");
    expect(body.version).toBe(3);
    expect(body.backup).toBeUndefined();
    expect(body.imported).toEqual({
      skills: 1,
      hooks: 1,
      memoryFiles: 2,
      workbenches: 1,
      schedules: 0,
      traces: { sessions: 0, files: 0 },
    });
    expect(body.toFill.sort()).toEqual(["GH_KEY", "OTHER", "mcp:github:env:GITHUB_TOKEN"]);
    const source = await card("source_agent");
    expect(body.agent).toMatchObject({
      agentId: "copy_agent",
      name: "Notes Agent",
      version: 3,
      skillCount: source!.skillCount,
      hookCount: source!.hookCount,
      memoryCount: source!.memoryCount,
      workbenchCount: source!.workbenchCount,
      vaultKeyCount: 0,
    });
    const copy = agentStateDir(t.root, projectId, "copy_agent");
    expect(await fs.readFile(path.join(copy, "skills", "notes", "SKILL.md"), "utf8")).toBe(
      SKILL_MD,
    );
    expect(await fs.readFile(path.join(copy, "workbenches", "todo", "state.json"), "utf8")).toBe(
      '{"items":1}',
    );
    expect((await card("copy_agent"))?.agentId).toBe("copy_agent");
  });

  it("a taken id without overwrite is 409 agent_exists naming it, and writes nothing", async () => {
    const state = await furnishedAgent("taken_agent");
    const zip = await exported("taken_agent");
    const before = await fs.readFile(path.join(state, "system_config.yaml"), "utf8");

    for (const url of [importUrl("?agentId=taken_agent"), importUrl()]) {
      const res = await member.upload(url, zip);
      expect(res.status).toBe(409);
      const err = (await res.json()) as { error: { code: string; details?: { agentId: string } } };
      expect(err.error).toMatchObject({
        code: "agent_exists",
        details: { agentId: "taken_agent" },
      });
    }
    expect(await fs.readFile(path.join(state, "system_config.yaml"), "utf8")).toBe(before);
    const staging = (await fs.readdir(agentsDir(t.root, projectId))).filter((n) =>
      n.startsWith(".import-"),
    );
    expect(staging).toEqual([]);
  });

  it("a member's overwrite is 403", async () => {
    await newAgent("guarded_agent");
    const zip = await exported("guarded_agent");

    const res = await member.upload(importUrl("?agentId=guarded_agent&overwrite=1"), zip);

    expect(res.status).toBe(403);
  });

  it("the owner's overwrite replaces the State after a backup and keeps the vault, keys, Traces, token and the parts the zip left out", async () => {
    await furnishedAgent("donor_agent");
    const target = await newAgent("target_agent");
    await write(target, {
      "memory/user/mine.md": "my memory\n",
      "workbenches/mine/package.json": '{"name":"mine","penguin":{"modules":["index.ts"]}}',
      "workbenches/mine/state.json": '{"mine":true}',
      "notes/own.md": "the Agent's own file\n",
    });
    await owner.put(`${agentBase("target_agent")}/config`, {
      config: {
        mcpServers: [
          {
            ...MCP_SERVERS[0]!,
            config: { ...MCP_SERVERS[0]!.config, env: { GITHUB_TOKEN: "mine" } },
          },
        ],
      },
    });
    await owner.put(`${agentBase("target_agent")}/vault`, {
      entries: [{ key: "TOKEN", value: "kept" }],
    });
    expect((await owner.post(`${agentBase("target_agent")}/api/keys`, { name: "ci" })).status).toBe(
      201,
    );
    const sid = "session-2026-11-01-10-00-00-0000aaaa";
    await writeTraceFile(t.root, projectId, "target_agent", "2026-11-01", sid, 1, []);
    const zip = await exported("donor_agent", "?memory=0&workbenches=0");

    const res = await owner.upload(importUrl("?agentId=target_agent&overwrite=1"), zip);

    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as AgentArchiveImportResponse;
    expect(body).toMatchObject({ mode: "overwritten", previousVersion: 1, version: 3 });
    expect(body.toFill).not.toContain("mcp:github:env:GITHUB_TOKEN");
    expect(await fs.readFile(path.join(target, "skills", "notes", "SKILL.md"), "utf8")).toBe(
      SKILL_MD,
    );
    expect(await fs.readFile(path.join(target, "memory", "user", "mine.md"), "utf8")).toBe(
      "my memory\n",
    );
    expect(await fs.readFile(path.join(target, "workbenches", "mine", "state.json"), "utf8")).toBe(
      '{"mine":true}',
    );
    expect(await fs.readFile(path.join(target, "notes", "own.md"), "utf8")).toBe(
      "the Agent's own file\n",
    );
    const config = (await (
      await owner.get(`${agentBase("target_agent")}/config`)
    ).json()) as AgentConfigResponse;
    expect(config.config.name).toBe("Notes Agent");
    expect(config.config.mcpServers[0]!.config).toMatchObject({ env: { GITHUB_TOKEN: "mine" } });
    const vault = (await (
      await owner.get(`${agentBase("target_agent")}/vault`)
    ).json()) as VaultResponse;
    expect(vault.entries.map((e) => e.key)).toEqual(["TOKEN"]);
    const api = (await (
      await owner.get(`${agentBase("target_agent")}/api`)
    ).json()) as AgentApiResponse;
    expect(api.api.keys.map((k) => k.name)).toEqual(["ci"]);
    await expect(
      fs.access(
        path.join(
          agentDir(t.root, projectId, "target_agent"),
          "traces",
          "2026-11-01",
          `${sid}_001.jsonl`,
        ),
      ),
    ).resolves.toBeUndefined();
    // The backup holds the State the overwrite replaced.
    expect(body.backup).toMatch(/^snapshots\/import-backup-v1-\d{8}T\d{6}Z-[0-9a-f]+\.tar\.gz$/);
    const listed: string[] = [];
    await tar.list({
      file: path.join(agentDir(t.root, projectId, "target_agent"), body.backup!),
      onReadEntry: (entry) => void listed.push(entry.path),
    });
    expect(listed).toContain("agent_state/memory/user/mine.md");
    expect(listed).not.toContain("agent_state/skills/notes/SKILL.md");
  });

  const linkEntry: Zippable = {
    "crafted/agent_state/skills/linked": [strToU8("../../.."), { os: 3, attrs: 0o120777 << 16 }],
  };
  const padded = strToU8("x".repeat(4096));
  it.each<[string, () => Uint8Array, number]>([
    ["a zip-slip path", () => crafted({ "crafted/../evil.txt": strToU8("evil") }), 400],
    ["a link entry", () => crafted(linkEntry), 400],
    [
      "an entry declaring more than the entry cap",
      () =>
        declareSize(
          crafted({ "crafted/agent_state/memory/user/pad.md": padded }),
          "crafted/agent_state/memory/user/pad.md",
          257 * 1024 * 1024,
        ),
      413,
    ],
    [
      "a directory declaring more entries than the cap",
      () => declareCount(crafted({}), 60_000),
      413,
    ],
    [
      "an entry that inflates past what it declares",
      () =>
        declareSize(
          crafted({ "crafted/agent_state/memory/user/pad.md": padded }),
          "crafted/agent_state/memory/user/pad.md",
          16,
        ),
      400,
    ],
    ["no config and no definition", () => crafted({}, { config: false }), 400],
    [
      "a SKILL.md without frontmatter",
      () => crafted({ "crafted/agent_state/skills/bad/SKILL.md": strToU8("# no frontmatter\n") }),
      400,
    ],
    [
      "a hooks.json naming a script outside its package",
      () =>
        crafted({
          "crafted/agent_state/hooks/bad/hooks.json": strToU8(
            JSON.stringify({ name: "bad", stop: [{ command: "../../escape.mjs" }] }),
          ),
        }),
      400,
    ],
  ])(
    "%s is refused before anything is written, and the id stays free",
    async (name, zip, status) => {
      const id = `refused_${name.replace(/[^a-z]+/g, "_").slice(0, 40)}`;

      const res = await member.upload(importUrl(`?agentId=${id}`), zip());

      expect(res.status, await res.clone().text()).toBe(status);
      expect(await card(id)).toBeUndefined();
      const names = await fs.readdir(agentsDir(t.root, projectId));
      expect(names.filter((n) => n === id || n.startsWith(".import-"))).toEqual([]);
      expect((await owner.post(`/api/projects/${projectId}/agents`, { agentId: id })).status).toBe(
        201,
      );
    },
  );

  it("a zip macOS's Archive Utility made, with its __MACOSX folder beside the Agent's, imports", async () => {
    const zip = unzipSync(crafted({}));
    zip["__MACOSX/crafted/._manifest.json"] = strToU8("resource fork");

    const res = await member.upload(importUrl("?agentId=from_finder"), zipSync(zip));

    expect(res.status, await res.clone().text()).toBe(201);
    expect(((await res.json()) as AgentArchiveImportResponse).version).toBe(2);
  });

  it("a hand-written zip creates the Agent from the template with its definition, instructions and skill, and notes an unknown tool", async () => {
    const zip = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          format: "penguin-agent-zip/1",
          agentId: "ported_agent",
          name: "Ported",
          vaultKeys: ["FS_TOKEN"],
          redacted: [],
          definition: {
            mcpServers: [
              {
                name: "files",
                config: {
                  command: "npx",
                  args: ["-y", "files-server"],
                  env: { API_TOKEN: "${FS_TOKEN}" },
                },
              },
            ],
            model: { thinkingLevel: "high" },
            tools: { builtin: ["read_file", "no_such_tool"] },
          },
        }),
      ),
      "agent_state/AGENTS.md": strToU8("# Ported instructions\n"),
      // Unquoted, as plugin-porting's normaliser writes it: the tolerant reader takes it.
      "agent_state/skills/porting/SKILL.md": strToU8(
        "---\nname: porting\ndescription: Use when: moving things: in\n---\n\nBody\n",
      ),
    });

    const res = await member.upload(importUrl(), zip);

    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as AgentArchiveImportResponse;
    expect(body).toMatchObject({
      mode: "created",
      agent: { agentId: "ported_agent", name: "Ported" },
    });
    expect(body.notes.join("\n")).toContain("no_such_tool");
    expect(body.toFill).toEqual(["FS_TOKEN"]);
    expect(body.imported.skills).toBe(1);
    const config = (await (
      await owner.get(`${agentBase("ported_agent")}/config`)
    ).json()) as AgentConfigResponse;
    expect(config.agentsMd).toBe("# Ported instructions\n");
    expect(config.config.mcpServers.map((s) => s.name)).toEqual(["files"]);
    expect(config.config.model?.thinkingLevel).toBe("high");
    expect(config.config.toolsBuiltin.map((tool) => tool.name)).toEqual(["read_file"]);
    const state = agentStateDir(t.root, projectId, "ported_agent");
    await expect(
      fs.access(path.join(state, "skills", "porting", "SKILL.md")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(state, "memory", "user", "MEMORY.md")),
    ).resolves.toBeUndefined();
  });

  it("while an overwrite swaps the State, a request for the Agent's workbenches waits for it to end", async () => {
    await newAgent("busy_agent");
    const zip = await exported("busy_agent");
    const real = t.deps.snapshots.swapAgentState.bind(t.deps.snapshots);
    let swapping!: () => void;
    const started = new Promise<void>((resolve) => (swapping = resolve));
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    const order: string[] = [];
    vi.spyOn(t.deps.snapshots, "swapAgentState").mockImplementation(async (...args) => {
      swapping();
      await held;
      await real(...args);
      order.push("swapped");
    });

    const imported = (async () => {
      const res = await owner.upload(importUrl("?agentId=busy_agent&overwrite=1"), zip);
      order.push(`import ${res.status}`);
    })();
    await started;
    const listed = (async () => {
      order.push(`list ${(await owner.get(`${agentBase("busy_agent")}/workbenches`)).status}`);
    })();
    finish();
    await Promise.all([imported, listed]);

    expect(order).toContain("import 201");
    expect(order.filter((step) => step !== "import 201")).toEqual(["swapped", "list 200"]);
  });

  /** An Agent whose workbench is still in the layout before Agent State. */
  async function legacyAgent(id: string): Promise<string> {
    await newAgent(id);
    const dir = agentDir(t.root, projectId, id);
    const legacy = path.join(dir, "workflows", "desk");
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, "package.json"), '{"name":"Desk"}');
    await fs.writeFile(path.join(legacy, "state.json"), '{"kept":true}');
    return dir;
  }

  it("an export of an Agent whose workbenches were never migrated migrates them first, and carries them", async () => {
    const dir = await legacyAgent("legacy_export");

    const names = Object.keys(entriesOf(await exported("legacy_export")));

    expect(names).toContain("agent_state/workbenches/desk/state.json");
    await expect(fs.stat(path.join(dir, "workflows"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("an overwrite of an Agent whose workbenches were never migrated migrates them first", async () => {
    const dir = await legacyAgent("legacy_import");
    const zip = await exported("default_agent");

    const res = await owner.upload(importUrl("?agentId=legacy_import&overwrite=1"), zip);

    expect(res.status, await res.clone().text()).toBe(201);
    await expect(fs.stat(path.join(dir, "workflows"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await fs.readFile(
        path.join(dir, ".workbench-migration", "backup", "workflows", "desk", "state.json"),
        "utf8",
      ),
    ).toBe('{"kept":true}');
  });
});
