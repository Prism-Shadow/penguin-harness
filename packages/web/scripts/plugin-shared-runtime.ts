/**
 * Shared host ESM runtime + W3C `<script type="importmap">` + standard `types/node_modules/`
 * declarations for browser modules loaded into the host SPA document.
 *
 * Zero custom manifest formats:
 * - Build (`vite build`): adds each shared host specifier as a Rollup entry in the SAME module
 *   graph as `index.html` with `preserveEntrySignatures: "strict"`, injects a standard W3C
 *   `<script type="importmap">` into `index.html` (the single source of truth for both the
 *   browser and the server JIT compiler), and emits `.d.ts` declarations for
 *   `@prismshadow/penguin-core/kernel` and `@prismshadow/penguin-web-plugin` under standard
 *   `types/node_modules/` (React & `@prismshadow/penguin-ui` declarations already live under
 *   `workbench-runtime/types/node_modules/`).
 * - Dev (`vite dev`): serves virtual ESM wrappers at `/@penguin-shared/<key>.js` through Vite's
 *   module pipeline and injects `<script type="importmap">` pointing to them.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HtmlTagDescriptor, Plugin } from "vite";
import ts from "typescript";

export interface SharedRuntimeEntry {
  readonly specifier: string;
  readonly chunkKey: string;
  readonly cjs: boolean;
}

export const SHARED_RUNTIME_ENTRIES: readonly SharedRuntimeEntry[] = [
  { specifier: "react", chunkKey: "shared-react", cjs: true },
  { specifier: "react-dom", chunkKey: "shared-react-dom", cjs: true },
  { specifier: "react/jsx-runtime", chunkKey: "shared-react-jsx-runtime", cjs: true },
  { specifier: "@prismshadow/penguin-ui", chunkKey: "shared-penguin-ui", cjs: false },
  {
    specifier: "@prismshadow/penguin-core/kernel",
    chunkKey: "shared-penguin-core-kernel",
    cjs: false,
  },
  {
    specifier: "@prismshadow/penguin-web-plugin",
    chunkKey: "shared-penguin-web-plugin",
    cjs: false,
  },
];

export const HOST_TYPES_DIR = "types";

const VIRTUAL_PREFIX = "virtual:penguin-shared/";
const DEV_URL_PREFIX = "/@penguin-shared/";
const RESOLVED_PREFIX = "\0penguin-shared:";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const repoRoot = path.resolve(webDir, "..", "..");
const requireFromWeb = createRequire(path.join(webDir, "package.json"));

/** Returns the ES module wrapper source for one shared host specifier. */
export function sharedEntrySource(entry: SharedRuntimeEntry): string {
  if (!entry.cjs) {
    return `export * from ${JSON.stringify(entry.specifier)};\n`;
  }
  const mod = requireFromWeb(entry.specifier) as Record<string, unknown>;
  const names = Object.keys(mod)
    .filter((name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name))
    .sort();
  return (
    [
      `import m from ${JSON.stringify(entry.specifier)};`,
      "export default m;",
      names.length > 0 ? `export const { ${names.join(", ")} } = m;` : "",
    ]
      .filter(Boolean)
      .join("\n") + "\n"
  );
}

function normalizeRelativeSpecifier(spec: string): string | null {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  if (
    spec.endsWith(".js") ||
    spec.endsWith(".mjs") ||
    spec.endsWith(".cjs") ||
    spec.endsWith(".json")
  ) {
    return null;
  }
  return `${spec}.js`;
}

/**
 * TypeScript `afterDeclarations` AST transformer that appends `.js` to extensionless relative
 * module specifiers in emitted `.d.ts` files so they resolve under `moduleResolution: "NodeNext"`.
 */
