/**
 * One-shot build-and-deploy to a running runtime: `node scripts/deploy.mjs <port>`.
 *
 * Aimed at one ad-hoc target and run once — for deploying to a machine reached through an
 * ssh tunnel (`ssh -L <port>:127.0.0.1:<remote port> …`) as much as to a local runtime.
 *
 * Builds the web dist, compiles the platform and cli entries, and pushes all three as ONE
 * atomic version to POST /api/hmr/upgrade. Authentication is an admin session established
 * per run: PENGUIN_ADMIN_PASSWORD is read from the environment and exchanged for a cookie,
 * so no credential of any kind is written to disk — a file holding an admin-equivalent
 * secret is readable by everything running as this user, agent shells included, which makes
 * the file itself the vulnerability.
 *
 * A target refuses a build that cannot run every plugin installed there, naming them. In a
 * terminal the script then asks whether to push anyway; anywhere else it stops, and
 * `--force` is how a run that cannot be asked says yes up front. Pushed that way, the target
 * runs without those plugins and says so on its Plugins page, where they can be repaired.
 *
 * `--out <file>` builds the same version and writes the push body to a file instead of
 * pushing it: the body POST /api/hmr/upgrade takes, every part inline. That is how a server
 * running from a checkout builds the install image it puts on machines
 * (packages/server/src/machines/checkout-image.ts), so the packer is this one, not a second
 * copy of it. It needs no target and no credential, and builds the web dist beside the file
 * rather than in packages/web/dist, which that server may be serving (see `webDist`).
 *
 * Usage:
 *   PENGUIN_ADMIN_PASSWORD=… node scripts/deploy.mjs 53531
 *   PENGUIN_ADMIN_PASSWORD=… node scripts/deploy.mjs 53531 --skip-web-build
 *   PENGUIN_ADMIN_PASSWORD=… node scripts/deploy.mjs 53531 --force
 *   PENGUIN_ADMIN_PASSWORD=… node scripts/deploy.mjs https://box.example.com
 *   node scripts/deploy.mjs --out /tmp/version.gz
 *
 * A target that has already committed this exact build is left alone: the push would only make
 * it import the same platform as another generation (see deploy-same-build.mjs). `--force`
 * pushes anyway.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { unsafePlaintextTarget } from "./deploy-target-safety.mjs";
import {
  LEAVE_OUT,
  UNSATISFIED_PLUGINS_HEADER,
  leftOutPlugins,
  pluginLines,
  refusalStep,
  refusedPlugins,
  saidYes,
} from "./deploy-unsatisfied-plugins.mjs";
import { checkoutFacts, originUrl } from "./build-git-stamp.mjs";
import { compilePushBundle, pushBundleOptions } from "./push-bundle.mjs";
import { FAR_SIDE_SCRIPTS } from "./far-side-scripts.mjs";
import { buildBuiltinPlugins } from "./build-plugins.mjs";
import { archiveName, packArchive, prefixPackages } from "./asset-archives.mjs";
import { typescriptPayload } from "./typescript-payload.mjs";
import { libraryPayload } from "./library-payload.mjs";
import { BENCHMARKS_DIR, buildBenchmarks } from "./build-benchmarks.mjs";
import { createHash } from "node:crypto";
import { buildPointers, committedBuildMatches } from "./deploy-same-build.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIST = path.join(ROOT, "packages", "web", "dist");
const PLATFORM_ENTRY = path.join(ROOT, "packages", "server", "src", "hmr", "entry.ts");
const CLI_ENTRY = path.join(ROOT, "packages", "cli", "src", "index.ts");
const PLATFORM_BUNDLE = path.join(os.tmpdir(), `penguin-deploy-platform-${process.pid}.mjs`);
const CLI_BUNDLE = path.join(os.tmpdir(), `penguin-deploy-cli-${process.pid}.mjs`);

const log = (msg) => console.log(`[deploy] ${msg}`);

/**
 * Provenance for this push, recorded with the version so `penguin version --json` on the
 * target can name where its harness came from — harness.json's copy, alongside the same
 * revision inlined into the bundles themselves.
 *
 * `revision` is spelled exactly as core's BuildInfo.describe, `-dirty` included: a deploy
 * from an uncommitted tree is normal here and the record has to admit it, since the sha
 * alone would name code that never existed. Null when this is not a checkout of this
 * repository, in which case the push carries no `source` rather than a fabricated one.
 *
 * A release build is the exception: the release workflow stamps core before building (its
 * tree is dirty by construction), and the bundles compiled from it report that release —
 * `v<version>`, channel `release`. That is what its image records, so a machine reporting a
 * release beside this image reads as running it rather than as a release that fell back from
 * a pushed build (packages/server/src/machines/install-server.ts's runningBuild).
 */
