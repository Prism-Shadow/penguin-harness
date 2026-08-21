/**
 * Staging node-pty into the app directory — pure filesystem logic, no Electron imports
 * (unit-tested).
 *
 * node-pty is the one native module the embedded server needs, and the only dependency the
 * bundler cannot absorb. The server reaches it through `createRequire(import.meta.url)
 * ("node-pty")` (packages/server/src/platform/terminal/pty-module.ts), and node-pty's own
 * loader then resolves `../build/Release/pty.node` or `../prebuilds/<platform>-<arch>/pty.node`
 * relative to its lib/ directory — on darwin also `../<that dir>/spawn-helper`, a side binary
 * it execs. All of that needs a real package directory on disk, so scripts/build-assets.mjs
 * writes one to `dist/node_modules/node-pty`: the first node_modules the resolver meets walking
 * up from dist/server.js, in a source run and inside a packaged app alike.
 *
 * Not the whole npm install. node-pty's prebuilds carry ~44 MB of Windows .pdb debug symbols,
 * and its TypeScript sources, node-gyp inputs and vendored winpty sources are build-time only —
 * out of that vendored tree only the license ships, alongside the winpty binaries built from it.
 * scripts/deploy.mjs selects the same way for the copy an HMR push carries as an asset, but not
 * over the same set: that rule is looser, keeping the sourcemaps and node-pty's own tests and
 * shipping no license. Same shape, different destination and transport — and separate, so
 * changing one leaves the other exactly as it was.
 */
import fs from "node:fs";
import path from "node:path";

/** Where the bundled server resolves node-pty, relative to the app directory. */
export const NODE_PTY_RELDIR = ["dist", "node_modules", "node-pty"];

/**
 * Individual files that ship at their own path: the manifest whose `main` the require lands on,
 * node-pty's MIT license, and winpty's — node-pty's license does not cover that vendored
 * project, whose winpty.dll and winpty-agent.exe ship in the win32 prebuilds below.
 */
const SHIPPED_FILES = ["package.json", "LICENSE", "deps/winpty/LICENSE"];

/**
 * Package-root directories whose contents ship: the JavaScript, the binding node-gyp builds
 * where no prebuild exists (Linux), and the prebuilt binaries for every other platform.
 */
const SHIPPED_DIRS = ["lib", "build/Release", "prebuilds"];

/**
 * Never shipped, wherever they appear: sourcemaps, node-pty's own test build, and the Windows
 * debug symbols and link-time import libraries nothing loads at runtime.
 */
const DROPPED_SUFFIXES = [".map", ".test.js", ".pdb", ".lib"];

/** node-pty's darwin side binary, which its npm tarball ships without the exec bit. */
const SPAWN_HELPER = "spawn-helper";

/** Package-relative, POSIX-separated path of an entry inside a node-pty install. */
function toRelPosix(...segments: string[]): string {
  return segments.join("/");
}

/** Whether a file at this package-relative path belongs in the staged copy. */
export function shipsNodePtyFile(relPath: string): boolean {
  const rel = relPath.split(path.sep).join("/");
  if (DROPPED_SUFFIXES.some((suffix) => rel.endsWith(suffix))) return false;
  if (SHIPPED_FILES.includes(rel)) return true;
  return SHIPPED_DIRS.some((dir) => rel.startsWith(`${dir}/`));
}

/** Whether a directory can still contain a shipped file — everything else is pruned unvisited. */
function descendsInto(relPath: string): boolean {
  const rel = relPath.split(path.sep).join("/");
  return (
    SHIPPED_DIRS.some(
      (dir) => dir === rel || dir.startsWith(`${rel}/`) || rel.startsWith(`${dir}/`),
    ) || SHIPPED_FILES.some((file) => file.startsWith(`${rel}/`))
  );
}

function copyInto(srcDir: string, destDir: string, relBase: string, copied: string[]): void {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const rel = relBase === "" ? entry.name : toRelPosix(relBase, entry.name);
    const from = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      if (descendsInto(rel)) copyInto(from, path.join(destDir, entry.name), rel, copied);
      continue;
    }
    if (!shipsNodePtyFile(rel)) continue;
    const to = path.join(destDir, entry.name);
    fs.mkdirSync(destDir, { recursive: true });
    // copyFileSync follows the symlink pnpm's store uses and lands real bytes.
    fs.copyFileSync(from, to);
    // node-pty publishes spawn-helper as 0644, which makes posix_spawnp refuse it and every
    // macOS terminal fail to start. The runtime repair in the server cannot reach a signed
    // .app under /Applications, so the mode is fixed here, before the app is packed.
    if (entry.name === SPAWN_HELPER) fs.chmodSync(to, 0o755);
    copied.push(rel);
  }
}

/**
 * Replaces `destDir` with the shipping subset of the node-pty install at `srcDir`. Returns the
 * package-relative paths copied, in walk order.
 */
export function stageNodePty(srcDir: string, destDir: string): string[] {
  fs.rmSync(destDir, { recursive: true, force: true });
  const copied: string[] = [];
  copyInto(srcDir, destDir, "", copied);
  return copied;
}

/** The native bindings among a staged file list — an empty result means the copy ships no pty. */
export function nativeBindings(relPaths: string[]): string[] {
  return relPaths.filter((rel) => rel.endsWith("/pty.node"));
}

/**
 * The staged binding node-pty's loader will actually find here, in its own search order
 * (lib/utils.js: build/Release, then prebuilds/<platform>-<arch>). Undefined means the copy
 * carries bindings for other platforms only: node-pty prebuilds darwin and win32 but not
 * Linux, so an install whose node-gyp step never ran still looks populated to a check that
 * only asks whether some pty.node exists.
 */
export function hostBinding(
  relPaths: string[],
  platform: string = process.platform,
  arch: string = process.arch,
): string | undefined {
  return ["build/Release/pty.node", `prebuilds/${platform}-${arch}/pty.node`].find((rel) =>
    relPaths.includes(rel),
  );
}
