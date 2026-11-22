/**
 * The files `npm pack` would publish from a package directory, for one held in memory (an
 * uploaded zip, or the package directory the CLI zipped) — what an install made without npm
 * puts in the prefix and packs into `archives/` (direct-install.ts), so that it is exactly what
 * npm's own pack-then-install of the same zip would have installed.
 *
 * A port of npm's file list (npm-packlist 10 over ignore-walk 8, as npm 11 runs them), with the
 * same matcher (minimatch, with npm's options: `matchBase`, `dot`, `flipNegate`, `nocase`):
 *
 * - npm's defaults are ignored everywhere: `.npmignore` and `.gitignore` themselves, VCS
 *   folders, `.DS_Store`, `._*`, `.*.swp`, `*.orig`, `npm-debug.log`, `.npmrc`, `/.lock-wscript`,
 *   `/.wafpickle-*`, `/build/config.gypi`, `/archived-packages/**`;
 * - in each directory, a `.npmignore` applies to its subtree, or — where there is none — its
 *   `.gitignore`, which is how a developer's git-ignored `.env` stays out; at the root, a
 *   `files` field replaces both;
 * - `files` entries include what they name (a file strictly, a directory with everything under
 *   it, anything else as a pattern), still subject to nested ignore files;
 * - always included: `package.json`, the README, LICENSE / LICENCE and COPYING, `main`,
 *   `browser` and every `bin` target (normalized as npm normalizes the manifest, including
 *   `directories.bin`); always left out: `/.git`, `/node_modules`, `.npmrc` and the root
 *   lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`);
 * - a name with `*` in it is never packed (Windows could not hold it).
 *
 * Bundled dependencies are not walked: a package that bundles them needs npm anyway.
 */
import path from "node:path";
import { Minimatch } from "minimatch";

/** The synthetic rule sets npm-packlist injects, beside the ignore files read from disk. */
const DEFAULT_RULES = Symbol("default rules");
const STRICT_RULES = Symbol("strict rules");
type RuleSet = string | symbol;

const DEFAULTS = [
  ".npmignore",
  ".gitignore",
  "**/.git",
  "**/.svn",
  "**/.hg",
  "**/CVS",
  "**/.git/**",
  "**/.svn/**",
  "**/.hg/**",
  "**/CVS/**",
  "/.lock-wscript",
  "/.wafpickle-*",
  "/build/config.gypi",
  "npm-debug.log",
  "**/.npmrc",
  ".*.swp",
  ".DS_Store",
  "**/.DS_Store/**",
  "._*",
  "**/._*/**",
  "*.orig",
  "/archived-packages/**",
];

const STRICT_DEFAULTS = ["/.git"];

const MATCH_OPTIONS = { matchBase: true, dot: true, flipNegate: true, nocase: true };

const posix = path.posix;

/** The package's directory tree, as the zip's file paths imply it. */
class Tree {
  readonly files = new Set<string>();
  readonly children = new Map<string, Set<string>>([["", new Set()]]);

  constructor(paths: Iterable<string>) {
    for (const rel of paths) {
      this.files.add(rel);
      const parts = rel.split("/");
      for (let i = 0; i < parts.length; i += 1) {
        const dir = parts.slice(0, i).join("/");
        if (!this.children.has(dir)) this.children.set(dir, new Set());
        this.children.get(dir)!.add(parts[i]!);
      }
    }
  }

  isDirectory(rel: string): boolean {
    return this.children.has(rel);
  }

  isFile(rel: string): boolean {
    return this.files.has(rel);
  }

  entries(dir: string): string[] {
    return [...(this.children.get(dir) ?? [])];
  }
}

/** `path.join('.', path.join('/', p))` over `\` and `:` unified, '' when it names the root (npm's secureAndUnixifyPath). */
function securePath(ref: string): string {
  const unix = ref.replace(/\\|:/g, "/");
  const secured = posix.join(".", posix.join("/", unix)).replace(/\\|:/g, "/");
  return secured.startsWith("./") ? "" : secured;
}

