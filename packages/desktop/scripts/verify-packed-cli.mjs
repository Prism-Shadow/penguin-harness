/**
 * The packed app carries a working `penguin`.
 *
 * Run after `electron-builder --dir` (CI's runtime job builds exactly that tree). An
 * installed desktop app puts the CLI on the user's PATH: the deb postinst links
 * /usr/bin/penguin at install time, and the other three forms install this same launcher
 * from the shell at launch (src/cli-install.ts). Every one of them resolves <app>/bin/penguin and
 * <app>/dist/penguin.js as plain files inside the packed tree, so `bin/` dropping out of
 * electron-builder's `files`, asar being switched on, or the bundled entry being renamed
 * would ship an app whose `penguin` command does not exist — with nothing else in the
 * build failing. The unit tests pin those couplings in the config files; this checks the
 * tree they produced.
 *
 * Every app directory found is checked for the launchers and the bundled entry. The
 * launcher is then actually run: a cross-architecture bundle that cannot execute on this
 * host is reported and skipped, but at least one has to run and report a version.
 *
 * It is also checked for what the Machines page installs on another computer from it: the
 * server bundle at the path the server recognizes as a packaged app, the release installers
 * and the install image (the harness a machine runs, in the hot push's format) beside it,
 * and the app's own package.json naming this build's version — the release a machine
 * downloads. None of them is imported by anything, so an app without them builds, starts
 * and runs its CLI, and only an install on a machine fails. So is the main window's preload, a
 * bundle nothing imports either: an app without it starts, and its Windows and Linux windows
 * have no button to minimize, maximize or close them.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { libraryParts } from "@prismshadow/penguin-core";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { FAR_SIDE_SCRIPTS } = await import(
  pathToFileURL(path.resolve(pkgDir, "..", "..", "scripts", "far-side-scripts.mjs")).href
);
// The market covers ride beside the server bundle too, and nothing imports them either: an app
// without them starts, and its plugin market draws generated covers until a fetch succeeds.
const { MARKET_COVERS_NAME, marketCoverFiles } = await import(
  pathToFileURL(path.resolve(pkgDir, "..", "..", "scripts", "market-covers.mjs")).href
);
const coverFiles = marketCoverFiles(path.resolve(pkgDir, "..", "..")).map(
  (rel) => `dist/${MARKET_COVERS_NAME}/${rel}`,
);
const outDir = path.join(pkgDir, "out");
const ownPkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const version = ownPkg.version;
/** The plugin packages the bundled loader will look for: every @penguinharness/* in this package's dependencies (the one field the packaged manifest keeps). */
const pluginNames = Object.keys(ownPkg.dependencies ?? {}).filter((name) =>
  name.startsWith("@penguinharness/"),
);

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

/**
 * Whether `penguin --version` named this build. The CLI prints its identity rather than a
 * bare version number: a release build prints `v<version>`, while a build from a checkout
 * prints git's description of it — `v<version>-3-g<sha>` when a tag is reachable, and
 * `v<version>-g<sha>` when none is, which is what a shallow CI checkout produces (core's
 * composeDescribe assembles both). Every form is `v<version>` alone or carrying a `-`
 * suffix; a launcher that ran some other bundle, or printed anything but a version, is not.
 */
function namesThisBuild(printed) {
  return printed === `v${version}` || printed.startsWith(`v${version}-`);
}

// The TypeScript compiler the build staged (scripts/build-assets.mjs): its entry and the default
// library files it reads from its own directory. electron-builder leaves every `*.d.ts` out of
// `files`, so the library files travel as extra resources (electron-builder.yml); an app packed
// without them resolves the compiler and then fails every workflow it compiles.
const compilerDir = path.join(pkgDir, "dist", "node_modules", "typescript");
const compilerFiles = fs.existsSync(path.join(compilerDir, "lib"))
  ? [
      "package.json",
      ...fs
        .readdirSync(path.join(compilerDir, "lib"))
        .sort()
        .map((name) => `lib/${name}`),
    ].map((rel) => `dist/node_modules/typescript/${rel}`)
  : [];
