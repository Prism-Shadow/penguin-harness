/** Choose an explicit Git, the current platform's copy shipped as files, or unpack it from this plugin. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { x as extract } from "tar";
import { keptFiles, pinFor, windowsSubfolder, type GitProgram } from "./layout.js";

export { keptFiles, pinFor, type GitPin, type GitProgram } from "./layout.js";

function operatorGit(directory: string): GitProgram {
  const windows = process.platform === "win32";
  return {
    program: path.resolve(directory, windows ? "cmd/git.exe" : "bin/git"),
    execPath: path.resolve(
      directory,
      windows ? windowsSubfolder(process.arch) : "",
      "libexec/git-core",
    ),
  };
}

export async function locateGit(opts: {
  cacheDir: string;
  env?: Readonly<Record<string, string | undefined>>;
  log?: (line: string) => void;
  /** Where this package's payloads are; its own `dist/native/` unless a test names another. */
  nativeDir?: string;
}): Promise<{ git: GitProgram; source: string } | null> {
  const custom = (opts.env ?? process.env).LOCAL_GIT_DIRECTORY;
  if (custom) return { git: operatorGit(custom), source: "LOCAL_GIT_DIRECTORY" };
  const pin = pinFor();
  if (!pin) return null;
  const target = process.platform + "-" + process.arch;
  const native = opts.nativeDir ?? fileURLToPath(new URL("../dist/native/", import.meta.url));
  const kept = keptFiles(process.platform, process.arch)[0]!;
  // A host that has to sign every program it carries cannot leave one inside an archive: the
  // macOS desktop app ships this platform's payload as files, signed with the app, and it runs
  // from there. Extracting a copy would only produce the same program a second time.
  const unpacked = path.join(native, target, kept);
  try {
    await fs.access(unpacked);
    return {
      git: { program: unpacked, execPath: path.dirname(unpacked) },
      source: "bundled " + target + ", unpacked",
    };
  } catch {
    // The package as published: the payload is an archive.
  }
  const archive = path.join(native, target + ".tar");
  const destination = path.join(opts.cacheDir, "bundled-" + pin.checksum);
  const program = path.join(destination, kept);
  try {
    await fs.access(program);
  } catch {
    await fs.mkdir(opts.cacheDir, { recursive: true });
    const stage = await fs.mkdtemp(path.join(opts.cacheDir, "extract-"));
    try {
      await extract({ file: archive, cwd: stage, strict: true });
      await fs.chmod(path.join(stage, path.relative(destination, program)), 0o755);
      try {
        await fs.rename(stage, destination);
      } catch (error) {
        // A concurrent server may already have installed this exact release.
        try {
          await fs.access(program);
        } catch {
          throw error;
        }
      }
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
  }
  return { git: { program, execPath: path.dirname(program) }, source: "bundled " + target };
}
