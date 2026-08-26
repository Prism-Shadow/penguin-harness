/**
 * `penguin schedule` — list and manage the project's scheduled tasks.
 *
 *   penguin schedule ls [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
 *   penguin schedule add <name> --prompt <s> --start-at <ISO|now> [--period <dur>]
 *                    [--end-at <ISO>] [--session-id <id> | --workspace <path>
 *                    [--model-id <id> --provider <p>]] [--disabled]
 *                    [--project-id] [--agent-id] [--json] [--server]
 *   penguin schedule update <name> [--prompt] [--start-at] [--period] [--end-at]
 *                    [--session-id | --workspace [--model-id --provider]]
 *                    [--enable|--disable] [--project-id] [--agent-id] [--json] [--server]
 *   penguin schedule rm <name> [--project-id] [--agent-id] [--json] [--server]
 *
 * `ls`: schedules live per agent (GET .../agents/:a/schedules); without `--agent-id`
 * the command iterates every agent of the project. Columns: agent, name, enabled,
 * startAt, period, target (bound sessionId or "new session"), lastFiredAt, and a status
 * marker for the non-active states (expired / done / missed / invalid — unparsable
 * files are listed too, marked invalid).
 *
 * `add` / `update` / `rm` map onto the schedules API (POST / PUT / DELETE), which
 * writes the TOML file — the file remains the single source of truth, and the CLI is a
 * validated writer (the same pattern model config and vault follow: updates go through
 * the system interface, validation converges at the interface layer, hand edits stay
 * possible). API errors surface verbatim, so an agent gets synchronous validation
 * instead of the reconcile lag hand-editing hits. The target is `--session-id` XOR the
 * new-session form (`--workspace`, optional `--model-id`+`--provider` pair). One
 * deliberate divergence from the raw file: `add` defaults to ENABLED (adding a task
 * means you want it to run; the raw-file default of enabled=false stays for hand
 * edits) — `--disabled` opts out. `update` is read-modify-write against the stored
 * item: unspecified fields keep their values, `--enable`/`--disable` flip the flag,
 * and switching target kinds clears the other kind's fields. `rm` deletes without
 * prompting (agents drive this; the server's owner authorization still applies).
 * `--start-at now` means the current instant.
 * Docs: /docs/cli § "penguin schedule".
 */
import type { Command } from "commander";
import type { ScheduleItem, SchedulesResponse } from "@prismshadow/penguin-server/api";
import {
  resolveAgentId,
  resolveConnection,
  resolveProjectId,
  ServerClient,
  shortSessionId,
} from "../client.js";
import { listAgents } from "../server-session.js";
import { renderTable } from "../table.js";
import type { Messages } from "../i18n.js";

const enc = encodeURIComponent;

/** `--start-at` value: the literal `now` becomes the current instant; anything else passes through for the server to validate. */
function resolveStartAt(raw: string): string {
  return raw.trim().toLowerCase() === "now" ? new Date().toISOString() : raw;
}

/** One line confirming a written schedule (name, enabled state, next fire when known). */
function writtenLine(t: Messages, item: ScheduleItem): string {
  return t.schedule.written(
    item.name,
    item.enabled ? t.schedule.enabled() : t.schedule.disabled(),
    item.nextFireAt,
  );
}

