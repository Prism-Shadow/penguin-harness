/**
 * JIT TypeScript/TSX compiler and O(1) static asset resolver for active browser modules
 * declared via `package.json` `"browser"` (or `exports["."].browser`).
 *
 * Design invariants:
 * - Uniform OS module asset namespace: compiled modules (whether builtin or user-installed)
 *   live under `/assets/modules/<pkg>/<hash>/<file>` (`immutable`) alongside Vite's own
 *   `/assets/*` chunks, with a lightweight boot index at `/assets/modules.json` (`no-cache`).
 *   Never squats on `/plugins` (an SPA page route).
 * - Single source of truth for host shared imports: reads strictly from the W3C
 *   `<script type="importmap">` in `index.html` parsed via `parse5` (zero hardcoded fallback list).
 * - Non-recursive graph tracing: passes ONLY the declared `browser` entry to TypeScript so
 *   shared pure TS modules (e.g. `src/shared/`) compile cleanly while server code is untouched.
 * - O(1) single-file GET hot path: maintains an in-memory generation-keyed active module map
 *   (`specifier\0hash -> outDir`) with single-flight deduplication. Single-file requests never
 *   scan `PluginHost` or re-hash files; the content `<hash>` in the URL is the ETag.
 * - Slim manifest + immutable per-module `ifaces.json`: each module's browser-only interface
 *   subset is emitted to `<outDir>/ifaces.json` and served immutably at `ifacesUrl`, keeping
 *   `/assets/modules.json` tiny even at thousands of installed packages.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defaultTreeAdapter, parse as parseHtml } from "parse5";
import type { IfaceTable, ManifestTable } from "@prismshadow/penguin-core/kernel";
import type { LoadedPlugin, PluginHost } from "./host.js";
import { loadTypeScript, type TypeScript } from "./typescript.js";
import { UI_RUNTIME_DIR, type WebFiles } from "../workbenches/ui-runtime.js";

export const HOST_TYPES_DIR = "types";
export const MODULES_STATIC_PREFIX = "/assets/modules";
export const MODULES_MANIFEST_PATH = "/assets/modules.json";

const SOURCE_RE = /\.tsx?$/;
const DECLARATION_RE = /\.d\.[cm]?ts$/;
const ANCHOR_FILE = "__plugin_web__.ts";

export interface BrowserEntryMeta {
  entry: string;
  modules: string[];
  replaces: string[];
}

export interface TrimmedBrowserIfaces {
  ifaces: IfaceTable["ifaces"];
  types: IfaceTable["types"];
  modules: ManifestTable;
}

export interface CompiledWebModuleEntry {
  specifier: string;
  hash: string;
  entry: string;
  ifacesUrl: string;
  browser?: BrowserEntryMeta;
}

export interface UnsatisfiedWebModule {
  specifier: string;
  error: string;
}

export interface WebModulesManifest {
  /** The host document's W3C importmap imports that these modules were compiled against. */
  imports: Record<string, string>;
  modules: CompiledWebModuleEntry[];
  unsatisfied: UnsatisfiedWebModule[];
}

export class PluginWebCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginWebCompileError";
  }
}

interface HostTypeBundle {
  hash: string;
  importMap: Record<string, string>;
  imports: readonly string[];
  typesDir: string;
}

interface LatestBuildRecord {
  hash: string;
  typesHash: string;
  entryRel: string;
  entryJsRel: string;
  deps: Array<{ rel: string; size: number; mtimeMs: number }>;
}

const materializedTypesCache = new Map<string, HostTypeBundle>();

