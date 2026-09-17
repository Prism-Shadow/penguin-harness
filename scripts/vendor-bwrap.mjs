/**
 * The bubblewrap the sandbox backend runs, vendored into the plugin.
 *
 * A deployment must not depend on the host having `bwrap`: most distributions do not install
 * one, several ship a version too old for the profile this backend builds, and asking an
 * operator to `apt install bubblewrap` before the sandbox works is the kind of setup step that
 * silently never happens. The plugin therefore carries its own binary, one per architecture,
 * and falls back to a `bwrap` on PATH only when it has none for this host.
 *
 * WHERE IT COMES FROM: conda-forge, pinned by exact URL and sha256 below. Those builds target
 * an old glibc and carry `$ORIGIN/../lib` as their rpath, so `vendor/<arch>/bin/bwrap` finds
 * `vendor/<arch>/lib/libcap.so.2` beside it with no environment variable — which matters,
 * because a sandbox backend rewrites an argv and never gets to set one.
 *
 * Bubblewrap is LGPL-2.1-or-later and libcap is BSD-3-Clause or GPL-2.0: their license files
 * travel with the binaries (`vendor/<arch>/licenses/`), which is what shipping them requires.
 *
 * Usage (a library for build-plugins.mjs, and a CLI):
 *   node scripts/vendor-bwrap.mjs            vendor into plugins/sandbox-bwrap/vendor/
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompress } from "node:zlib";
import { promisify } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "plugins", "sandbox-bwrap", "vendor");
const CACHE = path.join(ROOT, "node_modules", ".cache", "penguin-bwrap-vendor");
const tar = createRequire(path.join(ROOT, "packages", "server", "package.json"))("tar");
const decompress = promisify(zstdDecompress);

/** Bump when what this script WRITES changes, so a stale vendor directory is rebuilt. */
const VENDOR_FORMAT = 1;

/**
 * What each architecture gets, pinned. A version moves only by editing this table: the sandbox
 * runs what it says, and a build that cannot verify a hash fails rather than shipping a binary
 * nobody pinned.
 */
const TARGETS = [
  {
    arch: "linux-x64",
    packages: [
      {
        url: "https://conda.anaconda.org/conda-forge/linux-64/bubblewrap-0.11.2-h424e585_1.conda",
        sha256: "94458118b18b0c25afc720d012c0ef1bd36fa4d31c2bb92c4d14662857457825",
      },
      {
        url: "https://conda.anaconda.org/conda-forge/linux-64/libcap-2.78-h084b8d7_1.conda",
        sha256: "8cb25174d6b6fac95d31e86cfe41faffc8ee9dacbf2bfd22e6c23377e8f338c1",
      },
    ],
  },
  {
    arch: "linux-arm64",
    packages: [
      {
        url: "https://conda.anaconda.org/conda-forge/linux-aarch64/bubblewrap-0.11.2-h9367005_1.conda",
        sha256: "20022874a86589f68b508a6c34768fdcb418439a780a39d69b94f72403d05e68",
      },
      {
        url: "https://conda.anaconda.org/conda-forge/linux-aarch64/libcap-2.78-hfcc8634_1.conda",
        sha256: "6487e7644d062e18d389c11a9a3183e5a71c2652d05fdd88dbd063ad09f7ad4b",
      },
    ],
  },
];

/** What is taken out of a package: the program, the library it loads, and their licenses. */
const WANTED = [
  { from: "bin/bwrap", to: "bin/bwrap", exec: true },
  { from: /^lib\/libcap\.so(\.\d+)*$/, to: "lib", exec: false },
  { from: /^(info\/)?licenses?\/.+/i, to: "licenses", exec: false },
];

function log(message) {
  process.stdout.write(`[vendor-bwrap] ${message}\n`);
}

