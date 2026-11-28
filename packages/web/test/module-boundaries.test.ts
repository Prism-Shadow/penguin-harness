/**
 * The static-import boundaries between the Web App's libraries and its feature modules, as a
 * ratchet. The module tree checks the dependencies it can see (slots, `@Use`); a plain `import`
 * is invisible to it, so these rules are held here, over every file under `src/` and under the
 * migrated web halves the app compiles in (`library/<domain>/src/web/`):
 *
 * 1. A library — anything outside `features/` and `web-app/` (`lib/`, `api/`, `state/`, `rescue/`,
 *    `components/`, the root files) — imports nothing under `features/`. The one exception is the
 *    composition root, `web-root.ts`, which imports each feature's `module.ts` to list it in the
 *    tree.
 * 2. A file of one module directory — `features/<a>/`, `web-app/` (the frame), or a library half
 *    (`library/<domain>/src/web/`) — reaches another only through its index file (`index.ts`,
 *    `index.tsx`, the host seam's `internal.ts`), never one of its inner files.
 * 3. No import cycle between module directories. An edge `features/a -> features/b` is reported
 *    when it lies on a cycle, i.e. both ends sit in the same strongly connected component.
 * 4. A `module.ts` or `<name>.module.ts` (a module class) is imported by the composition root
 *    and nothing else: a module reaches another through slots and interfaces, never through its
 *    class.
 *
 * The code predates the rules, so what breaks them today is listed, one line per edge, in
 * `module-boundaries.baseline.txt`. A violation missing from the baseline fails; so does a
 * baseline line that no longer occurs. The list can only shrink: whoever removes a violation
 * deletes its line in the same change.
 *
 * A file is named by its path relative to `packages/web/src/` when it is the app's own, and by
 * its repo-relative path when it belongs to a library half — the same ids the guard reports and
 * the baseline records.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const BASELINE = fileURLToPath(new URL("./module-boundaries.baseline.txt", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The migrated web halves the app compiles in, as [domain, directory]. */
const LIBRARY_HALVES: ReadonlyArray<readonly [string, string]> = [
  ["workbench", fileURLToPath(new URL("../../../library/workbench/src/web", import.meta.url))],
  [
    "organization",
    fileURLToPath(new URL("../../../library/organization/src/web", import.meta.url)),
  ],
];

/** The absolute path a scanned id names: a library half's is repo-relative, the app's src-relative. */
const idPath = (id: string): string =>
  id.startsWith("library/") ? join(REPO_ROOT, id) : join(SRC, id);