export function addJsExtensionToDeclarations(): ts.TransformerFactory<ts.Bundle | ts.SourceFile> {
  return (context) => {
    const { factory } = context;
    const visit: ts.Visitor = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const next = normalizeRelativeSpecifier(node.moduleSpecifier.text);
        if (next !== null) {
          return factory.updateImportDeclaration(
            node,
            node.modifiers,
            node.importClause,
            factory.createStringLiteral(next),
            node.attributes,
          );
        }
      }
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const next = normalizeRelativeSpecifier(node.moduleSpecifier.text);
        if (next !== null) {
          return factory.updateExportDeclaration(
            node,
            node.modifiers,
            node.isTypeOnly,
            node.exportClause,
            factory.createStringLiteral(next),
            node.attributes,
          );
        }
      }
      if (ts.isImportTypeNode(node)) {
        const visited = ts.visitEachChild(node, visit, context);
        if (
          ts.isLiteralTypeNode(visited.argument) &&
          ts.isStringLiteral(visited.argument.literal)
        ) {
          const next = normalizeRelativeSpecifier(visited.argument.literal.text);
          if (next !== null) {
            return factory.updateImportTypeNode(
              visited,
              factory.updateLiteralTypeNode(visited.argument, factory.createStringLiteral(next)),
              visited.attributes,
              visited.qualifier,
              visited.typeArguments,
              visited.isTypeOf,
            );
          }
        }
        return visited;
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (sfOrBundle) => {
      if (ts.isSourceFile(sfOrBundle)) {
        return ts.visitNode(sfOrBundle, visit) as ts.SourceFile;
      }
      return sfOrBundle;
    };
  };
}

/** Collects standard `node_modules/` `.d.ts` declarations for `@prismshadow/penguin-core/kernel` and `@prismshadow/penguin-web-plugin`. */
export function buildHostTypeAssets(): { fileName: string; source: string | Uint8Array }[] {
  const assets: { fileName: string; source: string | Uint8Array }[] = [];

  // 1. @prismshadow/penguin-core/kernel declarations (already emitted by tsup in packages/core/dist/)
  const corePkgDir = path.join(repoRoot, "packages", "core");
  const corePkg = JSON.parse(fs.readFileSync(path.join(corePkgDir, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
  const coreDist = path.join(corePkgDir, "dist");
  const coreKernelDts = path.join(coreDist, "kernel", "index.d.ts");
  if (!fs.existsSync(coreKernelDts)) {
    throw new Error(
      `penguinSharedRuntime: missing ${coreKernelDts}. Build @prismshadow/penguin-core first.`,
    );
  }
  assets.push({
    fileName: `${HOST_TYPES_DIR}/node_modules/@prismshadow/penguin-core/package.json`,
    source: `${JSON.stringify(
      {
        name: corePkg.name,
        version: corePkg.version,
        type: "module",
        exports: {
          "./kernel": {
            types: "./dist/kernel/index.d.ts",
          },
        },
      },
      null,
      2,
    )}\n`,
  });
  for (const dir of [coreDist, path.join(coreDist, "kernel")]) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".d.ts")) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(coreDist, abs).split(path.sep).join("/");
      assets.push({
        fileName: `${HOST_TYPES_DIR}/node_modules/@prismshadow/penguin-core/dist/${rel}`,
        source: fs.readFileSync(abs),
      });
    }
  }

  // 2. @prismshadow/penguin-web-plugin declarations (emitted in memory from packages/web-plugin/src/)
  const webPluginDir = path.join(repoRoot, "packages", "web-plugin");
  const webPluginPkg = JSON.parse(
    fs.readFileSync(path.join(webPluginDir, "package.json"), "utf8"),
  ) as { name: string; version: string };
  const srcDir = path.join(webPluginDir, "src");
  const srcFiles = fs
    .readdirSync(srcDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
    .map((e) => path.join(srcDir, e.name))
    .sort();
  const options: ts.CompilerOptions = {
    declaration: true,
    emitDeclarationOnly: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    strict: true,
    rootDir: srcDir,
    outDir: path.join(webPluginDir, "dist"),
  };
  const program = ts.createProgram(srcFiles, options);
  const emittedWebPlugin = new Map<string, string>();
  program.emit(
    undefined,
    (fileName, text) => {
      if (!fileName.endsWith(".d.ts")) return;
      const rel = path
        .relative(path.join(webPluginDir, "dist"), fileName)
        .split(path.sep)
        .join("/");
      emittedWebPlugin.set(rel, text);
    },
    undefined,
    true,
    { afterDeclarations: [addJsExtensionToDeclarations()] },
  );
  if (!emittedWebPlugin.has("index.d.ts")) {
    throw new Error(
      "penguinSharedRuntime: failed to emit declarations for @prismshadow/penguin-web-plugin",
    );
  }
  assets.push({
    fileName: `${HOST_TYPES_DIR}/node_modules/@prismshadow/penguin-web-plugin/package.json`,
    source: `${JSON.stringify(
      {
        name: webPluginPkg.name,
        version: webPluginPkg.version,
        type: "module",
        exports: {
          ".": {
            types: "./dist/index.d.ts",
          },
        },
      },
      null,
      2,
    )}\n`,
  });
  for (const [rel, source] of [...emittedWebPlugin.entries()].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    assets.push({
      fileName: `${HOST_TYPES_DIR}/node_modules/@prismshadow/penguin-web-plugin/dist/${rel}`,
      source,
    });
  }

  return assets;
}

