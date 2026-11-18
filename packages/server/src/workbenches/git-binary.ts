import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serverPackageDir } from "../plugin/library-host.js";

let pushed: string | null = null;

/** Like the built-in library, a hot platform takes its native assets from its own build. */
export function usePushedGitDirectory(dir: string | null): void {
  pushed = dir;
}

function executable(root: string): string {
  const target = `${process.platform}-${process.arch}`;
  if (process.platform !== "win32") return path.join(root, target, "bin", "git");
  const prefix =
    process.arch === "arm64" ? "clangarm64" : process.arch === "ia32" ? "mingw32" : "ucrt64";
  return path.join(root, target, prefix, "bin", "git.exe");
}

const local = path.dirname(fileURLToPath(import.meta.url));
const server = serverPackageDir(local);
/** An absolute path avoids developer-tools prompts on bare macOS and does not trust a PATH shim. */
export function agentGit(): string {
  const shell = process.env.PENGUIN_BUNDLED_SHELL;
  if (process.platform === "win32" && shell && path.isAbsolute(shell)) {
    const minGit = path.resolve(path.dirname(shell), "..", "..", "cmd", "git.exe");
    if (fs.existsSync(minGit)) return minGit;
  }
  if (process.platform === "win32") {
    // The desktop also exposes its CLI directly, without the launcher's shell environment.
    const desktopGit = path.resolve(local, "..", "..", "git", "cmd", "git.exe");
    if (fs.existsSync(desktopGit)) return desktopGit;
  }
  for (const base of [
    pushed,
    server && path.join(server, "vendor", "agent-git"),
    path.join(local, "agent-git"),
  ]) {
    if (base) {
      const binary = executable(base);
      if (fs.existsSync(binary)) return binary;
    }
  }
  // Source checkouts before the first build and platforms without a native asset retain system Git.
  return "git";
}
