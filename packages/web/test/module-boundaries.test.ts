/**
 * The static-import boundaries between the Web App's libraries and its feature modules, as a
 * ratchet. The module tree checks the dependencies it can see (slots, `@Use`); a plain `import`
 * is invisible to it, so these three rules are held here, over every file under `src/`:
 *
 * 1. A library — anything outside `features/` (`lib/`, `api/`, `state/`, `components/`, the root
 *    files) — imports nothing under `features/`.
 * 2. A file under `features/<a>/` reaches `features/<b>/` only through `features/<b>/index.ts`
 *    (or `index.tsx`), never one of its inner files.
 * 3. No import cycle between feature directories. An edge `features/a -> features/b` is reported
 *    when it lies on a cycle, i.e. both ends sit in the same strongly connected component.
 *
 * The code predates the rules, so what breaks them today is listed, one line per edge, in
 * `module-boundaries.baseline.txt`. A violation missing from the baseline fails; so does a
 * baseline line that no longer occurs. The list can only shrink: whoever removes a violation
 * deletes its line in the same change.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const BASELINE = fileURLToPath(new URL("./module-boundaries.baseline.txt", import.meta.url));

/** Every `.ts`/`.tsx` under `dir`, as POSIX paths relative to it. */
function sourceFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(dir, next));
    else if (/\.tsx?$/.test(entry.name)) out.push(next);
  }
  return out;
}

/** Every module specifier a file names: static, type-only, re-exports and dynamic `import()`. */
function specifiers(text: string): string[] {
  return ts.preProcessFile(text, true, true).importedFiles.map((ref) => ref.fileName);
}

/**
 * The src-relative file a relative specifier lands on, `null` for a bare package or anything
 * outside src (the UI package, the server's types), and `undefined` when nothing matches — which
 * fails the test rather than silently narrowing it.
 */
function resolveImport(
  from: string,
  spec: string,
  isFile: (rel: string) => boolean,
): string | null | undefined {
  if (!spec.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  if (base.startsWith("../")) return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find(isFile);
}

/** `features/<name>` for a file under it, else null (the file is a library). */
function featureOf(file: string): string | null {
  const match = /^features\/([^/]+)\//.exec(file);
  return match === null ? null : `features/${match[1]}`;
}

/** Inter-feature edges that lie on a cycle: both ends in one strongly connected component. */
function cycleEdges(edges: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  // Tarjan's algorithm; the graph is a few dozen feature directories.
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const component = new Map<string, number>();
  const stack: string[] = [];
  let counter = 0;
  let components = 0;
  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (!component.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      let member: string;
      do {
        member = stack.pop()!;
        component.set(member, components);
      } while (member !== node);
      components++;
    }
  };
  for (const node of edges.keys()) if (!index.has(node)) visit(node);
  const out: string[] = [];
  for (const [from, targets] of edges) {
    for (const to of targets) {
      if (component.get(from) === component.get(to)) out.push(`cycle: ${from} -> ${to}`);
    }
  }
  return out;
}

interface Scan {
  violations: string[];
  unresolved: string[];
}

/** Applies the three rules to a set of files; `read` and `isFile` take src-relative paths. */
function scan(
  files: readonly string[],
  read: (rel: string) => string,
  isFile: (rel: string) => boolean,
): Scan {
  const violations = new Set<string>();
  const unresolved: string[] = [];
  const featureEdges = new Map<string, Set<string>>();
  for (const file of files) {
    const own = featureOf(file);
    for (const spec of specifiers(read(file))) {
      const target = resolveImport(file, spec, isFile);
      if (target === undefined) unresolved.push(`${file}: ${spec}`);
      if (target == null || !/\.tsx?$/.test(target)) continue;
      const other = featureOf(target);
      if (other === null || other === own) continue;
      if (own === null) {
        violations.add(`${file} -> ${target}`);
        continue;
      }
      if (!/^features\/[^/]+\/index\.tsx?$/.test(target)) violations.add(`${file} -> ${target}`);
      const set = featureEdges.get(own) ?? new Set<string>();
      set.add(other);
      featureEdges.set(own, set);
    }
  }
  for (const line of cycleEdges(featureEdges)) violations.add(line);
  return { violations: [...violations].sort(), unresolved };
}

function scanSrc(): Scan {
  const isFile = (rel: string): boolean => {
    try {
      return statSync(join(SRC, rel)).isFile();
    } catch {
      return false;
    }
  };
  return scan(sourceFiles(SRC), (rel) => readFileSync(join(SRC, rel), "utf8"), isFile);
}

function baseline(): string[] {
  return readFileSync(BASELINE, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

describe("the import scan", () => {
  const files: Record<string, string> = {
    "app.tsx": [
      "import {",
      "  a,",
      "  b,",
      '} from "./features/chat/chat-page";',
      'import type { T } from "./lib/x";',
    ].join("\n"),
    "lib/x.ts": 'export type { M } from "../features/models/model";',
    "features/chat/chat-page.tsx": [
      'const lazy = () => import("../models");',
      'import { inner } from "../models/model";',
    ].join("\n"),
    "features/models/index.ts": 'export * from "./model";',
    "features/models/model.ts": 'import type { C } from "../chat/chat-page";',
  };
  const result = scan(
    Object.keys(files),
    (rel) => files[rel]!,
    (rel) => rel in files,
  );

  it("sees multi-line, type-only, re-exported and dynamic imports", () => {
    expect(result.violations).toEqual([
      "app.tsx -> features/chat/chat-page.tsx",
      "cycle: features/chat -> features/models",
      "cycle: features/models -> features/chat",
      "features/chat/chat-page.tsx -> features/models/model.ts",
      "features/models/model.ts -> features/chat/chat-page.tsx",
      "lib/x.ts -> features/models/model.ts",
    ]);
  });

  it("reports a relative import that lands on no file", () => {
    const broken = scan(
      ["lib/a.ts"],
      () => 'import "./missing";',
      () => false,
    );
    expect(broken.unresolved).toEqual(["lib/a.ts: ./missing"]);
  });
});

describe("module boundaries in packages/web/src", () => {
  const actual = scanSrc();
  const recorded = baseline();

  it("resolves every relative import", () => {
    expect(actual.unresolved).toEqual([]);
  });

  it("keeps the baseline sorted and free of duplicates", () => {
    expect(recorded).toEqual([...new Set(recorded)].sort());
  });

  it("breaks no boundary the baseline does not already list", () => {
    const fresh = actual.violations.filter((line) => !recorded.includes(line));
    expect(
      fresh,
      "New boundary violations. Import the other feature through its index.ts, or move the " +
        "shared code into lib/; do not add lines to the baseline.",
    ).toEqual([]);
  });

  it("lists no violation that is gone (delete the line)", () => {
    const gone = recorded.filter((line) => !actual.violations.includes(line));
    expect(
      gone,
      `These lines no longer occur; delete them from ${relative(dirname(SRC), BASELINE)}.`,
    ).toEqual([]);
  });
});
