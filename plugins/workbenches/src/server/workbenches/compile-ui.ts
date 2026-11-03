/**
 * A workbench's pages in TSX, checked and emitted by the server.
 *
 * A page under `ui/` may be TypeScript with JSX that imports React and the shared UI package.
 * A browser runs neither, and resolves a bare specifier only through an import map, so the
 * server compiles the pages into `.build/<revision>/ui/` — a request for a `.js` that is not
 * on disk is answered from there (./routes.ts) — and serves their HTML with a map onto the
 * page runtime it carries (./page-html.ts, ./ui-runtime.ts). Only a `ui/` holding a `.tsx`
 * is compiled; a folder of plain pages is served as written, exactly as before.
 *
 * The program is the host's, as the handler's is (./compile.ts): strict, NodeNext (a relative
 * import names the `.js` it becomes), the DOM's library, no ambient `@types`, every file
 * compiled on its own (`isolatedModules`, the way the browser loads them). Every `.ts` and
 * `.tsx` under `ui/` is a root, so every file is checked without reading the HTML. A bare
 * specifier resolves only when the runtime lists it, and then only into the declarations
 * copied to `.harness/ui/` — never the folder's own `node_modules`, nor a version its
 * `package.json` names: a page is checked against the build that will run it. Refused by
 * name: any other bare specifier, a code file outside `ui/`, a stylesheet imported from code,
 * and a `.ts`/`.tsx` beside a `.js` of the same path (the file on disk would be served, never
 * what the source compiles to).
 *
 * The emit goes aside and is put in place only once the whole load has succeeded, so a load
 * that fails — even one of the revision that is serving — leaves the serving pages as they were.
 */
import fs from "node:fs";
import path from "node:path";
import type { TypeScript } from "../plugin/typescript.js";
import { BUILD_DIR, describe, WorkbenchCompileError } from "./compile.js";
import { UI_DIR, type WorkbenchFolder } from "./store.js";
import { installUiTypes, type UiRuntime } from "./ui-runtime.js";

const SOURCE = /\.tsx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;
/** A file name inside the copied declarations: bare specifiers resolve as if imported from there. */
const ANCHOR = "__page__.ts";

/** Whether a load compiles the folder's pages: its `ui/` holds at least one `.tsx`. */
export function hasTsxPages(files: readonly string[]): boolean {
  return files.some((f) => f.startsWith(`${UI_DIR}/`) && f.endsWith(".tsx"));
}

/** Pages emitted aside: `commit` puts them in place once the load has succeeded; `discard` drops them. */
export interface UiBuild {
  commit(): void;
  discard(): void;
}

