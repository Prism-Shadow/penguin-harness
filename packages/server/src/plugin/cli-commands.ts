/**
 * Plugin commands for the `penguin` CLI: the `PluginCliCommandsProvider.commands` slot,
 * and the two routes the CLI reads it through.
 *
 * A plugin contributes a command the way it contributes anything else: a class whose
 * `contributes["PluginCliCommandsProvider.commands"]` entry is the data half (the key and
 * the one-line summary) and whose `@Bind(entry.id)` field is the code half
 * (`CliCommandCode`, `@prismshadow/penguin-core/cli`). The commands live in the
 * server's tree with the rest of the plugin, so only the server knows them. The CLI lists
 * them from GET /api/cli/commands and runs one with POST /api/cli/commands/run, the same
 * way the web app reads its slots from GET /api/contributions.
 *
 * A run builds a fresh commander program per request: every command of the named plugin the
 * caller may run, each on the node its key locates and described by its summary, then argv is
 * parsed against that program alone. What the command writes through its context — and what
 * commander prints for help and usage errors — comes back as the response with the exit code,
 * with the files it handed back. Listing is open to any signed-in user.
 *
 * Who may run what (PRFC-0024 v1.1): a command is `admin` unless its data half says `member`.
 * The administrator runs any; anyone else runs the package's member commands only — the program
 * then holds nothing else, so an admin command's code never runs for them. A run names its
 * caller's Project and Session (an Agent's control environment); the route checks the caller can
 * see the Project and that the Session is the Project's, and the command reads both from
 * `ctx.caller`. A member command needs a Project.
 *
 * Two opt-ins of the data half narrow that further, each for its own command only. With
 * `requiresProjectListing` the command runs only where the caller's Project lists its plugin for
 * this machine (403 `plugin_not_enabled`), checked before any code of it runs. With
 * `tokenCaller: "session-driver"` a call made with the local API token — every Agent's
 * credential — runs as the person driving the named Session rather than as the administrator the
 * token stands for (cli-command-caller.ts). Every other command keeps v1.1's rule.
 *
 * Output: a member command writes through the context only, and its runs are concurrent. An admin
 * command keeps v1.0's contract as well: for its run the process's stdout and stderr are
 * redirected into the response and `process.exitCode` read back, so those runs are serialized.
 *
 * Files: the terminal reads the files a command's `files.read` options name and sends them with
 * the run (counted against the request body cap); the command reads one by the option's value
 * with `ctx.input`. What it hands back with `ctx.output` — plain names, at most
 * MAX_RUN_OUTPUT_BYTES in all — the terminal saves under its `files.write` option.
 */
import { Command, CommanderError } from "commander";
import { Hono } from "hono";
import { Bind, Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Opaque, Slot } from "@prismshadow/penguin-core/kernel";
import { cliCommandKeyFault, cliCommandNamedBy } from "@prismshadow/penguin-core/cli";
import type {
  CliCommandCaller,
  CliCommandCode,
  CliCommandData,
  CliCommandFile,
  CliCommandFiles,
  CliCommandProgram,
  CliCommandSummary,
} from "@prismshadow/penguin-core/cli";
import type { DatabaseSync } from "node:sqlite";
import { effectivePluginTable, isValidId } from "@prismshadow/penguin-core";
import type { Users } from "@prismshadow/penguin-library-auth";
import { MachinesRepo } from "@prismshadow/penguin-library-machine/machine";
import type { Access, ProjectConfigStore } from "@prismshadow/penguin-library-project";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import type {
  PluginCliCommandOutputFile,
  PluginCliCommandRunRequest,
  PluginCliCommandRunResponse,
  PluginCliCommandsResponse,
} from "../api/types.js";
import type { AppEnv } from "../auth/middleware.js";
import type { Db, Hmr } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import { badRequest, readJson, requireString } from "../http/validate.js";
import { sessionDriverCaller } from "./cli-command-caller.js";
import { pluginHostFrom } from "./host.js";

/** One plugin command the server holds: its package, its data half, its bound code half. */
export interface PluginCliCommand {
  readonly package: string;
  readonly key: string;
  readonly summary: CliCommandSummary;
  /** Absent: `admin`, the default. */
  readonly access?: "admin" | "member";
  readonly files?: CliCommandFiles;
  readonly requiresProjectListing?: boolean;
  readonly tokenCaller?: "session-driver";
  readonly code: CliCommandCode;
}

