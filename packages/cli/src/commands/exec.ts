/**
 * `penguin exec <plugin> [args…]` — one plugin's commands, by name, run on the server.
 *
 *   penguin exec my-plugin deploy --prod
 *   penguin exec @scope/my-plugin -- deploy --help   (`--` hands every option to the plugin)
 *
 * The unambiguous form of a plugin command: the plugin named is the only candidate, so this
 * is also what the ambiguity report hands the caller, one copyable line per plugin. Name
 * resolution: an exact npm name always wins; a short name (`packageShortName`) works while
 * exactly one plugin carries it; anything else is an error naming the candidates.
 *
 * The server parses the args against that plugin's commands alone and answers with what
 * they printed and their exit code; with no args it prints the plugin's own help. A server
 * that is not running is started, as for any command that needs one.
 */
import type { Command } from "commander";
import type { Language, Messages } from "@prismshadow/penguin-server/cli";
import { packageShortName, serverPluginCommands, writeRun } from "../plugin-cli-commands.js";
import { Bind, Component } from "@prismshadow/penguin-core/kernel";
import type { CliCommandCode, CliCommandProgram } from "@prismshadow/penguin-core/plugin";
import { getMessages } from "@prismshadow/penguin-server/cli";

/** What name resolution decided: the package, or the error to report. */

/** The node the host located for a key, typed with this package's commander. */
const node = (command: CliCommandProgram): Command => command as Command;
export type ExecResolution =
  | { readonly pkg: string }
  | { readonly unknown: string }
  | { readonly collision: { readonly short: string; readonly fulls: readonly string[] } };

/** Resolves the name `penguin exec` was given against the plugins that contribute commands. */
export function resolveExecPackage(packages: readonly string[], name: string): ExecResolution {
  if (packages.includes(name)) return { pkg: name };
  const byShort = packages.filter((pkg) => packageShortName(pkg) === name);
  if (byShort.length === 1) return { pkg: byShort[0]! };
  if (byShort.length > 1) return { collision: { short: name, fulls: byShort } };
  return { unknown: name };
}

/** Fills in `penguin exec`, on the node the host located by the command's key. */
export function registerExecCommand(
  exec: Command,
  t: Messages,
  opts: { language: Language },
): void {
  exec
    .argument("<package>", t.exec.packageArg)
    .argument("[args...]", t.exec.argsArg)
    .allowUnknownOption()
    .action(async (name: string, args: string[]) => {
      const source = serverPluginCommands({ autoStart: true }, t);
      const packages: string[] = [];
      for (const cmd of await source.list()) {
        if (!packages.includes(cmd.package)) packages.push(cmd.package);
      }
      const resolution = resolveExecPackage(packages, name);
      if ("unknown" in resolution) {
        process.stderr.write(
          `${t.exec.unknownPackage(resolution.unknown)}\n${t.exec.candidates(packages)}\n`,
        );
        process.exitCode = 1;
        return;
      }
      if ("collision" in resolution) {
        process.stderr.write(
          `${t.exec.shortCollision(resolution.collision.short, resolution.collision.fulls)}\n`,
        );
        process.exitCode = 1;
        return;
      }
      process.exitCode = writeRun(
        await source.run({
          package: resolution.pkg,
          args,
          language: opts.language,
          prog: `penguin exec ${name}`,
        }),
      );
    });
}

/** `penguin exec`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.exec",
        key: "exec",
        summary: {
          en: "Run a plugin's command on the server by naming the plugin (the unambiguous form when two plugins contribute the same command)",
          zh: "点名插件，在服务端执行它的命令（两个插件贡献同一命令时的无歧义形式）",
        },
      },
    ],
  },
})
export class ExecCommand {
  @Bind("cli.exec") command!: CliCommandCode;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerExecCommand(node(command), getMessages(ctx.language), { language: ctx.language });
      },
    };
  }
}