/** The manifest's `bin` as npm normalizes it (@npmcli/package-json's `bin` and `binDir` steps). */
export function normalizedBins(
  manifest: Record<string, unknown>,
  tree?: { files: Iterable<string> },
): Record<string, string> {
  let bin = manifest.bin as unknown;
  const directories = manifest.directories as { bin?: unknown } | undefined;
  if (
    (bin === undefined || bin === null || bin === "") &&
    typeof directories?.bin === "string" &&
    tree !== undefined
  ) {
    const binPath = securePath(directories.bin);
    const out: Record<string, string> = {};
    for (const file of tree.files) {
      if (binPath === "" || !file.startsWith(`${binPath}/`)) continue;
      const inside = file.slice(binPath.length + 1);
      // glob's `**` passes over dot files and dot folders.
      if (inside === "" || inside.split("/").some((part) => part.startsWith("."))) continue;
      out[posix.basename(inside)] = `${binPath}/${securePath(inside)}`;
    }
    return out;
  }
  if (typeof bin === "string") {
    if (typeof manifest.name !== "string") return {};
    bin = { [manifest.name]: bin };
  } else if (Array.isArray(bin)) {
    bin = Object.fromEntries(
      bin.filter((k): k is string => typeof k === "string").map((k) => [posix.basename(k), k]),
    );
  }
  if (typeof bin !== "object" || bin === null) return {};
  const out: Record<string, string> = {};
  for (const [key, target] of Object.entries(bin as Record<string, unknown>)) {
    if (typeof target !== "string") continue;
    const base = posix.basename(securePath(key));
    const binTarget = securePath(target);
    if (base === "" || binTarget === "") continue;
    out[base] = binTarget;
  }
  return out;
}

/** One directory's walk: ignore-walk's Walker with npm-packlist's PackWalker overrides. */
class Walker {
  readonly basename: string;
  private readonly rules = new Map<RuleSet, Minimatch[] | null>();

  constructor(
    private readonly tree: Tree,
    private readonly manifest: Record<string, unknown>,
    private readonly dir: string,
    private readonly parent: Walker | null,
    private readonly ignoreFiles: readonly RuleSet[],
    private readonly isPackage: boolean,
    private readonly requiredFiles: string[],
    private readonly exact: boolean,
    private readonly result: string[],
    private readonly read: (rel: string) => string,
  ) {
    this.basename = posix.basename(dir);
    this.inject(DEFAULT_RULES, DEFAULTS);
    if (!isPackage) {
      this.inject(STRICT_RULES, [...STRICT_DEFAULTS, ...requiredFiles.map((file) => `!${file}`)]);
    }
  }

  private inject(set: RuleSet, rules: readonly string[]): void {
    this.onRead(set, `${rules.join("\n")}\n`);
  }

