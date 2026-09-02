/**
 * `penguin app` — the App Center registry: list, register, unregister and probe the apps
 * built in this project's conversations.
 *
 *   penguin app ls [--project-id <id>] [--json] [--server <url>]
 *   penguin app register --name <s> [--id <slug>] [--description <s>] [--url <url>]
 *                    [--health-url <url>] [--start-command <s>] [--stop-command <s>]
 *                    [--kind web|api|cli|other] [--session-id <id>] [--workspace <path>]
 *                    [--project-id] [--json] [--server]
 *   penguin app unregister <id> [--project-id] [--json] [--server]
 *   penguin app status <id> [--project-id] [--json] [--server]
 *
 * `register` is what the app-center skill runs once an app is up: the app binds to the
 * Session that built it — `--session-id` defaults to PENGUIN_SESSION_ID, the calling
 * Session inside a harness agent — and the server fills the agent and Workspace from that
 * Session unless `--workspace` says otherwise. Without an `--id` the server derives one
 * from the name. Registering an explicit `--id` that already exists updates it in place
 * (register-again-is-update), so a Session whose URL or commands changed re-runs the same
 * command. `ls` probes every app's status; `status` re-probes one app on demand.
 * `unregister` deletes without prompting (agents drive this; the server's owner
 * authorization still applies).
 * Docs: /docs/cli § "penguin app".
 */
import type { Command } from "commander";
import type { AppItem, AppsResponse, AppUpsertRequest } from "@prismshadow/penguin-server/api";
import {
  ApiError,
  resolveConnection,
  resolveProjectId,
  ServerClient,
  shortSessionId,
} from "../client.js";
import { renderTable } from "../table.js";
import type { Messages } from "../i18n.js";

const enc = encodeURIComponent;

const KINDS = ["web", "api", "cli", "other"] as const;
type AppKind = (typeof KINDS)[number];

function isKind(value: string): value is AppKind {
  return (KINDS as readonly string[]).includes(value);
}

/** The registration's Session: the flag, else the calling Session inside a harness agent. */
function resolveSessionId(flag: string | undefined): string | undefined {
  return flag?.trim() || process.env.PENGUIN_SESSION_ID?.trim() || undefined;
}

export function registerAppCommand(program: Command, t: Messages): void {
  const app = program.command("app").description(t.app.desc);

  app
    .command("ls")
    .description(t.app.lsDesc)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const res = await client.request<AppsResponse>("GET", `/api/projects/${enc(projectId)}/apps`);
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(res)}\n`);
        return;
      }
      const rows: string[][] = res.apps.map((a) => [
        a.id,
        a.name,
        a.kind,
        a.status,
        a.url ?? "-",
        shortSessionId(a.sessionId),
        a.registeredAt,
      ]);
      for (const f of res.invalidFiles) rows.push([f.id, "-", "-", "invalid", "-", "-", "-"]);
      if (rows.length === 0) {
        process.stdout.write(`${t.app.empty(projectId)}\n`);
        return;
      }
      process.stdout.write(
        renderTable(
          [
            t.app.colId(),
            t.app.colName(),
            t.app.colKind(),
            t.app.colStatus(),
            t.app.colUrl(),
            t.app.colSession(),
            t.app.colRegistered(),
          ],
          rows,
        ),
      );
    });

  app
    .command("register")
    .description(t.app.registerDesc)
    .requiredOption("--name <name>", t.app.name)
    .option("--id <slug>", t.app.id)
    .option("--description <text>", t.app.description)
    .option("--url <url>", t.app.url)
    .option("--health-url <url>", t.app.healthUrl)
    .option("--start-command <command>", t.app.startCommand)
    .option("--stop-command <command>", t.app.stopCommand)
    .option("--kind <kind>", t.app.kind)
    .option("--session-id <id>", t.app.sessionId)
    .option("--workspace <path>", t.app.workspace)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const sessionId = resolveSessionId(opts.sessionId);
      if (sessionId === undefined) {
        process.stderr.write(`${t.error(t.app.sessionRequired())}\n`);
        process.exitCode = 1;
        return;
      }
      const kind = opts.kind !== undefined ? String(opts.kind).trim().toLowerCase() : undefined;
      if (kind !== undefined && !isKind(kind)) {
        process.stderr.write(`${t.error(t.app.kindInvalid(String(opts.kind)))}\n`);
        process.exitCode = 1;
        return;
      }
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const body: AppUpsertRequest = {
        name: String(opts.name),
        sessionId,
        ...(opts.description !== undefined ? { description: String(opts.description) } : {}),
        ...(opts.url !== undefined ? { url: String(opts.url) } : {}),
        ...(opts.healthUrl !== undefined ? { healthUrl: String(opts.healthUrl) } : {}),
        ...(opts.startCommand !== undefined ? { startCommand: String(opts.startCommand) } : {}),
        ...(opts.stopCommand !== undefined ? { stopCommand: String(opts.stopCommand) } : {}),
        ...(opts.workspace !== undefined ? { workspace: String(opts.workspace) } : {}),
        ...(kind !== undefined ? { kind } : {}),
      };
      const base = `/api/projects/${enc(projectId)}/apps`;
      const id = opts.id !== undefined ? String(opts.id).trim() : undefined;
      let item: AppItem;
      let updated = false;
      try {
        item = await client.request<AppItem>("POST", base, {
          ...(id !== undefined ? { id } : {}),
          ...body,
        });
      } catch (err) {
        // An explicit id that is already registered: the same command updates it in place.
        if (!(err instanceof ApiError && err.code === "app_exists" && id !== undefined)) throw err;
        item = await client.request<AppItem>("PUT", `${base}/${enc(id)}`, body);
        updated = true;
      }
      if (opts.json === true) process.stdout.write(`${JSON.stringify(item)}\n`);
      else
        process.stdout.write(
          `${updated ? t.app.updated(item.id, item.name, item.url) : t.app.registered(item.id, item.name, item.url)}\n`,
        );
    });

  app
    .command("unregister <id>")
    .description(t.app.unregisterDesc)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (id: string, opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      await client.request("DELETE", `/api/projects/${enc(projectId)}/apps/${enc(id)}`);
      if (opts.json === true) process.stdout.write(`${JSON.stringify({ id })}\n`);
      else process.stdout.write(`${t.app.unregistered(id)}\n`);
    });

  app
    .command("status <id>")
    .description(t.app.statusDesc)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (id: string, opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const item = await client.request<AppItem>(
        "GET",
        `/api/projects/${enc(projectId)}/apps/${enc(id)}?refresh=1`,
      );
      if (opts.json === true) process.stdout.write(`${JSON.stringify(item)}\n`);
      else process.stdout.write(`${t.app.statusLine(item.id, item.status, item.url)}\n`);
    });
}
