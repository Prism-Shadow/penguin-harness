/**
 * `penguin app` — inspect and operate the project's Apps (workbenches) through the server.
 *
 *   penguin app ls [--project-id <id>] [--agent-id <id>] [-a|--all] [--json] [--server <url>]
 *   penguin app info [app-id] [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
 *   penguin app reload [app-id] [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
 *   penguin app enable [app-id] [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
 *   penguin app disable [app-id] [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
 *   penguin app history [app-id] [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
 *   penguin app call <target> [path] [-X|--method <M>] [-d|--data <json>] [--project-id <id>]
 *                    [--agent-id <id>] [--server <url>]
 *
 * Canonical App ID is `<agentId>/<workbenchId>`. Inside a workbench-created Session, the server
 * injects `PENGUIN_APP_ID`, so single-app subcommands accept an omitted `[app-id]` (and `call`
 * accepts `/path` alone). `ls` reads `/api/projects/:p/app-center` (or `?all=1` with `-a`),
 * which never compiles or boots workbenches.
 */
import type { Command } from "commander";
import { Bind, Component } from "@prismshadow/penguin-core/kernel";
import type { CliCommandCode, CliCommandProgram } from "@prismshadow/penguin-core/cli";
import type {
  AppCenterShortcut,
  WorkbenchInfo,
  WorkbenchVersion,
} from "@prismshadow/penguin-library-workbench";
import type { AppCenterResponse, WorkbenchesResponse } from "../../api/types.js";
import {
  formatAppId,
  resolveAppId,
  validateAppApiPath,
  type AppIdError,
  type ResolvedAppId,
} from "../app-id.js";
import { resolveProjectId, ServerClient } from "../client.js";
import { resolveConnection } from "../connection.js";
import { cutText } from "../cut-text.js";
import type { Messages } from "../i18n.js";
import { renderTable } from "../table.js";

const node = (command: CliCommandProgram): Command => command as Command;
const enc = encodeURIComponent;

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

interface BaseOpts {
  projectId?: string;
  agentId?: string;
  json?: boolean;
  server?: string;
}

async function connect(opts: { server?: string }, t: Messages): Promise<ServerClient> {
  return new ServerClient(await resolveConnection({ server: opts.server }, t), t);
}

/** Formats an AppIdError into the user's language. */
export function formatAppIdError(err: AppIdError, t: Messages): string {
  switch (err.kind) {
    case "missing":
      return t.app.idMissing();
    case "looks_like_session_id":
      return t.app.idLooksLikeSession(err.raw);
    case "invalid":
      return t.app.idInvalid(err.raw);
    case "missing_agent":
      return t.app.idMissingAgent(err.workbenchId);
    case "agent_mismatch":
      return t.app.idAgentMismatch(err.appAgentId, err.flagAgentId);
  }
}

function resolveTarget(raw: string | undefined, opts: BaseOpts, t: Messages): ResolvedAppId | null {
  const res = resolveAppId(raw, { agentId: opts.agentId });
  if (res.ok) return res;
  process.stderr.write(`${t.error(formatAppIdError(res, t))}\n`);
  process.exitCode = 1;
  return null;
}

function workbenchBase(projectId: string, target: ResolvedAppId): string {
  return `/api/projects/${enc(projectId)}/agents/${enc(target.agentId)}/workbenches`;
}

function shortcutStatus(s: AppCenterShortcut, t: Messages): string {
  const base =
    s.enabled === false
      ? t.app.statusDisabled()
      : s.build === "building"
        ? t.app.statusBuilding()
        : s.build === "failed"
          ? t.app.statusFailed()
          : t.app.statusReady();
  return s.hidden === true ? `${base} (${t.app.hiddenTag()})` : base;
}

function localizedTitle(s: AppCenterShortcut, t: Messages): string {
  return t.language === "zh" ? (s.titleZh ?? s.title) : s.title;
}

