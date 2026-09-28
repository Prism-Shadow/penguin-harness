/**
 * One mouth per machine, and no kind of machine in the main tree. Nothing in packages/server/src
 * starts a machine's program by name — ssh, scp, wsl.exe, a container CLI are their kinds'
 * (plugins/machine-*), transport/ included — nothing outside machines/transport/ reaches around
 * the MachineConnection seam (transport/connection.ts), and nothing outside it spells or reads an
 * address's kind prefix. The incident behind the seam (#561) grew exactly where a call site
 * opened its own channel and judged the machine's liveness from that channel's state.
 *
 * A source scan rather than a lint rule: it runs with the suite everywhere, and its failure
 * message names the offending file. Tests are exempt — a unit test of a private module imports
 * it by nature.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".ts")) yield full;
  }
}

const files = [...walk(SRC)].map((full) => ({
  rel: path.relative(SRC, full).replaceAll(path.sep, "/"),
  text: fs.readFileSync(full, "utf8"),
}));
const outside = files.filter((f) => !f.rel.startsWith("machines/transport/"));

describe("the transport boundary", () => {
  it("nothing in the main tree starts a machine's program by name — not even transport/", () => {
    const programs =
      /\b(?:spawn|spawnSync|execFile|execFileSync|run|runWithInput)\(\s*["'](?:ssh|scp|wsl(?:\.exe)?|docker|podman|nerdctl)["']/;
    const spawners = files.filter((f) => programs.test(f.text)).map((f) => f.rel);
    expect(spawners).toEqual([]);
  });

  it("the directory is entered through its index alone", () => {
    const reachers = outside
      .filter((f) => /from\s+["'][^"']*\/transport\/(?!index\.js)/.test(f.text))
      .map((f) => f.rel);
    expect(reachers).toEqual([]);
  });

  it("the private modules' old paths stay gone", () => {
    // Each relative specifier is resolved against the importing file rather than matched by
    // shape, so a caller anywhere under src/ reaching for `../machines/exec.js` is caught,
    // not only a sibling writing `./exec.js`.
    const gone = new Set([
      "machines/exec.js",
      "machines/targets.js",
      "machines/ssh-session.js",
      "machines/forward.js",
      "machines/ssh-config.js",
      "machines/transport/ssh-session.js",
      "machines/transport/socks.js",
      "machines/transport/targets.js",
    ]);
    const specifiers = /from\s+["'](\.{1,2}\/[^"']+)["']/g;
    const stragglers = files
      .filter((f) => {
        const dir = path.posix.dirname(f.rel);
        return [...f.text.matchAll(specifiers)].some((m) =>
          gone.has(path.posix.normalize(path.posix.join(dir, m[1]!))),
        );
      })
      .map((f) => f.rel);
    expect(stragglers).toEqual([]);
  });

  it("outside transport/, no file slices an address or spells a kind prefix into one", () => {
    const sliced = /\.slice\(\s*["'](?:ssh|wsl|docker|podman):["']\.length\s*\)/;
    const spelled = /`(?:ssh|wsl|docker|podman):\$\{/;
    // A prefix built from a variable, in the code that handles machines (a messaging connector
    // spelling its own `${kind}:${id}` keys is no address).
    const built = /\$\{[^}]*\bkind\b[^}]*\}:\$\{/;
    const machinesCode = (rel: string) =>
      rel.startsWith("machines/") ||
      rel.startsWith("port-forwards/") ||
      rel === "http/routes/machines.ts";
    const offenders = outside
      .filter(
        (f) =>
          sliced.test(f.text) ||
          spelled.test(f.text) ||
          (machinesCode(f.rel) && built.test(f.text)),
      )
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