  private onRead(set: RuleSet, data: string): void {
    this.rules.set(
      set,
      data
        .split(/\r?\n/)
        .filter((line) => !/^#|^$/.test(line.trim()))
        .map((rule) => new Minimatch(rule.trim(), MATCH_OPTIONS)),
    );
  }

  private join(entry: string): string {
    return this.dir === "" ? entry : `${this.dir}/${entry}`;
  }

  walk(): void {
    const entries = this.tree.entries(this.dir);
    if (entries.length === 0) return;
    for (const entry of entries) {
      if (!this.ignoreFiles.includes(entry)) continue;
      if (entry === "package.json" && this.isPackage) {
        this.processPackage();
      } else if (this.tree.isFile(this.join(entry))) {
        this.onRead(entry, this.read(this.join(entry)));
      }
    }
    if (this.rules.get("package.json")) {
      this.rules.set(".npmignore", null);
      this.rules.set(".gitignore", null);
    } else if (this.rules.get(".npmignore")) {
      this.rules.set(".gitignore", null);
    }
    for (const entry of entries) {
      const passFile = this.filterEntry(entry);
      const passDir = this.filterEntry(entry, true);
      if (!(passFile || passDir)) continue;
      if (/\*/.test(entry)) continue;
      const rel = this.join(entry);
      if (this.tree.isDirectory(rel)) {
        if (!passDir) continue;
        new Walker(
          this.tree,
          this.manifest,
          rel,
          this,
          [DEFAULT_RULES, ".npmignore", ".gitignore", STRICT_RULES],
          false,
          this.requiredFiles
            .map((file) =>
              posix.relative(file, entry) === ".." ? posix.relative(entry, file) : null,
            )
            .filter((file): file is string => file !== null),
          passFile || this.filterEntry(`${entry}/`),
          this.result,
          this.read,
        ).walk();
      } else if (passFile) {
        this.result.push(rel);
      }
    }
  }

  /** ignore-walk's filterEntry, unchanged in its logic. */
  filterEntry(entry: string, partial?: boolean, entryBasename?: string): boolean {
    let included = true;
    if (this.parent !== null) {
      const parentEntry = `${this.basename}/${entry}`;
      const parentBasename = entryBasename || entry;
      included = this.parent.filterEntry(parentEntry, partial, parentBasename);
      if (!included && !this.exact) return false;
    }
    for (const set of this.ignoreFiles) {
      const rules = this.rules.get(set);
      if (!rules) continue;
      for (const rule of rules) {
        if (rule.negate === included) continue;
        const isRelativeRule =
          entryBasename !== undefined &&
          entryBasename !== "" &&
          rule.globParts.some((part) => part.length <= (part.slice(-1)[0] ? 1 : 2));
        const match =
          rule.match(`/${entry}`) ||
          rule.match(entry) ||
          (!!partial &&
            (rule.match(`/${entry}/`) ||
              rule.match(`${entry}/`) ||
              (rule.negate && (rule.match(`/${entry}`, true) || rule.match(entry, true))) ||
              (isRelativeRule &&
                (rule.match(`/${entryBasename}/`) ||
                  rule.match(`${entryBasename}/`) ||
                  (rule.negate &&
                    (rule.match(`/${entryBasename}`, true) ||
                      rule.match(entryBasename!, true)))))));
        if (match) included = rule.negate;
      }
    }
    return included;
  }

  /** npm-packlist's processPackage: the `files` field, and the strictly included files. */
  private processPackage(): void {
    const { browser, files, main } = this.manifest as {
      browser?: unknown;
      files?: unknown;
      main?: unknown;
    };
    const ignores: string[] = [];
    const strict = [
      ...STRICT_DEFAULTS,
      "!/package.json",
      "!/readme{,.*[^~$]}",
      "!/copying{,.*[^~$]}",
      "!/license{,.*[^~$]}",
      "!/licence{,.*[^~$]}",
      "/.git",
      "/node_modules",
      ".npmrc",
      "/package-lock.json",
      "/yarn.lock",
      "/pnpm-lock.yaml",
      "/bun.lockb",
    ];
    if (Array.isArray(files)) {
      for (let file of files) {
        if (typeof file !== "string") continue;
        if (file.startsWith("./")) file = file.slice(1);
        if (file.endsWith("/*")) file += "*";
        const inverse = `!${file}`;
        const target = posix
          .join("/", this.dir, file.replace(/^!+/, ""))
          .slice(1)
          .replace(/\/+$/, "");
        if (this.tree.isFile(target)) {
          strict.unshift(inverse);
          this.requiredFiles.push(file.startsWith("/") ? file.slice(1) : file);
        } else if (this.tree.isDirectory(target)) {
          ignores.push(inverse, `${inverse}/**`);
        } else {
          ignores.push(inverse);
        }
      }
      this.inject("package.json", ["*", ...ignores]);
    }
    if (typeof browser === "string" && browser !== "") strict.push(`!/${browser}`);
    if (typeof main === "string" && main !== "") strict.push(`!/${main}`);
    for (const target of Object.values(normalizedBins(this.manifest, this.tree))) {
      strict.push(`!/${target}`);
    }
    this.inject(STRICT_RULES, strict);
  }
}

/**
 * The paths (relative, POSIX) of `files` that `npm pack` would put in the package's tarball,
 * read by npm's rules (see the header). `files` is the package directory, `package.json` at
 * its root.
 */
export function packedFiles(files: ReadonlyMap<string, Uint8Array>): string[] {
  const tree = new Tree(files.keys());
  const read = (rel: string) => Buffer.from(files.get(rel) ?? new Uint8Array()).toString("utf8");
  let manifest: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(read("package.json")) as unknown;
    if (typeof parsed === "object" && parsed !== null) manifest = parsed as Record<string, unknown>;
  } catch {
    manifest = {};
  }
  const result: string[] = [];
  new Walker(
    tree,
    manifest,
    "",
    null,
    [DEFAULT_RULES, "package.json", ".npmignore", ".gitignore", STRICT_RULES],
    true,
    [],
    false,
    result,
    read,
  ).walk();
  return result;
}
