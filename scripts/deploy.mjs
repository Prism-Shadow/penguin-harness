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
 * Usage:
 *   PENGUIN_ADMIN_PASSWORD=… node scripts/deploy.mjs 53531
 *   PENGUIN_ADMIN_PASSWORD=… node scripts/deploy.mjs 53531 --skip-web-build
 *   PENGUIN_ADMIN_PASSWORD=… node scripts/deploy.mjs https://box.example.com
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { unsafePlaintextTarget } from "./deploy-target-safety.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIST = path.join(ROOT, "packages", "web", "dist");
const PLATFORM_ENTRY = path.join(ROOT, "packages", "server", "src", "platform", "entry.ts");
const CLI_ENTRY = path.join(ROOT, "packages", "cli", "src", "index.ts");
const PLATFORM_BUNDLE = path.join(os.tmpdir(), `penguin-deploy-platform-${process.pid}.mjs`);
const CLI_BUNDLE = path.join(os.tmpdir(), `penguin-deploy-cli-${process.pid}.mjs`);

const log = (msg) => console.log(`[deploy] ${msg}`);

function usage(problem) {
  console.error(
    `${problem}\n\n` +
      "Usage: PENGUIN_ADMIN_PASSWORD=… node scripts/deploy.mjs <port|url> [--skip-web-build]\n" +
      "  <port>  a port on this machine (an ssh -L tunnel to the target runtime, or a local server)\n" +
      "  <url>   a full origin, when the target is not reached over loopback\n",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const skipWebBuild = args.includes("--skip-web-build");
const target = args.find((a) => !a.startsWith("--"));
if (target === undefined) usage("[deploy] no target given.");
const ADMIN_PASSWORD = process.env.PENGUIN_ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) usage("[deploy] PENGUIN_ADMIN_PASSWORD is not set.");

/** A bare port means this machine's loopback (typically an ssh -L tunnel to the real target). */
const baseUrl = /^\d+$/.test(target) ? `http://127.0.0.1:${target}` : target.replace(/\/+$/, "");

const plaintextProblem = unsafePlaintextTarget(baseUrl);
if (plaintextProblem) usage(`[deploy] ${plaintextProblem}`);

/**
 * On a loopback bind 127.0.0.1 is the PREVIEW host, where /api answers 401; the API is
 * served under the canonical app host. A tunnel lands on 127.0.0.1:<port> at this end,
 * so the request must still be addressed to `localhost` by name.
 */
const hostOverride = new URL(baseUrl).hostname === "127.0.0.1" ? "localhost" : undefined;

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
 * Compiles one entry to a self-contained ESM file. The banner is load-bearing: several
 * bundled CJS deps call plain `require(...)` inside their own wrapper, and esbuild's ESM
 * output otherwise routes those to a shim that always throws.
 */
async function compileEntry(entry, outfile) {
  if (!fs.existsSync(entry)) throw new Error(`compile entry missing: ${entry}`);
  const esbuild = await import("esbuild");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent",
    banner: {
      js: 'import { createRequire as __penguinCreateRequire } from "node:module"; const require = __penguinCreateRequire(import.meta.url);',
    },
    alias: {
      "@prismshadow/penguin-core/kernel": require.resolve("@prismshadow/penguin-core/kernel"),
    },
  });
}

/** The built web dist as a { relPath: base64 } manifest. */
async function readWebManifest() {
  const files = {};
  for (const entry of await fsp.readdir(WEB_DIST, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    files[path.relative(WEB_DIST, abs).split(path.sep).join("/")] = (
      await fsp.readFile(abs)
    ).toString("base64");
  }
  return files;
}

/**
 * Native modules the pushed platform needs as real files. A bundle cannot carry one: it is
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
  for (const entry of await fsp.readdir(ptyDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(ptyDir, abs).split(path.sep).join("/");
    if (!wanted(rel)) continue;
    const target = `node_modules/node-pty/${rel}`;
    files[target] = (await fsp.readFile(abs)).toString("base64");
    // node-pty ships its prebuilt spawn-helper as 0644; the runtime restores the bit from
    // this list, so push it regardless of how it looks on this machine.
    if (rel.endsWith("spawn-helper") || ((await fsp.stat(abs)).mode & 0o111) !== 0) {
      exec.push(target);
    }
  }
  return { files, exec };
}

async function main() {
  if (skipWebBuild) {
    if (!fs.existsSync(path.join(WEB_DIST, "index.html"))) {
      throw new Error(`--skip-web-build given but ${WEB_DIST} has no index.html`);
    }
    log("reusing the existing web dist");
  } else {
    log("building the web dist…");
    execFileSync("pnpm", ["--filter", "@prismshadow/penguin-web", "build"], {
      cwd: ROOT,
      stdio: "inherit",
    });
  }

  log("compiling platform + cli…");
  await compileEntry(PLATFORM_ENTRY, PLATFORM_BUNDLE);
  await compileEntry(CLI_ENTRY, CLI_BUNDLE);

  const files = await readWebManifest();
  const assets = await readNativeAssets();
  const gz = zlib.gzipSync(
    Buffer.from(
      JSON.stringify({
        platform: await fsp.readFile(PLATFORM_BUNDLE, "utf8"),
        cli: await fsp.readFile(CLI_BUNDLE, "utf8"),
        web: { files },
        assets,
      }),
    ),
  );
  log(
    `pushing ${Object.keys(files).length} web files + ${Object.keys(assets.files).length} native assets + 2 bundles (${(gz.length / 1048576).toFixed(1)} MB) to ${baseUrl}…`,
  );

  const cookie = await login();
  const started = Date.now();
  const res = await request(`${baseUrl}/api/hmr/upgrade`, {
    method: "POST",
    headers: { "content-type": "application/gzip", cookie },
    body: gz,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const text = res.body.toString("utf8");
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
  });
