#!/usr/bin/env node
/**
 * Fails when a Linux native module the build ships needs a newer glibc than the release
 * promises to run on.
 *
 *   node scripts/check-native-glibc.mjs [--glibc <x.y>] [--expect <path>]... <path>...
 *
 * Why it exists: node-pty compiles its Linux binding with whatever toolchain installs it, and
 * the release used to install it on `ubuntu-latest`. When that label moved from Ubuntu 24.04
 * to 26.04 (between 0.2.18 and 0.2.19), the binding started binding cfsetispeed and
 * cfsetospeed at GLIBC_2.42 instead of the 2.34 it had needed, and every terminal on a Linux
 * machine with an older glibc failed to start — with nothing in the build, the tests or the
 * release noticing (issue #1900). The bindings are now built in a manylinux_2_28 container
 * (scripts/build-linux-pty.sh); this is what makes a binding that slipped past that, or any
 * other native addon a payload picks up, fail the run that would have shipped it.
 *
 * Every `<path>` is read as it ships: a directory is walked, a `.tgz` / `.tar.gz` / `.tar` is
 * read member by member (archives inside it too — the carried store keeps node-pty as
 * `archives/node-pty.tgz`), and another `.gz` is read as an install image (the gzipped JSON
 * `scripts/deploy.mjs --out` writes), whose assets are read the same way. Each `*.node` that
 * is an ELF object is checked: every `GLIBC_x.y` it binds must be at most `--glibc` (default
 * 2.28, the glibc nodejs.org's Linux builds of Node 24 need, so a binding never asks more of a
 * machine than the runtime the release bundles), and one under a `linux-<arch>/` directory
 * must be built for that architecture. darwin and win32 bindings are not ELF and are skipped.
 *
 * `--expect <path>` names a binding that must be among those checked, matched against the end
 * of its reported path (`archive!member` for a file inside an archive): a check that found no
 * Linux binding at all would otherwise pass, and a missing one is the other half of #1900.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { compareVersions, glibcVersion, isElf, readElf } from "./lib/elf.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The server's own dependency, as scripts/asset-archives.mjs packs with it.
const tar = createRequire(path.join(ROOT, "packages", "server", "package.json"))("tar");

/** The glibc a release's Linux native code may need at most: Node 24's own (see above). */
export const GLIBC_FLOOR = "2.28";

const isTar = (name) => /\.(tgz|tar\.gz|tar)$/.test(name);
/** A file that is, or may carry, a native module: a binding, an archive, an install image. */
const readable = (name) => name.endsWith(".node") || name.endsWith(".gz") || isTar(name);

