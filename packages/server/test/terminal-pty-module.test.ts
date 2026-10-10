/**
 * Which node-pty a terminal gets (terminal/pty-module.ts) — the difference between a machine
 * whose terminals open and one whose every terminal fails, when the platform it runs was built
 * on another kind of machine (a Mac installing on Linux, x64 on arm64).
 *
 * The copies are real package directories in a temp tree, each a stand-in node-pty whose
 * entry either loads (and says which copy it is) or throws node-pty's own error for a binding
 * built for something else.
 *
 * Scenarios:
 * - Given a pushed platform inside an installed program, the program's own node-pty — published
 *   for this machine — is used, not the pushed one built wherever the deploy ran.
 * - Given the program's copy has no binding for this machine, the pushed copy is tried next.
 * - Given no copy loads, the error says terminals cannot start here and names this machine's
 *   platform, then what each copy said.
 * - The copy that loaded is the one whose directory is reported, for the spawn-helper repair.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadNodePtyFrom, nodePtySources } from "../src/terminal/pty-module.js";
import { makeTempRoot } from "./helpers.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A node-pty package under `<dir>/node_modules/node-pty` that loads, or fails as a foreign binding does. */
function fakeNodePty(dir: string, copy: string, loads: boolean): void {
  const pkg = path.join(dir, "node_modules", "node-pty");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "node-pty", main: "index.js" }));
  fs.writeFileSync(
    path.join(pkg, "index.js"),
    loads
      ? `exports.copy = ${JSON.stringify(copy)}; exports.spawn = () => null;`
      : `throw new Error("Failed to load native module: pty.node, checked: build/Release, build/Debug, prebuilds/linux-arm64");`,
  );
}

/** An installed program (`<program>/lib/dist/penguin-hmr.js`) and a pushed assets directory. */
async function machine(opts: { program: boolean; pushed: boolean }) {
  const root = await makeTempRoot();
  roots.push(root);
  const lib = path.join(root, "program", "lib");
  fs.mkdirSync(path.join(lib, "dist"), { recursive: true });
  const entry = path.join(lib, "dist", "penguin-hmr.js");
  fs.writeFileSync(entry, "");
  fakeNodePty(lib, "program", opts.program);
  const assets = path.join(root, "data", "hmr", "store", "assets", "abc");
  fakeNodePty(assets, "pushed", opts.pushed);
  // The pushed platform's own graph resolves nothing: it is imported from the store.
  const sources = nodePtySources(() => assets, entry).slice(1);
  return { sources, lib, assets };
}

describe("node-pty for a pushed platform", () => {
  it("uses the installed program's copy, built for this machine, over the pushed one", async () => {
    const { sources, lib } = await machine({ program: true, pushed: true });
    const loaded = loadNodePtyFrom(sources);
    expect((loaded.pty as unknown as { copy: string }).copy).toBe("program");
    expect(loaded.dir).toBe(path.join(lib, "node_modules", "node-pty"));
  });

  it("falls back to the pushed copy when the program's has no binding for this machine", async () => {
    const { sources, assets } = await machine({ program: false, pushed: true });
    const loaded = loadNodePtyFrom(sources);
    expect((loaded.pty as unknown as { copy: string }).copy).toBe("pushed");
    expect(loaded.dir).toBe(path.join(assets, "node_modules", "node-pty"));
  });

  it("says plainly that terminals cannot start here when no copy loads, and what each said", async () => {
    const { sources } = await machine({ program: false, pushed: false });
    expect(() => loadNodePtyFrom(sources, "linux-arm64")).toThrow(
      /^Terminals cannot start on this machine: no copy of node-pty here loads on linux-arm64\. \(the installed program's: Failed to load native module.* \/ the pushed build's: Failed to load native module/,
    );
  });
});
