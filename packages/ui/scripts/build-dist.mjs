#!/usr/bin/env node
/**
 * Builds what the package publishes, and the Workbench runtime the Web App carries:
 *
 *   dist/index.js, dist/highlighter.js, dist/chunks/   ES modules for a bundler: React and every npm
 *                                                     dependency stay imports, penguin-core/a2ui is
 *                                                     bundled, and no module imports CSS
 *   dist/index.d.ts, dist/highlighter.d.ts             one declaration file per entry, the a2ui
 *                                                     types inlined
 *   dist/styles.css, dist/assets/                      the precompiled stylesheet, KaTeX's woff2
 *                                                     faces and the licences of what is bundled
 *   dist/fonts.css, dist/fonts/                        the optional interface typefaces, with
 *                                                     fonts/LICENSES/
 *   dist/workbench/                                    the browser runtime of a TSX Workbench page;
 *                                                     not published
 *
 * Nothing in the repository imports these: the Web App, the gallery and the tests read `src/`
 * through the `exports` map. The npm tarball reads them (`publishConfig`), and so does the Web
 * App's build, which copies `dist/workbench/` in (`penguinUi({ workbenchRuntime: true })`).
 *
 * The stylesheet goes through the Web App's own pipeline — Vite with `@tailwindcss/vite`, KaTeX
 * reduced to woff2 — with the components imported behind `scripts/styles.entry.css`, so their CSS
 * lands after it in the order the app's bundle gets.
 *
 * The runtime is the package for a browser with no bundler: every dependency but React bundled
 * in, chunks importing one another by relative path, and React imported by bare specifier so the
 * page's import map resolves every copy to the one set of modules below. Those are React's
 * production builds wrapped as ES modules, their named exports listed here at build time, because
 * a CommonJS module has no static export list for an import map to link against.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build as esbuild } from "esbuild";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";
import { build as viteBuild } from "vite";
import { dropNonWoff2FontSources } from "../src/vite-plugin.ts";

// React's index modules pick their production or development build by this variable, both in the
// bundles below and in the `require` that lists their exports.
process.env.NODE_ENV = "production";

const PKG = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(PKG, "dist");
const RUNTIME = join(DIST, "workbench");
const require = createRequire(join(PKG, "package.json"));
const ts = require("typescript");
const { version } = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));

const ENTRIES = {
  index: "src/index.ts",
  highlighter: "src/components/content/code-block/highlighter-core.ts",
};

/** What a page's import map resolves, by specifier, to the runtime file that answers it. */
const RUNTIME_IMPORTS = {
  "@prismshadow/penguin-ui": "penguin-ui.js",
  react: "react.js",
  "react/jsx-runtime": "react-jsx-runtime.js",
  "react-dom": "react-dom.js",
  "react-dom/client": "react-dom-client.js",
};
const REACT_SPECIFIERS = Object.keys(RUNTIME_IMPORTS).filter(
  (s) => s !== "@prismshadow/penguin-ui",
);

/**
 * The type packages a page is checked against whole, beside the package's own declarations: React
 * for the page's own code and JSX. The declarations the package's types reach beyond them are
 * added file by file (`declarationClosure`).
 */
const RUNTIME_TYPE_PACKAGES = ["@types/react", "@types/react-dom", "csstype"];

const isBare = (spec) => !spec.startsWith(".") && !isAbsolute(spec) && !spec.startsWith("\0");
/** Bundled into the published JS: the browser half of penguin-core, which the package must not depend on. */
const isBundled = (spec) => spec.startsWith("@prismshadow/penguin-core/");

/** Keeps every npm dependency an import of the published modules. */
const externalDependencies = {
  name: "external-dependencies",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) =>
      isBare(args.path) && !isBundled(args.path) && !args.path.endsWith(".css")
        ? { path: args.path, external: true }
        : undefined,
    );
  },
};

/**
 * Leaves React to the page's import map. An ES import of React stays a bare import. A CommonJS
 * `require` of it (React DOM's own, or a dependency's) cannot: esbuild would turn it into a
 * `require` call a browser does not have, so it is answered by a module that re-exports the bare
 * import instead. React's other entry points are not in the runtime and fail the build by name.
 */