/** One run as the route hands it over: the request, with the files the terminal sent decoded. */
export interface PluginCliCommandRun extends Omit<PluginCliCommandRunRequest, "files"> {
  /** The sent files by the option value they were read for. */
  files: ReadonlyMap<string, CliCommandFile>;
}

/** What the routes read: the plugins' commands, and one run against a plugin's commands. */
@Interface()
export abstract class PluginCliCommands {
  /** Every valid plugin command, in load order. */
  abstract list(): readonly PluginCliCommand[];
  /**
   * Parses `args` against the named plugin's commands the caller may run; null when the plugin
   * has none. A non-administrator naming an admin command, or a package with no member command,
   * is a 403 `admin_required`; a member command with no Project a 400 `project_required`; a
   * `requiresProjectListing` command where the caller's Project does not list its plugin for this
   * machine a 403 `plugin_not_enabled`.
   */
  abstract run(
    request: Opaque<"PluginCliCommandRun", PluginCliCommandRun>,
    caller: CliCommandCaller,
  ): Promise<PluginCliCommandRunResponse | null>;
}

export interface PluginCliCommandsSlots {
  /** A command: its key and summary here, its code half bound by the contributor. */
  commands: Slot<CliCommandData, CliCommandCode>;
}

/** A contribution as the slot delivered it, before it is attributed to a package. */
interface Collected {
  readonly id: string;
  readonly from: string;
  readonly key: string;
  readonly summary: CliCommandSummary;
  readonly access?: "admin" | "member";
  readonly files?: CliCommandFiles;
  readonly requiresProjectListing?: boolean;
  readonly tokenCaller?: "session-driver";
  readonly code: CliCommandCode;
}

/** A long option as the terminal finds it on a command line: `--name`, lowercase. */
const LONG_OPTION = /^--[a-z][a-z0-9-]*$/;

/** What is wrong with a command's `files`, or null: every entry must be a long option. */
function filesFault(files: CliCommandFiles | undefined): string | null {
  if (files === undefined) return null;
  const options = [...(files.read ?? []), ...(files.write !== undefined ? [files.write] : [])];
  const bad = options.find((option) => !LONG_OPTION.test(option));
  return bad === undefined
    ? null
    : `files names '${bad.slice(0, 64)}', which is not a long option (--name)`;
}

/**
 * Attributes each contribution to its plugin package and drops what cannot run: a module
 * no loaded plugin is behind, a key that is not a command path, `files` that name anything but
 * long options, and a key one package contributes twice (both entries go, so the package's
 * commands stay unambiguous).
 */
