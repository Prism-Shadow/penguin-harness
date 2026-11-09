/**
 * The highlighting engine stays out of the main bundle.
 *
 * Tokenizing is linear in the size of the input and runs to completion once it starts, so the
 * viewer's responsiveness depends on it happening in a worker. The engine lives in the shared UI
 * package on its own subpath (`@prismshadow/penguin-ui/highlighter`, which the package's code
 * surfaces never import — they ask the highlighter the app hands them), and the app decides where
 * it runs. A static import of the engine anywhere but the worker would quietly bundle a second
 * ~147KB copy of Shiki into the entry chunk for every reader whose worker works, without failing
 * a build or looking wrong in review, so every source file is scanned for one.
 *
 * vitest runs node-only here (`environment: "node"`, no jsdom), so this asserts against the
 * source text rather than a built bundle.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** Every `.ts`/`.tsx` under src/, as [path relative to src, source text]. */
function sources(dir: string, rel = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const next = join(dir, entry.name);
    const label = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sources(next, label));
    else if (/\.tsx?$/.test(entry.name)) out.push([label, readFileSync(next, "utf8")]);
  }
  return out;
}

describe("the highlighting engine", () => {
  it("is imported statically by the worker alone", () => {
    const importers = sources(SRC)
      .filter(([, src]) =>
        /^import\s(?!type\s)[^;]*from "@prismshadow\/penguin-ui\/highlighter"/m.test(src),
      )
      .map(([path]) => path);
    expect(importers).toEqual(["lib/highlight/highlighter.worker.ts"]);
  });
});
