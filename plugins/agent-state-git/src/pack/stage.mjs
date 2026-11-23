/** Create deterministic local payloads at package time. No install hook runs on a user's host. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import sources from "./sources.json" with { type: "json" };
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { TABLE, keptFiles, windowsSubfolder } from "../layout.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cache = process.env.DUGITE_CACHE_DIR || path.join(root, "node_modules/.cache/dugite");
const out = path.join(root, "dist/native");

async function checksum(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifiedArchive(pin) {
  const file = path.join(cache, pin.name);
  if ((await checksum(file).catch(() => null)) === pin.checksum) return file;
  await fs.mkdir(cache, { recursive: true });
  const temp = path.join(cache, pin.name + "." + randomUUID() + ".part");
  try {
    const response = await fetch(pin.url, { signal: AbortSignal.timeout(15 * 60_000) });
    if (!response.ok || !response.body)
      throw new Error(`Cannot stage ${pin.name}: HTTP ${response.status}`);
    await pipeline(response.body, createWriteStream(temp, { flags: "wx" }));
    if ((await checksum(temp)) !== pin.checksum)
      throw new Error(`Checksum mismatch for ${pin.name}`);
    await fs.rename(temp, file);
    return file;
  } finally {
    await fs.rm(temp, { force: true });
  }
}

export async function stageTarget(target) {
  const pin = TABLE[target];
  if (!pin) return;
  const [platform, arch] = target.split("-");
  const programs = keptFiles(platform, arch);
  const selected = new Set(programs);
  const prefix = platform === "win32" ? windowsSubfolder(arch) + "/" : "";
  const licenseDirs = [
    "libiconv",
    "gettext-runtime",
    "pcre2",
    "zlib",
    "libgcc",
    "gcc-libs",
    "libwinpthread",
    "winpthreads",
  ];
  const roots = [
    prefix + "share/git-core/templates/",
    ...licenseDirs.map((n) => prefix + "share/licenses/" + n + "/"),
  ];
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-git-payload-"));
  const contents = path.join(stage, "contents");
  try {
    const upstream = await verifiedArchive(pin);
    await fs.mkdir(contents);
    await tar.x({
      file: upstream,
      cwd: contents,
      strict: true,
      filter(name, entry) {
        const rel = name.replace(/^\.\//, "");
        return (
          entry.type === "File" &&
          (selected.has(rel) ||
            rel === "LICENSE.txt" ||
            rel === "etc/package-versions.txt" ||
            roots.some((base) => rel.startsWith(base)) ||
            (platform === "win32" && rel.startsWith("usr/share/licenses/gcc-libs/")))
        );
      },
    });
    for (const rel of programs) await fs.access(path.join(contents, rel));
    await fs.chmod(path.join(contents, programs[0]), 0o755);
    const files = (await fs.readdir(contents, { recursive: true, withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) =>
        path.relative(contents, path.join(e.parentPath, e.name)).split(path.sep).join("/"),
      )
      .sort();
    await fs.mkdir(out, { recursive: true });
    await tar.c(
      { cwd: contents, file: path.join(out, target + ".tar"), portable: true, noMtime: true },
      files,
    );
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

async function stageSources(releaseArchive) {
  const legal = path.join(root, "dist/sources");
  await fs.mkdir(legal, { recursive: true });
  const included = sources.filter((source) => releaseArchive || !source.releaseOnly);
  for (const source of included) {
    const file = await verifiedArchive(source);
    if (!releaseArchive) await fs.copyFile(file, path.join(legal, source.name));
  }
  if (releaseArchive) {
    await fs.mkdir(path.dirname(releaseArchive), { recursive: true });
    await tar.c(
      { cwd: cache, file: releaseArchive, portable: true, noMtime: true },
      included.map((source) => source.name),
    );
  } else {
    const tag = process.env.PENGUIN_RELEASE_TAG;
    const release = tag
      ? [
          "https://github.com/Prism-Shadow/penguin-harness/releases/download/" +
            encodeURIComponent(tag) +
            "/agent-state-git-sources.tar",
          "",
        ]
      : [];
    await fs.writeFile(
      path.join(legal, "SOURCES.txt"),
      [...release, ...sources.map((source) => source.checksum + "  " + source.url)].join("\n") +
        "\n",
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [option, destination] = process.argv.slice(2);
  if (option === "--release-sources" && destination) {
    await stageSources(path.resolve(destination));
  } else {
    if (option && option !== "--host")
      throw new Error("Expected --host or --release-sources <archive>");
    const targets =
      option === "--host" ? [process.platform + "-" + process.arch] : Object.keys(TABLE);
    for (const target of targets) await stageTarget(target);
    if (!option) await stageSources();
  }
}