const reactFromImportMap = {
  name: "react-from-import-map",
  setup(build) {
    build.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => {
      if (!REACT_SPECIFIERS.includes(args.path)) {
        return { errors: [{ text: `${args.path} is not one of the runtime's React modules` }] };
      }
      if (args.kind === "require-call") return { path: args.path, namespace: "react-require" };
      return { path: args.path, external: true };
    });
    build.onLoad({ filter: /.*/, namespace: "react-require" }, (args) => ({
      contents: `export * from ${JSON.stringify(args.path)};`,
      loader: "js",
    }));
  },
};

/** The wrapper modules of React's CommonJS builds, as virtual entry points. */
const reactWrappers = {
  name: "react-wrappers",
  setup(build) {
    build.onResolve({ filter: /^react-wrapper:/ }, (args) => ({
      path: args.path.slice("react-wrapper:".length),
      namespace: "react-wrapper",
    }));
    build.onLoad({ filter: /.*/, namespace: "react-wrapper" }, (args) => {
      const names = Object.keys(require(args.path)).filter(
        (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name),
      );
      // The module itself by path, so that its own import is bundled while the `require`s inside
      // it of the other React modules reach `reactFromImportMap`.
      const file = require.resolve(args.path);
      return {
        contents: [
          `import m from ${JSON.stringify(file)};`,
          "export default m;",
          `export const { ${names.join(", ")} } = m;`,
        ].join("\n"),
        resolveDir: PKG,
        loader: "js",
      };
    });
  },
};

const BROWSER = {
  absWorkingDir: PKG,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  // Components import their CSS; the stylesheets carry it, so the modules import none.
  loader: { ".css": "empty" },
  logLevel: "warning",
};

/** dist/index.js, dist/highlighter.js and their shared chunks. */
async function buildModules() {
  await esbuild({
    ...BROWSER,
    entryPoints: ENTRIES,
    outdir: DIST,
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    plugins: [externalDependencies],
  });
}

/** One declaration file per entry: rolled up so a2ui's types are inlined and core is never named. */
async function buildDeclarations() {
  for (const [name, input] of Object.entries(ENTRIES)) {
    const bundle = await rollup({
      input: join(PKG, input),
      external: (id) => isBare(id) && !isBundled(id) && !id.endsWith(".css"),
      plugins: [
        {
          // A side-effect import of a stylesheet has no types.
          name: "css-has-no-types",
          resolveId: (id) => (id.endsWith(".css") ? `\0css:${id}` : null),
          load: (id) => (id.startsWith("\0css:") ? "export {};" : null),
        },
        dts({
          tsconfig: join(PKG, "tsconfig.json"),
          respectExternal: true,
          // pnpm links every package; through its real path, each declaration has one identity.
          compilerOptions: { preserveSymlinks: false },
        }),
      ],
      onwarn(warning, warn) {
        // The same declaration reached from two modules; rolled up once.
        if (warning.code !== "CIRCULAR_DEPENDENCY") warn(warning);
      },
    });
    await bundle.write({ file: join(DIST, `${name}.d.ts`), format: "es" });
    await bundle.close();
  }
}

/**
 * One Vite build of a virtual entry that imports `imports`, keeping the CSS it emits and its
 * assets. Bare imports other than stylesheets stay external, so only the package's own modules
 * are read: what the build is for is their CSS, in their import order.
 */