export function validPluginCommands(
  collected: readonly Collected[],
  packageOf: (module: string) => string | undefined,
  warn: (line: string) => void,
): PluginCliCommand[] {
  const attributed: Array<Collected & { package: string }> = [];
  for (const c of collected) {
    const pkg = packageOf(c.from);
    const why =
      pkg === undefined
        ? `module '${c.from}' contributes CLI commands but no loaded plugin package is behind it`
        : (cliCommandKeyFault(c.key) ?? filesFault(c.files));
    if (why !== null) {
      warn(`[plugin-cli-commands] '${c.from}' contribution '${c.id}' skipped: ${why}`);
      continue;
    }
    attributed.push({ ...c, package: pkg! });
  }
  const counts = new Map<string, number>();
  for (const c of attributed) {
    const k = `${c.package}\0${c.key}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const kept: PluginCliCommand[] = [];
  for (const c of attributed) {
    if (counts.get(`${c.package}\0${c.key}`)! > 1) {
      warn(
        `[plugin-cli-commands] '${c.package}' contributes '${c.key}' more than once; contribution '${c.id}' skipped`,
      );
      continue;
    }
    kept.push({
      package: c.package,
      key: c.key,
      summary: c.summary,
      access: c.access === "member" ? "member" : "admin",
      ...(c.files !== undefined ? { files: c.files } : {}),
      ...(c.requiresProjectListing === true ? { requiresProjectListing: true } : {}),
      ...(c.tokenCaller === "session-driver" ? { tokenCaller: "session-driver" as const } : {}),
      code: c.code,
    });
  }
  return kept;
}

/** The node for a dotted key under `program`, found or built one segment at a time. */
function commandAt(program: Command, key: string): Command {
  let node = program;
  for (const segment of key.split(".")) {
    node = node.commands.find((c) => c.name() === segment) ?? node.command(segment);
  }
  return node;
}

/** The most a run may hand back to the terminal, all files together. */
export const MAX_RUN_OUTPUT_BYTES = 64 * 1024 * 1024;

/** A file name the terminal may write as it stands: no directory part, nothing a shell would read as one. */
function plainFileName(name: string): boolean {
  return (
    name.length > 0 && name.length <= 255 && name !== "." && name !== ".." && !/[/\\\0]/.test(name)
  );
}

/** What a run is given beside its argv: who runs it and the files the terminal sent. */
export interface PluginCommandRunContext {
  caller?: CliCommandCaller;
  files?: ReadonlyMap<string, CliCommandFile>;
}

/**
 * Admin runs capture the process's streams, so they go one at a time and never capture each
 * other's output; member runs touch no process state and are not queued behind them.
 */
let captured: Promise<unknown> = Promise.resolve();

/**
 * Runs `request.args` against `commands` (one package's, already narrowed to what the caller may
 * run) on a fresh program, collecting what is printed and handed back. A command's own failure is
 * reported on stderr with exit code 1, and never escapes into the server. `capture`: also redirect
 * the process's stdout and stderr and read `process.exitCode` (v1.0's contract, admin commands).
 */
export async function runPluginCommands(
  commands: readonly PluginCliCommand[],
  request: Pick<PluginCliCommandRunRequest, "args" | "language" | "prog">,
  context: PluginCommandRunContext = {},
  capture = true,
): Promise<PluginCliCommandRunResponse> {
  if (!capture) return runPluginCommandOnce(commands, request, context, false);
  const run = captured.then(() => runPluginCommandOnce(commands, request, context, true));
  captured = run.catch(() => undefined);
  return run;
}

async function runPluginCommandOnce(
  commands: readonly PluginCliCommand[],
  request: Pick<PluginCliCommandRunRequest, "args" | "language" | "prog">,
  context: PluginCommandRunContext,
  capture: boolean,
): Promise<PluginCliCommandRunResponse> {
  const stdout = { text: "" };
  const stderr = { text: "" };
  const outputs: PluginCliCommandOutputFile[] = [];
  let outputBytes = 0;
  let exitCode: number | undefined;
  const sink =
    (into: { text: string }) =>
    (chunk: unknown): true => {
      into.text += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    };
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  const priorExitCode = process.exitCode;
  if (capture) {
    process.stdout.write = sink(stdout) as typeof process.stdout.write;
    process.stderr.write = sink(stderr) as typeof process.stderr.write;
    process.exitCode = 0;
  }
  const result = (): PluginCliCommandRunResponse => ({
    exitCode: exitCode ?? (capture ? Number(process.exitCode ?? 0) : 0),
    stdout: stdout.text,
    stderr: stderr.text,
    ...(outputs.length > 0 ? { files: outputs } : {}),
  });
  try {
    const program = new Command();
    // Commander's own output (help, usage errors) goes where the command's does. Set before any
    // subcommand exists: that is when the settings are copied down.
    program
      .name(request.prog)
      .exitOverride()
      .configureOutput({ writeOut: sink(stdout), writeErr: sink(stderr) });
    try {
      for (const c of commands) {
        const node = commandAt(program, c.key).description(c.summary[request.language]);
        // The server host holds no shared command vocabulary yet, so its bundle is the
        // locale the caller resolved — the one thing every host's bundle guarantees.
        c.code.register(node as unknown as CliCommandProgram, {
          messages: { language: request.language },
          stdout: { write: sink(stdout) },
          stderr: { write: sink(stderr) },
          exit: (code) => {
            exitCode = code;
          },
          ...(context.caller !== undefined ? { caller: context.caller } : {}),
          input: (value) => context.files?.get(value),
          output: (file) => {
            if (!plainFileName(file.name)) {
              throw new Error(`'${file.name.slice(0, 64)}' is not a plain file name.`);
            }
            outputBytes += file.data.byteLength;
            if (outputBytes > MAX_RUN_OUTPUT_BYTES) {
              throw new Error(
                `The files of one run exceed ${MAX_RUN_OUTPUT_BYTES / (1024 * 1024)} MiB.`,
              );
            }
            outputs.push({
              name: file.name,
              ...(file.mimeType !== undefined ? { mimeType: file.mimeType } : {}),
              data: Buffer.from(file.data).toString("base64"),
            });
          },
        });
      }
      // Only print help when no args given, so unknown words are reported as they are.
      if (request.args.length === 0) {
        program.outputHelp();
        return result();
      }
      await program.parseAsync(request.args, { from: "user" });
      return result();
    } catch (err) {
      if (err instanceof CommanderError) {
        // Commander already printed what it had to say (help, or the usage error).
        exitCode = err.exitCode;
        return result();
      }
      stderr.text += `${err instanceof Error ? err.message : String(err)}\n`;
      exitCode = 1;
      return result();
    }
  } finally {
    if (capture) {
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
      process.exitCode = priorExitCode;
    }
  }
}

/**
 * Narrows a package's commands to what the caller may run, then runs `request` against them —
 * the PRFC-0024 v1.1 rules the module comment states.
 */
export async function runAsCaller(
  own: readonly PluginCliCommand[],
  run: PluginCliCommandRun,
  caller: CliCommandCaller,
  listed: (projectId: string, pkg: string) => Promise<boolean> = async () => true,
): Promise<PluginCliCommandRunResponse> {
  const target = cliCommandNamedBy(own, run.args);
  let runnable = own;
  if (!caller.isAdmin) {
    runnable = own.filter((cmd) => cmd.access === "member");
    if (runnable.length === 0 || (target !== undefined && target.access !== "member")) {
      throw new HttpError(403, "admin_required", "Only an admin can run this plugin command.");
    }
  }
  if (target?.access === "member" && caller.projectId === undefined) {
    throw new HttpError(
      400,
      "project_required",
      "This command runs in a Project: run it inside a Session, or set PENGUIN_PROJECT_ID.",
    );
  }
  if (
    target?.requiresProjectListing === true &&
    (caller.projectId === undefined || !(await listed(caller.projectId, run.package)))
  ) {
    throw new HttpError(
      403,
      "plugin_not_enabled",
      `${run.package} is not enabled for Project ${caller.projectId ?? "(none)"} on this server: install the plugin on one of the Project's Agents, or ask an administrator to.`,
    );
  }
  return runPluginCommands(
    runnable,
    run,
    { caller, files: run.files },
    target?.access !== "member",
  );
}