function printInfo(
  target: ResolvedAppId,
  wb: WorkbenchInfo,
  agentEnabled: boolean,
  t: Messages,
): void {
  const status =
    wb.enabled === false
      ? t.app.valueDisabled()
      : !agentEnabled
        ? `${t.app.valueDisabled()} (${t.app.valueAgentDisabled()})`
        : t.app.valueEnabled();
  const lines: string[] = [
    `${t.app.fieldId()}: ${target.appId}`,
    `${t.app.fieldName()}: ${wb.name}`,
    ...(wb.version !== null ? [`${t.app.fieldVersion()}: ${wb.version}`] : []),
    `${t.app.fieldStatus()}: ${status}`,
    `${t.app.fieldRevision()}: ${wb.revision}`,
    ...(wb.loadedAt !== null ? [`${t.app.fieldLoaded()}: ${wb.loadedAt}`] : []),
  ];
  if (wb.tabs.length > 0) {
    const tabs = wb.tabs
      .map((tab) => `${tab.key} (${t.language === "zh" ? (tab.titleZh ?? tab.title) : tab.title})`)
      .join(", ");
    lines.push(`${t.app.fieldTabs()}: ${tabs}`);
  }
  if (wb.appCenter !== undefined) {
    lines.push(
      `${t.app.fieldAppCenter()}: ${wb.appCenter.show ? t.app.valueShown() : t.app.valueHidden()}`,
    );
  }
  if (wb.showInSidebar !== undefined) {
    lines.push(
      `${t.app.fieldSidebar()}: ${wb.showInSidebar ? t.app.valueShown() : t.app.valueHidden()}`,
    );
  }
  if (wb.error !== null) {
    lines.push(`${t.app.fieldError()}: ${wb.error}`);
  }
  if (wb.hints.length > 0) {
    lines.push(`${t.app.fieldHints()}:`);
    for (const hint of wb.hints) lines.push(`  - ${hint}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function registerAppCommand(app: Command, t: Messages): void {
  app
    .command("ls")
    .description(t.app.lsDesc)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("-a, --all", t.app.lsAll)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts: BaseOpts & { all?: boolean }) => {
      const client = await connect(opts, t);
      const projectId = resolveProjectId(opts.projectId);
      const query = opts.all === true ? "?all=1" : "";
      const res = await client.request<AppCenterResponse>(
        "GET",
        `/api/projects/${enc(projectId)}/app-center${query}`,
      );
      const filterAgent = opts.agentId !== undefined ? opts.agentId.trim() : undefined;
      const rows = (
        filterAgent !== undefined
          ? res.shortcuts.filter((s) => s.agentId === filterAgent)
          : res.shortcuts
      ).map((s) => ({
        appId: formatAppId(s.agentId, s.workbenchId),
        ...s,
      }));
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(rows)}\n`);
        return;
      }
      if (rows.length === 0) {
        process.stdout.write(`${t.app.empty(projectId)}\n`);
        return;
      }
      process.stdout.write(
        renderTable(
          [t.app.colId(), t.app.colTitle(), t.app.colStatus(), t.app.colTab(), t.app.colPlugin()],
          rows.map((s) => [
            s.appId,
            cutText(localizedTitle(s, t), 40),
            shortcutStatus(s, t),
            s.tab ?? "",
            s.plugin ?? "",
          ]),
        ),
      );
    });

  app
    .command("info")
    .description(t.app.infoDesc)
    .argument("[app-id]", t.app.appIdArg)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (appIdArg: string | undefined, opts: BaseOpts) => {
      const target = resolveTarget(appIdArg, opts, t);
      if (!target) return;
      const client = await connect(opts, t);
      const projectId = resolveProjectId(opts.projectId);
      const res = await client.request<WorkbenchesResponse>(
        "GET",
        `${workbenchBase(projectId, target)}?id=${enc(target.workbenchId)}`,
      );
      const wb = res.workbenches[0];
      if (!wb) {
        process.stderr.write(`${t.error(t.app.notFound(target.appId))}\n`);
        process.exitCode = 1;
        return;
      }
      if (opts.json === true) {
        process.stdout.write(
          `${JSON.stringify({ appId: target.appId, agentId: target.agentId, agentEnabled: res.enabled ?? true, ...wb })}\n`,
        );
        return;
      }
      printInfo(target, wb, res.enabled ?? true, t);
    });

  app
    .command("reload")
    .description(t.app.reloadDesc)
    .argument("[app-id]", t.app.appIdArg)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (appIdArg: string | undefined, opts: BaseOpts) => {
      const target = resolveTarget(appIdArg, opts, t);
      if (!target) return;
      const client = await connect(opts, t);
      const projectId = resolveProjectId(opts.projectId);
      const res = await client.request<{ workbench: WorkbenchInfo }>(
        "POST",
        `${workbenchBase(projectId, target)}/${enc(target.workbenchId)}/reload`,
      );
      const wb = res.workbench;
      if (opts.json === true) {
        process.stdout.write(
          `${JSON.stringify({ appId: target.appId, agentId: target.agentId, ...wb })}\n`,
        );
        if (wb.error !== null) process.exitCode = 1;
        return;
      }
      if (wb.error !== null) {
        process.stderr.write(`${t.error(t.app.reloadFailed(target.appId, wb.error))}\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`${t.app.reloaded(target.appId, wb.revision)}\n`);
      for (const hint of wb.hints) process.stdout.write(`  - ${hint}\n`);
    });

  for (const enabled of [true, false] as const) {
    app
      .command(enabled ? "enable" : "disable")
      .description(enabled ? t.app.enableDesc : t.app.disableDesc)
      .argument("[app-id]", t.app.appIdArg)
      .option("--project-id <id>", t.common.projectId)
      .option("--agent-id <id>", t.common.agentId)
      .option("--json", t.common.json)
      .option("--server <url>", t.common.server)
      .action(async (appIdArg: string | undefined, opts: BaseOpts) => {
        const target = resolveTarget(appIdArg, opts, t);
        if (!target) return;
        const client = await connect(opts, t);
        const projectId = resolveProjectId(opts.projectId);
        const res = await client.request<{ workbench: WorkbenchInfo }>(
          "PUT",
          `${workbenchBase(projectId, target)}/${enc(target.workbenchId)}/enabled`,
          { enabled },
        );
        if (opts.json === true) {
          process.stdout.write(
            `${JSON.stringify({ appId: target.appId, agentId: target.agentId, ...res.workbench })}\n`,
          );
          return;
        }
        process.stdout.write(
          `${enabled ? t.app.enabled(target.appId) : t.app.disabled(target.appId)}\n`,
        );
      });
  }

  app
    .command("history")
    .description(t.app.historyDesc)
    .argument("[app-id]", t.app.appIdArg)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (appIdArg: string | undefined, opts: BaseOpts) => {
      const target = resolveTarget(appIdArg, opts, t);
      if (!target) return;
      const client = await connect(opts, t);
      const projectId = resolveProjectId(opts.projectId);
      const res = await client.request<{ versions: WorkbenchVersion[] }>(
        "GET",
        `${workbenchBase(projectId, target)}/${enc(target.workbenchId)}/history`,
      );
      if (opts.json === true) {
        process.stdout.write(
          `${JSON.stringify({ appId: target.appId, versions: res.versions })}\n`,
        );
        return;
      }
      if (res.versions.length === 0) {
        process.stdout.write(`${t.app.historyEmpty(target.appId)}\n`);
        return;
      }
      process.stdout.write(
        renderTable(
          [t.app.colRevision(), t.app.colCommit(), t.app.colSaved()],
          res.versions.map((v) => [v.revision, v.commit, v.savedAt]),
        ),
      );
    });

  app
    .command("call")
    .description(t.app.callDesc)
    .argument("<target>", t.app.callTargetArg)
    .argument("[path]", t.app.callPathArg)
    .option("-X, --method <method>", t.app.callMethod)
    .option("-d, --data <json>", t.app.callData)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--server <url>", t.common.server)
    .action(
      async (
        targetArg: string,
        pathArg: string | undefined,
        opts: BaseOpts & { method?: string; data?: string },
      ) => {
        let appArg: string | undefined;
        let rawPath: string;
        if (pathArg !== undefined) {
          appArg = targetArg;
          rawPath = pathArg;
        } else if (targetArg.startsWith("/")) {
          appArg = undefined;
          rawPath = targetArg;
        } else {
          process.stderr.write(`${t.error(t.app.callPathRequired())}\n`);
          process.exitCode = 1;
          return;
        }

        const apiPath = validateAppApiPath(rawPath);
        if (apiPath === null) {
          process.stderr.write(`${t.error(t.app.callPathInvalid(rawPath))}\n`);
          process.exitCode = 1;
          return;
        }

        const method = (opts.method ?? (opts.data !== undefined ? "POST" : "GET"))
          .trim()
          .toUpperCase();
        if (!HTTP_METHODS.has(method)) {
          process.stderr.write(`${t.error(t.app.callMethodInvalid(opts.method ?? method))}\n`);
          process.exitCode = 1;
          return;
        }

        let bodyBytes: Uint8Array | undefined;
        if (opts.data !== undefined) {
          if (method === "GET" || method === "HEAD") {
            process.stderr.write(`${t.error(t.app.callDataOnBodylessMethod(method))}\n`);
            process.exitCode = 1;
            return;
          }
          try {
            const parsed = JSON.parse(opts.data);
            bodyBytes = new TextEncoder().encode(JSON.stringify(parsed));
          } catch (err) {
            process.stderr.write(
              `${t.error(t.app.callDataNotJson(err instanceof Error ? err.message : String(err)))}\n`,
            );
            process.exitCode = 1;
            return;
          }
        }

        const target = resolveTarget(appArg, opts, t);
        if (!target) return;

        const client = await connect(opts, t);
        const projectId = resolveProjectId(opts.projectId);
        const res = await client.raw(
          method,
          `${workbenchBase(projectId, target)}/${enc(target.workbenchId)}/api${apiPath}`,
          bodyBytes,
          "application/json",
        );
        if (res.status === 204 || method === "HEAD") return;
        const text = await res.text();
        if (text === "") return;
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("json")) {
          try {
            process.stdout.write(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
            return;
          } catch {
            // Fall through to raw output if handler claimed JSON but sent non-JSON text.
          }
        }
        process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
      },
    );
}

/**
 * `penguin app`, as a contribution to the CLI's `CliCommandsModule.commands`: the data half
 * is the entry below, the code half the register this class binds.
 */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.app",
        key: "app",
        summary: {
          en: "Inspect and operate the project's apps",
          zh: "查看与操作 Project 的应用",
        },
      },
    ],
  },
})
export class AppCommand {
  @Bind("cli.app") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerAppCommand(node(command), ctx.messages);
      },
    };
  }
}