if (compilerFiles.length === 0) {
  console.error(
    `[verify-packed-cli] no staged compiler under ${compilerDir} — run the desktop build first.`,
  );
  process.exit(1);
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
  // The Web App travels by a `from: ../web/dist` mapping that electron-builder skips
  // WITHOUT complaint when the source is absent — a pack run before the web build shipped
  // an app whose every page was a 404. The shell now refuses to start such a build
  // (src/web-dist.ts); this catches it before anything is uploaded.
  // The plugin library travels as electron-builder's collected dependencies, at the app root's
  // node_modules: the packed server resolves each package by name from there, and a plugin
  // that did not make it in is simply absent from every Agent's library, with nothing else
  // failing. Verify each package's actual declarations, including server-only modules.
  const pluginFiles = pluginNames.map((name) => `node_modules/${name}/package.json`);
  for (const name of pluginNames) {
    const dir = path.join(app, "node_modules", name);
    const parts = libraryParts(dir);
    if (!Object.values(parts).some(Boolean)) {
      problems.push(`${dir}: no declared Agent contributions or loadable server module.`);
    }
    for (const sub of ["skills", "hooks", "workbenches"]) {
      if (parts[sub] && !fs.existsSync(path.join(dir, sub))) {
        problems.push(`${dir}: missing declared ${sub}/.`);
      }
    }
  }
  for (const rel of [
    "bin/penguin",
    "bin/penguin.cmd",
    "dist/penguin.js",
    "dist/server.js",
    // The main window's preload, a bundle of its own (tsup.config.ts): without it Windows and
    // Linux windows have no minimize, maximize or close button at all.
    "dist/preload.cjs",
    ...FAR_SIDE_SCRIPTS.map(({ name }) => `dist/${name}`),
    ...coverFiles,
    "dist/install-image.gz",
    "web-dist/index.html",
    ...pluginFiles,
    ...compilerFiles,
    // The Node declarations workbench code is checked with: `*.d.ts` that travel as extra
    // resources like the compiler's libraries. Without them the manifest alone is left and
    // every workbench fails to load with TS2688.
    "dist/node_modules/@types/node/package.json",
    "dist/node_modules/@types/node/index.d.ts",
    "dist/node_modules/undici-types/package.json",
    "dist/node_modules/undici-types/index.d.ts",
  ]) {
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

  let packedVersion = null;
  try {
    packedVersion = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8")).version;
  } catch {
    // Reported below with the rest.
  }
  if (packedVersion !== version) {
    problems.push(
      `${app}: package.json names version ${JSON.stringify(packedVersion)}, want ${version} — the release a machine install downloads.`,
    );
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
  if (!namesThisBuild(printed)) {
    problems.push(
      `${app}: penguin --version printed ${JSON.stringify(printed)}, want v${version} or v${version}-<git description>.`,
    );
    continue;
  }
  ran += 1;
  console.log(`[verify-packed-cli] ${app}: penguin --version -> ${printed}`);
  // Exercise the native engine from the server's installed prefix, with no PATH Git or network.
  const gitPlugin = path.join(app, "plugins/node_modules/@penguinharness/agent-state-git");
  // A macOS app carries Git for its own architecture alone (build/mac-native-git.cjs), so the
  // other architecture's app, whose launcher Rosetta may still have run, has none for this Node.
  const hostGit = path.join(gitPlugin, "dist/native", `${process.platform}-${process.arch}`);
  if (process.platform === "darwin" && !fs.existsSync(hostGit)) {
    console.log(`[verify-packed-cli] ${app}: built for another architecture, native Git not run.`);
    continue;
  }
  const gitSmoke = spawnSync(
    process.execPath,
    [path.resolve(pkgDir, "../../plugins/agent-state-git/test/packed.mjs"), gitPlugin],
    { stdio: "inherit" },
  );
  if (gitSmoke.status !== 0) problems.push(`${app}: native Git failed to save and read a version.`);
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