/**
 * The `prog` a run may name: the program name followed by plain words, nothing a terminal
 * would interpret. The colon is `penguin exec <package>:<id>`'s — the explicit form names
 * the package before the id, and an npm name carries no colon itself.
 */
const PROG_PATTERN = /^[A-Za-z0-9@/._ :-]{1,256}$/;

/** The files of a run request, decoded and keyed by the option value they were read for. */
function parseInputFiles(value: unknown): Map<string, CliCommandFile> {
  const files = new Map<string, CliCommandFile>();
  if (value === undefined) return files;
  if (!Array.isArray(value)) throw badRequest("files must be an array.");
  for (const [i, entry] of value.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw badRequest(`files[${i}] must be an object.`);
    }
    const file = entry as Record<string, unknown>;
    const at = requireString(file, "value", {
      minLen: 1,
      maxLen: 4096,
      label: `files[${i}].value`,
    });
    const name = requireString(file, "name", { minLen: 1, maxLen: 255, label: `files[${i}].name` });
    const data = file.data;
    if (typeof data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw badRequest(`files[${i}].data must be base64.`);
    }
    files.set(at, { name, data: Buffer.from(data, "base64") });
  }
  return files;
}

export interface PluginCliCommandRouteDeps {
  commands: PluginCliCommands;
  access: Pick<Access, "requireProjectAccess" | "canAccess">;
  sessions: Pick<SessionIndex, "findById">;
  users: Pick<Users, "findById">;
}

