/**
 * Plugin commands, reached through the server.
 *
 * A plugin's commands are contributions to the server's tree (the server's
 * `PluginCliCommandsProvider.commands` slot), so the server is the one that knows them and
 * the one that runs them: GET /api/cli/commands lists every plugin command with its package,
 * and POST /api/cli/commands/run parses an argv against one package's commands and answers
 * with what they printed and their exit code. The CLI asks only when the first word of the
 * command line names none of its own commands, and only a server that is already running.
 *
 * One plugin answering the words runs; two or more answering the same words is ambiguous,
 * and the report lists one `penguin exec <package>:<id>` line per plugin with exit code 2,
 * so the caller names the one it meant. No plugin answering leaves the command line to the
 * CLI's own parse, which reports the unknown command as it always has.
 *
 * A run carries its caller's context — the Agent's `PENGUIN_PROJECT_ID` and `PENGUIN_SESSION_ID`,
 * else `default_project` for a command any Project member may run — and the files the command's
 * `files.read` options name, read here and sent with it; the files the run hands back are saved
 * here under its `files.write` option, else in the current directory, never over an existing file.
 * Local paths are read and written by the terminal only.
 */
import fs from "node:fs";
import path from "node:path";
import { cliCommandNamedBy } from "@prismshadow/penguin-core/cli";
import type {
  PluginCliCommandInfo,
  PluginCliCommandInputFile,
  PluginCliCommandOutputFile,
  PluginCliCommandRunRequest,
  PluginCliCommandRunResponse,
  PluginCliCommandsResponse,
  Language,
  Messages,
} from "@prismshadow/penguin-server/cli";
import { resolveConnection, ServerClient } from "@prismshadow/penguin-server/cli";

/** A word POSIX shells read back unchanged: letters, digits, and the portable punctuation set. */
const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** One word in a copyable command line, single-quoted the way POSIX shells read it back. */
export function shellQuote(text: string): string {
  return SAFE_WORD.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
}

/** The unscoped name of a package: `@scope/name` → `name`, a bare name stays itself. */
export function packageShortName(pkg: string): string {
  const at = pkg.lastIndexOf("/");
  return at === -1 ? pkg : pkg.slice(at + 1);
}

/** The command words of an argv: what comes before its first option. */
function commandWords(argv: readonly string[]): string[] {
  const words: string[] = [];
  for (const token of argv) {
    if (token.startsWith("-")) break;
    words.push(token);
  }
  return words;
}

/**
 * Whether a command with this key answers the argv: its segments and the argv's command
 * words agree for as far as both go. `tool sub` answers `tool sub x`, and also `tool` and
 * `tool --help`, where the words stop first; `tool sub` does not answer `tool other`.
 */
export function keyAnswers(key: string, argv: readonly string[]): boolean {
  const segments = key.split(".");
  const words = commandWords(argv);
  const n = Math.min(segments.length, words.length);
  if (n === 0) return false;
  for (let i = 0; i < n; i++) if (segments[i] !== words[i]) return false;
  return true;
}

/** The packages whose commands answer the argv, in listing order, each once. */
export function matchingPackages(
  commands: readonly PluginCliCommandInfo[],
  argv: readonly string[],
): string[] {
  const packages: string[] = [];
  for (const cmd of commands) {
    if (keyAnswers(cmd.key, argv) && !packages.includes(cmd.package)) packages.push(cmd.package);
  }
  return packages;
}

/** Where plugin commands come from: the server's two routes, or a stand-in in a test. */
export interface PluginCommandSource {
  list(): Promise<readonly PluginCliCommandInfo[]>;
  run(request: PluginCliCommandRunRequest): Promise<PluginCliCommandRunResponse>;
}

/**
 * The server's plugin commands. The connection is resolved on first use; with
 * `autoStart: false` a missing server fails the call rather than starting one.
 */