/** Downloads once into the cache, keyed by the hash the table pins, and verifies it. */
async function fetchPackage(pkg) {
  await fsp.mkdir(CACHE, { recursive: true });
  const file = path.join(CACHE, `${pkg.sha256}-${path.basename(pkg.url)}`);
  if (fs.existsSync(file)) return file;
  const response = await fetch(pkg.url);
  if (!response.ok) throw new Error(`${pkg.url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== pkg.sha256) {
    throw new Error(`${pkg.url}: sha256 is ${digest}, and the pin says ${pkg.sha256}`);
  }
  await fsp.writeFile(file, bytes);
  log(`${path.basename(pkg.url)}: downloaded (${(bytes.length / 1024).toFixed(0)}KB)`);
  return file;
}

/**
 * A `.conda` package is a ZIP holding `pkg-<name>.tar.zst`; this reads that member out of it
 * without a ZIP library. It goes through the CENTRAL DIRECTORY rather than walking local
 * headers, because these archives are ZIP64: a local header there carries 0xFFFFFFFF for the
 * sizes and leaves the real ones to the central entry's extra field.
 */
export function readZipMember(zip, predicate) {
  const end = findSignature(zip, 0x0605_4b50, 22);
  if (end === -1) throw new Error("not a ZIP: no end-of-central-directory record");
  let entries = zip.readUInt16LE(end + 10);
  let directory = zip.readUInt32LE(end + 16);
  const zip64 = findSignature(zip, 0x0606_4b50, 56);
  if (zip64 !== -1) {
    entries = Number(zip.readBigUInt64LE(zip64 + 32));
    directory = Number(zip.readBigUInt64LE(zip64 + 48));
  }
  let at = directory;
  for (let i = 0; i < entries; i++) {
    if (zip.readUInt32LE(at) !== 0x0201_4b50) throw new Error("malformed central directory");
    const method = zip.readUInt16LE(at + 10);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    let compressed = zip.readUInt32LE(at + 20);
    let localHeader = zip.readUInt32LE(at + 42);
    if (compressed === 0xffff_ffff || localHeader === 0xffff_ffff) {
      ({ compressed, localHeader } = zip64Sizes(
        zip.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength),
        zip.readUInt32LE(at + 24) === 0xffff_ffff,
        compressed === 0xffff_ffff,
        localHeader === 0xffff_ffff,
        { compressed, localHeader },
      ));
    }
    if (predicate(name)) {
      if (method !== 0) {
        throw new Error(`${name}: compressed with method ${method}, expected stored`);
      }
      const start =
        localHeader + 30 + zip.readUInt16LE(localHeader + 26) + zip.readUInt16LE(localHeader + 28);
      return zip.subarray(start, start + compressed);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** The first record with this signature, searched from the end (where ZIP keeps its trailers). */
function findSignature(zip, signature, minimumTail) {
  for (let at = zip.length - minimumTail; at >= 0; at--) {
    if (zip.readUInt32LE(at) === signature) return at;
  }
  return -1;
}

/**
 * The ZIP64 extra field (header id 0x0001) holds whichever of uncompressed size, compressed
 * size and local-header offset the central entry could not, in that order — so which values it
 * carries depends on which ones were 0xFFFFFFFF.
 */
function zip64Sizes(extra, uncompressedIsBig, compressedIsBig, offsetIsBig, fallback) {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const size = extra.readUInt16LE(at + 2);
    if (id === 0x0001) {
      let field = at + 4;
      if (uncompressedIsBig) field += 8;
      const compressed = compressedIsBig
        ? Number(extra.readBigUInt64LE(field))
        : fallback.compressed;
      if (compressedIsBig) field += 8;
      const localHeader = offsetIsBig ? Number(extra.readBigUInt64LE(field)) : fallback.localHeader;
      return { compressed, localHeader };
    }
    at += 4 + size;
  }
  return fallback;
}

/** Unpacks one package into `stage`, keeping only WANTED files. */
async function extract(file, stage) {
  const zip = await fsp.readFile(file);
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "penguin-bwrap-"));
  try {
    // Two members carry what is wanted: `pkg-*` the files themselves, `info-*` the licenses
    // conda-forge keeps under `info/licenses/` — and shipping a binary means shipping those.
    for (const prefix of ["pkg-", "info-"]) {
      const member = readZipMember(
        zip,
        (name) => name.startsWith(prefix) && name.endsWith(".tar.zst"),
      );
      if (member === null) {
        if (prefix === "pkg-") throw new Error(`${file}: no pkg-*.tar.zst inside`);
        continue;
      }
      const tarFile = path.join(scratch, `${prefix}archive.tar`);
      await fsp.writeFile(tarFile, await decompress(member));
      await tar.x({ file: tarFile, cwd: scratch });
    }
    for (const want of WANTED) {
      const matches = (await walk(scratch)).filter((rel) =>
        typeof want.from === "string" ? rel === want.from : want.from.test(rel),
      );
      for (const rel of matches) {
        const target =
          typeof want.from === "string"
            ? path.join(stage, want.to)
            : path.join(stage, want.to, path.basename(rel));
        await fsp.mkdir(path.dirname(target), { recursive: true });
        const source = path.join(scratch, rel);
        const link = await fsp.lstat(source);
        if (link.isSymbolicLink()) {
          // libcap.so.2 → libcap.so.2.78: kept as a link, the way the loader expects it.
          const to = await fsp.readlink(source);
          await fsp.rm(target, { force: true });
          await fsp.symlink(to, target);
        } else {
          await fsp.copyFile(source, target);
          await fsp.chmod(target, want.exec ? 0o755 : 0o644);
        }
      }
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

/** Files under `dir`, as relative posix paths (symlinks included, since libcap ships one). */
async function walk(dir, prefix = "") {
  const out = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

/**
 * Vendors every target into `plugins/sandbox-bwrap/vendor/<arch>/`, skipping the work when the
 * directory already holds this pinning (a `.complete` marker naming it).
 */
export async function vendorBwrap() {
  const pinning = createHash("sha256")
    .update(`${VENDOR_FORMAT}\0${JSON.stringify(TARGETS)}`)
    .digest("hex");
  const marker = path.join(OUT, ".complete");
  if (fs.existsSync(marker) && (await fsp.readFile(marker, "utf8")) === pinning) return OUT;
  await fsp.rm(OUT, { recursive: true, force: true });
  for (const target of TARGETS) {
    const stage = path.join(OUT, target.arch);
    await fsp.mkdir(stage, { recursive: true });
    for (const pkg of target.packages) await extract(await fetchPackage(pkg), stage);
    if (!fs.existsSync(path.join(stage, "bin", "bwrap"))) {
      throw new Error(`${target.arch}: the packages carried no bin/bwrap`);
    }
    log(`${target.arch}: vendored`);
  }
  await fsp.writeFile(marker, pinning);
  return OUT;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  vendorBwrap().then(
    (dir) => log(`ready: ${dir}`),
    (err) => {
      process.stderr.write(`[vendor-bwrap] ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
