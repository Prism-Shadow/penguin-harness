/**
 * Highlighting must stay off the main thread, and the engine must stay out of the main bundle.
 *
 * Tokenizing is linear in the size of the input and runs to completion once it starts, so the
 * viewer's responsiveness depends on it happening in a worker. Two edits would quietly undo that
 * without failing a build or looking wrong in review: calling the engine directly from a
 * component, and turning the client's fallback `await import(…)` into a static import — which
 * bundles a second ~147KB copy of Shiki into the entry chunk for every reader whose worker works,
 * the very cost the split exists to avoid.
 *
 * vitest runs node-only here (`environment: "node"`, no jsdom), so this asserts against the
 * source text rather than a running worker.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const CHAT = join(SRC, "features/chat");

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

describe("the highlighting worker", () => {
  it("is what the client talks to", () => {
    const client = readFileSync(join(CHAT, "highlighter.ts"), "utf8");
    // `new URL(…, import.meta.url)` is the form Vite resolves into a bundled worker chunk; a
    // bare string path builds without complaint and 404s at runtime.
    expect(client).toMatch(
      /new Worker\(\s*new URL\("\.\/highlighter\.worker\.ts", import\.meta\.url\)/,
    );
  });

  it("owns the only static import of the engine", () => {
    const importers = sources(SRC)
      .filter(([, src]) => /^import\s(?!type\s)[^;]*from "[^"]*highlighter-core"/m.test(src))
      .map(([path]) => path);
    expect(importers).toEqual(["features/chat/highlighter.worker.ts"]);
  });

  it("leaves the client's own use of the engine dynamic, as its fallback", () => {
    const client = readFileSync(join(CHAT, "highlighter.ts"), "utf8");
    expect(client).toMatch(/await import\("\.\/highlighter-core"\)/);
  });
});