async function pushSource() {
  const repo = originUrl();
  const built = await compiledIdentity();
  if (built.channel === "release") {
    return { repo: repo ?? path.basename(ROOT), revision: built.describe };
  }
  const facts = checkoutFacts();
  if (facts?.described == null || repo === null) return null;
  return { repo, revision: facts.described };
}

/**
 * The identity the bundles compiled here report: core's buildInfo(), from the core build they
 * inline (the alias in push-bundle.mjs resolves the same package).
 */
async function compiledIdentity() {
  const core = await import("@prismshadow/penguin-core");
  return core.buildInfo();
}

function usage(problem) {
  console.error(
    `${problem}\n\n` +
      "Usage: PENGUIN_ADMIN_PASSWORD=… node scripts/deploy.mjs <port|url> [--skip-web-build] [--force]\n" +
      "       PENGUIN_API_TOKEN=$(cat <root>/api-token) node scripts/deploy.mjs <port|url>\n" +
      "       node scripts/deploy.mjs --out <file> [--skip-web-build]\n" +
      "  <port>  a port on this machine (an ssh -L tunnel to the target runtime, or a local server)\n" +
      "  <url>   a full origin, when the target is not reached over loopback\n" +
      "  <file>  where to write the version instead of pushing it (gzipped upgrade body)\n" +
      "  --force push even if the target has this build or has plugins it cannot run; unsupported plugins are left out\n",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const skipWebBuild = args.includes("--skip-web-build");
/** Override same-build skipping and allow a push that leaves unsupported plugins out. */
const force = args.includes("--force");
const outIndex = args.indexOf("--out");
const outFile = outIndex === -1 ? null : (args[outIndex + 1] ?? "");
if (outFile !== null && (outFile === "" || outFile.startsWith("--"))) {
  usage("[deploy] --out needs a file.");
}
const target = args.find((a, i) => !a.startsWith("--") && (outIndex === -1 || i !== outIndex + 1));
if (outFile === null && target === undefined) usage("[deploy] no target given.");
if (outFile !== null && target !== undefined) {
  usage("[deploy] --out writes the version to a file; give it no target.");
}

/**
 * Where this run's web dist is built and read back. A push builds it in place, as it always
 * has. `--out` builds it into a directory of its own beside the out file: a server running
 * from this checkout builds its install image this way, and that server — `pnpm desktop`, or
 * the dev server's own static fallback — serves packages/web/dist to the page in use, so a
 * build in place would take the page's files out from under it. `--skip-web-build` only reads
 * the dist, so it reads it in place either way.
 */
const webDist =
  outFile !== null && !skipWebBuild ? path.resolve(`${outFile}.${process.pid}.web`) : WEB_DIST;

// Two credentials, either one: the admin password (exchanged for a cookie), or the
// runtime's own local API token (`<root>/api-token`, admin-equivalent — see
// server/src/auth/api-token.ts), sent as a Bearer. A local push needs no password.
const ADMIN_PASSWORD = process.env.PENGUIN_ADMIN_PASSWORD;
const API_TOKEN = process.env.PENGUIN_API_TOKEN;
if (outFile === null && !ADMIN_PASSWORD && !API_TOKEN)
  usage(
    "[deploy] set PENGUIN_ADMIN_PASSWORD or PENGUIN_API_TOKEN (the runtime's <root>/api-token).",
  );

/** A bare port means this machine's loopback (typically an ssh -L tunnel to the real target). */
const baseUrl =
  target === undefined
    ? null
    : /^\d+$/.test(target)
      ? `http://127.0.0.1:${target}`
      : target.replace(/\/+$/, "");

const plaintextProblem = baseUrl === null ? null : unsafePlaintextTarget(baseUrl);
if (plaintextProblem) usage(`[deploy] ${plaintextProblem}`);

/**
 * On a loopback bind 127.0.0.1 is the PREVIEW host, where /api answers 401; the API is
 * served under the canonical app host. A tunnel lands on 127.0.0.1:<port> at this end,
 * so the request must still be addressed to `localhost` by name.
 */
const hostOverride =
  baseUrl !== null && new URL(baseUrl).hostname === "127.0.0.1" ? "localhost" : undefined;

/**
 * node:http rather than the global fetch: fetch (undici) silently derives Host from the
 * URL and ignores an explicit `headers.host`, which breaks the override above.
 */
function request(urlStr, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: { ...headers, ...(hostOverride ? { host: hostOverride } : {}) },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** The request headers that authenticate as admin: a Bearer token, or a cookie from a password login. */
async function authHeaders() {
  if (API_TOKEN) return { authorization: `Bearer ${API_TOKEN}` };
  return { cookie: await login() };
}

/** Signs in as `admin` and returns the session cookie. */
async function login() {
  const res = await request(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "admin", password: ADMIN_PASSWORD }),
  });
  if (res.status !== 200) {
    throw new Error(`admin login failed (${res.status}): ${res.body.toString("utf8")}`);
  }
  const setCookie = res.headers["set-cookie"];
  if (!setCookie?.length) throw new Error("login succeeded but set no session cookie");
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

/**
 * Whether the target has already committed `build`, from its GET /api/version. Anything short of a
 * readable report that matches is an answer of "no", with the reason: the push goes ahead
 * exactly as it did before this check.
 */
async function targetRunsThisBuild(auth, build) {
  let res;
  try {
    res = await request(`${baseUrl}/api/version`, { headers: auth });
  } catch (err) {
    return {
      same: false,
      reason: `GET /api/version failed: ${err instanceof Error ? err.message : err}`,
    };
  }
  if (res.status !== 200) return { same: false, reason: `GET /api/version → ${res.status}` };
  let report;
  try {
    report = JSON.parse(res.body.toString("utf8"));
  } catch {
    return { same: false, reason: "GET /api/version answered something that is not JSON" };
  }
  return committedBuildMatches(report, buildPointers(build));
}

/**
 * Compiles one entry to a self-contained ESM file, every npm dependency inlined (see
 * push-bundle.mjs, which holds the options).
 */
async function compileEntry(entry, outfile) {
  if (!fs.existsSync(entry)) throw new Error(`compile entry missing: ${entry}`);
  // The platform imports its generated interface table; make sure it is current.
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/gen-ifaces.mjs"),
      "--project",
      path.join(ROOT, "packages/server/tsconfig.json"),
      "--out",
      path.join(ROOT, "packages/server/src/ifaces.json"),
    ],
    { stdio: "inherit" },
  );
  await compilePushBundle(pushBundleOptions(entry, outfile));
}