function readWebFile(source: WebFiles, rel: string): Buffer | null {
  if (source.kind === "mem") {
    return source.files.get(rel) ?? null;
  }
  const abs = path.join(source.dir, ...rel.split("/"));
  try {
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}

function collectWebDirFiles(source: WebFiles, prefix: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const norm = prefix.replace(/^\/+|\/+$/g, "") + "/";
  if (source.kind === "mem") {
    for (const [key, buf] of source.files) {
      if (key.startsWith(norm)) out.set(key.slice(norm.length), buf);
    }
    return out;
  }
  const dir = path.join(source.dir, ...norm.slice(0, -1).split("/"));
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    out.set(path.relative(dir, abs).split(path.sep).join("/"), fs.readFileSync(abs));
  }
  return out;
}

/** Parses the standard W3C `<script type="importmap">` from `index.html` using WHATWG HTML parser (`parse5`). */
export function parseDocumentImportMap(html: string): Record<string, string> | null {
  const doc = parseHtml(html);
  const stack: unknown[] = [...doc.childNodes].reverse();
  let rawJson: string | null = null;
  while (stack.length > 0) {
    const node = stack.pop() as Parameters<typeof defaultTreeAdapter.isElementNode>[0];
    if (defaultTreeAdapter.isElementNode(node)) {
      if (node.tagName === "script") {
        const typeAttr = node.attrs.find((a) => a.name === "type");
        if (typeAttr && typeAttr.value.trim().toLowerCase() === "importmap") {
          rawJson = node.childNodes
            .filter((child) => defaultTreeAdapter.isTextNode(child))
            .map((child) => child.value)
            .join("");
          break;
        }
      }
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        stack.push(node.childNodes[i]);
      }
    }
  }
  if (rawJson === null) return null;
  try {
    const parsed = JSON.parse(rawJson) as { imports?: unknown };
    if (!parsed.imports || typeof parsed.imports !== "object" || Array.isArray(parsed.imports)) {
      return null;
    }
    const entries = Object.entries(parsed.imports as Record<string, unknown>);
    if (entries.length === 0) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of entries.sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (typeof v !== "string" || k === "" || v === "") return null;
      out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Reads the W3C `<script type="importmap">` from `index.html` and materializes the standard
 * `node_modules/` declarations (`workbench-runtime/types/` + `types/`) into
 * `<cacheRoot>/_types/<hash>/` once per importmap revision. Zero custom manifest files.
 */
export function ensureHostWebPluginTypes(
  source: WebFiles,
  cacheRoot: string,
): HostTypeBundle | null {
  const htmlBuf = readWebFile(source, "index.html");
  if (!htmlBuf) return null;
  const importMap = parseDocumentImportMap(htmlBuf.toString("utf8"));
  if (!importMap) return null;

  const combinedHash = createHash("sha256")
    .update(JSON.stringify(importMap))
    .digest("hex")
    .slice(0, 16);
  const cacheKey = `${path.resolve(cacheRoot)}\0${combinedHash}`;
  const cached = materializedTypesCache.get(cacheKey);
  if (cached && fs.existsSync(path.join(cached.typesDir, ".ok"))) {
    return cached;
  }

  const typesDir = path.join(cacheRoot, "_types", combinedHash);
  const marker = path.join(typesDir, ".ok");
  if (!fs.existsSync(marker)) {
    const merged = collectWebDirFiles(source, `${UI_RUNTIME_DIR}/types`);
    for (const [rel, bytes] of collectWebDirFiles(source, HOST_TYPES_DIR)) {
      merged.set(rel, bytes);
    }
    if (merged.size === 0) return null;
    const staging = `${typesDir}.${process.pid}.${Date.now()}.tmp`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    for (const [rel, bytes] of merged) {
      const target = path.join(staging, ...rel.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    fs.writeFileSync(path.join(staging, ".ok"), combinedHash);
    fs.mkdirSync(path.dirname(typesDir), { recursive: true });
    try {
      fs.renameSync(staging, typesDir);
    } catch {
      fs.rmSync(staging, { recursive: true, force: true });
      if (!fs.existsSync(marker)) {
        throw new Error(`Failed to materialize host types at ${typesDir}`);
      }
    }
  }

  const bundle: HostTypeBundle = {
    hash: combinedHash,
    importMap,
    imports: Object.keys(importMap),
    typesDir,
  };
  materializedTypesCache.set(cacheKey, bundle);
  return bundle;
}

function packageDirAbove(file: string): string | null {
  for (let dir = path.dirname(file); ;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolves a package's `browser` entry relative to `pkgDir` (no recursive scanning):
 * checks top-level `package.json` `"browser"` first, then `exports["."].browser`.
 */
export function resolvePluginBrowserEntry(pkgDir: string): string | null {
  let raw: { browser?: unknown; exports?: Record<string, unknown> };
  try {
    raw = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
      browser?: unknown;
      exports?: Record<string, unknown>;
    };
  } catch {
    return null;
  }
  let target: string | null = null;
  if (typeof raw.browser === "string") {
    target = raw.browser;
  } else {
    const dot = raw.exports?.["."];
    if (
      dot &&
      typeof dot === "object" &&
      typeof (dot as Record<string, unknown>).browser === "string"
    ) {
      target = (dot as Record<string, unknown>).browser as string;
    }
  }
  if (target === null) return null;

  const normalized = target.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    normalized === "" ||
    normalized.startsWith("/") ||
    normalized.split("/").some((seg) => seg === "" || seg === "." || seg === "..")
  ) {
    throw new PluginWebCompileError(
      `browser entry '${target}' must be a safe relative path inside the package`,
    );
  }
  if (!SOURCE_RE.test(normalized) || DECLARATION_RE.test(normalized)) {
    throw new PluginWebCompileError(
      `browser entry '${target}': external plugins must ship TypeScript/TSX source (.ts/.tsx) for their browser entry`,
    );
  }
  const abs = path.join(pkgDir, ...normalized.split("/"));
  if (!fs.existsSync(abs)) {
    throw new PluginWebCompileError(`browser entry '${target}' does not exist`);
  }
  return normalized;
}

function inside(parent: string, file: string): boolean {
  const rel = path.relative(parent, path.resolve(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function realOr(dir: string): string {
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return dir;
  }
}

function formatDiagnostics(
  ts: TypeScript,
  pkgDir: string,
  diagnostics: readonly import("typescript").Diagnostic[],
): string {
  return diagnostics
    .map((d) => {
      const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      if (d.file && d.start !== undefined) {
        const pos = d.file.getLineAndCharacterOfPosition(d.start);
        const rel = path.relative(pkgDir, d.file.fileName).split(path.sep).join("/");
        return `${rel}:${pos.line + 1}:${pos.character + 1} TS${d.code}: ${msg}`;
      }
      return `TS${d.code}: ${msg}`;
    })
    .join("\n");
}

function safeSpecifierDir(specifier: string): string {
  return specifier.replace(/^@/, "_at_").replace(/[^A-Za-z0-9._-]/g, "__");
}

/**
 * Extracts only the browser-relevant slice of a package's single `ifaces.json` (the browser
 * modules, their transitive child modules, and every interface/type reachable from them) so
 * server-only routes, cards, and CLI metadata never ship to the browser.
 */
export function trimBrowserIfaces(
  full: TrimmedBrowserIfaces,
  browser?: BrowserEntryMeta,
): TrimmedBrowserIfaces {
  if (!browser || browser.modules.length === 0) {
    return full;
  }
  const keptModules: Record<string, ManifestTable[string]> = {};
  const moduleQueue = [...browser.modules, ...browser.replaces];
  while (moduleQueue.length > 0) {
    const name = moduleQueue.shift()!;
    if (name in keptModules) continue;
    const mod = full.modules[name];
    if (!mod) continue;
    keptModules[name] = mod;
    for (const child of mod.children ?? []) {
      const childName = typeof child === "string" ? child : child.keyed;
      if (childName && childName !== "*" && !(childName in keptModules)) {
        moduleQueue.push(childName);
      }
    }
  }

  const keptIfaces: IfaceTable["ifaces"] = {};
  const keptTypes: IfaceTable["types"] = {};
  const scanQueue: unknown[] = Object.values(keptModules);
  while (scanQueue.length > 0) {
    const val = scanQueue.shift();
    if (typeof val === "string") {
      if (val in full.ifaces && !(val in keptIfaces)) {
        keptIfaces[val] = full.ifaces[val]!;
        scanQueue.push(keptIfaces[val]);
      }
      if (val in full.types && !(val in keptTypes)) {
        keptTypes[val] = full.types[val]!;
        scanQueue.push(keptTypes[val]);
      }
    } else if (Array.isArray(val)) {
      for (const item of val) scanQueue.push(item);
    } else if (val && typeof val === "object") {
      for (const v of Object.values(val as Record<string, unknown>)) scanQueue.push(v);
    }
  }

  return { ifaces: keptIfaces, types: keptTypes, modules: keptModules };
}

export interface CompilePluginWebOptions {
  pkgDir: string;
  specifier: string;
  /** Relative to `pkgDir`, e.g. `"src/web/index.ts"`. */
  entryRel: string;
  typesDir: string;
  typesHash: string;
  allowedImports: readonly string[];
  cacheRoot: string;
  /** Trimmed browser interface subset emitted alongside JS as `<outDir>/ifaces.json`. */
  browserIfaces?: TrimmedBrowserIfaces;
}

export interface CompilePluginWebResult {
  hash: string;
  outDir: string;
  entryJsRel: string;
}

function tryWarmCache(
  specCacheDir: string,
  pkgReal: string,
  entryRel: string,
  typesHash: string,
): CompilePluginWebResult | null {
  const latestPath = path.join(specCacheDir, "latest.json");
  if (!fs.existsSync(latestPath)) return null;
  let rec: LatestBuildRecord;
  try {
    rec = JSON.parse(fs.readFileSync(latestPath, "utf8")) as LatestBuildRecord;
  } catch {
    return null;
  }
  if (rec.typesHash !== typesHash || rec.entryRel !== entryRel || !Array.isArray(rec.deps)) {
    return null;
  }
  const outDir = path.join(specCacheDir, rec.hash);
  if (!fs.existsSync(path.join(outDir, ".ok"))) return null;
  for (const dep of rec.deps) {
    try {
      const st = fs.statSync(path.join(pkgReal, ...dep.rel.split("/")));
      if (st.size !== dep.size || Math.trunc(st.mtimeMs) !== dep.mtimeMs) return null;
    } catch {
      return null;
    }
  }
  return { hash: rec.hash, outDir, entryJsRel: rec.entryJsRel };
}

/**
 * Compiles one package's `browser` entry TypeScript/TSX import graph (no recursive directory scan)
 * into content-addressed static ES modules under `<cacheRoot>/<safeSpecifier>/<hash>/`.
 */
export async function compilePluginWeb(
  opts: CompilePluginWebOptions,
): Promise<CompilePluginWebResult> {
  const pkgReal = realOr(opts.pkgDir);
  const specCacheDir = path.join(opts.cacheRoot, safeSpecifierDir(opts.specifier));
  const warm = tryWarmCache(specCacheDir, pkgReal, opts.entryRel, opts.typesHash);
  if (warm !== null) return warm;

  const entryAbs = path.join(pkgReal, ...opts.entryRel.split("/"));
  const srcDir = path.join(pkgReal, "src");
  const rootDir = inside(srcDir, entryAbs) ? srcDir : path.dirname(entryAbs);
  const typesReal = realOr(opts.typesDir);

  const ts = await loadTypeScript();
  const staging = path.join(specCacheDir, `.staging-${process.pid}-${Date.now()}`);
  const options: import("typescript").CompilerOptions = {
    strict: true,
    noEmitOnError: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
    resolveJsonModule: true,
    isolatedModules: true,
    useDefineForClassFields: true,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
    skipLibCheck: true,
    rootDir,
    outDir: staging,
  };

  const host = ts.createCompilerHost(options);
  const anchor = path.join(opts.typesDir, ANCHOR_FILE);
  const allowedList = `the host runtime provides only ${opts.allowedImports.join(", ")}`;
  const refused = new Set<string>();
  const importedJsonFiles = new Set<string>();

  const inPkgSource = (file: string) => {
    if (!inside(rootDir, file)) return false;
    return !path.relative(rootDir, path.resolve(file)).split(path.sep).includes("node_modules");
  };

  host.resolveModuleNameLiterals = (literals, containingFile, redirected, compilerOpts, source) =>
    literals.map((literal) => {
      const text = literal.text;
      const resolve = (from: string) =>
        ts.resolveModuleName(
          text,
          from,
          compilerOpts,
          host,
          undefined,
          redirected,
          ts.getModeForUsageLocation(source, literal, compilerOpts),
        );
      const declared = (found: ReturnType<typeof resolve>) => {
        const file = found.resolvedModule?.resolvedFileName;
        return file !== undefined && (inside(opts.typesDir, file) || inside(typesReal, file));
      };

      if (!inPkgSource(containingFile)) {
        const found = resolve(containingFile);
        const bare = !text.startsWith("./") && !text.startsWith("../");
        return bare && !declared(found) ? { resolvedModule: undefined } : found;
      }

      const refuse = (why: string) => {
        const at =
          literal.pos < 0
            ? { line: 0, character: 0 }
            : source.getLineAndCharacterOfPosition(literal.getStart(source));
        const file = path.relative(pkgReal, source.fileName).split(path.sep).join("/");
        refused.add(`${file}:${at.line + 1}:${at.character + 1} imports '${text}': ${why}`);
        return { resolvedModule: undefined };
      };

      if (/\.css$/i.test(text)) {
        return refuse(
          `CSS imports are not supported in external browser plugin modules yet (see issue #1935)`,
        );
      }

      if (!text.startsWith("./") && !text.startsWith("../")) {
        if (!opts.allowedImports.includes(text)) return refuse(allowedList);
        const found = resolve(anchor);
        return declared(found)
          ? found
          : refuse(`the host runtime lists '${text}' but carries no declarations for it`);
      }

      const found = resolve(containingFile);
      const file = found.resolvedModule?.resolvedFileName;
      if (file !== undefined && file.endsWith(".json") && inPkgSource(file)) {
        importedJsonFiles.add(file);
        return found;
      }
      if (
        file === undefined
          ? inPkgSource(path.resolve(path.dirname(containingFile), text))
          : inPkgSource(file) || DECLARATION_RE.test(file)
      ) {
        return found;
      }
      const rootLabel = path.relative(pkgReal, rootDir).split(path.sep).join("/") || ".";
      return refuse(`relative imports must stay inside ${rootLabel}/`);
    });

  const program = ts.createProgram([entryAbs], options, host);
  if (refused.size > 0) {
    throw new PluginWebCompileError([...refused].join("\n"));
  }
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    throw new PluginWebCompileError(formatDiagnostics(ts, pkgReal, diagnostics));
  }

  const reachableSources = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && inPkgSource(sf.fileName));
  const depAbsPaths = [
    ...new Set([...reachableSources.map((sf) => sf.fileName), ...importedJsonFiles]),
  ].sort();

  const ifacesPath = path.join(pkgReal, "ifaces.json");
  if (fs.existsSync(ifacesPath)) {
    depAbsPaths.push(ifacesPath);
  }

  const hasher = createHash("sha256").update(opts.typesHash).update("\0").update(opts.entryRel);
  const depsMeta: LatestBuildRecord["deps"] = [];
  for (const abs of depAbsPaths) {
    const relFromPkg = path.relative(pkgReal, abs).split(path.sep).join("/");
    const bytes = fs.readFileSync(abs);
    const st = fs.statSync(abs);
    hasher.update("\0").update(relFromPkg).update("\0").update(bytes);
    depsMeta.push({ rel: relFromPkg, size: st.size, mtimeMs: Math.trunc(st.mtimeMs) });
  }
  const hash = hasher.digest("hex").slice(0, 16);
  const outDir = path.join(specCacheDir, hash);
  const entryJsRel = path
    .relative(rootDir, entryAbs)
    .split(path.sep)
    .join("/")
    .replace(SOURCE_RE, ".js");

  if (!fs.existsSync(path.join(outDir, ".ok"))) {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    try {
      for (const sf of reachableSources) {
        const result = program.emit(sf);
        if (result.emitSkipped) {
          throw new PluginWebCompileError(formatDiagnostics(ts, pkgReal, result.diagnostics));
        }
      }
      for (const jsonAbs of importedJsonFiles) {
        const relFromRoot = path.relative(rootDir, jsonAbs).split(path.sep).join("/");
        const dest = path.join(staging, ...relFromRoot.split("/"));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(jsonAbs, dest);
      }
      if (opts.browserIfaces !== undefined) {
        fs.writeFileSync(path.join(staging, "ifaces.json"), JSON.stringify(opts.browserIfaces));
      }
      fs.writeFileSync(path.join(staging, ".ok"), hash);
      fs.mkdirSync(path.dirname(outDir), { recursive: true });
      try {
        fs.renameSync(staging, outDir);
      } catch {
        fs.rmSync(staging, { recursive: true, force: true });
        if (!fs.existsSync(path.join(outDir, ".ok"))) {
          throw new PluginWebCompileError(`failed to commit compiled browser module to ${outDir}`);
        }
      }
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw err;
    }
  }

  const latestRecord: LatestBuildRecord = {
    hash,
    typesHash: opts.typesHash,
    entryRel: opts.entryRel,
    entryJsRel,
    deps: depsMeta,
  };
  fs.mkdirSync(specCacheDir, { recursive: true });
  fs.writeFileSync(path.join(specCacheDir, "latest.json"), JSON.stringify(latestRecord));

  return { hash, outDir, entryJsRel };
}

function activeExternalPlugins(host: PluginHost): LoadedPlugin[] {
  const unmet = typeof host.unsatisfied === "function" ? host.unsatisfied() : new Map();
  return [...host.entries().values()].filter(
    (plugin) => unmet.get(plugin.specifier)?.disabled !== true,
  );
}

function isSpecifierActive(host: PluginHost, specifier: string): boolean {
  if (!host.entries().has(specifier)) return false;
  const unmet = typeof host.unsatisfied === "function" ? host.unsatisfied() : new Map();
  return unmet.get(specifier)?.disabled !== true;
}

interface SingleIfacesRead {
  ifaces: TrimmedBrowserIfaces;
  browser?: BrowserEntryMeta;
}

function readSingleIfacesFile(pkgDir: string): SingleIfacesRead | null {
  const file = path.join(pkgDir, "ifaces.json");
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      ifaces?: IfaceTable["ifaces"];
      types?: IfaceTable["types"];
      modules?: ManifestTable;
      browser?: Partial<BrowserEntryMeta>;
    };
    if (!raw.ifaces || !raw.types || !raw.modules) return null;
    const browser =
      raw.browser && typeof raw.browser.entry === "string" && Array.isArray(raw.browser.modules)
        ? {
            entry: raw.browser.entry,
            modules: raw.browser.modules.filter((m): m is string => typeof m === "string"),
            replaces: Array.isArray(raw.browser.replaces)
              ? raw.browser.replaces.filter((m): m is string => typeof m === "string")
              : [],
          }
        : undefined;
    return {
      ifaces: trimBrowserIfaces(
        { ifaces: raw.ifaces, types: raw.types, modules: raw.modules },
        browser,
      ),
      ...(browser !== undefined ? { browser } : {}),
    };
  } catch {
    return null;
  }
}

export interface BuiltPluginWebState {
  manifest: WebModulesManifest;
  /** Keyed by `${specifier}\0${hash}` → compiled cache directory on disk. */
  compiledDirs: Map<string, string>;
}

/**
 * Compiles (with content-hash disk cache) every active external package's declared `browser` entry
 * and returns the slim static manifest + compiled output directory map.
 */
export async function buildPluginWebState(
  host: PluginHost,
  source: WebFiles,
  cacheRoot: string,
): Promise<BuiltPluginWebState> {
  const empty: BuiltPluginWebState = {
    manifest: { imports: {}, modules: [], unsatisfied: [] },
    compiledDirs: new Map(),
  };
  const typesBundle = ensureHostWebPluginTypes(source, cacheRoot);
  if (typesBundle === null) return empty;

  const modules: CompiledWebModuleEntry[] = [];
  const unsatisfied: UnsatisfiedWebModule[] = [];
  const compiledDirs = new Map<string, string>();

  for (const plugin of activeExternalPlugins(host)) {
    if (!plugin.file) continue;
    const pkgDir = packageDirAbove(plugin.file);
    if (!pkgDir) continue;

    let entryRel: string | null;
    try {
      entryRel = resolvePluginBrowserEntry(pkgDir);
    } catch (err) {
      unsatisfied.push({
        specifier: plugin.specifier,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (entryRel === null) continue;

    const read = readSingleIfacesFile(pkgDir);
    if (read === null) {
      unsatisfied.push({
        specifier: plugin.specifier,
        error: `missing or unreadable ifaces.json beside package.json`,
      });
      continue;
    }

    try {
      const compiled = await compilePluginWeb({
        pkgDir,
        specifier: plugin.specifier,
        entryRel,
        typesDir: typesBundle.typesDir,
        typesHash: typesBundle.hash,
        allowedImports: typesBundle.imports,
        cacheRoot,
        browserIfaces: read.ifaces,
      });
      compiledDirs.set(`${plugin.specifier}\0${compiled.hash}`, compiled.outDir);
      const base = `${MODULES_STATIC_PREFIX}/${plugin.specifier}/${compiled.hash}`;
      modules.push({
        specifier: plugin.specifier,
        hash: compiled.hash,
        entry: `${base}/${compiled.entryJsRel}`,
        ifacesUrl: `${base}/ifaces.json`,
        ...(read.browser !== undefined ? { browser: read.browser } : {}),
      });
    } catch (err) {
      unsatisfied.push({
        specifier: plugin.specifier,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { manifest: { imports: typesBundle.importMap, modules, unsatisfied }, compiledDirs };
}

/**
 * In-memory snapshot + single-flight cache for `/assets/modules.json` and O(1) lookup for
 * `/assets/modules/<pkg>/<hash>/<file>`.
 */
interface CachedHostSnapshot {
  key: string;
  state: BuiltPluginWebState;
}

const snapshotByCacheRoot = new Map<string, CachedHostSnapshot>();
const inflightByCacheRoot = new Map<
  string,
  { key: string; promise: Promise<BuiltPluginWebState> }
>();

function hostSnapshotKey(host: PluginHost, typesHash: string): string {
  return (
    typesHash +
    "\0" +
    activeExternalPlugins(host)
      .map((p) => `${p.specifier}\t${p.file ?? ""}\t${p.stamp ?? ""}`)
      .join("\n")
  );
}

/**
 * Returns the cached manifest + compiledDirs for the current `PluginHost` snapshot, compiling
 * at most once per `(cacheRoot, typesHash, activePlugins)` tuple (single-flight).
 */
export async function getCachedPluginWebState(
  host: PluginHost,
  source: WebFiles,
  cacheRoot: string,
): Promise<BuiltPluginWebState> {
  const typesBundle = ensureHostWebPluginTypes(source, cacheRoot);
  if (typesBundle === null) {
    return { manifest: { imports: {}, modules: [], unsatisfied: [] }, compiledDirs: new Map() };
  }
  const rootKey = path.resolve(cacheRoot);
  const key = hostSnapshotKey(host, typesBundle.hash);
  const cached = snapshotByCacheRoot.get(rootKey);
  if (cached && cached.key === key) {
    return cached.state;
  }
  const inflight = inflightByCacheRoot.get(rootKey);
  if (inflight && inflight.key === key) {
    return inflight.promise;
  }
  const promise = buildPluginWebState(host, source, cacheRoot)
    .then((state) => {
      snapshotByCacheRoot.set(rootKey, { key, state });
      return state;
    })
    .finally(() => {
      if (inflightByCacheRoot.get(rootKey)?.promise === promise) {
        inflightByCacheRoot.delete(rootKey);
      }
    });
  inflightByCacheRoot.set(rootKey, { key, promise });
  return promise;
}

/**
 * O(1) hot-path resolver for `/assets/modules/<specifier>/<hash>/<relPath>`:
 * checks the in-memory snapshot map first without scanning `PluginHost` or touching any other
 * plugin; falls back to `getCachedPluginWebState` only on a cold miss (e.g. right after restart).
 */
export async function resolveStaticModuleFile(
  host: PluginHost,
  source: WebFiles,
  cacheRoot: string,
  specifier: string,
  hash: string,
  relPath: string,
): Promise<string | null> {
  if (!isSpecifierActive(host, specifier)) return null;
  const rootKey = path.resolve(cacheRoot);
  const mapKey = `${specifier}\0${hash}`;
  let outDir = snapshotByCacheRoot.get(rootKey)?.state.compiledDirs.get(mapKey);
  if (outDir === undefined) {
    const state = await getCachedPluginWebState(host, source, cacheRoot);
    outDir = state.compiledDirs.get(mapKey);
  }
  if (outDir === undefined) return null;
  return resolveCompiledPluginAsset(outDir, relPath);
}

/** Parses `/assets/modules/<specifier>/<hash>/<relPath>` (scoped or unscoped specifier). */
export function parsePluginStaticPath(
  reqPath: string,
): { specifier: string; hash: string; relPath: string } | null {
  if (!reqPath.startsWith(`${MODULES_STATIC_PREFIX}/`)) return null;
  const rest = reqPath.slice(MODULES_STATIC_PREFIX.length + 1);
  if (rest === "" || rest.includes("\0") || rest.includes("\\")) return null;
  const parts = rest.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  let specifier: string;
  let idx: number;
  if (parts[0]!.startsWith("@")) {
    if (parts.length < 4) return null;
    specifier = `${parts[0]}/${parts[1]}`;
    idx = 2;
  } else {
    if (parts.length < 3) return null;
    specifier = parts[0]!;
    idx = 1;
  }
  const hash = parts[idx]!;
  if (!/^[0-9a-f]{16}$/.test(hash)) return null;
  const relPath = parts.slice(idx + 1).join("/");
  const ext = path.extname(relPath).toLowerCase();
  if (ext !== ".js" && ext !== ".mjs" && ext !== ".json" && ext !== ".map") return null;
  return { specifier, hash, relPath };
}

/** Resolves a compiled static asset under `outDir`, strictly contained inside `outDir`. */
export function resolveCompiledPluginAsset(outDir: string, relPath: string): string | null {
  if (relPath.includes("\0") || relPath.startsWith("/") || relPath.includes("\\")) return null;
  const segments = relPath.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  const base = realOr(outDir);
  const candidate = path.resolve(base, ...segments);
  if (!candidate.startsWith(base + path.sep)) return null;
  if (!fs.existsSync(candidate)) return null;
  const real = realOr(candidate);
  if (!real.startsWith(base + path.sep)) return null;
  return fs.lstatSync(real).isFile() ? real : null;
}
