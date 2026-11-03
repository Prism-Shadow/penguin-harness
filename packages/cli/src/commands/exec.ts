/**
 * `penguin exec <id> [args…]` — a plugin command, by its dotted id, run on the server.
 *
 *   penguin exec sandbox.wsl.restart --prod
 *   penguin exec @penguinharness/sandbox-wsl:sandbox.wsl.restart   (when ids collide)
 *
 * The id is the dotted key the command contributes (`a.b.c` — the segments its plugin
 * answers `penguin a b c ARGS` with), at least two segments, and it resolves exactly: no
 * prefix, suffix or short-form matching. When two plugins contribute the same id, the full
 * npm package names it — `<package>:<id>`, scope included; nothing shorter does. `ls`
 * lists what the plugins contribute, in the style of `penguin agent ls`:
 *
 *   penguin exec ls                 (every plugin command, grouped per package)
 *   penguin exec ls <package>       (one plugin's commands; the full npm name)
 *
 * `ls` is reserved. A plugin command whose id is `ls` is reached only in the prefixed form,
 * `<package>:ls`. Every option after the id — `--help` included — belongs to the plugin
 * command: it is handed to the server, which parses the whole thing against that plugin's
 * commands and answers with what they printed and their exit code. A server that is not
 * running is started, as for any command that needs one.
 */
import type { Command } from "commander";
import type { PluginCliCommandInfo } from "@prismshadow/penguin-server/api";
import type { Language, Messages } from "@prismshadow/penguin-server/cli";
import { renderTable } from "@prismshadow/penguin-server/cli";
import { serverPluginCommands, writeRun } from "../plugin-cli-commands.js";
import { Bind, Component } from "@prismshadow/penguin-core/kernel";
import type { CliCommandCode, CliCommandProgram } from "@prismshadow/penguin-core/cli";

/**
 * The language the server-side surfaces come in: a command summary is `{ en, zh }` and the
 * run request names one of the two, while the bundle's `language` is the host's to define —
 * so anything that is not `zh` renders English, the same judgment the host's own resolver
 * makes.
 */
function summaryLanguage(t: Messages): Language {
  return t.language === "zh" ? "zh" : "en";
}

/** What id resolution decided: the command to run, or the error to report. */
export type ExecResolution =
  | { readonly target: { readonly pkg: string; readonly key: string } }
  | { readonly invalidId: string }
  | { readonly unknownId: string; readonly keys: readonly string[] }
  | { readonly unknownPackage: string; readonly packages: readonly string[] }
  | { readonly collision: { readonly key: string; readonly fulls: readonly string[] } };

/** The npm packages that contribute commands, in listing order, each once. */
function packagesOf(commands: readonly PluginCliCommandInfo[]): string[] {
  const packages: string[] = [];
  for (const cmd of commands) {
    if (!packages.includes(cmd.package)) packages.push(cmd.package);
  }
  return packages;
}

/** Resolves the name `penguin exec` was given against the commands the plugins contribute. */
export function resolveExecTarget(
  commands: readonly PluginCliCommandInfo[],
  name: string,
): ExecResolution {
  if (name.includes(":")) {
    const at = name.indexOf(":");
    const pkg = name.slice(0, at);
    const id = name.slice(at + 1);
    const packages = packagesOf(commands);
    if (!packages.includes(pkg)) return { unknownPackage: pkg, packages };
    const keys = commands.filter((cmd) => cmd.package === pkg).map((cmd) => cmd.key);
    if (!keys.includes(id)) return { unknownId: id, keys };
    return { target: { pkg, key: id } };
  }
  if (!name.includes(".")) return { invalidId: name };
  const matches = commands.filter((cmd) => cmd.key === name);
  if (matches.length === 0) return { unknownId: name, keys: commands.map((cmd) => cmd.key) };
  const fulls = packagesOf(matches);
  if (matches.length > 1) return { collision: { key: name, fulls } };
  return { target: { pkg: matches[0]!.package, key: name } };
}

/** Fills in `penguin exec`, on the node the host located by the command's key. */
export function registerExecCommand(exec: Command, t: Messages): void {
  // The id's own options belong to the plugin command: no `--help` of ours, no option
  // parsing — everything after the id is handed to the server as it was typed.
  exec
    .helpOption(false)
    .allowUnknownOption()
    .argument("[args...]", t.exec.argsArg)
    .action(async (args: string[]) => {
      // Bare, or leading with an option (`penguin exec --help`): this command's own help.
      // An id never starts with `-`, so nothing a plugin owns is shadowed.
      if (args.length === 0 || args[0]!.startsWith("-")) {
        exec.outputHelp();
        return;
      }
      const source = serverPluginCommands({ autoStart: true }, t);
      const commands = await source.list();
      const resolution = resolveExecTarget(commands, args[0]!);
      if ("invalidId" in resolution) {
        process.stderr.write(`${t.exec.invalidId(resolution.invalidId)}\n`);
        process.exitCode = 1;
        return;
      }
      if ("unknownId" in resolution) {
        process.stderr.write(
          `${t.exec.unknownId(resolution.unknownId)}\n${t.exec.keys(resolution.keys)}\n`,
        );
        process.exitCode = 1;
        return;
      }
      if ("unknownPackage" in resolution) {
        process.stderr.write(
          `${t.exec.unknownPackage(resolution.unknownPackage)}\n${t.exec.candidates(resolution.packages)}\n`,
        );
        process.exitCode = 1;
        return;
      }
      if ("collision" in resolution) {
        process.stderr.write(
          `${t.exec.collision(resolution.collision.key, resolution.collision.fulls)}\n`,
        );
        process.exitCode = 1;
        return;
      }
      const { pkg, key } = resolution.target;
      process.exitCode = writeRun(
        await source.run({
          package: pkg,
          args: [...key.split("."), ...args.slice(1)],
          language: summaryLanguage(t),
          prog: `penguin exec ${args[0]}`,
        }),
      );
    });

  exec
    .command("ls")
    .description(t.exec.lsDesc)
    .argument("[package]", t.exec.lsPackageArg)
    .action(async (pkg?: string) => {
      const source = serverPluginCommands({ autoStart: true }, t);
      const commands = await source.list();
      if (pkg !== undefined && !packagesOf(commands).includes(pkg)) {
        process.stderr.write(
          `${t.exec.unknownPackage(pkg)}\n${t.exec.candidates(packagesOf(commands))}\n`,
        );
        process.exitCode = 1;
        return;
      }
      const rows = commands
        .filter((cmd) => pkg === undefined || cmd.package === pkg)
        .map((cmd) =>
          pkg === undefined
            ? [cmd.package, cmd.key, cmd.summary[summaryLanguage(t)]]
            : [cmd.key, cmd.summary[summaryLanguage(t)]],
        );
      process.stdout.write(
        renderTable(
          pkg === undefined
            ? [t.exec.colPackage(), t.exec.colId(), t.exec.colSummary()]
            : [t.exec.colId(), t.exec.colSummary()],
          rows,
        ),
      );
    });
}

/** The node the host located for a key, typed with this package's commander. */
const node = (command: CliCommandProgram): Command => command as Command;

/** `penguin exec`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.exec",
        key: "exec",
        summary: {
          en: "Run a plugin command on the server by its dotted id (`penguin exec ls` lists what the plugins contribute)",
          zh: "按点分 id 在服务端执行插件命令（`penguin exec ls` 列出各插件贡献的命令）",
        },
      },
    ],
  },
})
export class ExecCommand {
  @Bind("cli.exec") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerExecCommand(node(command), ctx.messages);
      },
    };
  }
}
