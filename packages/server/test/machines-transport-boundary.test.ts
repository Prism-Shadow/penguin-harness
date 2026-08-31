/**
 * One mouth per machine: nothing outside machines/transport/ may open ssh or reach around
 * the MachineConnection seam (transport/connection.ts). The incident behind the rule
 * (#561) grew exactly where a call site opened its own channel and judged the machine's
 * liveness from that channel's state.
 *
 * A source scan rather than a lint rule: it runs with the suite everywhere, and its
 * failure message names the offending file. Tests are exempt — a unit test of a private
 * module imports it by nature.
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
  it("only machines/transport/ spawns ssh or scp", () => {
    const spawners = outside
      .filter((f) => /\b(?:spawn|execFile)\(\s*["'](?:ssh|scp)["']/.test(f.text))
      .map((f) => f.rel);
    expect(spawners).toEqual([]);
  });

  it("the directory is entered through its index alone", () => {
    const reachers = outside
      .filter((f) => /from\s+["'][^"']*\/transport\/(?!index\.js)/.test(f.text))
      .map((f) => f.rel);
    expect(reachers).toEqual([]);
  });

  it("the private modules' old top-level paths stay gone", () => {
    const stragglers = outside
      .filter(
        (f) =>
          f.rel.startsWith("machines/") &&
          /from\s+["']\.\/(?:exec|ssh-session|forward|targets)\.js["']/.test(f.text),
      )
      .map((f) => f.rel);
    expect(stragglers).toEqual([]);
  });
});