export function serverPluginCommands(
  opts: { autoStart: boolean },
  t: Messages,
): PluginCommandSource {
  let client: Promise<ServerClient> | null = null;
  const connect = (): Promise<ServerClient> => {
    client ??= resolveConnection({ autoStart: opts.autoStart }, t).then(
      (conn) => new ServerClient(conn, t),
    );
    return client;
  };
  return {
    list: async () =>
      (await (await connect()).request<PluginCliCommandsResponse>("GET", "/api/cli/commands"))
        .commands,
    run: async (request) =>
      (await connect()).request<PluginCliCommandRunResponse>(
        "POST",
        "/api/cli/commands/run",
        request,
      ),
  };
}

/** Writes what a run printed, stdout first, and returns its exit code. */
export function writeRun(result: PluginCliCommandRunResponse): number {
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  return result.exitCode;
}

/** The values an option takes on a command line (`--x v`, `--x=v`), up to a bare `--`. */
export function optionValues(args: readonly string[], option: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") break;
    if (arg === option && i + 1 < args.length) values.push(args[++i]!);
    else if (arg.startsWith(`${option}=`)) values.push(arg.slice(option.length + 1));
  }
  return values;
}

/** The caller context a run carries: the Agent's control environment, else the CLI's default Project for a member command. */
export function callerContext(
  command: Pick<PluginCliCommandInfo, "access"> | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Pick<PluginCliCommandRunRequest, "projectId" | "sessionId"> {
  const projectId =
    env.PENGUIN_PROJECT_ID?.trim() || (command?.access === "member" ? "default_project" : "");
  const sessionId = env.PENGUIN_SESSION_ID?.trim() || "";
  return {
    ...(projectId !== "" ? { projectId } : {}),
    ...(projectId !== "" && sessionId !== "" ? { sessionId } : {}),
  };
}

/** The files a command's `files.read` options name on this command line, read from disk relative to the current directory. */
function readInputFiles(
  args: readonly string[],
  command: PluginCliCommandInfo | undefined,
): PluginCliCommandInputFile[] {
  const files: PluginCliCommandInputFile[] = [];
  for (const option of command?.files?.read ?? []) {
    for (const value of optionValues(args, option)) {
      if (files.some((f) => f.value === value)) continue;
      const data = fs.readFileSync(path.resolve(value));
      files.push({ value, name: path.basename(value), data: data.toString("base64") });
    }
  }
  return files;
}

/** A path beside `wanted` that does not exist yet: `name.ext`, then `name-1.ext`, `name-2.ext` … */
function writeNew(dir: string, wanted: string, data: Buffer): string {
  const ext = path.extname(wanted);
  const stem = wanted.slice(0, wanted.length - ext.length);
  for (let n = 0; ; n++) {
    const target = path.join(dir, n === 0 ? wanted : `${stem}-${n}${ext}`);
    try {
      fs.writeFileSync(target, data, { flag: "wx" });
      return target;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}

/**
 * Saves the files a run handed back under the command's `files.write` option (its last value),
 * else the current directory, and names each saved path on stderr. False when one was not saved.
 */
function saveOutputFiles(
  files: readonly PluginCliCommandOutputFile[],
  args: readonly string[],
  command: PluginCliCommandInfo | undefined,
  t: Messages,
): boolean {
  const option = command?.files?.write;
  const dir = path.resolve((option !== undefined ? optionValues(args, option).at(-1) : "") ?? "");
  let saved = true;
  for (const file of files) {
    // The server sends plain names; a name with a directory part is not written anywhere.
    if (path.basename(file.name) !== file.name || file.name === "." || file.name === "..") {
      process.stderr.write(`${t.exec.fileUnsaved(file.name, "not a plain file name")}
`);
      saved = false;
      continue;
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      const target = writeNew(dir, file.name, Buffer.from(file.data, "base64"));
      process.stderr.write(`${t.exec.fileSaved(target)}
`);
    } catch (err) {
      process.stderr.write(
        `${t.exec.fileUnsaved(file.name, err instanceof Error ? err.message : String(err))}
`,
      );
      saved = false;
    }
  }
  return saved;
}

/**
 * Runs one plugin command on the server — `run` is the request without the caller's context and
 * files, which are added here — writes what it printed, saves what it handed back, and returns its
 * exit code. `commands` is the listing, for the command's access and files. An input file that
 * cannot be read stops the run before anything is sent.
 */
export async function runPluginCommand(
  source: PluginCommandSource,
  run: Pick<PluginCliCommandRunRequest, "package" | "args" | "language" | "prog">,
  commands: readonly PluginCliCommandInfo[],
  t: Messages,
): Promise<number> {
  const command = cliCommandNamedBy(
    commands.filter((cmd) => cmd.package === run.package),
    run.args,
  );
  let files: PluginCliCommandInputFile[];
  try {
    files = readInputFiles(run.args, command);
  } catch (err) {
    const failed = err as NodeJS.ErrnoException;
    process.stderr.write(`${t.exec.fileUnreadable(failed.path ?? "?", failed.message)}
`);
    return 1;
  }
  const result = await source.run({
    ...run,
    ...callerContext(command),
    ...(files.length > 0 ? { files } : {}),
  });
  const exitCode = writeRun(result);
  const saved = saveOutputFiles(result.files ?? [], run.args, command, t);
  return exitCode === 0 && !saved ? 1 : exitCode;
}

/**
 * The ambiguity report: the header, one copyable `penguin exec <package>:<id>` line per
 * plugin, the closing note. Each id is the longest key of that package's commands that
 * answer the argv, and what follows it is the part of the argv the key does not name — so
 * a pasted line runs the plugin command with the same arguments, options included, no `--`
 * needed. Returns exit code 2.
 */
export function reportAmbiguous(
  argv: readonly string[],
  commands: readonly PluginCliCommandInfo[],
  t: Messages,
): number {
  const matching = commands.filter((cmd) => keyAnswers(cmd.key, argv));
  const packages: string[] = [];
  for (const cmd of matching) {
    if (!packages.includes(cmd.package)) packages.push(cmd.package);
  }
  process.stderr.write(`${t.ambiguous.header(commandWords(argv).join(" "), packages.length)}\n`);
  const words = commandWords(argv);
  for (const pkg of packages) {
    // The longest key the package contributes that answers the argv; its segments are
    // dropped from the front of the argv, the rest is pasted after the id.
    const key = matching
      .filter((cmd) => cmd.package === pkg)
      .reduce((a, b) => (b.key.split(".").length > a.key.split(".").length ? b : a)).key;
    const rest = [...words.slice(key.split(".").length), ...argv.slice(words.length)]
      .map(shellQuote)
      .join(" ");
    process.stderr.write(
      `  penguin exec ${shellQuote(`${pkg}:${key}`)}${rest ? ` ${rest}` : ""}\n`,
    );
  }
  process.stderr.write(`${t.ambiguous.note()}\n`);
  return 2;
}

/**
 * Runs the argv as a plugin command when exactly one plugin's commands answer it, and
 * reports the ambiguity when several do; returns the exit code. Null when none does, or
 * when the commands cannot be listed: the CLI then parses the argv as its own.
 */
export async function dispatchPluginCommand(
  argv: readonly string[],
  language: Language,
  source: PluginCommandSource,
  t: Messages,
): Promise<number | null> {
  let commands: readonly PluginCliCommandInfo[];
  try {
    commands = await source.list();
  } catch {
    return null;
  }
  const packages = matchingPackages(commands, argv);
  if (packages.length === 0) return null;
  if (packages.length > 1) return reportAmbiguous(argv, commands, t);
  return runPluginCommand(
    source,
    { package: packages[0]!, args: [...argv], language, prog: "penguin" },
    commands,
    t,
  );
}