/** The built web dist as a { relPath: base64 } manifest. */
async function readWebManifest() {
  const files = {};
  for (const entry of await fsp.readdir(webDist, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    files[path.relative(webDist, abs).split(path.sep).join("/")] = await fsp.readFile(abs);
  }
  return files;
}

/**
 * cmd.exe gets a `shell: true` spawn's args joined into one command line, unquoted, so a path
 * with a space in it (a data root under `C:\Users\Jane Doe`) would split in two. Quoted the way
 * build-plugins.mjs quotes.
 */
const quoteForCmd = (a) => (/[\s"^&|<>;,()%!]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

/**
 * Files the pushed platform needs as real files rather than bundled code. A bundle cannot carry one: it is
 * imported from the runtime's data root, where node-pty's own relative `build/Release/
 * pty.node` does not resolve. So the package ships whole — its JS, its prebuilds and its
 * darwin `spawn-helper` — and the runtime unpacks it next to the bundle (hmr/host.ts's
 * UpgradeAssets), where node-pty's normal resolution works again.
 *
 * `exec` carries the files whose exec bit must survive the trip: base64 has no mode, and a
 * spawn-helper without it makes every terminal fail to start on macOS.
 */
async function readNativeAssets() {
  const ptyDir = path.dirname(
    require.resolve("node-pty/package.json", {
      paths: [path.join(ROOT, "packages", "server")],
    }),
  );
  const files = {};
  const exec = [];
  // Only what the loader reads at runtime. `.pdb` files are Windows debug symbols that
  // nothing ever loads and are 90% of the package's bytes (58 MB → 3 MB without them),
  // which is the difference between a push that crosses an ssh tunnel and one that does
  // not; `.lib` are link-time import libraries, equally never read at runtime.
  const wanted = (rel) =>
    !rel.endsWith(".pdb") &&
    !rel.endsWith(".lib") &&
    (rel === "package.json" ||
      rel.startsWith("lib/") ||
      rel.startsWith("build/Release/") ||
      rel.startsWith("prebuilds/"));
  const pty = [];
  for (const entry of await fsp.readdir(ptyDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(ptyDir, abs).split(path.sep).join("/");
    if (!wanted(rel)) continue;
    // node-pty ships its prebuilt spawn-helper as 0644; the archive records it executable
    // regardless of how it looks on this machine.
    const executable = rel.endsWith("spawn-helper") || ((await fsp.stat(abs)).mode & 0o111) !== 0;
    pty.push({ rel: `node_modules/node-pty/${rel}`, abs, exec: executable });
  }
  // Every package travels as ONE archive (scripts/asset-archives.mjs): a push of hundreds of
  // small files is hundreds of blobs, probes and transfers, and stalls. The platform unpacks
  // `archives/*.tgz` before resolving anything from its assets (hmr/asset-archives.ts).
  files[`archives/${archiveName("", "node-pty")}`] = await packArchive(pty);
  // The compiler plugin interfaces and workflows are checked with: the target's program may
  // predate it being a dependency (or be a desktop bundle with no node_modules), and a
  // platform that cannot find it compares no plugin interface and loads no workflow.
  // Content-addressed like everything here, so it crosses once.
  files[`archives/${archiveName("", "typescript")}`] = await packArchive(
    typescriptPayload(path.join(ROOT, "packages", "server")).map(({ rel, abs }) => ({
      rel: `node_modules/typescript/${rel}`,
      abs,
      exec: false,
    })),
  );
  // The scripts that run on the FAR side — the release installers a remote install feeds
  // over, the one thing that has to arrive before the CLI does. A pushed bundle resolves them
  // from its own assets directory, so a push that omits one leaves a server that cannot
  // install a machine at all. Same set the packaged build copies into dist/; see the module.
  for (const { name, from } of FAR_SIDE_SCRIPTS) {
    files[name] = await fsp.readFile(path.join(ROOT, from));
  }
  // The builtin plugins, as the npm prefix the loader resolves from (`plugins/package.json`
  // + `plugins/node_modules/<name>/…`, see scripts/build-plugins.mjs), from cache when
  // unchanged — one archive per package, so an unchanged plugin is an unchanged blob.
  const built = await buildBuiltinPlugins({ log });
  const { byPackage, loose } = await prefixPackages(built.dir, built.files, "plugins");
  files["archives/plugins.tgz"] = await packArchive(loose);
  for (const [pkg, entries] of byPackage) {
    files[`archives/${archiveName("plugins.", pkg)}`] = await packArchive(entries);
  }
  // The skill/hook plugin LIBRARY this build was made with. Without it the target reads the
  // library of whatever program booted the platform, so a plugin newer than that program is
  // never offered there (see scripts/library-payload.mjs).
  const library = await libraryPayload(ROOT);
  try {
    files["archives/library.tgz"] = await packArchive(library.entries);
  } finally {
    await library.cleanup();
  }
  log(`plugin library: ${library.names.length} plugins packed`);
  await buildBenchmarks();
  const benchmarks = [];
  for (const entry of await fsp.readdir(BENCHMARKS_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    if (abs === path.join(BENCHMARKS_DIR, "catalog.json")) continue;
    benchmarks.push({
      rel: `builtin-benchmarks/${path.relative(BENCHMARKS_DIR, abs).split(path.sep).join("/")}`,
      abs,
      exec: false,
    });
  }
  files["archives/benchmarks.tgz"] = await packArchive(benchmarks);
  return { files, exec };
}

/** One line from the terminal; a closed input (Ctrl-C, Ctrl-D) reads as an empty answer. */
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.on("close", () => {
      if (!answered) resolve("");
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  if (skipWebBuild) {
    if (!fs.existsSync(path.join(WEB_DIST, "index.html"))) {
      throw new Error(`--skip-web-build given but ${WEB_DIST} has no index.html`);
    }
    log("reusing the existing web dist");
  } else {
    log("building the web dist…");
    // Extra args reach the package's own `vite build`. Outside the package, vite would leave
    // the directory as it found it and warn; it is this run's own, so it is emptied.
    const build = ["--filter", "@prismshadow/penguin-web", "build"];
    if (webDist !== WEB_DIST) build.push("--outDir", webDist, "--emptyOutDir");
    const windows = process.platform === "win32";
    execFileSync("pnpm", windows ? build.map(quoteForCmd) : build, {
      cwd: ROOT,
      stdio: "inherit",
      // pnpm is a .cmd shim on Windows, which Node refuses to spawn without a shell.
      shell: windows,
    });
  }

  log("compiling platform + cli…");
  await compileEntry(PLATFORM_ENTRY, PLATFORM_BUNDLE);
  await compileEntry(CLI_ENTRY, CLI_BUNDLE);

  const files = await readWebManifest();
  const assets = await readNativeAssets();
  const source = await pushSource();

  const platform = await fsp.readFile(PLATFORM_BUNDLE);
  const cli = await fsp.readFile(CLI_BUNDLE);
  const mapValues = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
  const body = (part) => ({
    platform: part(platform, "utf8"),
    cli: part(cli, "utf8"),
    web: { files: mapValues(files, (b) => part(b, "base64")) },
    assets: { files: mapValues(assets.files, (b) => part(b, "base64")), exec: assets.exec },
    ...(source === null ? {} : { source }),
  });

  if (outFile !== null) {
    // Every part inline: whoever reads the file has no store to resolve a name from.
    const gz = zlib.gzipSync(
      Buffer.from(JSON.stringify(body((bytes, encoding) => bytes.toString(encoding)))),
    );
    // Written beside and renamed in, so a reader never takes half a version for a whole one.
    const tmp = `${outFile}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, gz);
    await fsp.rename(tmp, outFile);
    if (source !== null) log(`provenance: ${source.revision}`);
    log(
      `wrote ${Object.keys(files).length} web files + ${Object.keys(assets.files).length} assets + 2 bundles (${(gz.length / 1048576).toFixed(1)} MB) to ${outFile}`,
    );
    return;
  }

  const auth = await authHeaders();
  if (force) {
    log("--force: pushing without asking what the target runs");
  } else {
    const running = await targetRunsThisBuild(auth, {
      platform,
      cli,
      web: files,
      assets: assets.files,
    });
    if (running.same) {
      log(
        `the target already has this build (${source?.revision ?? "no provenance"}); nothing pushed. ` +
          "--force pushes it again.",
      );
      return;
    }
    log(`pushing: ${running.reason}`);
  }
  // Content-addressed transfer, the way git pushes: name every part by its sha256, ask the
  // target which blobs it lacks, PUT only those (raw), then push a body of names. A target
  // without the probe (an older runtime) answers 404 and gets every part inline.
  const blobs = new Map();
  let payload = body((bytes) => {
    const sha = createHash("sha256").update(bytes).digest("hex");
    blobs.set(sha, bytes);
    return { sha };
  });
  const probe = await request(`${baseUrl}/api/hmr/assets/probe`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify({ hashes: [...blobs.keys()] }),
  });
  if (probe.status === 200) {
    let sent = 0;
    for (const sha of JSON.parse(probe.body.toString("utf8")).missing) {
      const bytes = blobs.get(sha);
      if (bytes === undefined) continue;
      const put = await request(`${baseUrl}/api/hmr/blobs/${sha}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream", ...auth },
        body: bytes,
      });
      if (put.status !== 200) {
        throw new Error(`PUT /api/hmr/blobs/${sha} → ${put.status}: ${put.body.toString("utf8")}`);
      }
      sent += bytes.length;
    }
    log(`${blobs.size} blobs; ${(sent / 1048576).toFixed(1)} MB were new to the target`);
  } else {
    log("target has no probe: pushing everything inline");
    payload = body((bytes, encoding) => bytes.toString(encoding));
  }
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload)));
  if (source !== null) log(`provenance: ${source.revision}`);
  log(
    `pushing ${Object.keys(files).length} web files + ${Object.keys(assets.files).length} assets + 2 bundles (${(gz.length / 1048576).toFixed(1)} MB body) to ${baseUrl}…`,
  );

  let started = Date.now();
  const send = (leaveOut) =>
    request(`${baseUrl}/api/hmr/upgrade`, {
      method: "POST",
      headers: {
        "content-type": "application/gzip",
        ...(leaveOut ? { [UNSATISFIED_PLUGINS_HEADER]: LEAVE_OUT } : {}),
        ...auth,
      },
      body: gz,
    });
  let res = await send(force);
  let text = res.body.toString("utf8");
  const refused = refusedPlugins(res.status, text);
  if (refused !== null) {
    // Not an error yet: the target kept its version and is asking. Only a person may say
    // yes — here at the prompt, or beforehand with --force.
    log(
      "the target kept its current version: this build cannot fully run plugins installed there.",
    );
    for (const line of pluginLines(refused)) console.error(line);
    if (
      refusalStep(process.stdin.isTTY === true && process.stdout.isTTY === true) === "needs-force"
    ) {
      console.error(
        "[deploy] not pushed. Run again with --force to push anyway; the target then runs without them.",
      );
      process.exitCode = 1;
      return;
    }
    if (!saidYes(await ask("[deploy] Push anyway and run without them? [y/N] "))) {
      log("not pushed.");
      process.exitCode = 1;
      return;
    }
    started = Date.now();
    res = await send(true);
    text = res.body.toString("utf8");
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`/api/hmr/upgrade → ${res.status}: ${text}`);
  }
  const outcome = JSON.parse(text);
  if (outcome.status === "blocked") {
    // A blocked upgrade is a first-class outcome, not an HTTP error: the running
    // version keeps serving and these paths say what would have been discarded.
    log(`BLOCKED after ${seconds}s — the target kept its current version.`);
    console.error(JSON.stringify(outcome, null, 2));
    process.exitCode = 1;
    return;
  }
  log(
    `ok in ${seconds}s — impl ${outcome.impl}, mode ${outcome.mode}, web rev ${outcome.web?.rev}`,
  );
  const leftOut = leftOutPlugins(outcome);
  if (leftOut.length > 0) {
    console.warn("[deploy] the target runs this build without plugins installed there:");
    for (const line of pluginLines(leftOut, true)) console.warn(line);
    console.warn(
      // The App answers under `localhost` by name (see hostOverride), so that is the link to open.
      `[deploy] Repair them from ${baseUrl.replace("//127.0.0.1", "//localhost")}/plugins ("Fix with AI" on each plugin's row), or leave ` +
        "them as they are: they stay installed and run again on a build that has what they need.",
    );
  }
  if (outcome.persisted === false) {
    // The live swap took effect, but the server could not write it to disk (see
    // host.ts's persistVersion) — a restart on the target reverts to the previously
    // committed version, silently undoing this push.
    console.warn(
      "[deploy] WARNING: the target could not persist this version to disk (persisted: false). " +
        "It is live now but will REVERT on the target's next restart — check the target's disk/permissions.",
    );
  }
}

main()
  .catch((err) => {
    console.error(`[deploy] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const f of [PLATFORM_BUNDLE, CLI_BUNDLE]) fs.rmSync(f, { force: true });
    if (webDist !== WEB_DIST) fs.rmSync(webDist, { recursive: true, force: true });
  });
