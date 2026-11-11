/**
 * An Agent exported and imported as a zip of its directory.
 *
 * - The default export carries the State without its schedules, vault, workbench build output
 *   or git entries, and without Traces.
 * - `traces=last:N` takes the N latest Sessions and the subagent Sessions they started; a date
 *   range takes the Sessions in those date folders; a vault value in a Trace travels as its key.
 * - An export with its Traces imports under a new id with its parts, version and Sessions, listed
 *   with their titles; imported again, the Sessions this install now has are skipped and reported.
 * - Over a taken id, an import is 409 `agent_exists` naming it and writes nothing; a member's
 *   overwrite is 403; the owner's backs the State up, replaces it, and keeps the vault, the Traces
 *   and the API keys.
 * - A zip that leaves its folder, holds a link, unpacks past the cap or has no config is a 400 that
 *   writes nothing, and its id stays free; an upload past the package cap is a 413 unread.
 * - A config without `system_prompt` is laid over the template's, and refused as a config write
 *   would be.
 * - A tar.gz snapshot package imports as a new Agent and over one.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Zippable } from "fflate";
import * as tar from "tar";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agentDir,
  agentStateDir,
  agentVaultPath,
  defaultSystemConfig,
  snapshotsDir,
  tracesDir,
} from "@prismshadow/penguin-core";
import type {
  AgentApiKeyCreateResponse,
  AgentApiResponse,
  AgentArchiveImportResponse,
  AgentConfigResponse,
  ProjectCreateResponse,
  SessionsResponse,
} from "../src/api/types.js";
import { MAX_PACKAGE_BYTES } from "../src/services/agent-zip.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SECRET = "vault-secret-0123";
const CONFIG = 'system_prompt: "imported"\nversion: 2\n';
const P1 = "session-2026-01-10-09-00-00-aaaa0001";
const P2 = "session-2026-02-10-09-00-00-aaaa0002";
const CHILD = "session-2026-02-10-09-05-00-aaaa0003";

/** One Trace file: its session_meta, a user prompt and any further events. */
function trace(sessionId: string, source: string, prompt: string, ...events: object[]): string {
  const meta = {
    session_id: sessionId,
    provider: "custom",
    model_id: "m",
    model_context_window: 1000,
    system_prompt: "",
    agent_state: "/a",
    workspace: "/w",
    source,
  };
  const records = [
    { type: "session_meta", payload: meta },
    { type: "model_msg", payload: { type: "text", role: "user", text: prompt } },
    ...events.map((payload) => ({ type: "event_msg", payload })),
  ];
  const at = "2026-01-01T00:00:00.000Z";
  return records.map((r) => JSON.stringify({ timestamp: at, ...r })).join("\n") + "\n";
}

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

const zip = (files: Record<string, string>, extra: Zippable = {}): Uint8Array =>
  zipSync({
    ...Object.fromEntries(Object.entries(files).map(([n, v]) => [n, strToU8(v)])),
    ...extra,
  });
const names = (bytes: Uint8Array): string[] => Object.keys(unzipSync(bytes));
const traceIds = (bytes: Uint8Array): string[] =>
  names(bytes)
    .filter((n) => n.includes("/traces/"))
    .map((n) => path.basename(n, "_001.jsonl"))
    .sort();

/** `bytes` with every central-directory entry declaring `size` uncompressed bytes. */
function declaring(bytes: Uint8Array, size: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 28 <= bytes.byteLength; i++) {
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, size, true);
  }
  return bytes;
}