export function penguinSharedRuntime(): Plugin {
  const byChunkKey = new Map(SHARED_RUNTIME_ENTRIES.map((e) => [e.chunkKey, e]));

  return {
    name: "penguin:shared-runtime",

    config(userConfig, env) {
      if (env.command !== "build") return undefined;
      const existingInput = userConfig.build?.rollupOptions?.input;
      const inputMap: Record<string, string> =
        typeof existingInput === "string"
          ? { index: existingInput }
          : Array.isArray(existingInput)
            ? Object.fromEntries(existingInput.map((file, i) => [`entry${i}`, file]))
            : existingInput && typeof existingInput === "object"
              ? { ...existingInput }
              : { index: path.join(webDir, "index.html") };
      for (const entry of SHARED_RUNTIME_ENTRIES) {
        inputMap[entry.chunkKey] = `${VIRTUAL_PREFIX}${entry.chunkKey}`;
      }
      return {
        build: {
          rollupOptions: {
            preserveEntrySignatures: "strict",
            input: inputMap,
          },
        },
      };
    },

    resolveId(id) {
      if (id.startsWith(VIRTUAL_PREFIX)) {
        const key = id.slice(VIRTUAL_PREFIX.length);
        if (byChunkKey.has(key)) return `${RESOLVED_PREFIX}${key}`;
      }
      if (id.startsWith(DEV_URL_PREFIX) && id.endsWith(".js")) {
        const key = id.slice(DEV_URL_PREFIX.length, -".js".length);
        if (byChunkKey.has(key)) return `${RESOLVED_PREFIX}${key}`;
      }
      return null;
    },

    load(id) {
      if (!id.startsWith(RESOLVED_PREFIX)) return null;
      const key = id.slice(RESOLVED_PREFIX.length);
      const entry = byChunkKey.get(key);
      if (!entry) return null;
      return sharedEntrySource(entry);
    },

    generateBundle() {
      for (const asset of buildHostTypeAssets()) {
        this.emitFile({ type: "asset", ...asset });
      }
    },

    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const imports: Record<string, string> = {};
        if (ctx.bundle) {
          for (const entry of SHARED_RUNTIME_ENTRIES) {
            const chunk = Object.values(ctx.bundle).find(
              (item) => item.type === "chunk" && item.isEntry && item.name === entry.chunkKey,
            );
            if (!chunk) {
              throw new Error(
                `penguinSharedRuntime: missing emitted chunk for "${entry.specifier}" (${entry.chunkKey})`,
              );
            }
            imports[entry.specifier] = `/${chunk.fileName}`;
          }
        } else {
          for (const entry of SHARED_RUNTIME_ENTRIES) {
            imports[entry.specifier] = `${DEV_URL_PREFIX}${entry.chunkKey}.js`;
          }
        }
        const tag: HtmlTagDescriptor = {
          tag: "script",
          attrs: { type: "importmap" },
          children: `\n${JSON.stringify({ imports }, null, 2)}\n    `,
          injectTo: "head-prepend",
        };
        return { html, tags: [tag] };
      },
    },
  };
}
