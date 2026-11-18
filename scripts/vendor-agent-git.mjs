/**
 * Stage GitHub Desktop's pinned Git for Agent State. Downloads run on the build machine.
 * A server or npm installation never downloads a binary at runtime or in an install script.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(import.meta.dirname, "agent-git");
const notices = ["COPYING", "SOURCES.md"];
const noticeHash = createHash("sha256");
for (const name of notices) noticeHash.update(await fs.readFile(path.join(SOURCE, name)));
const noticeStamp = noticeHash.digest("hex");
const CACHE = path.join(ROOT, "node_modules", ".cache", "agent-state-git");
const SERVER = path.join(ROOT, "packages", "server");
const tar = createRequire(path.join(SERVER, "package.json"))("tar");
const pins = JSON.parse(await fs.readFile(path.join(SOURCE, "pins.json"), "utf8"));
export const gitTargets = Object.keys(pins);
export const gitVendorDir = path.join(SERVER, "vendor", "agent-git");

const windowsDirs = { "win32-x64": "ucrt64", "win32-arm64": "clangarm64", "win32-ia32": "mingw32" };
const dlls = ["libiconv-2.dll", "libintl-8.dll", "libpcre2-8-0.dll", "zlib1.dll"];
const noticeDirs = new Set([
  "libiconv",
  "gettext-runtime",
  "pcre2",
  "zlib",
  "libgcc",
  "libwinpthread",
]);

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function archive(pin) {
  const file = path.join(CACHE, pin.name);
  await fs.mkdir(CACHE, { recursive: true });
  if ((await sha256(file).catch(() => null)) === pin.checksum) return file;
  const tmp = file + "." + randomUUID();
  try {
    const response = await fetch(pin.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body)
      throw new Error(`Git archive download failed: HTTP ${response.status} (${pin.url})`);
    const handle = await fs.open(tmp, "wx");
    try {
      await pipeline(response.body, handle.createWriteStream());
    } finally {
      await handle.close();
    }
    if ((await sha256(tmp)) !== pin.checksum) throw new Error(`Wrong SHA-256 for ${pin.name}`);
    await fs.rename(tmp, file).catch(async (error) => {
      if (
        !["EEXIST", "EPERM"].includes(error.code) ||
        (await sha256(file).catch(() => null)) !== pin.checksum
      )
        throw error;
    });
    return file;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/** Stage only built-in Git commands and the DLLs directly or transitively imported by git.exe. */
const hostTarget = `${process.platform}-${process.arch}`;
export async function vendorAgentGit(
  targets = gitTargets.includes(hostTarget) ? [hostTarget] : [],
) {
  await fs.mkdir(gitVendorDir, { recursive: true });
  for (const target of targets) {
    const pin = pins[target];
    if (!pin) throw new Error(`No dugite-native build for ${target}`);
    const dest = path.join(gitVendorDir, target);
    const win = windowsDirs[target];
    const binary = win ? win + "/bin/git.exe" : "bin/git";
    const files = new Set([binary]);
    if (win) {
      const needed =
        target === "win32-ia32" ? [...dlls, "libgcc_s_dw2-1.dll", "libwinpthread-1.dll"] : dlls;
      for (const name of needed) files.add(win + "/bin/" + name);
      files.add("LICENSE.txt");
    }
    const stamp = `2 ${pin.checksum} ${noticeStamp}`;
    async function complete() {
      try {
        if ((await fs.readFile(path.join(dest, "VERSION"), "utf8")) !== stamp) return false;
        await Promise.all([...files, ...notices].map((rel) => fs.access(path.join(dest, rel))));
        return true;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    }
    if (await complete()) continue;
    const stage = await fs.mkdtemp(path.join(gitVendorDir, ".stage-"));
    try {
      const file = await archive(pin);
      await tar.x({
        file,
        cwd: stage,
        strict: true,
        filter(name, entry) {
          if (entry.type !== "File") return false;
          const rel = name.replace(/^\.\//, "");
          if (files.has(rel)) return true;
          const prefix = win + "/share/licenses/";
          return (
            !!win &&
            rel.startsWith(prefix) &&
            noticeDirs.has(rel.slice(prefix.length).split("/")[0])
          );
        },
      });
      for (const rel of files) await fs.access(path.join(stage, rel));
      await fs.chmod(path.join(stage, binary), 0o755);
      for (const name of notices)
        await fs.copyFile(path.join(SOURCE, name), path.join(stage, name));
      await fs.writeFile(path.join(stage, "VERSION"), stamp);
      // Concurrent builds of the same pin publish identical content. A loser reuses the winner.
      if (await complete()) continue;
      // Move an incomplete or superseded tree aside before atomically installing its replacement.
      const old = path.join(gitVendorDir, ".old-" + randomUUID());
      try {
        await fs.rename(dest, old).catch((err) => {
          if (err.code !== "ENOENT") throw err;
        });
        await fs.rename(stage, dest).catch(async (err) => {
          if (!(await complete())) throw err;
        });
      } finally {
        await fs.rm(old, { recursive: true, force: true });
      }
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
  }
  return gitVendorDir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  await vendorAgentGit(args.includes("--all") ? gitTargets : args.length ? args : undefined);
}