describe("Agent zip export and import", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let memberCookie: string;
  let P: string;
  let agents: string;

  const exportOf = async (agentId: string, query = ""): Promise<Uint8Array> => {
    const res = await member.get(`${agents}/${agentId}/archive${query}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return new Uint8Array(await res.arrayBuffer());
  };
  const importAs = (client: typeof owner, bytes: Uint8Array, query = "") =>
    client.upload(`${agents}/import${query}`, bytes);
  const stateOf = (agentId: string, rel: string) =>
    path.join(agentStateDir(t.root, P, agentId), rel);

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "owner_z")).cookie);
    memberCookie = (await provisionUser(t.app, "member_z")).cookie;
    member = apiClient(t.app, memberCookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_z-zip", name: "Zip" })
    ).json()) as ProjectCreateResponse;
    P = created.project.projectId;
    agents = `/api/projects/${P}/agents`;
    expect((await owner.post(`/api/projects/${P}/members`, { userId: "member_z" })).status).toBe(
      201,
    );
    expect((await owner.post(agents, { agentId: "source" })).status).toBe(201);
    const put = await owner.put(`${agents}/source/vault`, {
      entries: [{ key: "TOKEN", value: SECRET }],
    });
    expect(put.status).toBe(200);
    const config = stateOf("source", "system_config.yaml");
    await fs.writeFile(
      config,
      (await fs.readFile(config, "utf8")).replace(/^version: .*$/m, "version: 3"),
    );
    for (const rel of [
      "skills/demo/SKILL.md",
      "skills/demo/.git/config",
      "hooks/pkg/hooks.json",
      "memory/user/notes.md",
      "workbenches/desk/package.json",
      "workbenches/desk/state.json",
      "workbenches/desk/.build/out.js",
      "schedule/daily.toml",
    ]) {
      await write(stateOf("source", rel), "{}\n");
    }
    const traces = tracesDir(t.root, P, "source");
    await write(
      path.join(traces, "2026-01-10", `${P1}_001.jsonl`),
      trace(P1, "user", "first task"),
    );
    await write(
      path.join(traces, "2026-02-10", `${P2}_001.jsonl`),
      trace(P2, "user", `second task with ${SECRET}`, { type: "subagent", session_id: CHILD }),
    );
    await write(
      path.join(traces, "2026-02-10", `${CHILD}_001.jsonl`),
      trace(CHILD, "subagent", "help"),
    );
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("the default export carries the State without schedules, vault, build output, git entries or Traces", async () => {
    const res = await member.get(`${agents}/source/archive`);
    expect(res.headers.get("content-disposition")).toMatch(/filename="source-\d{8}\.zip"/);
    const entries = names(new Uint8Array(await res.arrayBuffer()));
    expect(entries).toEqual(
      expect.arrayContaining([
        "source/agent_state/system_config.yaml",
        "source/agent_state/skills/demo/SKILL.md",
        "source/agent_state/workbenches/desk/state.json",
      ]),
    );
    expect(
      entries.filter((e) => /\/schedule\/|\.vault\.toml|\/\.build\/|\/\.git\/|\/traces\//.test(e)),
    ).toEqual([]);
  });

  it("last:N takes the latest Sessions with their subagents, a range its date folders, and a vault value travels as its key", async () => {
    const last = await exportOf("source", "?traces=last:1");
    expect(traceIds(last)).toEqual([P2, CHILD].sort());
    expect(traceIds(await exportOf("source", "?traces=2026-01-01..2026-01-31"))).toEqual([P1]);
    const text = strFromU8(unzipSync(last)[`source/traces/2026-02-10/${P2}_001.jsonl`]!);
    expect(text).toContain("[vault:TOKEN]");
    expect(text).not.toContain(SECRET);
  });

  it("an export with its Traces imports under a new id with its parts and Sessions; imported again, the Sessions are skipped", async () => {
    const pkg = await exportOf("source", "?traces=last:5&schedules=1");

    const res = await importAs(member, pkg, "?agentId=copy");

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      agent: { agentId: "copy" },
      mode: "created",
      version: 3,
      sessions: { imported: 3, skipped: [] },
    } satisfies Partial<AgentArchiveImportResponse>);
    for (const rel of ["skills/demo/SKILL.md", "hooks/pkg/hooks.json", "memory/user/notes.md"]) {
      await expect(fs.readFile(stateOf("copy", rel), "utf8")).resolves.toBe("{}\n");
    }
    await expect(
      fs.access(stateOf("copy", "workbenches/desk/state.json")),
    ).resolves.toBeUndefined();
    await expect(fs.access(stateOf("copy", "schedule/daily.toml"))).resolves.toBeUndefined();
    const listed = (await (await owner.get(`${agents}/copy/sessions`)).json()) as SessionsResponse;
    expect(listed.sessions.map((s) => s.title)).toEqual(
      expect.arrayContaining(["first task", "second task with [vault:TOKEN]"]),
    );

    const again = await importAs(owner, pkg, "?agentId=copy_again");
    const { sessions } = (await again.json()) as AgentArchiveImportResponse;
    expect(sessions.imported).toBe(0);
    expect(sessions.skipped.sort()).toEqual([P1, P2, CHILD].sort());
  });

  describe("over a taken id", () => {
    let pkg: Uint8Array;
    beforeAll(async () => {
      expect((await owner.post(agents, { agentId: "target" })).status).toBe(201);
      await owner.put(`${agents}/target/vault`, { entries: [{ key: "TOKEN", value: "kept" }] });
      await owner.post(`${agents}/target/api/keys`, { name: "ci" });
      await write(stateOf("target", "marker.txt"), "previous State");
      await write(stateOf("target", "memory/user/own.md"), "the target's own memory");
      await write(
        path.join(tracesDir(t.root, P, "target"), "2026-03-01", "kept_001.jsonl"),
        "{}\n",
      );
      pkg = await exportOf("source", "?memory=0");
    });

    it("an import without overwrite is 409 naming the id, and writes nothing", async () => {
      const res = await importAs(member, pkg, "?agentId=target");

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string; details: { agentId: string } } };
      expect(body.error).toMatchObject({ code: "agent_exists", details: { agentId: "target" } });
      await expect(fs.readFile(stateOf("target", "marker.txt"), "utf8")).resolves.toBe(
        "previous State",
      );
      const left = await fs.readdir(agentDir(t.root, P, "target"));
      expect(left.filter((n) => n.startsWith(".import-") || n === "snapshots")).toEqual([]);
    });

    it("a member's overwrite is 403", async () => {
      expect((await importAs(member, pkg, "?agentId=target&overwrite=1")).status).toBe(403);
    });

    it("the owner's overwrite backs the State up, replaces the parts the zip carries, and keeps the vault, Traces, API keys and the parts it left out", async () => {
      const vault = await fs.readFile(agentVaultPath(t.root, P, "target"));

      const res = await importAs(owner, pkg, "?agentId=target&overwrite=1");

      expect(res.status).toBe(201);
      const body = (await res.json()) as AgentArchiveImportResponse;
      expect(body).toMatchObject({ mode: "overwritten", version: 3 });
      const backed: string[] = [];
      await tar.list({
        file: path.join(snapshotsDir(t.root, P, "target"), body.backup!),
        onReadEntry: (entry) => void backed.push(entry.path),
      });
      expect(backed).toContain("agent_state/marker.txt");
      await expect(fs.access(stateOf("target", "marker.txt"))).rejects.toThrow();
      await expect(fs.access(stateOf("target", "skills/demo/SKILL.md"))).resolves.toBeUndefined();
      await expect(fs.readFile(stateOf("target", "memory/user/own.md"), "utf8")).resolves.toBe(
        "the target's own memory",
      );
      expect(await fs.readFile(agentVaultPath(t.root, P, "target"))).toEqual(vault);
      await expect(
        fs.access(path.join(tracesDir(t.root, P, "target"), "2026-03-01", "kept_001.jsonl")),
      ).resolves.toBeUndefined();
      const api = (await (await owner.get(`${agents}/target/api`)).json()) as AgentApiResponse;
      expect(api.api.keys.map((k) => k.name)).toEqual(["ci"]);
    });
  });

  it.each([
    [
      "leaves its folder",
      zip({ "broken/agent_state/system_config.yaml": CONFIG, "broken/../out.txt": "x" }),
    ],
    [
      "holds a link",
      zip(
        { "broken/agent_state/system_config.yaml": CONFIG },
        {
          "broken/agent_state/skills/x": [
            strToU8("/etc"),
            { os: 3, attrs: (0o120777 << 16) >>> 0 },
          ],
        },
      ),
    ],
    [
      "unpacks past the cap",
      declaring(zip({ "broken/agent_state/system_config.yaml": CONFIG }), 0xf0000000),
    ],
    ["has no config", zip({ "broken/agent_state/AGENTS.md": "hi" })],
  ])("a zip that %s is a 400 that writes nothing", async (_why, bytes) => {
    expect((await importAs(member, bytes)).status).toBe(400);
    await expect(fs.access(agentDir(t.root, P, "broken"))).rejects.toThrow();
  });

  it("an upload past the package cap is refused before it is read", async () => {
    const res = await t.app.request(`${agents}/import`, {
      method: "POST",
      headers: {
        cookie: memberCookie,
        "content-type": "application/octet-stream",
        "content-length": String(MAX_PACKAGE_BYTES + 1),
      },
      body: zip({ "big/agent_state/system_config.yaml": CONFIG }),
    });
    expect(res.status).toBe(413);
  });

  it("the id a refused package named stays free", async () => {
    const res = await importAs(member, zip({ "broken/agent_state/system_config.yaml": CONFIG }));
    expect(await res.json()).toMatchObject({ agent: { agentId: "broken" }, mode: "created" });
  });

  it("a config without system_prompt is laid over the template's, its MCP servers taken", async () => {
    const servers = [{ name: "docs", config: { command: "node", args: ["server.js"] } }];
    const yaml = `name: Ported\ntools:\n  mcpServers: ${JSON.stringify(servers)}\n`;

    const res = await importAs(member, zip({ "ported/agent_state/system_config.yaml": yaml }));

    expect(res.status, await res.clone().text()).toBe(201);
    const { config } = (await (
      await owner.get(`${agents}/ported/config`)
    ).json()) as AgentConfigResponse;
    expect(config).toMatchObject({ name: "Ported", mcpServers: servers });
    expect(config.systemPrompt).toBe(defaultSystemConfig().system_prompt);
    expect(config.toolsBuiltin).toEqual(defaultSystemConfig().tools?.builtin);
    const refused = zip({ "refused/agent_state/system_config.yaml": "max_turns: 0\n" });
    expect((await importAs(member, refused)).status).toBe(400);
  });

  it("a tar.gz snapshot package imports as a new Agent, and over one", async () => {
    const src = path.join(t.root, "legacy");
    await write(path.join(src, "agent_state", "system_config.yaml"), CONFIG);
    await tar.create({ gzip: true, cwd: src, file: `${src}.tar.gz` }, ["agent_state"]);
    const pkg = await fs.readFile(`${src}.tar.gz`);

    expect((await importAs(owner, pkg)).status).toBe(400);
    expect(await (await importAs(owner, pkg, "?agentId=legacy")).json()).toMatchObject({
      mode: "created",
      version: 2,
    });
    expect(await (await importAs(owner, pkg, "?agentId=legacy&overwrite=1")).json()).toMatchObject({
      mode: "overwritten",
      version: 2,
    });
  });
});
