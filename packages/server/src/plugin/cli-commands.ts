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
 * A run builds a fresh commander program per request: every command of the named plugin,
 * each on the node its key locates and described by its summary, then argv is parsed
 * against that program alone. For the duration of a run the process's stdout and stderr
 * are redirected into the response, so what the command writes to the process — and what
 * commander prints for help and usage errors — comes back as the response with the exit
 * code. Running a plugin's code is an admin operation; listing is open to any signed-in
 * user.
 */
import { Command, CommanderError } from "commander";
import { Hono } from "hono";
import { Bind, Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Slot } from "@prismshadow/penguin-core/kernel";
import { cliCommandKeyFault } from "@prismshadow/penguin-core/cli";
import type {
  CliCommandCode,
  CliCommandData,
  CliCommandProgram,
  CliCommandSummary,
} from "@prismshadow/penguin-core/cli";
import type {
  PluginCliCommandRunRequest,
  PluginCliCommandRunResponse,
  PluginCliCommandsResponse,
} from "../api/types.js";
import type { AppEnv } from "../auth/middleware.js";
import type { Hmr } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import { badRequest, readJson, requireString } from "../http/validate.js";
import { pluginHostFrom } from "./host.js";

/** One plugin command the server holds: its package, its data half, its bound code half. */
export interface PluginCliCommand {
  readonly package: string;
  readonly key: string;
  readonly summary: CliCommandSummary;
  readonly code: CliCommandCode;
}

/** What the routes read: the plugins' commands, and one run against a plugin's commands. */
@Interface()
export abstract class PluginCliCommands {
  /** Every valid plugin command, in load order. */
  abstract list(): readonly PluginCliCommand[];
  /** Parses `args` against the named plugin's commands; null when the plugin has none. */
  abstract run(request: PluginCliCommandRunRequest): Promise<PluginCliCommandRunResponse | null>;
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
  readonly code: CliCommandCode;
}

/**
 * Attributes each contribution to its plugin package and drops what cannot run: a module
 * no loaded plugin is behind, a key that is not a command path, and a key one package
 * contributes twice (both entries go, so the package's commands stay unambiguous).
 */
export function validPluginCommands(
  collected: readonly Collected[],
  packageOf: (module: string) => string | undefined,
  warn: (line: string) => void,
): PluginCliCommand[] {
  const attributed: Array<PluginCliCommand & { id: string; from: string }> = [];
  for (const c of collected) {
    const pkg = packageOf(c.from);
    const why =
      pkg === undefined
        ? `module '${c.from}' contributes CLI commands but no loaded plugin package is behind it`
        : cliCommandKeyFault(c.key);
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
    kept.push({ package: c.package, key: c.key, summary: c.summary, code: c.code });
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

/**
 * Runs `request.args` against `commands` (one package's) on a fresh program, collecting
 * everything printed. A command's own failure is reported on stderr with exit code 1, and
 * never escapes into the server.
 *
 * A command writes to the process's own streams — the contract holds no output channel —
 * so for the duration of a run this process's stdout and stderr are redirected into the
 * response's strings and restored after: the host decides what the process's streams mean.
 * Runs are serialized, so two concurrent runs never capture each other's output.
 */
let runs: Promise<unknown> = Promise.resolve();

export async function runPluginCommands(
  commands: readonly PluginCliCommand[],
  request: Pick<PluginCliCommandRunRequest, "args" | "language" | "prog">,
): Promise<PluginCliCommandRunResponse> {
  const run = runs.then(() => runPluginCommandOnce(commands, request));
  runs = run.catch(() => undefined);
  return run;
}

async function runPluginCommandOnce(
  commands: readonly PluginCliCommand[],
  request: Pick<PluginCliCommandRunRequest, "args" | "language" | "prog">,
): Promise<PluginCliCommandRunResponse> {
  const stdout = { text: "" };
  const stderr = { text: "" };
  const capture =
    (sink: { text: string }): typeof process.stdout.write =>
    (chunk: unknown) => {
      sink.text += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    };
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  const priorExitCode = process.exitCode;
  process.stdout.write = capture(stdout);
  process.stderr.write = capture(stderr);
  process.exitCode = 0;
  try {
    const program = new Command();
    program.name(request.prog).exitOverride();
    try {
      for (const c of commands) {
        const node = commandAt(program, c.key).description(c.summary[request.language]);
        // The server host holds no shared command vocabulary yet, so its bundle is the
        // locale the caller resolved — the one thing every host's bundle guarantees.
        c.code.register(node as unknown as CliCommandProgram, {
          messages: { language: request.language },
        });
      }
      // Only print help when no args given, so unknown words are reported as they are.
      if (request.args.length === 0) {
        program.outputHelp();
        return { exitCode: 0, stdout: stdout.text, stderr: stderr.text };
      }
      await program.parseAsync(request.args, { from: "user" });
      return { exitCode: process.exitCode ?? 0, stdout: stdout.text, stderr: stderr.text };
    } catch (err) {
      if (err instanceof CommanderError) {
        // Commander already printed what it had to say (help, or the usage error).
        return { exitCode: err.exitCode, stdout: stdout.text, stderr: stderr.text };
      }
      stderr.text += `${err instanceof Error ? err.message : String(err)}\n`;
      return { exitCode: 1, stdout: stdout.text, stderr: stderr.text };
    }
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
    process.exitCode = priorExitCode;
  }
}

/**
 * The `prog` a run may name: the program name followed by plain words, nothing a terminal
 * would interpret. The colon is `penguin exec <package>:<id>`'s — the explicit form names
 * the package before the id, and an npm name carries no colon itself.
 */
const PROG_PATTERN = /^[A-Za-z0-9@/._ :-]{1,256}$/;

export function pluginCliCommandRoutes(commands: PluginCliCommands): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) =>
    c.json({
      commands: commands.list().map((cmd) => ({
        package: cmd.package,
        key: cmd.key,
        summary: cmd.summary,
      })),
    } satisfies PluginCliCommandsResponse),
  );

  app.post("/run", async (c) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can run a plugin's command.");
    }
    const body = await readJson(c);
    const pkg = requireString(body, "package", { minLen: 1, maxLen: 214 });
    const prog = requireString(body, "prog", { pattern: PROG_PATTERN });
    const args = (body as { args?: unknown }).args;
    if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
      throw badRequest("args must be an array of strings.");
    }
    const language = (body as { language?: unknown }).language;
    if (language !== "en" && language !== "zh") throw badRequest("language must be 'en' or 'zh'.");
    const result = await commands.run({ package: pkg, args, language, prog });
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
  @Provide() pluginCliCommands!: PluginCliCommands;
  @Bind("PluginCliCommandsProvider.routes") routes!: Hono<AppEnv>;

  setup({ contributions }: ClassCtx) {
    // The kernel checked each entry against the slot's data type at boot, and resolved every
    // code half by its id.
    const collected: Collected[] = (contributions.commands ?? []).map((c) => ({
      id: c.id,
      from: c.from,
      key: c.data.key as string,
      summary: c.data.summary as unknown as CliCommandSummary,
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
      run: async (request) => {
        const own = list().filter((cmd) => cmd.package === request.package);
        return own.length === 0 ? null : runPluginCommands(own, request);
      },
    };
    this.pluginCliCommands = pluginCliCommands;
    this.routes = pluginCliCommandRoutes(pluginCliCommands);
  }
}