export function registerScheduleCommand(program: Command, t: Messages): void {
  const schedule = program.command("schedule").description(t.schedule.desc);

  schedule
    .command("ls")
    .description(t.schedule.lsDesc)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const agentIds =
        opts.agentId !== undefined
          ? [resolveAgentId(opts.agentId)]
          : (await listAgents(client, projectId)).map((a) => a.agentId);

      const perAgent = await Promise.all(
        agentIds.map(async (agentId) => ({
          agentId,
          res: await client.request<SchedulesResponse>(
            "GET",
            `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/schedules`,
          ),
        })),
      );

      if (opts.json === true) {
        process.stdout.write(
          `${JSON.stringify(
            perAgent.map(({ agentId, res }) => ({
              agentId,
              schedules: res.schedules,
              invalidFiles: res.invalidFiles,
            })),
          )}\n`,
        );
        return;
      }

      const rows: string[][] = [];
      for (const { agentId, res } of perAgent) {
        for (const s of res.schedules) {
          // `enabled` is the file's intent; the derived status carries the rest —
          // active is the quiet norm, everything else gets named.
          rows.push([
            agentId,
            s.name,
            s.enabled ? t.schedule.enabled() : t.schedule.disabled(),
            s.startAt,
            s.period ?? t.schedule.oneShot(),
            s.sessionId !== undefined ? shortSessionId(s.sessionId) : t.schedule.newSession(),
            s.lastFiredAt ?? "-",
            s.status === "active" ? "" : s.status,
          ]);
        }
        for (const f of res.invalidFiles) {
          rows.push([agentId, f.name, "-", "-", "-", "-", "-", "invalid"]);
        }
      }
      if (rows.length === 0) {
        process.stdout.write(`${t.schedule.empty(projectId)}\n`);
        return;
      }
      process.stdout.write(
        renderTable(
          [
            t.agent.colId(),
            t.schedule.colName(),
            t.schedule.colEnabled(),
            t.schedule.colStartAt(),
            t.schedule.colPeriod(),
            t.schedule.colTarget(),
            t.schedule.colLastFired(),
            t.schedule.colStatus(),
          ],
          rows,
        ),
      );
    });

  schedule
    .command("add <name>")
    .description(t.schedule.addDesc)
    .requiredOption("--prompt <text>", t.schedule.prompt)
    .requiredOption("--start-at <when>", t.schedule.startAt)
    .option("--period <duration>", t.schedule.period)
    .option("--end-at <iso>", t.schedule.endAt)
    .option("--session-id <id>", t.schedule.sessionId)
    .option("--workspace <path>", t.schedule.workspace)
    .option("--model-id <id>", t.common.modelId)
    .option("--provider <group>", t.common.provider)
    .option("--disabled", t.schedule.disabledOpt)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (name: string, opts) => {
      if (!validateTarget(opts, t)) return;
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const agentId = resolveAgentId(opts.agentId);
      const item = await client.request<ScheduleItem>(
        "POST",
        `/api/projects/${enc(projectId)}/agents/${enc(agentId)}/schedules`,
        {
          name,
          // The deliberate divergence from the raw file's enabled=false default: a task
          // added through the CLI is meant to run; --disabled opts out.
          enabled: opts.disabled !== true,
          prompt: String(opts.prompt),
          startAt: resolveStartAt(String(opts.startAt)),
          ...(opts.period !== undefined ? { period: String(opts.period) } : {}),
          ...(opts.endAt !== undefined ? { endAt: String(opts.endAt) } : {}),
          ...(opts.sessionId !== undefined ? { sessionId: String(opts.sessionId) } : {}),
          ...(opts.workspace !== undefined ? { workspace: String(opts.workspace) } : {}),
          ...(opts.modelId !== undefined
            ? { modelId: String(opts.modelId), provider: String(opts.provider) }
            : {}),
        },
      );
      if (opts.json === true) process.stdout.write(`${JSON.stringify(item)}\n`);
      else process.stdout.write(`${writtenLine(t, item)}\n`);
    });

  schedule
    .command("update <name>")
    .description(t.schedule.updateDesc)
    .option("--prompt <text>", t.schedule.prompt)
    .option("--start-at <when>", t.schedule.startAt)
    .option("--period <duration>", t.schedule.period)
    .option("--end-at <iso>", t.schedule.endAt)
    .option("--session-id <id>", t.schedule.sessionId)
    .option("--workspace <path>", t.schedule.workspace)
    .option("--model-id <id>", t.common.modelId)
    .option("--provider <group>", t.common.provider)
    .option("--enable", t.schedule.enableOpt)
    .option("--disable", t.schedule.disableOpt)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (name: string, opts) => {
      if (!validateTarget(opts, t)) return;
      if (opts.enable === true && opts.disable === true) {
        process.stderr.write(`${t.error(t.schedule.enableDisableConflict())}\n`);
        process.exitCode = 1;
        return;
      }
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const agentId = resolveAgentId(opts.agentId);
      const base = `/api/projects/${enc(projectId)}/agents/${enc(agentId)}/schedules`;
      // Read-modify-write: unspecified fields keep the stored values; a target flag of
      // one kind clears the other kind's stored fields (the file holds one target).
      const stored = await client.request<ScheduleItem>("GET", `${base}/${enc(name)}`);
      const switchToSession = opts.sessionId !== undefined;
      const switchToNew =
        opts.workspace !== undefined || opts.modelId !== undefined || opts.provider !== undefined;
      const body: Record<string, unknown> = {
        enabled: opts.enable === true ? true : opts.disable === true ? false : stored.enabled,
        prompt: opts.prompt !== undefined ? String(opts.prompt) : stored.prompt,
        startAt: opts.startAt !== undefined ? resolveStartAt(String(opts.startAt)) : stored.startAt,
      };
      const period = opts.period !== undefined ? String(opts.period) : stored.period;
      if (period !== undefined) body.period = period;
      const endAt = opts.endAt !== undefined ? String(opts.endAt) : stored.endAt;
      if (endAt !== undefined) body.endAt = endAt;
      if (switchToSession) {
        body.sessionId = String(opts.sessionId);
      } else if (switchToNew) {
        const workspace = opts.workspace !== undefined ? String(opts.workspace) : stored.workspace;
        if (workspace !== undefined) body.workspace = workspace;
        const modelId = opts.modelId !== undefined ? String(opts.modelId) : stored.modelId;
        const provider = opts.provider !== undefined ? String(opts.provider) : stored.provider;
        if (modelId !== undefined) {
          body.modelId = modelId;
          body.provider = provider;
        }
      } else {
        if (stored.sessionId !== undefined) body.sessionId = stored.sessionId;
        if (stored.workspace !== undefined) body.workspace = stored.workspace;
        if (stored.modelId !== undefined) {
          body.modelId = stored.modelId;
          body.provider = stored.provider;
        }
      }
      const item = await client.request<ScheduleItem>("PUT", `${base}/${enc(name)}`, body);
      if (opts.json === true) process.stdout.write(`${JSON.stringify(item)}\n`);
      else process.stdout.write(`${writtenLine(t, item)}\n`);
    });

  schedule
    .command("rm <name>")
    .description(t.schedule.rmDesc)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (name: string, opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const agentId = resolveAgentId(opts.agentId);
      await client.request(
        "DELETE",
        `/api/projects/${enc(projectId)}/agents/${enc(agentId)}/schedules/${enc(name)}`,
      );
      if (opts.json === true) process.stdout.write(`${JSON.stringify({ name })}\n`);
      else process.stdout.write(`${t.schedule.removed(name)}\n`);
    });
}

/**
 * Target validation shared by add/update: `--session-id` XOR the new-session form, and
 * the model pair both-or-neither (never inferred, as everywhere). Returns false after
 * printing the error.
 */
function validateTarget(
  opts: {
    sessionId?: string;
    workspace?: string;
    modelId?: string;
    provider?: string;
  },
  t: Messages,
): boolean {
  if (Boolean(opts.modelId) !== Boolean(opts.provider)) {
    process.stderr.write(`${t.error(t.modelRefIncomplete())}\n`);
    process.exitCode = 1;
    return false;
  }
  if (
    opts.sessionId !== undefined &&
    (opts.workspace !== undefined || opts.modelId !== undefined)
  ) {
    process.stderr.write(`${t.error(t.schedule.targetConflict())}\n`);
    process.exitCode = 1;
    return false;
  }
  return true;
}