export function pluginCliCommandRoutes(deps: PluginCliCommandRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) =>
    c.json({
      commands: deps.commands.list().map((cmd) => ({
        package: cmd.package,
        key: cmd.key,
        summary: cmd.summary,
        access: cmd.access ?? "admin",
        ...(cmd.files !== undefined ? { files: cmd.files } : {}),
      })),
    } satisfies PluginCliCommandsResponse),
  );

  app.post("/run", async (c) => {
    const user = c.var.user;
    const body = await readJson(c);
    const pkg = requireString(body, "package", { minLen: 1, maxLen: 214 });
    const prog = requireString(body, "prog", { pattern: PROG_PATTERN });
    const args = (body as { args?: unknown }).args;
    if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
      throw badRequest("args must be an array of strings.");
    }
    const language = (body as { language?: unknown }).language;
    if (language !== "en" && language !== "zh") throw badRequest("language must be 'en' or 'zh'.");
    // The caller's context, checked here so a command can trust what it reads from ctx.caller.
    const caller: CliCommandCaller = { userId: user.userId, isAdmin: user.isAdmin };
    if (body.projectId !== undefined) {
      const projectId = requireString(body, "projectId", { minLen: 1, maxLen: 128 });
      if (!isValidId(projectId)) throw badRequest("projectId is not a Project id.");
      deps.access.requireProjectAccess(user.userId, projectId);
      caller.projectId = projectId;
    }
    if (body.sessionId !== undefined) {
      const sessionId = requireString(body, "sessionId", { minLen: 1, maxLen: 128 });
      const row = deps.sessions.findById(sessionId);
      if (caller.projectId === undefined || row === null || row.projectId !== caller.projectId) {
        throw new HttpError(404, "session_not_found", "Session does not exist in this Project.");
      }
      caller.sessionId = sessionId;
      caller.agentId = row.agentId;
    }
    // The local API token (every Agent's credential) runs a `session-driver` command as the
    // person driving the Session it names: the command decides, never the request.
    const own = deps.commands.list().filter((cmd) => cmd.package === pkg);
    const target = cliCommandNamedBy(own, args);
    const runAs =
      target?.tokenCaller === "session-driver" && c.var.sessionVia === "token"
        ? sessionDriverCaller(caller, deps)
        : caller;
    const files = parseInputFiles(body.files);
    const result = await deps.commands.run({ package: pkg, args, language, prog, files }, runAs);
    if (result === null) {
      throw new HttpError(
        404,
        "unknown_package",
        `No plugin named '${pkg}' contributes CLI commands.`,
      );
    }
    return c.json(result satisfies PluginCliCommandRunResponse);
  });

  return app;
}

/**
 * Owns the slot; serves it at /api/cli/commands. The contributions are read off the slot
 * at boot; each call attributes them to the packages of the plugin host as it is then.
 */
@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "PluginCliCommandsProvider.routes",
        prefix: "/api/cli/commands",
        auth: "user",
        order: 66,
      },
    ],
  },
})
export class PluginCliCommandsProvider {
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly access!: Access;
  @Use() private readonly sessions!: SessionIndex;
  @Use() private readonly users!: Users;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly db!: Db;
  @Provide() pluginCliCommands!: PluginCliCommands;
  @Bind("PluginCliCommandsProvider.routes") routes!: Hono<AppEnv>;

  setup({ contributions }: ClassCtx) {
    const machineId = new MachinesRepo(this.db as unknown as DatabaseSync).ownId();
    /** Whether the Project lists the package for this machine (its shared table or its own). */
    const listed = async (projectId: string, pkg: string): Promise<boolean> => {
      try {
        return (
          pkg in
          effectivePluginTable(await this.projectConfig.getPluginTables(projectId), machineId)
        );
      } catch {
        return false;
      }
    };
    // The kernel checked each entry against the slot's data type at boot, and resolved every
    // code half by its id.
    const collected: Collected[] = (contributions.commands ?? []).map((c) => ({
      id: c.id,
      from: c.from,
      key: c.data.key as string,
      summary: c.data.summary as unknown as CliCommandSummary,
      ...(c.data.access !== undefined ? { access: c.data.access as "admin" | "member" } : {}),
      ...(c.data.files !== undefined ? { files: c.data.files as unknown as CliCommandFiles } : {}),
      ...(c.data.requiresProjectListing === true ? { requiresProjectListing: true } : {}),
      ...(c.data.tokenCaller === "session-driver"
        ? { tokenCaller: "session-driver" as const }
        : {}),
      code: c.code as CliCommandCode,
    }));
    const list = (): PluginCliCommand[] => {
      // The host registers its plugins when the generation commits, after this tree booted,
      // so it is claimed per call — the same object across swaps, as the skills store does.
      const packageOf = new Map<string, string>();
      for (const entry of pluginHostFrom(this.hmr.resources).entries().values()) {
        for (const module of entry.modules) packageOf.set(module.manifest.name, entry.specifier);
      }
      return validPluginCommands(
        collected,
        (module) => packageOf.get(module),
        (line) => console.warn(line),
      );
    };
    const pluginCliCommands: PluginCliCommands = {
      list,
      run: async (request, caller) => {
        const own = list().filter((cmd) => cmd.package === request.package);
        return own.length === 0 ? null : runAsCaller(own, request, caller, listed);
      },
    };
    this.pluginCliCommands = pluginCliCommands;
    this.routes = pluginCliCommandRoutes({
      commands: pluginCliCommands,
      access: this.access,
      sessions: this.sessions,
      users: this.users,
    });
  }
}
