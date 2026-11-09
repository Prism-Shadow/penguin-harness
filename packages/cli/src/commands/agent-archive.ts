/**
 * `penguin agent export|import` — an Agent as a zip of its directory, through the routes the
 * Agents page uses.
 *
 *   penguin agent export <agent-id> [--out <file>] [--no-skills] [--no-hooks] [--no-memory]
 *       [--no-workbenches] [--no-workbench-data] [--schedules]
 *       [--traces none|last:<N>|<from>..<to>] [--project-id <id>] [--json] [--server <url>]
 *   penguin agent import <file.zip|file.tar.gz|directory> [--agent-id <id>] [--overwrite]
 *       [--project-id <id>] [--json] [--server <url>]
 *
 * The export's defaults are the dialog's: every part but schedules, and no Traces; the file is
 * named as the server names it unless `--out` says otherwise. A directory to import is an Agent's
 * directory (`agent_state/`, and `traces/` if any) and is zipped here under its own name, which is
 * the id when `--agent-id` gives none: this is how an Agent that ported another framework's setup
 * hands it over. A taken id is refused with the way to overwrite it, which is the owner's.
 * Docs: /docs/cli § "penguin agent".
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import type {
  AgentArchiveImportResponse,
  AgentArchiveQuery,
} from "@prismshadow/penguin-server/api";
import { ApiError, resolveConnection, resolveProjectId, ServerClient } from "../client.js";
import { zipFolder } from "../zip-folder.js";
import type { Messages } from "../i18n.js";

/** The server's caps on an Agent package (its services/agent-zip.ts). */
const AGENT_CAPS = {
  files: 20_000,
  fileBytes: 512 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  zipBytes: 64 * 1024 * 1024,
  leftOut: new Set(["node_modules", ".git"]),
};

const agentsPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/agents`;
const bit = (on: unknown): "0" | "1" => (on === false || on === undefined ? "0" : "1");

export function registerAgentArchiveCommands(agent: Command, t: Messages): void {
  agent
    .command("export <agent-id>")
    .description(t.agent.exportDesc)
    .option("--out <file>", t.agent.exportOut)
    .option("--no-skills", t.agent.exportNoSkills)
    .option("--no-hooks", t.agent.exportNoHooks)
    .option("--no-memory", t.agent.exportNoMemory)
    .option("--no-workbenches", t.agent.exportNoWorkbenches)
    .option("--no-workbench-data", t.agent.exportNoWorkbenchData)
    .option("--schedules", t.agent.exportSchedules)
    .option("--traces <which>", t.agent.exportTraces, "none")
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (agentId: string, opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const query = {
        skills: bit(opts.skills),
        hooks: bit(opts.hooks),
        memory: bit(opts.memory),
        workbenches: bit(opts.workbenches),
        workbenchData: bit(opts.workbenchData),
        schedules: bit(opts.schedules),
        traces: String(opts.traces) as NonNullable<AgentArchiveQuery["traces"]>,
      } satisfies Required<AgentArchiveQuery>;
      const res = await client.raw(
        "GET",
        `${agentsPath(resolveProjectId(opts.projectId))}/${encodeURIComponent(agentId)}/archive?${new URLSearchParams(query)}`,
      );
      const named = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1];
      const file = path.resolve(opts.out ?? named ?? `${agentId}.zip`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      fs.writeFileSync(file, bytes);
      process.stdout.write(
        opts.json === true
          ? `${JSON.stringify({ agentId, file, bytes: bytes.byteLength })}\n`
          : `${t.agent.exported(agentId, file)}\n`,
      );
    });

  agent
    .command("import <source>")
    .description(t.agent.importDesc)
    .option("--agent-id <id>", t.agent.importAgentId)
    .option("--overwrite", t.agent.importOverwrite)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (source: string, opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const target = path.resolve(source.replace(/^~(?=$|\/)/, os.homedir()));
      let bytes: Uint8Array | null;
      try {
        bytes = fs.statSync(target).isDirectory()
          ? (zipFolder(target, path.basename(target), AGENT_CAPS)?.zip ?? null)
          : fs.readFileSync(target);
      } catch {
        throw new Error(t.agent.importUnreadable(target));
      }
      if (bytes === null) throw new Error(t.agent.importTooLarge(target));
      const query = new URLSearchParams({
        ...(opts.agentId !== undefined ? { agentId: String(opts.agentId) } : {}),
        ...(opts.overwrite === true ? { overwrite: "1" } : {}),
      });
      let res: AgentArchiveImportResponse;
      try {
        const answer = await client.raw("POST", `${agentsPath(projectId)}/import?${query}`, bytes);
        res = (await answer.json()) as AgentArchiveImportResponse;
      } catch (err) {
        if (err instanceof ApiError && err.code === "agent_exists") {
          throw new Error(`${err.message}\n${t.agent.importOverwriteHint()}`);
        }
        throw err;
      }
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(res)}\n`);
        return;
      }
      const { agent: imported, mode, version, sessions } = res;
      process.stdout.write(
        `${t.agent.imported(mode, imported.agentId, projectId, version, sessions.imported)}\n`,
      );
      if (res.backup !== undefined) process.stdout.write(`${t.agent.importBackup(res.backup)}\n`);
      if (res.sessions.skipped.length > 0) {
        process.stdout.write(`${t.agent.importSkipped(res.sessions.skipped)}\n`);
      }
    });
}