function inside(parent: string, file: string): boolean {
  const rel = path.relative(parent, path.resolve(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** The compiler resolves a package to its real path; the copy may sit under a symlinked root. */
function realOr(dir: string): string {
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return dir;
  }
}

/**
 * Type-checks the pages of `folder` against `runtime` and emits them aside; throws
 * {@link WorkbenchCompileError} naming each problem as `ui/<file>:<line>:<col> …`.
 */
export function compileWorkbenchUi(
  ts: TypeScript,
  folder: WorkbenchFolder,
  runtime: UiRuntime,
): UiBuild {
  const { dir } = folder;
  const uiDir = path.join(dir, UI_DIR);
  const files = new Set(folder.files);
  const roots = folder.files.filter(
    (f) => f.startsWith(`${UI_DIR}/`) && SOURCE.test(f) && !DECLARATION.test(f),
  );
  const twins = roots.flatMap((root) => {
    const js = root.replace(SOURCE, ".js");
    return files.has(js)
      ? [
          `${root}:1:1 and ${js} are the same page: the browser would be served ${js} as written, never what ${root} compiles to — delete one of them`,
        ]
      : [];
  });
  if (twins.length > 0) throw new WorkbenchCompileError(twins.join("\n"));

  const typesDir = installUiTypes(dir, runtime);
  const typesReal = realOr(typesDir);
  const provided = Object.keys(runtime.manifest.imports);
  const target = path.join(dir, BUILD_DIR, folder.revision, UI_DIR);
  const staging = `${target}.${process.pid}.tmp`;
  const options: import("typescript").CompilerOptions = {
    strict: true,
    noEmitOnError: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
    skipLibCheck: true,
    isolatedModules: true,
    forceConsistentCasingInFileNames: true,
    rootDir: uiDir,
    outDir: staging,
  };

  const refused = new Set<string>();
  const imports = `a page imports files under ${UI_DIR}/ by a relative path, and of packages only what this server provides: ${provided.join(", ")}`;
  const host = ts.createCompilerHost(options);
  const anchor = path.join(typesDir, ANCHOR);
  host.resolveModuleNameLiterals = (literals, containingFile, redirected, opts, source) =>
    literals.map((literal) => {
      const text = literal.text;
      const resolve = (from: string) =>
        ts.resolveModuleName(
          text,
          from,
          opts,
          host,
          undefined,
          redirected,
          ts.getModeForUsageLocation(source, literal, opts),
        );
      const declared = (found: ReturnType<typeof resolve>) => {
        const file = found.resolvedModule?.resolvedFileName;
        return file !== undefined && (inside(typesDir, file) || inside(typesReal, file));
      };
      if (!inside(uiDir, containingFile)) {
        // The declarations' own imports (React's types reaching csstype) resolve among
        // themselves; a package they name but do not carry stays unresolved rather than being
        // looked for up the folder's own node_modules (`skipLibCheck` leaves it untyped).
        const found = resolve(containingFile);
        const bare = !text.startsWith("./") && !text.startsWith("../");
        return bare && !declared(found) ? { resolvedModule: undefined } : found;
      }
      const refuse = (why: string) => {
        // The JSX runtime's import is the compiler's own and has no place in the file.
        const at =
          literal.pos < 0
            ? { line: 0, character: 0 }
            : source.getLineAndCharacterOfPosition(literal.getStart(source));
        const file = path.relative(dir, source.fileName).split(path.sep).join("/");
        refused.add(`${file}:${at.line + 1}:${at.character + 1} imports '${text}': ${why}`);
        return { resolvedModule: undefined };
      };
      if (/\.css$/i.test(text)) {
        return refuse(
          `a stylesheet is linked from the page's HTML (<link rel="stylesheet" href="…">), never imported from its code`,
        );
      }
      if (!text.startsWith("./") && !text.startsWith("../")) {
        if (!provided.includes(text)) return refuse(imports);
        const found = resolve(anchor);
        return declared(found)
          ? found
          : refuse(`this server's page runtime lists it but carries no types for it`);
      }
      const found = resolve(containingFile);
      const file = found.resolvedModule?.resolvedFileName;
      if (
        file === undefined
          ? inside(uiDir, path.resolve(path.dirname(containingFile), text))
          : inside(uiDir, file) || DECLARATION.test(file)
      ) {
        return found;
      }
      const sdk = path
        .relative(dir, path.resolve(path.dirname(containingFile), text))
        .split(path.sep)
        .join("/")
        .startsWith("sdk/");
      return refuse(
        `it is outside ${UI_DIR}/, and ${imports}` +
          (sdk
            ? ` (the page SDK is loaded at run time through a variable, outside the check: const sdk = "${text}"; await import(sdk))`
            : ""),
      );
    });

  const program = ts.createProgram(
    roots.map((root) => path.join(dir, root)),
    options,
    host,
  );
  if (refused.size > 0) throw new WorkbenchCompileError([...refused].join("\n"));
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) throw new WorkbenchCompileError(describe(ts, dir, diagnostics));

  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || !inside(uiDir, source.fileName)) continue;
    const result = program.emit(source);
    if (result.emitSkipped) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw new WorkbenchCompileError(describe(ts, dir, result.diagnostics));
    }
  }
  return {
    commit() {
      // A reload of the serving revision replaces pages in use: they are moved aside, not
      // deleted, until the new ones are in, and moved back if they cannot be.
      const old = `${target}.${process.pid}.old`;
      fs.rmSync(old, { recursive: true, force: true });
      const had = fs.existsSync(target);
      if (had) fs.renameSync(target, old);
      try {
        fs.renameSync(staging, target);
      } catch (err) {
        if (had) fs.renameSync(old, target);
        throw err;
      }
      fs.rmSync(old, { recursive: true, force: true });
    },
    discard() {
      fs.rmSync(staging, { recursive: true, force: true });
    },
  };
}
