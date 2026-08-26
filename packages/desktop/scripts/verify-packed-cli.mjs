/**
 * The packed app carries a working `penguin`.
 *
 * Run after `electron-builder --dir` (CI's runtime job builds exactly that tree). An
 * installed desktop app is a supported way to get the CLI: the deb postinst links
 * /usr/bin/penguin at install time, and the other three forms expose this same launcher
 * through "Install 'penguin' Command". Every one of them resolves <app>/bin/penguin and
 * <app>/dist/penguin.js as plain files inside the packed tree, so `bin/` dropping out of
 * electron-builder's `files`, asar being switched on, or the bundled entry being renamed
 * would ship an app whose `penguin` command does not exist — with nothing else in the
 * build failing. The unit tests pin those couplings in the config files; this checks the
 * tree they produced.
 *
 * Every app directory found is checked for the launchers and the bundled entry. The
 * launcher is then actually run: a cross-architecture bundle that cannot execute on this
 * host is reported and skipped, but at least one has to run and report a version.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(pkgDir, "out");
const version = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;

/** Every `resources/app` directory under out/, in both platform layouts. */
function appDirs() {
  if (!fs.existsSync(outDir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(outDir)) {
    // Windows/Linux: out/<name>/resources/app. macOS: out/<name>/<Product>.app/Contents/Resources/app.
    const flat = path.join(outDir, entry, "resources", "app");
    if (fs.existsSync(flat)) found.push(flat);
    const macRoot = path.join(outDir, entry);
    if (!fs.statSync(macRoot).isDirectory()) continue;
    for (const inner of fs.readdirSync(macRoot)) {
      if (!inner.endsWith(".app")) continue;
      const bundled = path.join(macRoot, inner, "Contents", "Resources", "app");
      if (fs.existsSync(bundled)) found.push(bundled);
    }
  }
  return found;
}

const problems = [];
let ran = 0;

const dirs = appDirs();
if (dirs.length === 0) {
  console.error(
    `[verify-packed-cli] no packed app found under ${outDir} — run \`electron-builder --dir\` first.`,
  );
  process.exit(1);
}

for (const app of dirs) {
  for (const rel of ["bin/penguin", "bin/penguin.cmd", "dist/penguin.js"]) {
    const file = path.join(app, ...rel.split("/"));
    if (!fs.existsSync(file)) {
      problems.push(`${app}: ${rel} is missing from the packed app.`);
      continue;
    }
    // The POSIX launcher is exec'd directly by the /usr/bin/penguin symlink a deb install
    // creates; writeFileSync's mode is masked by the umask, hence the explicit chmod in
    // scripts/build-assets.mjs that this pins.
    if (process.platform !== "win32" && rel === "bin/penguin") {
      if ((fs.statSync(file).mode & 0o111) === 0)
        problems.push(`${app}: ${rel} is not executable.`);
    }
  }

  const launcher =
    process.platform === "win32"
      ? path.join(app, "bin", "penguin.cmd")
      : path.join(app, "bin", "penguin");
  if (!fs.existsSync(launcher)) continue;
  // Node has refused to exec .cmd without a shell since the CVE-2024-27980 fix; the path
  // is this script's own, not user input.
  const result =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/c", launcher, "--version"], {
          encoding: "utf8",
        })
      : spawnSync(launcher, ["--version"], { encoding: "utf8" });
  const printed = (result.stdout ?? "").trim();
  if (result.status !== 0) {
    // A bundle for another architecture cannot run here; that is not a packaging fault, so
    // this alone does not fail the check — the `ran === 0` guard below does, once no bundle
    // has run. The reason is printed either way, because it is the diagnosis when it does.
    const why = result.error?.message ?? `exit ${result.status}: ${(result.stderr ?? "").trim()}`;
    console.log(`[verify-packed-cli] ${app}: launcher did not run on this host (${why}).`);
    continue;
  }
  if (printed !== `v${version}`) {
    problems.push(
      `${app}: penguin --version printed ${JSON.stringify(printed)}, want v${version}.`,
    );
    continue;
  }
  ran += 1;
  console.log(`[verify-packed-cli] ${app}: penguin --version -> ${printed}`);
}

if (ran === 0 && problems.length === 0) {
  problems.push(`none of the ${dirs.length} packed app(s) produced a runnable penguin launcher.`);
}

if (problems.length > 0) {
  console.error("[verify-packed-cli] failed:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("");
  process.exit(1);
}

console.log(`[verify-packed-cli] ok: ${ran}/${dirs.length} packed app(s) ran their bundled CLI.`);