async function buildStylesheet({ name, imports, assetsDir, plugins = [] }) {
  const out = mkdtempSync(join(tmpdir(), "penguin-ui-css-"));
  const entry = `\0penguin-ui-${name}`;
  try {
    await viteBuild({
      configFile: false,
      root: PKG,
      // Relative, so the sheet names its fonts by a path next to it wherever it is served.
      base: "./",
      publicDir: false,
      logLevel: "warn",
      plugins: [
        {
          name: "penguin-ui-stylesheet-entry",
          resolveId: (id) => (id === entry ? id : null),
          load: (id) =>
            id === entry
              ? imports
                  .map((file) => `import ${JSON.stringify(file.split("\\").join("/"))};`)
                  .join("\n")
              : null,
        },
        ...plugins,
      ],
      build: {
        outDir: out,
        emptyOutDir: true,
        copyPublicDir: false,
        reportCompressedSize: false,
        // Never inline a font, as in the Web App.
        assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
        rollupOptions: {
          input: { [name]: entry },
          external: (id) => isBare(id) && !id.endsWith(".css"),
          // The package declares its modules free of side effects, so the entry, which uses none
          // of their exports, would otherwise drop every one and the CSS each imports with it.
          // The JS this writes is thrown away.
          treeshake: false,
          output: {
            entryFileNames: "[name].js",
            assetFileNames: (asset) =>
              (asset.names?.[0] ?? "").endsWith(".css")
                ? "[name][extname]"
                : `${assetsDir}/[name]-[hash][extname]`,
          },
        },
      },
    });
    // Every stylesheet the entry reaches lands in this one file; a second one would be CSS of a
    // lazily imported module of the package, which the published sheet would then lack.
    const sheets = readdirSync(out, { recursive: true }).filter((file) =>
      String(file).endsWith(".css"),
    );
    if (sheets.length !== 1)
      throw new Error(`${name}.css: expected one stylesheet, got ${sheets.join(", ")}`);
    cpSync(join(out, `${name}.css`), join(DIST, `${name}.css`));
    cpSync(join(out, assetsDir), join(DIST, assetsDir), { recursive: true });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** dist/styles.css and KaTeX's faces in dist/assets/, with the licences of what dist bundles. */
async function buildStyles() {
  await buildStylesheet({
    name: "styles",
    imports: [join(PKG, "scripts/styles.entry.css"), join(PKG, ENTRIES.index)],
    assetsDir: "assets",
    plugins: [
      tailwindcss(),
      {
        name: "katex-woff2-only",
        enforce: "pre",
        transform(code, id) {
          if (!id.includes("/katex/dist/") || !id.includes(".css")) return null;
          return { code: dropNonWoff2FontSources(code), map: null };
        },
      },
    ],
  });
  // KaTeX's stylesheet and faces are in the sheet; the icon sets' outlines are in the modules.
  const licenses = join(DIST, "assets/LICENSES");
  mkdirSync(licenses, { recursive: true });
  cpSync(join(PKG, "node_modules/katex/LICENSE"), join(licenses, "katex.txt"));
  cpSync(join(PKG, "src/components/icons/sets/LICENSES"), licenses, { recursive: true });
}

/** dist/fonts.css, its faces and their licences in dist/fonts/. */
async function buildFonts() {
  await buildStylesheet({
    name: "fonts",
    imports: [join(PKG, "src/fonts/index.css")],
    assetsDir: "fonts",
  });
  cpSync(join(PKG, "src/fonts/LICENSES"), join(DIST, "fonts/LICENSES"), { recursive: true });
}

/** The runtime's modules: the package and its dependencies, then React's four wrappers. */
async function buildRuntimeModules() {
  const runtime = {
    ...BROWSER,
    outdir: RUNTIME,
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [reactFromImportMap],
  };
  await esbuild({
    ...runtime,
    entryPoints: { "penguin-ui": ENTRIES.index },
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
  });
  await esbuild({
    ...runtime,
    entryPoints: Object.fromEntries(
      REACT_SPECIFIERS.map((spec) => [
        RUNTIME_IMPORTS[spec].replace(/\.js$/, ""),
        `react-wrapper:${spec}`,
      ]),
    ),
    plugins: [reactWrappers, reactFromImportMap],
  });
}

/** The directory an installed package lives in, resolved from `from`. */
const packageDir = (name, from) =>
  dirname(createRequire(join(from, "package.json")).resolve(`${name}/package.json`));

/** The nearest directory holding `file` whose package.json names a package. */
function packageRoot(file) {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name) return dir;
  }
  throw new Error(`${file} belongs to no package`);
}