/** The members of a tar archive (gzipped or not) worth reading here, with their bytes. */
async function tarMembers(bytes) {
  const read = [];
  await new Promise((resolve, reject) => {
    const parser = new tar.Parser();
    parser.on("entry", (entry) => {
      const name = entry.path.replace(/^\.\//, "");
      if (entry.type !== "File" || !readable(name)) {
        entry.resume();
        return;
      }
      const chunks = [];
      entry.on("data", (chunk) => chunks.push(chunk));
      read.push(
        new Promise((done) => entry.on("end", () => done({ name, bytes: Buffer.concat(chunks) }))),
      );
    });
    parser.on("end", resolve);
    parser.on("error", reject);
    parser.end(bytes);
  });
  return Promise.all(read);
}

/**
 * Checks every Linux `*.node` under `paths` against `floor`. Returns the bindings it checked
 * (`{ where, machine, glibc }`, `glibc` the newest version one binds, null for none) and the
 * problems it found, each one sentence.
 */
export async function checkNativeGlibc(paths, { floor = GLIBC_FLOOR, expect = [] } = {}) {
  const checked = [];
  const problems = [];

  const binding = (where, bytes) => {
    if (!isElf(bytes)) return; // a darwin (Mach-O) or win32 (PE) binding
    let elf;
    try {
      elf = readElf(bytes);
    } catch (err) {
      problems.push(`${where}: cannot read this Linux binary (${err.message}).`);
      return;
    }
    let newest = null;
    const over = new Map();
    for (const need of elf.needs) {
      const version = glibcVersion(need.version);
      if (version === null) continue;
      if (newest === null || compareVersions(version, newest) > 0) newest = version;
      if (compareVersions(version, floor) > 0) over.set(need.version, need.symbols);
    }
    checked.push({ where, machine: elf.machine, glibc: newest });
    if (over.size > 0) {
      const detail = [...over]
        .sort(([a], [b]) => compareVersions(glibcVersion(b), glibcVersion(a)))
        .map(([version, symbols]) => `${version} (${symbols.join(", ") || "no symbol named"})`)
        .join(", ");
      problems.push(
        `${where} needs glibc ${newest}, newer than the ${floor} a release supports: ${detail}. It was compiled against a newer glibc than that; build it against ${floor} (node-pty's bindings: scripts/build-linux-pty.sh).`,
      );
    }
    const dir = /(?:^|[/!])linux-(x64|arm64|ia32|arm)\/[^/!]+$/.exec(where)?.[1];
    if (dir !== undefined && dir !== elf.machine) {
      problems.push(`${where} sits under linux-${dir} but is built for ${elf.machine}.`);
    }
  };

  const file = async (where, name, bytes) => {
    if (name.endsWith(".node")) return binding(where, bytes);
    if (isTar(name)) {
      let members;
      try {
        members = await tarMembers(bytes);
      } catch (err) {
        problems.push(`${where}: cannot read this archive (${err.message}).`);
        return;
      }
      for (const member of members) {
        await file(`${where}!${member.name}`, member.name, member.bytes);
      }
      return;
    }
    if (name.endsWith(".gz")) {
      // An install image: gzip(JSON) whose assets carry node-pty as an archive. Any other
      // gzip holds no native module this reads.
      let build;
      try {
        build = JSON.parse(zlib.gunzipSync(bytes).toString("utf8"));
      } catch {
        return;
      }
      const assets = build?.assets?.files;
      if (assets === null || typeof assets !== "object") return;
      for (const [rel, b64] of Object.entries(assets)) {
        if (typeof b64 === "string") await file(`${where}!${rel}`, rel, Buffer.from(b64, "base64"));
      }
    }
  };

  const walk = async (abs, where) => {
    const stat = fs.lstatSync(abs);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) {
        await walk(path.join(abs, name), `${where}/${name}`);
      }
      return;
    }
    // A symlinked directory is not followed (pnpm's node_modules is made of them); a
    // symlinked file is read through.
    if (!stat.isFile() && !stat.isSymbolicLink()) return;
    const name = path.basename(abs);
    if (!readable(name)) return;
    if (stat.isSymbolicLink() && !fs.statSync(abs).isFile()) return;
    await file(where, name, fs.readFileSync(abs));
  };

  for (const p of paths) {
    if (!fs.existsSync(p)) {
      problems.push(`${p} does not exist.`);
      continue;
    }
    await walk(path.resolve(p), p.replace(/\/+$/, ""));
  }
  for (const suffix of expect) {
    const found = checked.some(
      ({ where }) =>
        where === suffix || where.endsWith(`/${suffix}`) || where.endsWith(`!${suffix}`),
    );
    if (!found) problems.push(`no Linux binding at ${suffix} among what was checked.`);
  }
  return { checked, problems };
}

function usage(message) {
  console.error(
    `${message}\nusage: node scripts/check-native-glibc.mjs [--glibc <x.y>] [--expect <path>]... <path>...`,
  );
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const paths = [];
  const expect = [];
  let floor = GLIBC_FLOOR;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--glibc") {
      floor = args.shift() ?? usage("--glibc needs a version");
      if (!/^\d+\.\d+$/.test(floor)) usage(`--glibc ${floor} is not a version like 2.28`);
    } else if (arg === "--expect") {
      expect.push(args.shift() ?? usage("--expect needs a path"));
    } else if (arg.startsWith("--")) {
      usage(`unknown option ${arg}`);
    } else {
      paths.push(arg);
    }
  }
  if (paths.length === 0) usage("no path to check");
  const { checked, problems } = await checkNativeGlibc(paths, { floor, expect });
  for (const { where, machine, glibc } of checked) {
    console.log(`${where}  ${machine}  needs glibc ${glibc ?? "(nothing versioned)"}`);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`error: ${problem}`);
    process.exit(1);
  }
  console.log(`${checked.length} Linux native module(s), none needs a glibc newer than ${floor}.`);
}
