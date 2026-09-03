/**
 * Agent porting: the bundle export carries the definition, the guide, the endpoint sheet,
 * the three examples and every installed skill and hook directory, with no vault value in
 * it; importing that bundle into a fresh Project recreates the Agent (instructions, skills,
 * hooks, MCP entries with their secrets blanked, tool selection); a bare penguin-agent.json
 * imports too; an id override renames; a taken id is 409 agent_exists and leaves nothing
 * behind; malformed input is 400.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentStateDir } from "@prismshadow/penguin-core";
import type {
  AgentBundleImportResponse,
  AgentConfigResponse,
  AgentHooksResponse,
  AgentSkillsResponse,
  AgentsResponse,
  PortableAgentDefinition,
  ProjectCreateResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const BUNDLE_DOCS = [
  "penguin-agent.json",
  "README.md",
  "api/ENDPOINTS.md",
  "examples/curl.sh",
  "examples/client.py",
  "examples/client.ts",
];

/**
 * Rewrites the uncompressed size an entry declares, in the central directory record fflate
 * reads and in the local header beside it. A zip's size fields are self-reported — nothing in
 * the archive has to agree with them, and fflate believes the central directory.
 */
function declareUncompressedSize(zip: Uint8Array, entry: string, size: number): Uint8Array {
  const out = Buffer.from(zip);
  const name = Buffer.from(entry, "utf8");
  for (let i = 0; i + 46 <= out.length; i++) {
    if (out.readUInt32LE(i) !== 0x02014b50) continue; // central directory header
    if (!out.subarray(i + 46, i + 46 + out.readUInt16LE(i + 28)).equals(name)) continue;
    out.writeUInt32LE(size, i + 24);
    const local = out.readUInt32LE(i + 42);
    if (out.readUInt32LE(local) === 0x04034b50) out.writeUInt32LE(size, local + 22);
    return new Uint8Array(out);
  }
  throw new Error(`no central directory record for ${entry}`);
}

