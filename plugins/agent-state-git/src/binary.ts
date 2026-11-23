/** Choose an explicit Git or unpack the current platform's copy from this plugin. */
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
}): Promise<{ git: GitProgram; source: string } | null> {
  const custom = (opts.env ?? process.env).LOCAL_GIT_DIRECTORY;
  if (custom) return { git: operatorGit(custom), source: "LOCAL_GIT_DIRECTORY" };
  const pin = pinFor();
  if (!pin) return null;
  const target = process.platform + "-" + process.arch;
  const archive = fileURLToPath(new URL("../dist/native/" + target + ".tar", import.meta.url));
  const destination = path.join(opts.cacheDir, "bundled-" + pin.checksum);
  const program = path.join(destination, keptFiles(process.platform, process.arch)[0]!);
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
