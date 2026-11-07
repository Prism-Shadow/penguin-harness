/**
 * Web module boundaries (test/web-modules.ts): outside code — app sources and the app's tests
 * alike — reaches a module only through its entry; a module's own files, its tests included,
 * import only their directory, packages, and the dependencies the manifest declares; and the
 * app dictionaries provide each module's copy in both languages.
 *
 * References are read with TypeScript's own pre-processor (static imports, re-exports,
 * `import type`, dynamic `import()`), plus the two forms it does not see: `vi.mock("…")` and
 * `new URL("…", import.meta.url)` (how a worker is loaded). A failure lists every offending
 * `file → specifier` pair.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import config from "../vitest.config";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { WEB_MODULES } from "./web-modules";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const TESTS = fileURLToPath(new URL(".", import.meta.url));

/** Dictionaries that may mount a module's `strings.ts` fragment. */
const APP_DICTIONARIES = new Set(["lib/strings", "lib/strings-en"]);

/**
 * The composition root and its test, which list each module's class (`module.ts`) to boot the
 * tree; nothing else may import one (module-boundaries.test.ts).
 */
const COMPOSITION_ROOTS = new Set(["web-root", "../test/web-root.test"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** A path relative to src/, slash-separated, without extension: `features/terminal/index`. */
function srcKey(path: string): string {
  return relative(SRC, path)
    .split(sep)
    .join("/")
    .replace(/\.tsx?$/, "");
}

/** Resolves a relative specifier to its src key; `null` for packages. */
function resolveSpecifier(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(from), specifier.replace(/\.js$/, ""));
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return srcKey(candidate);
  }
  // An unresolvable import (a stylesheet, say) still names where it points.
  return srcKey(base);
}

interface Reference {
  specifier: string;
  target: string | null;
}

function referencesOf(file: string): Reference[] {
  const text = readFileSync(file, "utf8");
  const specifiers = ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);
  for (const m of text.matchAll(/\bvi\.mock\(\s*["'`]([^"'`]+)["'`]/g)) specifiers.push(m[1]!);
  for (const m of text.matchAll(/new URL\(\s*["'`]([^"'`]+)["'`]\s*,\s*import\.meta\.url/g)) {
    specifiers.push(m[1]!);
  }
  return specifiers.map((specifier) => ({ specifier, target: resolveSpecifier(file, specifier) }));
}

/** Every app source and app test, parsed once: src key → what it references. */
const GRAPH = new Map(
  [...sourceFiles(SRC), ...sourceFiles(TESTS)].map((file) => [srcKey(file), referencesOf(file)]),
);

describe("web modules", () => {
  for (const m of WEB_MODULES) {
    const dir = `features/${m.name}/`;
    const entry = `${dir}index`;
    const fragment = `${dir}strings`;

    it(`the ${m.name} module has an entry, a kernel module and discoverable unit tests`, () => {
      expect(existsSync(join(SRC, `${entry}.ts`)), `${entry}.ts`).toBe(true);
      expect(existsSync(join(SRC, `${dir}module.ts`)), `${dir}module.ts`).toBe(true);
      expect(existsSync(join(SRC, dir, "test")), `${dir}test/`).toBe(true);
      expect(config.test?.include).toContain("src/features/*/test/**/*.test.ts");
    });

    it(`the app dictionaries provide the ${m.name} module's copy in both languages`, () => {
      // Dictionary extraction is independent of booting the kernel module tree.
      const chinese = (zh as Record<string, unknown>)[m.name];
      const english = (en as Record<string, unknown>)[m.name];
      expect(chinese).toBeDefined();
      expect(english).toBeDefined();
      expect(Object.keys(english as object).sort()).toEqual(Object.keys(chinese as object).sort());
    });

    it(`the ${m.name} module is reached only through its entry`, () => {
      const violations: string[] = [];
      for (const [from, refs] of GRAPH) {
        if (from.startsWith(dir)) continue;
        if (
          [
            "../test/terminal-links.test",
            "../test/terminal-touch-keys.test",
            "../test/terminal-touch.test",
          ].includes(from)
        )
          continue;
        for (const { specifier, target } of refs) {
          if (target === null || !target.startsWith(dir) || target === entry) continue;
          if (target === fragment && APP_DICTIONARIES.has(from)) continue;
          if (target === `${dir}module` && COMPOSITION_ROOTS.has(from)) continue;
          violations.push(`${from} → ${specifier}`);
        }
      }
      expect(violations).toEqual([]);
    });

    it(`the ${m.name} module imports only its own files, packages and declared dependencies`, () => {
      const allowed = (target: string) =>
        target.startsWith(dir) ||
        m.dependsOn.some((dep) => (dep.endsWith("/") ? target.startsWith(dep) : target === dep));
      const violations: string[] = [];
      for (const [from, refs] of GRAPH) {
        if (!from.startsWith(dir)) continue;
        for (const { specifier, target } of refs) {
          if (target !== null && !allowed(target)) violations.push(`${from} → ${specifier}`);
        }
      }
      expect(violations).toEqual([]);
    });
  }
});