describe("agent porting", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let projectId: string;
  let base: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-port", name: "Porting project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    base = `/api/projects/${projectId}/agents`;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  /** A tuned source Agent: instructions, a vault key, an MCP Server with a secret, a library plugin (skills + a hook package), a trimmed toolset. */
  async function seedSource(): Promise<void> {
    expect(
      (
        await owner.post(base, {
          agentId: "researcher",
          name: "Researcher",
          description: "Finds things out",
          plugins: ["goal", "skill-porting"],
        })
      ).status,
    ).toBe(201);
    const url = `${base}/researcher`;
    const view = (await (await owner.get(`${url}/config`)).json()) as AgentConfigResponse;
    expect(
      (
        await owner.put(`${url}/config`, {
          agentsMd: "# Researcher\nAlways cite sources.\n",
          config: {
            model: { thinkingLevel: "high" },
            toolsBuiltin: view.config.toolsBuiltin.slice(0, 2),
            mcpServers: [
              {
                name: "search",
                config: {
                  transport: "http",
                  url: "https://mcp.example.com/",
                  headers: { Authorization: "Bearer topsecret", "X-Region": "eu" },
                },
              },
            ],
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (await owner.put(`${url}/vault`, { entries: [{ key: "SEARCH_API_KEY", value: "s3cret" }] }))
        .status,
    ).toBe(200);
  }

  it("exports a bundle any member can download, with every document and directory and no secret", async () => {
    await seedSource();
    const res = await member.get(`${base}/researcher/bundle`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("researcher-export.zip");
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(entries).filter((n) => !n.endsWith("/"));
    for (const doc of BUNDLE_DOCS) expect(names).toContain(doc);
    expect(names).toContain("skills/skill-porting/SKILL.md");
    expect(names).toContain("hooks/goal/hooks.json");
    expect(names).toContain("hooks/goal/stop.mjs");

    const definition = JSON.parse(
      strFromU8(entries["penguin-agent.json"]!),
    ) as PortableAgentDefinition;
    expect(definition.format).toBe("penguin-agent/1");
    expect(definition.id).toBe("researcher");
    expect(definition.name).toBe("Researcher");
    expect(definition.description).toBe("Finds things out");
    expect(definition.prompt).toBe("# Researcher\nAlways cite sources.\n");
    expect(definition.skills.map((s) => s.name)).toEqual(["skill-porting"]);
    expect(definition.hooks.map((h) => h.name)).toEqual(["goal"]);
    expect(definition.tools?.builtin).toHaveLength(2);
    expect(definition.model?.thinkingLevel).toBe("high");
    expect(definition.vaultKeys).toEqual(["SEARCH_API_KEY"]);
    expect(definition.source).toEqual({ projectId, agentId: "researcher", version: 1 });
    // Credential-looking header values are blanked, the others kept; the vault value is nowhere.
    const headers = (definition.mcpServers?.[0]?.config as { headers: Record<string, string> })
      .headers;
    expect(headers).toEqual({ Authorization: "", "X-Region": "eu" });
    for (const [name, data] of Object.entries(entries)) {
      expect(strFromU8(data).includes("s3cret"), name).toBe(false);
      expect(strFromU8(data).includes("topsecret"), name).toBe(false);
    }
    // The guide is written for this Agent: ids filled in, the CLI line and the four calls present.
    const readme = strFromU8(entries["README.md"]!);
    expect(readme).toContain(`--agent-id researcher --project-id ${projectId}`);
    expect(readme).toContain(`/api/projects/${projectId}/agents/researcher/sessions`);
    expect(readme).toContain("SEARCH_API_KEY");
    expect(readme).toContain("`skill-porting`");
    expect(strFromU8(entries["examples/client.py"]!)).toContain(`PROJECT_ID = "${projectId}"`);
  });

  it("round-trips: the bundle imports into a fresh Project as the same Agent, then 409s on the taken id", async () => {
    await seedSource();
    const bundle = Buffer.from(await (await owner.get(`${base}/researcher/bundle`)).arrayBuffer());
    const other = (await (
      await owner.post("/api/projects", { projectId: "owner_a-target", name: "Target" })
    ).json()) as ProjectCreateResponse;
    const target = `/api/projects/${other.project.projectId}/agents`;

    const res = await owner.post(`${target}/import`, { dataBase64: bundle.toString("base64") });
    expect(res.status).toBe(201);
    const out = (await res.json()) as AgentBundleImportResponse;
    expect(out.agent.agentId).toBe("researcher");
    expect(out.agent.name).toBe("Researcher");
    expect(out.agent.description).toBe("Finds things out");
    expect(out.agent.skillCount).toBe(1);
    expect(out.agent.hookCount).toBe(1);
    expect(out.installed).toEqual({ skills: ["skill-porting"], hooks: ["goal"] });
    expect(out.skipped).toEqual([]);
    expect(out.vaultKeys).toEqual(["SEARCH_API_KEY"]);

    const view = (await (
      await owner.get(`${target}/researcher/config`)
    ).json()) as AgentConfigResponse;
    expect(view.agentsMd).toBe("# Researcher\nAlways cite sources.\n");
    expect(view.config.model?.thinkingLevel).toBe("high");
    expect(view.config.toolsBuiltin).toHaveLength(2);
    expect(view.config.mcpServers.map((m) => m.name)).toEqual(["search"]);
    const skills = (await (
      await owner.get(`${target}/researcher/skills`)
    ).json()) as AgentSkillsResponse;
    expect(skills.skills.map((s) => s.name)).toEqual(["skill-porting"]);
    const hooks = (await (
      await owner.get(`${target}/researcher/hooks`)
    ).json()) as AgentHooksResponse;
    expect(hooks.hooks.map((h) => h.name)).toEqual(["goal"]);
    // The vault stays empty: values never travel.
    await expect(
      fs.access(
        path.join(agentStateDir(t.root, other.project.projectId, "researcher"), ".vault.toml"),
      ),
    ).rejects.toThrow();

    // The id is taken now; the override gives the same bundle a new home.
    const dup = await owner.post(`${target}/import`, { dataBase64: bundle.toString("base64") });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: { code: string } }).error.code).toBe("agent_exists");
    const renamed = await owner.post(`${target}/import`, {
      dataBase64: bundle.toString("base64"),
      agentId: "researcher_2",
    });
    expect(renamed.status).toBe(201);
    expect(((await renamed.json()) as AgentBundleImportResponse).agent.agentId).toBe(
      "researcher_2",
    );
  });

  it("a bare penguin-agent.json imports (any member), with unknown tools and missing skills reported, not fatal", async () => {
    const definition = {
      format: "penguin-agent/1",
      id: "greeter",
      name: "Greeter",
      prompt: "# Greeter\nGreet warmly.\n",
      skills: [{ name: "not-in-bundle" }],
      hooks: [],
      tools: { builtin: ["exec_command", "no_such_tool"] },
      vaultKeys: ["GREETING_KEY"],
    };
    const res = await member.post(`${base}/import`, {
      dataBase64: Buffer.from(JSON.stringify(definition)).toString("base64"),
    });
    expect(res.status).toBe(201);
    const out = (await res.json()) as AgentBundleImportResponse;
    expect(out.agent.agentId).toBe("greeter");
    expect(out.installed).toEqual({ skills: [], hooks: [] });
    expect(out.skipped).toHaveLength(2);
    expect(out.skipped.join("\n")).toContain("no_such_tool");
    expect(out.skipped.join("\n")).toContain("not-in-bundle");
    expect(out.vaultKeys).toEqual(["GREETING_KEY"]);
    const view = (await (await owner.get(`${base}/greeter/config`)).json()) as AgentConfigResponse;
    expect(view.agentsMd).toBe("# Greeter\nGreet warmly.\n");
    expect(view.config.toolsBuiltin.map((tool) => tool.name)).toEqual(["exec_command"]);
  });

  it("rejects junk, a foreign format and a bad id, leaving no Agent behind", async () => {
    const post = (payload: Buffer | string, agentId?: string) =>
      owner.post(`${base}/import`, {
        dataBase64: Buffer.from(payload).toString("base64"),
        ...(agentId !== undefined ? { agentId } : {}),
      });
    expect((await post("junk")).status).toBe(400);
    expect((await post(JSON.stringify({ format: "other/9", id: "x" }))).status).toBe(400);
    // A zip with no definition in it.
    expect((await post(Buffer.from(zipSync({ "README.md": strToU8("hi") })))).status).toBe(400);
    // A definition whose id breaks the semantic-id rule, unless overridden.
    const hyphenated = JSON.stringify({ format: "penguin-agent/1", id: "my-agent", prompt: "x" });
    expect((await post(hyphenated)).status).toBe(400);
    expect((await post(hyphenated, "my_agent")).status).toBe(201);
    // A bundled skill without a SKILL.md fails before the Agent exists.
    const broken = zipSync({
      "penguin-agent.json": strToU8(JSON.stringify({ format: "penguin-agent/1", id: "broken" })),
      "skills/thing/notes.md": strToU8("no SKILL.md here"),
    });
    expect((await post(Buffer.from(broken))).status).toBe(400);
    const list = (await (await owner.get(base)).json()) as AgentsResponse;
    expect(list.agents.map((a) => a.agentId)).not.toContain("broken");
    expect(list.agents.map((a) => a.agentId)).toContain("my_agent");
  });

  it("refuses a zip bomb from its headers, without inflating it", async () => {
    // 30MB of zeros deflates to a few KB, so this passes the request's 14MB cap; the entry sits
    // outside skills/ and hooks/, where the per-directory budgets never look, so the only thing
    // between it and 30MB of heap is the declared-size check on the way in.
    const bomb = zipSync({
      "penguin-agent.json": strToU8(JSON.stringify({ format: "penguin-agent/1", id: "bomb" })),
      "payload.bin": new Uint8Array(30 * 1024 * 1024),
    });
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    const res = await owner.post(`${base}/import`, {
      dataBase64: Buffer.from(bomb).toString("base64"),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bundle_too_large");
    const list = (await (await owner.get(base)).json()) as AgentsResponse;
    expect(list.agents.map((a) => a.agentId)).not.toContain("bomb");
  });

  it("refuses an entry that lies about its size, which no later check can catch", async () => {
    // fflate allocates the declared uncompressed size up front and then hands back a view as
    // long as what actually inflated: 5 bytes declaring 512MB costs 512MB of heap and still
    // measures 5 bytes afterwards, so every cap applied to decoded bytes waves it through
    // (before the filter this archive imported, 201, and created the Agent). Only the central
    // directory's own number gives it away — which is why this one is under a kilobyte and
    // must still be refused.
    const bomb = declareUncompressedSize(
      zipSync({
        "penguin-agent.json": strToU8(JSON.stringify({ format: "penguin-agent/1", id: "liar" })),
        "payload.bin": strToU8("hello"),
      }),
      "payload.bin",
      512 * 1024 * 1024,
    );
    expect(bomb.byteLength).toBeLessThan(1024);
    const res = await owner.post(`${base}/import`, {
      dataBase64: Buffer.from(bomb).toString("base64"),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("bundle_too_large");
    // The per-file branch names the entry, so the refusal came off that declaration and not
    // off some total measured later.
    expect(body.error.message).toContain("payload.bin");
    const list = (await (await owner.get(base)).json()) as AgentsResponse;
    expect(list.agents.map((a) => a.agentId)).not.toContain("liar");
  });
});
