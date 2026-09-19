/**
 * A workflow's source, checked and transpiled by the server.
 *
 * A workflow is TypeScript — `index.ts`, never JavaScript: what its handler returns and
 * which host members it calls are then questions the compiler answers before any of it
 * runs, not ones the first request answers. The server builds one program from the entry
 * (and whatever it imports), under options the HOST fixes — `strict`, NodeNext; a
 * `tsconfig.json` in the folder is not consulted, so a workflow cannot switch strictness
 * off for itself. `@prismshadow/penguin-server/plugin` resolves to the types the harness
 * wrote into the folder (./harness-types.ts), never to a package: what the workflow was
 * written against. Whether that still fits this platform is ../plugin/iface-check.ts.
 *
 * A second, virtual root file assigns the default export to `WorkflowPackage`, so the
 * shape is checked even when the author left `satisfies WorkflowPackage` out (in which
 * case `strict` has already refused the untyped parameters).
 *
 * Any diagnostic fails the load. A clean program is emitted into
 * `<workflow>/.build/<revision>/` — inside the folder, so the emitted code resolves the
 * workflow's own dependencies the way its source does; a dot-directory, so it is no part
 * of the revision, the recorded versions or what the watcher reacts to.
 */
import fs from "node:fs";
import path from "node:path";
import type { TypeScript } from "../plugin/typescript.js";
import { harnessTypesFile } from "./harness-types.js";

export const ENTRY = "index.ts";
export const BUILD_DIR = ".build";
/** The module a workflow imports its types from. */
export const TYPES_MODULE = "@prismshadow/penguin-server/plugin";
const CHECK_FILE = "__workflow_check__.ts";
const CHECK_SOURCE = `import type { WorkflowPackage } from ${JSON.stringify(TYPES_MODULE)};
import pkg from "./index.js";
const check: WorkflowPackage = pkg;
void check;
`;
/** Diagnostics reported per load; a broken import alone can produce hundreds. */
const MAX_DIAGNOSTICS = 12;

export class WorkflowCompileError extends Error {}

/** Type-checks the workflow in `dir` and emits it; resolves to the emitted entry file. */
export function compileWorkflow(ts: TypeScript, dir: string, revision: string): string {
  const entry = path.join(dir, ENTRY);
  if (!fs.existsSync(entry)) {
    const js = ["index.mjs", "index.js"].find((f) => fs.existsSync(path.join(dir, f)));
    throw new WorkflowCompileError(
      js === undefined
        ? `no ${ENTRY} next to package.json`
        : `a workflow is written in TypeScript: rename ${js} to ${ENTRY} and type its default export (\`satisfies WorkflowPackage\`)`,
    );
  }
  const outDir = path.join(dir, BUILD_DIR, revision);
  const options: import("typescript").CompilerOptions = {
    strict: true,
    noEmitOnError: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    skipLibCheck: true,
    rootDir: dir,
    outDir,
  };
  const checkFile = path.join(dir, CHECK_FILE);
  const same = (file: string) => path.resolve(file) === checkFile;
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (file) => same(file) || fileExists.call(host, file);
  host.readFile = (file) => (same(file) ? CHECK_SOURCE : readFile.call(host, file));
  host.getSourceFile = (file, languageVersion, ...rest) =>
    same(file)
      ? ts.createSourceFile(file, CHECK_SOURCE, languageVersion, true)
      : getSourceFile.call(host, file, languageVersion, ...rest);
  const types = {
    resolvedFileName: harnessTypesFile(dir),
    extension: ts.Extension.Dts,
    isExternalLibraryImport: false,
  };
  host.resolveModuleNameLiterals = (literals, containingFile, redirected, opts, source) =>
    literals.map((literal) =>
      literal.text === TYPES_MODULE
        ? { resolvedModule: types }
        : ts.resolveModuleName(
            literal.text,
            containingFile,
            opts,
            host,
            undefined,
            redirected,
            ts.getModeForUsageLocation(source, literal, opts),
          ),
    );

  const program = ts.createProgram([entry, checkFile], options, host);
  const all = ts.getPreEmitDiagnostics(program);
  // The virtual root asks what `satisfies WorkflowPackage` already asks; when the author's
  // own files have something to say, its copy of the same complaint is left out.
  const authored = all.filter((d) => d.file === undefined || !same(d.file.fileName));
  const diagnostics = authored.length > 0 ? authored : all;
  if (diagnostics.length > 0) throw new WorkflowCompileError(describe(ts, dir, diagnostics));

  fs.rmSync(outDir, { recursive: true, force: true });
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || same(source.fileName)) continue;
    if (program.isSourceFileFromExternalLibrary(source)) continue;
    const result = program.emit(source);
    if (result.emitSkipped) {
      throw new WorkflowCompileError(describe(ts, dir, result.diagnostics));
    }
  }
  return path.join(outDir, "index.js");
}

/** What the last load came to, beside the emitted code: see {@link writeLoadStatus}. */
export const STATUS_FILE = "status.json";

/**
 * Writes `.build/status.json` after every load, good or bad. The Agent that wrote the
 * workflow has its files and nothing else — no session with the HTTP API — so this is how
 * it learns whether the edit it just made loaded, and what the compiler said if it did not:
 * edit, wait a moment, read this file.
 */
export function writeLoadStatus(
  dir: string,
  status: {
    revision: string;
    checkedAt: string;
    error: string | null;
    tabs: string[];
    hints: string[];
  },
): void {
  try {
    fs.mkdirSync(path.join(dir, BUILD_DIR), { recursive: true });
    const file = path.join(dir, BUILD_DIR, STATUS_FILE);
    fs.writeFileSync(
      `${file}.tmp`,
      `${JSON.stringify({ ok: status.error === null, ...status }, null, 1)}\n`,
    );
    fs.renameSync(`${file}.tmp`, file);
  } catch {
    // The folder may have just been removed; the status of a workflow that is gone is moot.
  }
}

/** Drops the emitted code of every revision but `keep` (the one now serving). */
export function pruneBuilds(dir: string, keep: string): void {
  const base = path.join(dir, BUILD_DIR);
  let entries: string[];
  try {
    entries = fs.readdirSync(base);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === keep || name === STATUS_FILE) continue;
    fs.rmSync(path.join(base, name), { recursive: true, force: true });
  }
}

/**
 * An assignability failure arrives as a chain from the outermost type down to the member
 * that does not fit, each level restating the whole shape. The first line says what was
 * being assigned and the last two say what is wrong; the levels between are dropped.
 */
function briefly(chain: string): string {
  const lines = chain.split("\n").map((line) => line.trim());
  const kept = lines.length <= 4 ? lines : [lines[0]!, "…", ...lines.slice(-2)];
  return kept.join("\n    ");
}

function describe(
  ts: TypeScript,
  dir: string,
  diagnostics: readonly import("typescript").Diagnostic[],
): string {
  const lines = diagnostics.slice(0, MAX_DIAGNOSTICS).map((d) => {
    const text = briefly(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    if (d.file === undefined || d.start === undefined) return `TS${d.code} ${text}`;
    const at = d.file.getLineAndCharacterOfPosition(d.start);
    const file = path.relative(dir, d.file.fileName).split(path.sep).join("/");
    // The virtual root file is the server's question, not a file the author can open.
    const where =
      file === CHECK_FILE ? "default export" : `${file}:${at.line + 1}:${at.character + 1}`;
    return `${where} TS${d.code} ${text}`;
  });
  if (diagnostics.length > MAX_DIAGNOSTICS) {
    lines.push(`… and ${diagnostics.length - MAX_DIAGNOSTICS} more`);
  }
  return lines.join("\n");
}