/**
 * The packages the declarations of `entry` reach, resolved as a page's compile resolves them
 * (NodeNext, no ambient types), each with the declaration files TypeScript loads from it. A
 * component's props name react-markdown's and zustand's types, and those the unified packages',
 * so a page needs them too or those props check as `any`. The tree they are copied into is flat,
 * so a name reached in two versions fails the build rather than picking one. `seed` maps the
 * packages copied whole to their directories, which the closure must agree with.
 */
function declarationClosure(entry, seed) {
  const program = ts.createProgram([entry], {
    noEmit: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  });
  const packages = new Map(Object.entries(seed).map(([name, dir]) => [name, { dir, files: null }]));
  for (const source of program.getSourceFiles()) {
    if (resolve(source.fileName) === resolve(entry)) continue;
    if (program.isSourceFileDefaultLibrary(source)) continue;
    const dir = packageRoot(source.fileName);
    const { name } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const known = packages.get(name);
    if (known !== undefined && resolve(known.dir) !== resolve(dir)) {
      throw new Error(`the package's types reach ${name} twice: ${known.dir} and ${dir}`);
    }
    if (known === undefined) packages.set(name, { dir, files: new Set() });
    packages.get(name).files?.add(relative(dir, source.fileName));
  }
  return [...packages].filter(([, { files }]) => files !== null);
}

/** The stylesheet, the types tree and the manifest, once the published files exist. */
function assembleRuntime() {
  cpSync(join(DIST, "styles.css"), join(RUNTIME, "penguin-ui.css"));
  cpSync(join(DIST, "assets"), join(RUNTIME, "assets"), { recursive: true });

  const modules = join(RUNTIME, "types/node_modules");
  const own = join(modules, "@prismshadow/penguin-ui");
  mkdirSync(own, { recursive: true });
  cpSync(join(DIST, "index.d.ts"), join(own, "index.d.ts"));
  writeFileSync(
    join(own, "package.json"),
    `${JSON.stringify(
      {
        name: "@prismshadow/penguin-ui",
        version,
        type: "module",
        types: "./index.d.ts",
        exports: { ".": { types: "./index.d.ts" } },
      },
      null,
      2,
    )}\n`,
  );
  // @types/react's own dependency, csstype, resolves from @types/react.
  const from = {
    "@types/react": PKG,
    "@types/react-dom": PKG,
    csstype: packageDir("@types/react", PKG),
  };
  const whole = Object.fromEntries(
    RUNTIME_TYPE_PACKAGES.map((name) => [name, packageDir(name, from[name])]),
  );
  for (const [name, source] of Object.entries(whole)) {
    cpSync(source, join(modules, name), {
      recursive: true,
      dereference: true,
      filter: (path) => !/\.(?:md|flow)$/.test(path),
    });
  }
  // The rest of what the package's declarations reach: the files TypeScript loads, the manifest
  // that resolves them, and the licence beside them.
  for (const [name, { dir, files }] of declarationClosure(join(DIST, "index.d.ts"), whole)) {
    const licences = readdirSync(dir).filter((file) => /^licen[cs]e/i.test(file));
    for (const file of ["package.json", ...licences, ...files]) {
      mkdirSync(dirname(join(modules, name, file)), { recursive: true });
      cpSync(join(dir, file), join(modules, name, file));
    }
  }

  const manifest = {
    version,
    imports: RUNTIME_IMPORTS,
    stylesheet: "penguin-ui.css",
    types: "types",
  };
  writeFileSync(join(RUNTIME, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

const started = Date.now();
rmSync(DIST, { recursive: true, force: true });
await Promise.all([
  buildModules(),
  buildDeclarations(),
  buildRuntimeModules(),
  // One Vite build at a time: they share the process's Tailwind and Vite state.
  buildStyles().then(buildFonts),
]);
assembleRuntime();

const count = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
console.log(
  `penguin-ui ${version}: dist/ (${count(DIST) - count(RUNTIME)} files) and dist/workbench/ ` +
    `(${count(RUNTIME)} files) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
