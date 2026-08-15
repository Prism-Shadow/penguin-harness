/**
 * PenguinHarness CLI entry point — a thin, static loader.
 *
 * Bootstrapping commands (`web`, `server`, `update`) start or replace the runtime
 * itself, so they stay HERE, statically bundled into this package: hot-loading the
 * very thing that boots or replaces the runtime would be circular, and `update`'s
 * self-replacement safety invariants require every module it needs to be resolved
 * statically (see commands/update.ts's module doc).
 *
 * Every other command (`run`, `chat`, `config`, and top-level `--help`/`--version`/
 * no-args) lives in cli.ts, exported as `cli` — and is loaded fresh on every
 * invocation from the data root's HMR store when a version has been pushed there
 * (the same content-addressed store the HMR host boots the running server from —
 * see packages/server/src/hmr/host.ts). Hot-pushing a version therefore hot-updates
 * the CLI too: no rebuild, no reinstall — `node scripts/watch-push.mjs` (or a direct
 * POST /api/hmr/upgrade) landing new command code that the very next `penguin <cmd>`
 * picks up, read straight off `<root>/hmr/harness.json`'s `cli` entry — its own
 * independent artifact, a different file from the platform bundle (see
 * @prismshadow/penguin-server/hmr/manifest's resolveCliBundlePath — a plain disk
 * read; this process is short-lived and never runs an HmrHost). When nothing has
 * been pushed yet (fresh data root, or the store/manifest is missing/corrupt/
 * pruned), or the hot-loaded bundle fails to import or doesn't export `cli`, this
 * falls back to the packaged default: cli.ts, statically imported into this
 * very package — same function, just resolved the ordinary way instead of
 * dynamically imported from the HMR store. A broken push must never brick the CLI.
 *
 * No auth of any kind is needed for the load: this reads the local machine's own
 * store and executes in-process, the same trust boundary as running any other
 * locally-installed binary — unrelated to the admin-cookie-gated /api/hmr/* HTTP
 * surface.
 *
 * The pieces below are exported (and parameterized rather than reading
 * `process.argv` directly) so tests can drive them without spawning a real
 * `penguin` process; `main()` only runs automatically when this file is the actual
 * entry point (see the `isMain` guard at the bottom), never when a test imports it.
 *
 * Known gap (deferred — see the workflow-hmr design doc): `penguin` / `penguin
 * --help` with NO subcommand routes through the hot path (argv[0] is undefined, not
 * a boot command) and only shows cli.ts's help (run/chat/config), not
 * web/server/update — unifying top-level help across the boot/hot split is left for
 * later polish.
 *
 * Docs: packages/docs/content/cli.{zh,en}.md (site path /docs/cli).
 */
import "dotenv/config";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { VERSION, resolveRoot } from "@prismshadow/penguin-core";
import { resolveCliBundlePath } from "@prismshadow/penguin-server/hmr/manifest";
import { registerServeCommands } from "./commands/serve.js";
import { registerUpdateCommand } from "./commands/update.js";
import { cli as packagedCli } from "./cli.js";
import { defaultMessages } from "./i18n.js";
import type { Messages } from "./i18n.js";

/** Bootstrapping commands: never hot-loaded (see module doc above). */
const BOOT_COMMANDS = new Set(["web", "server", "update"]);

/**
 * Data root: `--root <dir>` (searched anywhere in `argv` — every subcommand that
 * accepts it registers it as its OWN option, so its position isn't fixed) takes
 * priority, relative paths resolved against cwd; otherwise PENGUIN_HOME /
 * ~/.penguin/data via `resolveRoot()` — the same priority every subcommand applies
 * itself (see e.g. commands/config.ts's `resolveRootOption`), re-derived here by
 * hand because this decision happens BEFORE any subcommand-specific commander
 * parsing (that parsing lives inside whichever `cli()` ends up handling the
 * command). `argv` is the bare user argument list (no node executable, no script
 * path).
 */
export function resolveDataRoot(argv: string[]): string {
  const flagIndex = argv.indexOf("--root");
  if (flagIndex !== -1 && argv[flagIndex + 1] !== undefined) {
    return path.resolve(argv[flagIndex + 1]!);
  }
  const inline = argv.find((a) => a.startsWith("--root="));
  if (inline !== undefined) return path.resolve(inline.slice("--root=".length));
  return resolveRoot();
}

/**
 * `web` / `server` / `update`: handled by a small local program, registered
 * directly — never hot-loaded (see module doc). Commander's default behavior
 * (process.exit on --help/--version/a parse error) is unchanged from before this
 * split. `nodeArgv` is a full `process.argv`-shaped array
 * (`[execPath, scriptPath, ...args]`), what commander's default 'node' parse mode
 * expects.
 */
export async function runLocal(nodeArgv: string[], t: Messages): Promise<number> {
  const program = new Command();
  program
    .name("penguin")
    .description(t.cliDescription)
    .version(VERSION, "-v, --version", t.versionDesc);
  registerServeCommands(program, t);
  registerUpdateCommand(program, t);
  await program.parseAsync(nodeArgv);
  return typeof process.exitCode === "number" ? process.exitCode : 0;
}

/**
 * Everything else: loaded from the unified bundle currently pointed at by `root`'s
 * HMR store, falling back to the packaged default when nothing has been pushed yet
 * or the hot-loaded bundle fails to import/boot cleanly (a broken push must never
 * brick the CLI).
 */
export async function runHot(argv: string[], root: string): Promise<number> {
  const bundlePath = await resolveCliBundlePath(root);
  if (bundlePath === null) return packagedCli(argv);
  try {
    // Cache-busted so a bundle rewritten at the same path (a fresh push landing
    // between two `penguin` invocations) is never served stale from Node's module
    // cache.
    const url = `${pathToFileURL(bundlePath).href}?v=${Date.now()}`;
    const mod = (await import(url)) as { cli?: (argv: string[]) => Promise<number> };
    if (typeof mod.cli !== "function") {
      throw new Error(`${bundlePath} does not export 'cli'`);
    }
    return await mod.cli(argv);
  } catch (err) {
    process.stderr.write(
      `[penguin] failed to load the hot-pushed CLI (${
        err instanceof Error ? err.message : String(err)
      }); falling back to the packaged default.\n`,
    );
    return packagedCli(argv);
  }
}

/**
 * Routes one invocation: `nodeArgv` is a full `process.argv`-shaped array; the bare
 * user arguments (`nodeArgv.slice(2)`) decide both the boot-vs-hot split and what
 * reaches whichever `cli()` ends up handling the command.
 */
export async function main(nodeArgv: string[]): Promise<number> {
  const argv = nodeArgv.slice(2);
  const sub = argv[0];
  if (sub !== undefined && BOOT_COMMANDS.has(sub)) {
    return runLocal(nodeArgv, defaultMessages());
  }
  return runHot(argv, resolveDataRoot(argv));
}

/** True only when this module is the actual process entry point (never on a test import). */
function isMain(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  main(process.argv)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
