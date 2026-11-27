#!/usr/bin/env node
/**
 * Puts the portable Linux node-pty bindings (scripts/build-linux-pty.sh) into node-pty
 * installs, so whatever is packed from one next carries a binding every supported Linux loads:
 * the release's lib/, the desktop app's staged copy (packages/desktop/src/pty-payload.ts), and
 * the install image, the carried store and a hot push, which scripts/deploy.mjs packs.
 *
 *   node scripts/stage-linux-pty.mjs <bindings-dir> [<node-pty dir>...]
 *
 * Each `<bindings-dir>/linux-<arch>/pty.node` becomes `prebuilds/linux-<arch>/pty.node`, which
 * node-pty's loader tries after build/ — the one place a copy packed on macOS or Windows can
 * carry a Linux binding at all. A `build/Release/pty.node` that is a Linux binary, the one
 * node-gyp compiled for the machine that installed it, is replaced with the portable binding
 * for its architecture: the loader tries build/ first, and its refusal is what the server
 * reports when no copy loads (packages/server/src/terminal/pty-module.ts). With no node-pty
 * dir, the workspace's own install is staged — the one the server, the desktop build and
 * deploy.mjs resolve.
 *
 * Files are replaced by unlinking them first: pnpm hardlinks package files out of its store,
 * and writing through such a link would change the store's copy for every other checkout.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isElf, readElf } from "./lib/elf.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The workspace's node-pty package directory, resolved as the server resolves it. */
export function workspaceNodePty() {
  const require = createRequire(path.join(ROOT, "packages", "server", "package.json"));
  return path.dirname(require.resolve("node-pty/package.json"));
}

function replace(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.rmSync(to, { force: true });
  fs.copyFileSync(from, to);
}

/**
 * Stages the bindings under `bindingsDir` into each of `ptyDirs`. Returns the package-relative
 * paths written, per directory. Throws, before writing anything, on a binding built for another
 * architecture than its directory names, and on a Linux build/Release binding no portable one
 * was given for.
 */
export function stageLinuxPty(bindingsDir, ptyDirs) {
  const bindings = new Map();
  for (const name of fs.readdirSync(bindingsDir).sort()) {
    const arch = /^linux-(.+)$/.exec(name)?.[1];
    const file = path.join(bindingsDir, name, "pty.node");
    if (arch === undefined || !fs.existsSync(file)) continue;
    const { machine } = readElf(fs.readFileSync(file));
    if (machine !== arch) throw new Error(`${file} is built for ${machine}, not ${arch}`);
    bindings.set(arch, file);
  }
  if (bindings.size === 0) throw new Error(`no linux-<arch>/pty.node under ${bindingsDir}`);

  const plans = ptyDirs.map((dir) => {
    if (!fs.existsSync(path.join(dir, "package.json"))) {
      throw new Error(`${dir} is not a node-pty package directory`);
    }
    const writes = [...bindings].map(([arch, from]) => ({
      from,
      rel: `prebuilds/linux-${arch}/pty.node`,
    }));
    const built = path.join(dir, "build", "Release", "pty.node");
    const bytes = fs.existsSync(built) ? fs.readFileSync(built) : null;
    if (bytes !== null && isElf(bytes)) {
      const { machine } = readElf(bytes);
      const from = bindings.get(machine);
      if (from === undefined) {
        throw new Error(
          `${built} is a Linux ${machine} binding built where it was installed, and no portable linux-${machine} binding was given to replace it`,
        );
      }
      writes.push({ from, rel: "build/Release/pty.node" });
    }
    return { dir, writes };
  });

  return plans.map(({ dir, writes }) => {
    for (const { from, rel } of writes) replace(from, path.join(dir, ...rel.split("/")));
    return { dir, staged: writes.map(({ rel }) => rel) };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [bindingsDir, ...dirs] = process.argv.slice(2);
  if (bindingsDir === undefined) {
    console.error("usage: node scripts/stage-linux-pty.mjs <bindings-dir> [<node-pty dir>...]");
    process.exit(2);
  }
  for (const { dir, staged } of stageLinuxPty(
    bindingsDir,
    dirs.length > 0 ? dirs : [workspaceNodePty()],
  )) {
    console.log(`${dir}: ${staged.join(", ")}`);
  }
}
