/**
 * `penguin exec <package> [args…]` — one contributing package's commands, by name.
 *
 *   penguin exec my-plugin deploy --prod
 *   penguin exec @scope/my-plugin deploy --prod   (when two packages share the short name)
 *
 * The unambiguous form of a contributed command: the package named is the ONLY candidate,
 * so this is also what the host's ambiguity report hands the caller — one copyable line
 * per package, the original argv shell-quoted behind it. Name resolution: an exact npm
 * name always wins; a short name (`packageShortName`) works while exactly one contributing
 * package carries it; anything else is an error naming the candidates.
 *
 * The package's own parse decides the rest: its code half registers on a fresh program
 * (the same settings the host's program gets), and the args parse against that alone —
 * commander's own nesting does the dispatch, so `server` + `server.status` from one package
 * never collide. With no args the fresh program prints its help: what this package
 * contributes, straight from the code half that owns it.
 */
import { Command, CommanderError } from "commander";
import type { Messages } from "../i18n.js";
import { reportCommanderError } from "../usage-error.js";
import { cliContext } from "../context.js";
import {
  discoverCliCommands,
  matchingCommands,
  packageShortName,
  registerPackageCommands,
  type CliDiscovery,
} from "../contributions.js";

/** A word POSIX shells read back unchanged: letters, digits, and the portable punctuation set. */
const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** One word in a copyable command line, single-quoted the way POSIX shells read it back. */
export function shellQuote(text: string): string {
  return SAFE_WORD.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
}

/** What name resolution decided: the package, or the error to report. */
export type ExecResolution =
  | { readonly pkg: string }
  | { readonly unknown: string }
  | { readonly collision: { readonly short: string; readonly fulls: readonly string[] } };

/**
 * Resolves the name `penguin exec` was given against the contributing packages: an exact
 * npm name first, then a short name only while it is unique. Pure, so a test can drive it
 * with a synthetic discovery.
 */
export function resolveExecPackage(discovery: CliDiscovery, name: string): ExecResolution {
  const pkgs: string[] = [];
  for (const cmd of discovery.commands) if (!pkgs.includes(cmd.pkg)) pkgs.push(cmd.pkg);
  if (pkgs.includes(name)) return { pkg: name };
  const byShort = pkgs.filter((pkg) => packageShortName(pkg) === name);
  if (byShort.length === 1) return { pkg: byShort[0]! };
  if (byShort.length > 1) return { collision: { short: name, fulls: byShort } };
  return { unknown: name };
}

/**
 * Registers the host's `exec` command. Its action resolves the package against a fresh
 * discovery (the review-quality read of the same data the dispatch already matched), then
 * parses the remaining argv on the package's own program.
 */
export function registerExecCommand(
  program: Command,
  t: Messages,
  opts: { language: "en" | "zh" },
): void {
  program
    .command("exec")
    .description(t.exec.desc)
    .argument("<package>", t.exec.packageArg)
    .argument("[args...]", t.exec.argsArg)
    .action(async (name: string, args: string[]) => {
      const ctx = cliContext({ language: opts.language });
      const discovery = await discoverCliCommands({ root: ctx.root });
      const resolution = resolveExecPackage(discovery, name);
      if ("unknown" in resolution) {
        const pkgs: string[] = [];
        for (const cmd of discovery.commands) if (!pkgs.includes(cmd.pkg)) pkgs.push(cmd.pkg);
        process.stderr.write(
          `${t.exec.unknownPackage(resolution.unknown)}\n${t.exec.candidates(pkgs)}\n`,
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

      // The package's commands alone, on a fresh program with the host's settings: what
      // runs is the package's own parse, so its nesting and errors read exactly as they do
      // behind plain `penguin` — and no other package can be reached from here.
      const pkg = resolution.pkg;
      const matches = matchingCommands(discovery.commands, args).filter((m) => m.pkg === pkg);
      const sub = new Command();
      sub
        .name(`penguin exec ${name}`)
        .exitOverride()
        .configureOutput({ outputError: () => {} });
      await registerPackageCommands(discovery, pkg, matches[0]?.entry.key, sub, ctx);
      sub.action(() => {
        sub.outputHelp();
      });
      try {
        await sub.parseAsync(args, { from: "user" });
      } catch (err) {
        // Same contract as the host's catch: a commander failure is reported localized
        // (its own output channel was silenced above), anything else propagates to the
        // host's catch untouched.
        if (err instanceof CommanderError) {
          process.exitCode = reportCommanderError(err, sub, args, t);
          return;
        }
        throw err;
      }
    });
}
