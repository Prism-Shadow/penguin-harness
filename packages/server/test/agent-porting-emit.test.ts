/**
 * The agent-porting Skill's port folder, built the way the Skill builds it, imports here.
 *
 * - Given a Claude Code `.mcp.json` whose servers hold credentials, a manifest the agent wrote
 *   and instructions it appended, the folder `inspect-config.mjs --emit` leaves imports as a new
 *   Agent: its MCP servers carry the source's command, arguments and plain values exactly and a
 *   Vault reference for each credential, the import asks for those Vault keys, and the
 *   instructions are the Agent's. No credential of the source reaches the Agent's configuration.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import type { Zippable } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AgentArchiveImportResponse,
  AgentConfigResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../../plugins/skill-porting/skills/agent-porting/scripts/inspect-config.mjs",
);
const planted = (n: number) => `planted-secret-value-${n}`;

/** A folder's files as zip entries under one top-level directory, as the CLI zips a folder. */
async function zipFolder(root: string, top: string): Promise<Uint8Array> {
  const files: Zippable = {};
  const walk = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else
        files[`${top}/${path.relative(root, full).split(path.sep).join("/")}`] =
          await fs.readFile(full);
    }
  };
  await walk(root);
  return zipSync(files);
}

describe("a port folder built with --emit", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  let work: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "owner_p")).cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_p-port", name: "Port project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    work = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-port-"));
  });
  afterAll(async () => {
    await t?.cleanup();
    if (work) await fs.rm(work, { recursive: true, force: true });
  });

  it("imports as an Agent whose servers hold the source's values and a Vault reference per credential", async () => {
    const source = path.join(work, "repo");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(
      path.join(source, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "example-github-mcp", "--token", planted(1)],
            env: { GITHUB_TOKEN: planted(2), REGION: "eu" },
          },
          docs: {
            type: "http",
            url: "https://mcp.example.com/mcp",
            headers: { "X-Api-Key": planted(3) },
          },
        },
      }),
    );
    await fs.writeFile(path.join(source, "CLAUDE.md"), "Answer in English.\n");
    const port = path.join(work, "port", "ported_agent");
    await fs.mkdir(port, { recursive: true });
    await fs.writeFile(
      path.join(port, "manifest.json"),
      JSON.stringify({
        format: "penguin-agent-zip/1",
        exportedAt: "2026-11-05T09:00:00Z",
        agentId: "ported_agent",
        name: "Ported",
        parts: {
          skills: false,
          hooks: false,
          memory: false,
          workbenches: false,
          workbenchData: false,
          schedules: false,
          traces: { kind: "none" },
        },
        vaultKeys: [],
        redacted: [],
        definition: {},
      }),
    );
    const steps = [
      ["--emit", path.join(source, ".mcp.json"), "--framework", "claude-code", "--out", port],
      [
        "--append",
        path.join(source, "CLAUDE.md"),
        "--to",
        path.join(port, "agent_state", "AGENTS.md"),
      ],
    ];
    for (const step of steps) {
      const run = spawnSync(process.execPath, [SCRIPT, ...step], { encoding: "utf8" });
      expect(run.status, run.stdout + run.stderr).toBe(0);
      for (const n of [1, 2, 3]) expect(run.stdout + run.stderr).not.toContain(planted(n));
    }

    const res = await owner.upload(
      `/api/projects/${projectId}/agents/import`,
      await zipFolder(port, "ported_agent"),
    );

    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as AgentArchiveImportResponse;
    expect(body.mode).toBe("created");
    expect([...body.toFill].sort()).toEqual(["DOCS_X_API_KEY", "GITHUB_TOKEN"]);
    const config = (await (
      await owner.get(`/api/projects/${projectId}/agents/ported_agent/config`)
    ).json()) as AgentConfigResponse;
    expect(config.agentsMd).toBe("Answer in English.\n");
    const servers = Object.fromEntries(config.config.mcpServers.map((s) => [s.name, s.config]));
    expect(servers.github).toMatchObject({
      command: "npx",
      args: ["-y", "example-github-mcp", "--token", "${GITHUB_TOKEN}"],
      env: { GITHUB_TOKEN: "${GITHUB_TOKEN}", REGION: "eu" },
    });
    expect(servers.docs).toMatchObject({
      url: "https://mcp.example.com/mcp",
      headers: { "X-Api-Key": "${DOCS_X_API_KEY}" },
    });
    expect(JSON.stringify(config)).not.toMatch(/planted-secret-value/);
  });
});
