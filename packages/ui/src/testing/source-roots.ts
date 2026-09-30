/**
 * Source-root scanning for guard tests.
 *
 * A guard that walks one hard-coded directory narrows silently when the code it guards moves: the
 * walk still succeeds, it just visits fewer files, and every "found nothing wrong" assertion stays
 * green over a tree that no longer holds the thing it was written for. The theme work moves
 * components from `packages/web/src` into `packages/ui/src` one wave at a time, so a guard scans a
 * named set of roots and reports, per root, how many files it actually read — a root that yields
 * nothing (a typo, a renamed directory, a package that moved) is a failure, never an empty pass.
 *
 * Node-only (`node:fs`) and framework-free: the caller asserts with its own test runner.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

/** Root name → absolute directory, e.g. `{ web: ".../packages/web/src", ui: ".../packages/ui/src" }`. */
export type SourceRoots = Readonly<Record<string, string>>;

/** What a guard scans unless it asks otherwise: source and the stylesheets that sit beside it. */
export const DEFAULT_SOURCE_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".css"];

/** Directories never descended into: installed or generated trees are not source. */
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".vite", "coverage"]);

export interface SourceFile {
  /** The root's key in the {@link SourceRoots} record, e.g. `"web"`. */
  readonly root: string;
  /** Path relative to its root, forward slashes on every platform: `components/ui/icons.tsx`. */
  readonly rel: string;
  /**
   * Path relative to the repository root, forward slashes: `packages/web/src/components/ui/icons.tsx`.
   * The name a guard reports and expects, because it stays unambiguous across roots.
   */
  readonly id: string;
  /** Absolute path, platform separators. */
  readonly path: string;
  /** The file name alone: `icons.tsx`. */
  readonly name: string;
  /** The file's text, read on first access and cached. */
  readonly text: string;
}

export interface RootReport {
  readonly name: string;
  readonly dir: string;
  readonly exists: boolean;
  /** Files with a scanned extension found under the root. */
  readonly files: number;
}

export interface SourceScan {
  /** Every scanned file across every root, sorted by {@link SourceFile.id}. */
  readonly files: readonly SourceFile[];
  /** One report per root, in the order the roots were given. */
  readonly roots: readonly RootReport[];
}

export interface ScanOptions {
  /** The repository root that {@link SourceFile.id} is relative to. */
  readonly repoRoot: string;
  /** File extensions to include, with the dot. Defaults to {@link DEFAULT_SOURCE_EXTENSIONS}. */
  readonly extensions?: readonly string[];
}

const toPosix = (path: string): string => path.split(sep).join("/");

// Plain fields rather than constructor parameter properties, so the module stays erasable-syntax
// TypeScript that Node can also run directly.
class ScannedFile implements SourceFile {
  readonly root: string;
  readonly rel: string;
  readonly id: string;
  readonly path: string;
  #text: string | undefined;

  constructor(root: string, rel: string, id: string, path: string) {
    this.root = root;
    this.rel = rel;
    this.id = id;
    this.path = path;
  }

  get name(): string {
    return basename(this.path);
  }

  get text(): string {
    this.#text ??= readFileSync(this.path, "utf8");
    return this.#text;
  }
}

function walk(dir: string, extensions: readonly string[], out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(path, extensions, out);
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(path);
    }
  }
}

/**
 * Walks every root and returns its files plus a per-root count. A root that does not exist is
 * reported (`exists: false`, `files: 0`) rather than thrown, so the guard's own "every root was
 * scanned" assertion is what fails — with the root's name in the message.
 */
export function scanSourceRoots(roots: SourceRoots, options: ScanOptions): SourceScan {
  const extensions = options.extensions ?? DEFAULT_SOURCE_EXTENSIONS;
  const files: SourceFile[] = [];
  const reports: RootReport[] = [];
  for (const [name, dir] of Object.entries(roots)) {
    const exists = existsSync(dir) && statSync(dir).isDirectory();
    const paths: string[] = [];
    if (exists) walk(dir, extensions, paths);
    for (const path of paths) {
      files.push(
        new ScannedFile(
          name,
          toPosix(relative(dir, path)),
          toPosix(relative(options.repoRoot, path)),
          path,
        ),
      );
    }
    reports.push({ name, dir, exists, files: paths.length });
  }
  files.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { files, roots: reports };
}

/**
 * One line per root that yielded no files, naming the root, its directory and why — empty when
 * every root was scanned. Guards assert this equals `[]`.
 */
export function unscannedRoots(scan: SourceScan): string[] {
  return scan.roots
    .filter((root) => root.files === 0)
    .map((root) =>
      root.exists
        ? `${root.name} (${root.dir}): no source files found`
        : `${root.name} (${root.dir}): directory does not exist`,
    );
}

/** The scanned file with this repo-relative id, or `undefined`. */
export function findSourceFile(scan: SourceScan, id: string): SourceFile | undefined {
  return scan.files.find((file) => file.id === id);
}

/** Every scanned file with this file name, across all roots — the input to a "one home" check. */
export function filesNamed(scan: SourceScan, name: string): SourceFile[] {
  return scan.files.filter((file) => file.name === name);
}