/** Whether a scanned id names a file. */
const isFileId = (id: string): boolean => {
  try {
    return statSync(idPath(id)).isFile();
  } catch {
    return false;
  }
};

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
 * The file a specifier lands on, as a scanned id, `null` for a bare package the guard does not
 * resolve (the UI package, the server's types), and `undefined` when an alias or relative path
 * names nothing — which fails the test rather than silently narrowing it.
 *
 * A relative specifier resolves inside the tree the importing file lives in (the app's `src/`,
 * or the library half's `web/`); a bare one resolves through the faces the app resolves by
 * alias (vite.config.ts `webHalfAliases`): the host seam, the features that stayed behind, and
 * the library halves' own faces.
 */
function resolveImport(
  from: string,
  spec: string,
  isFile: (rel: string) => boolean,
): string | null | undefined {
  const candidatesOf = (base: string): string[] => [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  if (spec.startsWith(".")) {
    const half = /^library\/[^/]+\/src\/web\//.exec(from)?.[0] ?? "";
    const base = posix.normalize(posix.join(posix.dirname(from), spec));
    if (!base.startsWith(half) || base.startsWith("../")) return null;
    return candidatesOf(base).find(isFile);
  }
  if (spec === "@prismshadow/penguin-web/internal") {
    return isFile("internal.ts") ? "internal.ts" : undefined;
  }
  const feature = /^@prismshadow\/penguin-web\/features\/([a-z-]+)$/.exec(spec);
  if (feature !== null) {
    return candidatesOf(`features/${feature[1]}/index`).find(isFile);
  }
  const face = /^@prismshadow\/penguin-library-([a-z-]+)\/web(?:\/(.*))?$/.exec(spec);
  if (face !== null) {
    const base = `library/${face[1]}/src/web${face[2] === undefined ? "/index" : `/${face[2]}`}`;
    return candidatesOf(base).find(isFile);
  }
  return null;
}

/** The composition root: the one file that lists module classes. */
const COMPOSITION_ROOT = "web-root.ts";

/** Whether a file declares a module class. */
const isModuleFile = (file: string): boolean => /(^|\/|\.)module\.ts$/.test(file);

/**
 * The module directory a file belongs to: `features/<name>`, `web-app` for the frame, whose
 * modules (the web-app and its sidebar) reach features through their index files like any
 * feature, or `library/<domain>` for a migrated web half; null for a library.
 */
function moduleDirOf(file: string): string | null {
  if (file.startsWith("web-app/")) return "web-app";
  const feature = /^features\/([^/]+)\//.exec(file);
  if (feature !== null) return `features/${feature[1]}`;
  const library = /^library\/([^/]+)\/src\/web\//.exec(file);
  if (library !== null) return `library/${library[1]}`;
  return null;
}

/** The index files a module directory may be reached through. */
const INDEX_FILE =
  /^(?:features\/[^/]+|web-app)\/index\.tsx?$|^internal\.ts$|^library\/[^/]+\/src\/web\/index\.tsx?$/;

/** A library half's face index: the half's own composition root, which lists its module classes. */
const HALF_INDEX_FILE = /^library\/[^/]+\/src\/web\/index\.tsx?$/;

/** The library half a scanned id belongs to, as its id prefix (`library/<domain>/src/web/`). */
const halfOf = (id: string): string | null => /^library\/[^/]+\/src\/web\//.exec(id)?.[0] ?? null;

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

/** Applies the rules to a set of files; `read` and `isFile` take src-relative paths. */
function scan(
  files: readonly string[],
  read: (rel: string) => string,
  isFile: (rel: string) => boolean,
): Scan {
  const violations = new Set<string>();
  const unresolved: string[] = [];
  const featureEdges = new Map<string, Set<string>>();
  for (const file of files) {
    const own = moduleDirOf(file);
    for (const spec of specifiers(read(file))) {
      const target = resolveImport(file, spec, isFile);
      if (target === undefined) unresolved.push(`${file}: ${spec}`);
      if (target == null || !/\.tsx?$/.test(target)) continue;
      // A module class is listed by the composition root, or by the half's own face index when
      // both live in the same half — the face index is that half's composition root.
      const ownHalf = halfOf(file);
      const inOwnHalf =
        ownHalf !== null && target.startsWith(ownHalf) && HALF_INDEX_FILE.test(file);
      if (isModuleFile(target) && file !== COMPOSITION_ROOT && !inOwnHalf) {
        violations.add(`${file} -> ${target}`);
        continue;
      }
      const other = moduleDirOf(target);
      if (other === null || other === own) continue;
      if (file === COMPOSITION_ROOT && isModuleFile(target)) continue;
      if (own === null) {
        // A library may use WebApp's public surface (the router's types); never a feature. The
        // composition root may also take a half's face index, which lists the half's modules.
        const compositionFace = file === COMPOSITION_ROOT && HALF_INDEX_FILE.test(target);
        if (other !== "web-app" && !compositionFace) violations.add(`${file} -> ${target}`);
        continue;
      }
      if (!INDEX_FILE.test(target)) {
        violations.add(`${file} -> ${target}`);
      }
      const set = featureEdges.get(own) ?? new Set<string>();
      set.add(other);
      featureEdges.set(own, set);
    }
  }
  for (const line of cycleEdges(featureEdges)) violations.add(line);
  return { violations: [...violations].sort(), unresolved };
}

function scanSrc(): Scan {
  const ids = [
    ...sourceFiles(SRC),
    ...LIBRARY_HALVES.flatMap(([domain, dir]) =>
      sourceFiles(dir).map((rel) => `library/${domain}/src/web/${rel}`),
    ),
  ];
  return scan(ids, (id) => readFileSync(idPath(id), "utf8"), isFileId);
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

  it("lets the composition root import module classes, and nothing else import them", () => {
    const tree: Record<string, string> = {
      "web-root.ts": [
        'import { WebAppModule } from "./web-app/module";',
        'import { SessionsModule } from "./state/sessions.module";',
        'import { ChatModule } from "./features/chat/module";',
        'import { ChatPage } from "./features/chat/chat-page";',
      ].join("\n"),
      "web-app/module.ts": 'import type { UserEventHandlers } from "../state/user-events";',
      "web-app/router.tsx": 'import type { WebApp } from "./module";',
      "state/sessions.module.ts": "",
      "state/user-events.ts": "",
      "state/sessions.tsx": 'import { SessionsModule } from "./sessions.module";',
      "features/chat/module.ts": 'import { ChatPage } from "./chat-page";',
      "features/chat/chat-page.tsx": 'import { ChatModule } from "./module";',
    };
    const result = scan(
      Object.keys(tree),
      (rel) => tree[rel]!,
      (rel) => rel in tree,
    );
    expect(result.violations).toEqual([
      "features/chat/chat-page.tsx -> features/chat/module.ts",
      "state/sessions.tsx -> state/sessions.module.ts",
      "web-app/router.tsx -> web-app/module.ts",
      "web-root.ts -> features/chat/chat-page.tsx",
    ]);
  });

  it("holds the web-app to a module's rules: other modules only through their index files", () => {
    const tree: Record<string, string> = {
      "web-app/sidebar/rail.tsx": [
        'import { ChatDrafts } from "../../features/chat";',
        'import { DRAFT } from "../../features/chat/chat-page";',
      ].join("\n"),
      "web-app/index.ts": "",
      "web-app/router.tsx": "",
      "features/chat/index.ts": "",
      "features/chat/chat-page.tsx": "",
      "features/list/list.tsx": [
        'import { useWebAppPages } from "../../web-app";',
        'import { AppRouter } from "../../web-app/router";',
      ].join("\n"),
      "main.tsx": 'import type { AppRouterProps } from "./web-app/router";',
    };
    const result = scan(
      Object.keys(tree),
      (rel) => tree[rel]!,
      (rel) => rel in tree,
    );
    expect(result.violations).toEqual([
      "features/list/list.tsx -> web-app/router.tsx",
      "web-app/sidebar/rail.tsx -> features/chat/chat-page.tsx",
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
