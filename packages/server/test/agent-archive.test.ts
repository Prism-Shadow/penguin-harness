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
 *   files, workbench and version, the import counts the memories it brought as the Agent card
 *   does (topic files, not indexes or Workspace markers), and it names the vault keys and the
 *   blanked token as what to fill.
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
 * - Given literal secrets in an MCP entry's args (a URL password, `--api-key=…`, the value after
 *   `--token`), its URL's query, its OAuth client secret and its headers, the export blanks and
 *   names each, leaves `${KEY}` references and everything else as written, and an overwrite of
 *   the same Agent from that zip puts every one of them back.
 * - Given a part directory that is a link out of the State, the export leaves it out and the
 *   preview notes it.
 * - Given a selection past what an import accepts — one file past the per-entry cap, or more
 *   bytes than an import inflates — the preview says why and the export is refused 413.
 * - Given a zip with `.git` entries, a vault under any letter case, staging leftovers and a
 *   workbench's `.build/`, `.harness/`, `node_modules/` and `.plugin.json`, none of them lands;
 *   given a part the manifest marks false whose entries the zip carries anyway, they do not land.
 * - Given an overwrite that brings schedules and workbenches without their data, the Agent keeps
 *   its expired schedules and its workbenches' data; given a hand-written overwrite, the Agent
 *   keeps its `tools/` and its MCP credential the definition leaves blank.
 * - Given names that only contain a credential word (`--max-tokens`, `MAX_TOKENS`, `?keyword=`),
 *   their values travel; a credential reached through a YAML alias is blanked all the same.
 * - Given an overwrite whose zip points a server at another address, or whose blanked arguments
 *   come in another order, a credential is refilled only for the same server and the same flag:
 *   it never goes to the other address and never into another flag.
 * - Given a selection past the import's entry cap, the preview says so.
 * - Given an Agent whose config does not parse, its export is refused with a clear code.
 * - Given an Agent whose runtime is cached, an overwrite makes its next use rebuild it.
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
import { agentDir, agentStateDir, agentsDir, userText } from "@prismshadow/penguin-core";
import type { TraceIndexStore } from "../src/mechanisms/traces.js";
import { planArchive } from "../src/agent-archive/export.js";
import type {
  AgentApiResponse,
  AgentArchiveParts,
  AgentArchiveImportResponse,
  AgentArchiveManifest,
  AgentArchivePreview,
  AgentConfigResponse,
  AgentsResponse,
  ProjectCreateResponse,
  VaultResponse,
} from "../src/api/types.js";
import { fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";
import {
  apiClient,
  canCreateSymlink,
  createTestApp,
  provisionUser,
  waitFor,
  writeTraceFile,
} from "./helpers.js";
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
  let loads = 0;

  beforeAll(async () => {
    // The loader counts how many times the manager (re)built a runtime; the runtime it builds
    // answers with nothing, so no case reaches an LLM.
    t = await createTestApp({
      now: () => NOW,
      loader: {
        load: async (row) => {
          loads += 1;
          return fakeSession(row.sessionId);
        },
      },
    });
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
      "memory/ws-0123abcd/.workspace": "/tmp/project\n",
      "memory/ws-0123abcd/MEMORY.md": "- [Build](build.md)\n",
      "memory/ws-0123abcd/build.md": "how to build\n",
      "workbenches/todo/package.json": '{"name":"todo","penguin":{"modules":["index.ts"]}}',
      "workbenches/todo/index.ts": "export default {};\n",
      "workbenches/todo/state.json": '{"items":1}',
      "workbenches/todo/.build/out.js": "built\n",
      "workbenches/todo/node_modules/dep/index.js": "dep\n",
      "workbenches/todo/notes.penguin-tmpab12cd": "staged\n",
      "schedule/daily.toml": 'prompt = "p"\nenabled = false\nstart_at = "2030-01-01T00:00:00Z"\n',
      "schedule/expired/old.toml":
        'prompt = "o"\nenabled = false\nstart_at = "2020-01-01T00:00:00Z"\n',
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
    expect(Object.keys(entries).filter((n) => n.includes("schedule/expired"))).toEqual([]);
    expect(Object.keys(entries)).not.toContain("agent_state/workbenches/todo/state.json");
    expect(preview.totalBytes).toBe(
      Object.values(entries).reduce((sum, bytes) => sum + bytes.byteLength, 0),
    );
    expect(preview.vaultKeys).toEqual(["GH_KEY", "OTHER"]);
    expect(preview.traces).toMatchObject({ sessions: 0, files: 0, newest: null });
    expect(preview.entries).toBe(Object.keys(entries).length);
    expect(preview.refusal).toBeUndefined();
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
    // Memories counted as the card counts them: two topic files, not their indexes or marker.
    expect(body.imported.memoryFiles).toBe(source!.memoryCount);
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
      "two names a disk that folds letter case takes for one",
      () =>
        crafted({
          "crafted/agent_state/skills/a/SKILL.md": strToU8("---\nname: a\n---\n"),
          "crafted/agent_state/skills/A/SKILL.md": strToU8("---\nname: A\n---\n"),
        }),
      400,
    ],
    [
      "a device name Windows reserves",
      () => crafted({ "crafted/agent_state/memory/user/CON.md": strToU8("x") }),
      400,
    ],
    [
      "a character Windows refuses in a name",
      () => crafted({ "crafted/agent_state/memory/user/a:b.md": strToU8("x") }),
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
    expect(body.notes).toEqual([
      expect.objectContaining({ code: "unknown_tool", subject: "no_such_tool" }),
    ]);
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

  it("literal MCP secrets in args, url, oauth and headers are blanked and named, references travel, and an overwrite puts them back", async () => {
    const state = await newAgent("mcp_secrets");
    const servers = [
      {
        name: "pg",
        config: {
          command: "npx",
          args: [
            "-y",
            "server-postgres",
            "postgresql://app:hunter2pw@db.example.test/app",
            "--api-key=sk-inline-123",
            "--token",
            "tok-after-flag",
            "--verbose",
            "--password=${PG_PASS}",
          ],
        },
      },
      {
        name: "remote",
        config: {
          url: "https://mcp.example.test/mcp?api_key=sk-live-zzz123&region=eu",
          headers: { Authorization: "Bearer remote-bearer-1" },
          oauth: { clientId: "app", clientSecret: "oauth-secret-1" },
        },
      },
    ];
    const put = await owner.put(`${agentBase("mcp_secrets")}/config`, {
      config: { mcpServers: servers },
    });
    expect(put.status, await put.clone().text()).toBe(200);

    const zip = await exported("mcp_secrets");

    const entries = entriesOf(zip);
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]!)) as AgentArchiveManifest;
    expect([...manifest.redacted].sort()).toEqual(
      [
        "mcp:pg:args:postgresql://db.example.test:password",
        "mcp:pg:args:--api-key",
        "mcp:pg:args:--token",
        "mcp:remote:headers:Authorization",
        "mcp:remote:oauth:clientSecret",
        "mcp:remote:url:query:api_key",
      ].sort(),
    );
    const config = strFromU8(entries["agent_state/system_config.yaml"]!);
    for (const secret of [
      "hunter2pw",
      "sk-inline-123",
      "tok-after-flag",
      "sk-live-zzz123",
      "remote-bearer-1",
      "oauth-secret-1",
    ]) {
      expect(config).not.toContain(secret);
    }
    for (const kept of [
      "${PG_PASS}",
      "region=eu",
      "clientId: app",
      "--verbose",
      "postgresql://app:@db",
    ]) {
      expect(config).toContain(kept);
    }

    const res = await owner.upload(importUrl("?agentId=mcp_secrets&overwrite=1"), zip);

    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as AgentArchiveImportResponse;
    expect(body.toFill.filter((label) => label.startsWith("mcp:"))).toEqual([]);
    const restored = parseYaml(
      await fs.readFile(path.join(state, "system_config.yaml"), "utf8"),
    ) as {
      tools: { mcpServers: typeof servers };
    };
    expect(restored.tools.mcpServers).toEqual(servers);
  });

  it.skipIf(!canCreateSymlink())(
    "a part directory that is a link out of the State is left out of the export, and the preview notes it",
    async () => {
      const state = await newAgent("linked_memory");
      const outside = path.join(t.root, "outside-memory");
      await fs.mkdir(path.join(outside, "user"), { recursive: true });
      await fs.writeFile(path.join(outside, "user", "secret.md"), "outside the State\n");
      await fs.rm(path.join(state, "memory"), { recursive: true, force: true });
      await fs.symlink(outside, path.join(state, "memory"), "dir");

      const names = Object.keys(entriesOf(await exported("linked_memory")));
      const preview = (await (
        await member.get(`${agentBase("linked_memory")}/archive/preview`)
      ).json()) as AgentArchivePreview;

      expect(names.filter((n) => n.startsWith("agent_state/memory/"))).toEqual([]);
      expect(preview.notes).toEqual([
        expect.objectContaining({ code: "link_skipped", subject: "memory" }),
      ]);
      expect(preview.parts.memory).toEqual({ files: 0, bytes: 0 });
    },
  );

  it.each<[string, Record<string, number>, string]>([
    ["one file past the per-entry cap", { "big.md": 257 * 1024 * 1024 }, "entry"],
    [
      "more bytes than an import inflates",
      Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`part${n}.md`, 250 * 1024 * 1024])),
      "inflated",
    ],
  ])("a selection with %s is refused, and the preview says why", async (_name, sizes, reason) => {
    const id = `too_big_${reason}`;
    const state = await newAgent(id);
    for (const [name, size] of Object.entries(sizes)) {
      // Sparse: the size is declared, not written.
      const file = path.join(state, "memory", "user", name);
      await fs.writeFile(file, "");
      await fs.truncate(file, size);
    }

    const preview = (await (
      await member.get(`${agentBase(id)}/archive/preview`)
    ).json()) as AgentArchivePreview;
    const res = await member.get(`${agentBase(id)}/archive`);

    expect(preview.refusal).toMatchObject({ reason });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "archive_too_large",
    );
  });

  it("none of the entries that never travel lands, nor a part the manifest marks false", async () => {
    const zip = crafted(
      {
        "crafted/agent_state/skills/s/SKILL.md": strToU8("---\nname: s\n---\n"),
        "crafted/agent_state/skills/s/.git/config": strToU8("[core]\n"),
        "crafted/agent_state/.vault.toml": strToU8('PLANTED = "1"\n'),
        "crafted/agent_state/.VAULT.toml": strToU8('PLANTED = "2"\n'),
        "crafted/agent_state/notes.penguin-tmp0a1b2c": strToU8("staged\n"),
        "crafted/agent_state/workbenches/w/package.json": strToU8('{"name":"w"}'),
        "crafted/agent_state/workbenches/w/.build/out.js": strToU8("built\n"),
        "crafted/agent_state/workbenches/w/.harness/types.d.ts": strToU8("types\n"),
        "crafted/agent_state/workbenches/w/node_modules/dep/index.js": strToU8("dep\n"),
        "crafted/agent_state/workbenches/w/.plugin.json": strToU8("{}"),
        "crafted/agent_state/memory/user/planted.md": strToU8("not imported\n"),
      },
      { manifest: { parts: { ...PARTS_ALL, memory: false } } },
    );

    const res = await member.upload(importUrl("?agentId=filtered"), zip);

    expect(res.status, await res.clone().text()).toBe(201);
    const state = agentStateDir(t.root, projectId, "filtered");
    const landed = (await fs.readdir(state, { recursive: true })).map((n) =>
      String(n).replaceAll("\\", "/"),
    );
    expect(landed).toContain("workbenches/w/package.json");
    expect(landed).toContain("skills/s/SKILL.md");
    expect(
      landed.filter((n) =>
        /\.git|vault\.toml|penguin-tmp|\.build|\.harness|node_modules|\.plugin\.json|planted/i.test(
          n,
        ),
      ),
    ).toEqual([]);
  });

  it("an overwrite that brings schedules and workbenches without their data keeps the Agent's expired schedules and workbench data", async () => {
    await furnishedAgent("schedule_donor");
    const target = await newAgent("schedule_target");
    await write(target, {
      "schedule/expired/kept.toml":
        'prompt = "k"\nenabled = false\nstart_at = "2020-01-01T00:00:00Z"\n',
      "workbenches/todo/package.json": '{"name":"todo","penguin":{"modules":["index.ts"]}}',
      "workbenches/todo/state.json": '{"mine":1}',
    });
    const zip = await exported("schedule_donor", "?schedules=1&workbenchData=0");

    const res = await owner.upload(importUrl("?agentId=schedule_target&overwrite=1"), zip);

    expect(res.status, await res.clone().text()).toBe(201);
    expect(await fs.readFile(path.join(target, "schedule", "daily.toml"), "utf8")).toContain("p");
    expect(
      await fs.readFile(path.join(target, "schedule", "expired", "kept.toml"), "utf8"),
    ).toContain("k");
    expect(await fs.readFile(path.join(target, "workbenches", "todo", "state.json"), "utf8")).toBe(
      '{"mine":1}',
    );
    expect(await fs.readFile(path.join(target, "workbenches", "todo", "index.ts"), "utf8")).toBe(
      "export default {};\n",
    );
  });

  it("a hand-written overwrite keeps the Agent's tools and the MCP credential its definition leaves blank", async () => {
    const target = await newAgent("hand_target");
    await write(target, { "tools/custom.json": "{}\n" });
    await owner.put(`${agentBase("hand_target")}/config`, {
      config: {
        mcpServers: [
          { name: "github", config: { command: "node", env: { GITHUB_TOKEN: "mine" } } },
        ],
      },
    });
    const zip = zipSync({
      "hand/manifest.json": strToU8(
        JSON.stringify({
          format: "penguin-agent-zip/1",
          agentId: "hand",
          definition: {
            mcpServers: [
              { name: "github", config: { command: "node", env: { GITHUB_TOKEN: "" } } },
            ],
          },
        }),
      ),
    });

    const res = await owner.upload(importUrl("?agentId=hand_target&overwrite=1"), zip);

    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as AgentArchiveImportResponse;
    expect(body.toFill).not.toContain("mcp:github:env:GITHUB_TOKEN");
    const config = (await (
      await owner.get(`${agentBase("hand_target")}/config`)
    ).json()) as AgentConfigResponse;
    expect(config.config.mcpServers[0]!.config).toMatchObject({ env: { GITHUB_TOKEN: "mine" } });
    expect(await fs.readFile(path.join(target, "tools", "custom.json"), "utf8")).toBe("{}\n");
  });

  it("an overwrite makes the Agent's cached runtime rebuild at its next use", async () => {
    await newAgent("runtime_agent");
    const sid = uniqueSessionId();
    t.deps.sessionsRepo.insert(
      sessionRow(sid, { projectId, agentId: "runtime_agent", workspace: t.root }),
    );
    const idle = () => t.deps.manager.statusOf(sid) === "idle";
    loads = 0;
    await t.deps.manager.startTask(sid, [userText("a")]);
    await waitFor(idle);
    await t.deps.manager.startTask(sid, [userText("b")]);
    await waitFor(idle);
    expect(loads).toBe(1);
    const zip = await exported("runtime_agent");

    const res = await owner.upload(importUrl("?agentId=runtime_agent&overwrite=1"), zip);
    expect(res.status, await res.clone().text()).toBe(201);
    await t.deps.manager.startTask(sid, [userText("c")]);
    await waitFor(idle);

    expect(loads).toBe(2);
  });

  it("a name that only contains a credential word is no credential's, and an aliased credential is blanked", async () => {
    const state = await newAgent("matcher_agent");
    // Written by hand: an `env` block reached through a YAML alias, as a person may write one.
    await fs.writeFile(
      path.join(state, "system_config.yaml"),
      [
        'system_prompt: "hi"',
        "version: 1",
        "x-shared-env: &shared",
        "  GITHUB_TOKEN: ghp_alias_secret_1",
        '  MAX_TOKENS: "4096"',
        "tools:",
        "  mcpServers:",
        "    - name: tuned",
        "      config:",
        "        command: node",
        '        args: ["server.js", "--max-tokens", "4096", "--keyword=penguin"]',
        "        env: *shared",
        "    - name: search",
        "      config:",
        '        url: "https://search.example.test/mcp?keyword=penguin&apiKey=sk-query-1"',
        "",
      ].join("\n"),
    );

    const entries = entriesOf(await exported("matcher_agent"));

    const manifest = JSON.parse(strFromU8(entries["manifest.json"]!)) as AgentArchiveManifest;
    expect([...manifest.redacted].sort()).toEqual(
      ["mcp:search:url:query:apiKey", "mcp:tuned:env:GITHUB_TOKEN"].sort(),
    );
    const exportedConfig = strFromU8(entries["agent_state/system_config.yaml"]!);
    expect(exportedConfig).not.toContain("ghp_alias_secret_1");
    expect(exportedConfig).not.toContain("sk-query-1");
    for (const kept of ["--max-tokens", "4096", "--keyword=penguin", "keyword=penguin"]) {
      expect(exportedConfig).toContain(kept);
    }
  });

  it("a credential is refilled only for the same server and the same flag: never to another address, never into another flag", async () => {
    const state = await newAgent("refill_agent");
    const put = await owner.put(`${agentBase("refill_agent")}/config`, {
      config: {
        mcpServers: [
          {
            name: "gh",
            config: {
              url: "https://real.example.test/mcp",
              headers: { Authorization: "Bearer REAL-TOKEN-1234" },
            },
          },
          {
            name: "db",
            config: {
              command: "dbtool",
              args: ["--api-key", "KEY-VALUE-1", "--password", "PASS-VALUE-1"],
            },
          },
        ],
      },
    });
    expect(put.status, await put.clone().text()).toBe(200);
    const zip = crafted({
      "crafted/agent_state/system_config.yaml": strToU8(
        [
          'system_prompt: "hi"',
          "version: 2",
          "tools:",
          "  mcpServers:",
          "    - name: gh",
          "      config:",
          "        url: https://collector.example.test/mcp",
          '        headers: { Authorization: "" }',
          "    - name: db",
          "      config:",
          "        command: dbtool",
          '        args: ["--password", "", "--api-key", ""]',
          "",
        ].join("\n"),
      ),
    });

    const res = await owner.upload(importUrl("?agentId=refill_agent&overwrite=1"), zip);

    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as AgentArchiveImportResponse;
    expect(body.toFill).toContain("mcp:gh:headers:Authorization");
    const config = parseYaml(await fs.readFile(path.join(state, "system_config.yaml"), "utf8")) as {
      tools: { mcpServers: Array<{ name: string; config: Record<string, unknown> }> };
    };
    const [gh, db] = config.tools.mcpServers;
    expect(gh!.config).toMatchObject({
      url: "https://collector.example.test/mcp",
      headers: { Authorization: "" },
    });
    expect(db!.config.args).toEqual(["--password", "PASS-VALUE-1", "--api-key", "KEY-VALUE-1"]);
  });

  it("a selection past the import's entry cap is refused, and the preview says why", async () => {
    await furnishedAgent("many_entries");
    const deps = {
      root: t.root,
      now: () => NOW,
      traceIndex: t.deps.traceIndex,
      traceStore: t.deps.tree.api<TraceIndexStore>("TracesModule", "TraceIndexStore"),
      traces: t.deps.traceService,
      sessionsRepo: t.deps.sessionsRepo,
      caps: { entries: 5 },
    };

    const plan = await planArchive(deps, projectId, "many_entries", PARTS_ALL as AgentArchiveParts);

    expect(plan.preview.entries).toBeGreaterThan(5);
    expect(plan.preview.refusal).toEqual({ reason: "entries", limit: 5 });
  });

  it("an Agent whose config does not parse is not exported, with a clear code", async () => {
    const state = await newAgent("broken_config");
    await fs.writeFile(
      path.join(state, "system_config.yaml"),
      'system_prompt: "a"\nsystem_prompt: "b"\n',
    );

    const res = await member.get(`${agentBase("broken_config")}/archive`);

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_config");
  });
});
