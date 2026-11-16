#!/usr/bin/env node
/**
 * What `@prismshadow/penguin-ui` publishes, checked on the tarball pnpm actually packs, and the
 * Workbench runtime the Web App carries, checked as a page's compile sees it.
 *
 * The package's exports point at `src/` in the repository and at `dist/` only in the tarball
 * (`publishConfig`, which pnpm applies and npm ignores), and nothing in the repository imports
 * `dist/`: a broken build would surface only in a project that installs the package, or in a
 * Workbench page that fails to compile. So:
 *
 * 1. The tarball holds no source, test helper, site file or the runtime, and its modules import
 *    no CSS.
 * 2. Every export, `main` and `types` names a file in the tarball.
 * 3. LICENSE is there, and each bundled font's licence beside the fonts.
 * 4. Installed into a project, a TSX file passing components valid props compiles under `tsc`
 *    and each line of one passing a wrong prop (the package's own type, and a dependency's) fails
 *    with TS2322; the rolled-up declarations themselves check, and none names a package the
 *    build bundles (`@prismshadow/a2ui`, `@prismshadow/chat-markdown`, both devDependencies) or
 *    `@prismshadow/penguin-core`.
 * 5. Components rendered with `react-dom/server` use only classes `styles.css` has a rule for.
 * 6. The runtime's manifest names files that exist, its modules import nothing a page's import
 *    map does not resolve, every module its declarations import is in its types tree, and those
 *    types give the same `tsc` results with the options the server compiles a page with.
 * 7. `styles.css` names the theme layers first in cascade order: `ui-base`, `ui-theme`,
 *    `ui-accent`, `ui-font`.
 *
 * Run after `pnpm --filter @prismshadow/penguin-ui build`, with the root LICENSE copied into
 * packages/ui/ as the release does before it publishes. Linux and macOS (it unpacks with `tar`).
 *
 * Usage: node scripts/check-ui-package.mjs
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const ui = join(root, "packages/ui");
const runtimeDir = join(ui, "dist/workbench");
const fromUi = createRequire(join(ui, "package.json"));
const ts = fromUi("typescript");

const failures = [];
const check = (n, title, problems) => {
  console.log(`${problems.length ? "FAIL" : "ok  "} ${n}. ${title}`);
  for (const p of problems) {
    console.log(`       ${p}`);
    failures.push(`${n}. ${p}`);
  }
};

/** Every file under `dir`, relative to it with `/`. */
const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split("\\").join("/"));

/**
 * The specifiers a module's static and dynamic imports name. A static one starts a statement,
 * which is what keeps a minified `"import"` property name out.
 */
const importsOf = (code) =>
  [
    ...code.matchAll(
      /(?:^|[;}])\s*(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+)["']/gm,
    ),
    ...code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);

if (!existsSync(join(ui, "dist/index.js")) || !existsSync(join(runtimeDir, "manifest.json"))) {
  console.error("packages/ui/dist is not built: pnpm --filter @prismshadow/penguin-ui build");
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "penguin-ui-check-"));
try {
  // --- the tarball -------------------------------------------------------------------------
  execFileSync("pnpm", ["pack", "--pack-destination", work], { cwd: ui, stdio: "ignore" });
  const tarball = readdirSync(work).find((file) => file.endsWith(".tgz"));
  const project = join(work, "project");
  const modules = join(project, "node_modules");
  const installed = join(modules, "@prismshadow/penguin-ui");
  mkdirSync(dirname(installed), { recursive: true });
  execFileSync("tar", ["-xzf", join(work, tarball), "-C", work]);
  renameSync(join(work, "package"), installed);
  const packed = filesUnder(installed);
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  console.log(`${tarball}: ${packed.length} files`);

  check(1, "no source, test helper, site file or runtime; no module imports CSS", [
    ...packed
      .filter(
        (file) =>
          /^src\//.test(file) ||
          /(^|\/)testing(\/|\.)/.test(file) ||
          /(^|\/)site[-./]/.test(file) ||
          file.startsWith("dist/workbench/"),
      )
      .map((file) => `${file} is packed`),
    ...packed
      .filter((file) => file.endsWith(".js"))
      .flatMap((file) =>
        importsOf(readFileSync(join(installed, file), "utf8"))
          .filter((spec) => spec.endsWith(".css"))
          .map((spec) => `${file} imports ${spec}`),
      ),
  ]);

  const targets = [];
  const collect = (value, key) => {
    if (typeof value === "string") targets.push([key, value]);
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) collect(v, `${key} ${k}`);
    }
  };
  collect(manifest.exports, "exports");
  collect(manifest.main, "main");
  collect(manifest.types, "types");
  check(2, "every export, main and types names a packed file", [
    ...(targets.length === 0 ? ["the packed manifest has no exports"] : []),
    ...targets
      .filter(([, target]) => !packed.includes(target.replace(/^\.\//, "")))
      .map(([key, target]) => `${key} → ${target} is not in the tarball`),
  ]);

  const fontLicenses = readdirSync(join(ui, "src/fonts/LICENSES")).map(
    (f) => `dist/fonts/LICENSES/${f}`,
  );
  check(
    3,
    "LICENSE and the font licences are packed",
    ["LICENSE", ...fontLicenses]
      .filter((file) => !packed.includes(file))
      .map(
        (file) =>
          `${file} is missing${file === "LICENSE" ? " (copy the root LICENSE in first)" : ""}`,
      ),
  );

  // --- a project that installed it ---------------------------------------------------------
  // Its dependencies are the ones this checkout installed for the package, linked in by name:
  // what an install would put there, without the network.
  writeFileSync(join(project, "package.json"), '{ "type": "module" }\n');
  for (const name of [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    "@types/react",
    "@types/react-dom",
  ]) {
    mkdirSync(dirname(join(modules, name)), { recursive: true });
    symlinkSync(realpathSync(join(ui, "node_modules", name)), join(modules, name), "dir");
  }
  // A prop typed by the package itself, and one typed by a dependency's declarations (Prose's
  // `components` is react-markdown's `Components`): each wrong line must be refused.
  const fixtures = {
    "valid.tsx":
      'import { Badge, Button, Prose } from "@prismshadow/penguin-ui";\n' +
      'export const view = <Button variant="primary" size="sm"><Badge tone="success">ok</Badge></Button>;\n' +
      'export const md = <Prose text="hi" components={{ p: "span" }} />;\n',
    "wrong.tsx":
      'import { Button, Prose } from "@prismshadow/penguin-ui";\n' +
      'export const view = <Button variant="loud">Save</Button>;\n' +
      'export const md = <Prose text="hi" components={{ p: 42 }} />;\n',
  };
  /** The 0-based lines of wrong.tsx that pass a wrong prop. */
  const WRONG_LINES = [1, 2];

  /** Compiles the fixtures in `dir` and returns the diagnostics of each, and of `alsoCheck`. */
  const compile = (dir, options, alsoCheck = []) => {
    const files = Object.keys(fixtures).map((name) => join(dir, name));
    for (const [name, text] of Object.entries(fixtures)) writeFileSync(join(dir, name), text);
    const program = ts.createProgram([...files, ...alsoCheck], options);
    const global = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
    const of = (file) => {
      const source = program.getSourceFile(file);
      if (source === undefined) return [`${file} is not in the program`];
      return [
        ...program.getSyntacticDiagnostics(source),
        ...program.getSemanticDiagnostics(source),
      ];
    };
    return {
      global,
      valid: of(files[0]),
      wrong: of(files[1]),
      extra: alsoCheck.flatMap((file) => of(file)),
    };
  };
  const say = (d) =>
    typeof d === "string"
      ? d
      : `${d.file ? relative(work, d.file.fileName) : ""} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  const verdict = (result) => [
    ...result.global.map((d) => `options: ${say(d)}`),
    ...result.valid.map((d) => `the valid fixture fails: ${say(d)}`),
    ...WRONG_LINES.filter(
      (line) =>
        !result.wrong.some(
          (d) =>
            d.code === 2322 &&
            d.file !== undefined &&
            d.file.getLineAndCharacterOfPosition(d.start ?? 0).line === line,
        ),
    ).map(
      (line) =>
        `wrong.tsx line ${line + 1} is not refused with TS2322 (got: ${result.wrong.map(say).join("; ") || "nothing"})`,
    ),
    ...result.extra.map((d) => say(d)),
  ];

  const declarations = ["dist/index.d.ts", "dist/highlighter.d.ts"].map((file) =>
    join(installed, file),
  );
  const npmResult = compile(
    project,
    {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      jsx: ts.JsxEmit.ReactJSX,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
      types: [],
      // The package's own declarations are checked one by one below; the dependencies' are theirs.
      skipLibCheck: false,
    },
    declarations,
  );
  // The packages the build bundles are devDependencies, and core is no dependency at all: a
  // declaration that named one would send a consumer's compiler to a package the tarball does
  // not depend on.
  const foreign = ["@prismshadow/a2ui", "@prismshadow/chat-markdown", "@prismshadow/penguin-core"];
  check(4, "a project's tsc accepts a valid prop and refuses a wrong one", [
    ...verdict(npmResult),
    ...declarations.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return foreign
        .filter((name) => text.includes(name))
        .map((name) => `${relative(installed, file)} names ${name}`);
    }),
  ]);

  // --- rendered classes --------------------------------------------------------------------
  const css = readFileSync(join(installed, "dist/styles.css"), "utf8");
  const ruled = new Set(
    [...css.matchAll(/\.((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w-])+)/g)].map((m) =>
      m[1].replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_, hex, ch) =>
        hex ? String.fromCodePoint(parseInt(hex, 16)) : ch,
      ),
    ),
  );
  /** Classes that only mark an element: `code-block` is how a message's code block is found. */
  const MARKERS = new Set(["code-block"]);
  const fromProject = createRequire(join(project, "package.json"));
  const { createElement: h } = await import(pathToFileURL(fromProject.resolve("react")).href);
  const { renderToStaticMarkup } = await import(
    pathToFileURL(fromProject.resolve("react-dom/server")).href
  );
  const lib = await import(pathToFileURL(join(installed, "dist/index.js")).href);
  // A style hook is anatomy a theme pack may give a recipe or leave alone (a section hook has no
  // rule in any built-in pack), so a hook class is no class without a rule.
  const hooks = new Set(lib.HOOKS);
  const noop = () => {};
  const samples = {
    Button: ["primary", "secondary", "danger", "ghost", "link"].map((variant) =>
      h(lib.Button, { key: variant, variant }, variant),
    ),
    Badge: h(lib.Badge, { tone: "success" }, "Done"),
    Pill: h(lib.Pill, { tone: "info" }, "Beta"),
    Card: h(lib.Card, { padding: "md" }, "Body"),
    Input: h(lib.Input, { label: "Name", hint: "Shown to others", defaultValue: "Ada" }),
    Checkbox: h(lib.Checkbox, { checked: true, onChange: noop, label: "Agree" }),
    Switch: h(lib.Switch, { checked: true, onChange: noop, "aria-label": "On" }),
    Notice: h(lib.Notice, { tone: "attention", title: "Heads up" }, "Text"),
    EmptyState: h(lib.EmptyState, { title: "Nothing here", description: "Add one" }),
    ProgressBar: h(lib.ProgressBar, { value: 40, label: "Progress" }),
    Spinner: h(lib.Spinner, { label: "Loading" }),
    Skeleton: h(lib.SkeletonList, { rows: 2 }),
    Tabs: h(lib.Tabs, {
      items: [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ],
      active: "a",
      onChange: noop,
    }),
    Segmented: h(lib.Segmented, {
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
      value: "a",
      onChange: noop,
    }),
    StatTile: h(lib.StatTile, { label: "Runs", value: 12, tone: "success" }),
    KeyValue: h(lib.KeyValue, null, h(lib.KeyValueRow, { label: "Model" }, "default")),
    Prose: h(lib.Prose, {
      text: "# Title\n\nSome *text* and `code`.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst a = 1;\n```\n",
    }),
  };
  const unruled = [];
  for (const [name, element] of Object.entries(samples)) {
    const html = renderToStaticMarkup(h("div", null, element));
    const classes = [...html.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) =>
      m[1]
        .replace(/&amp;/g, "&")
        .replace(/&gt;/g, ">")
        .replace(/&lt;/g, "<")
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .split(/\s+/)
        .filter(Boolean),
    );
    for (const cls of new Set(classes)) {
      // Tailwind's `group` and `peer` mark an element for a variant on another, and the markers
      // name an element for code that looks for it: none has a rule of its own.
      if (
        /^(?:group|peer)(?:\/[\w-]+)?$/.test(cls) ||
        MARKERS.has(cls) ||
        hooks.has(cls) ||
        ruled.has(cls)
      ) {
        continue;
      }
      unruled.push(`${name}: .${cls} has no rule in styles.css`);
    }
  }
  check(5, "rendered components use only classes styles.css styles", unruled);

  // --- the Workbench runtime ---------------------------------------------------------------
  const runtime = JSON.parse(readFileSync(join(runtimeDir, "manifest.json"), "utf8"));
  const runtimeTypes = join(runtimeDir, runtime.types ?? "", "node_modules");
  const runtimeFiles = filesUnder(runtimeDir);
  const servable = runtimeFiles.filter(
    (file) => file !== "manifest.json" && !file.startsWith(`${runtime.types}/`),
  );
  const specifiers = new Set(Object.keys(runtime.imports ?? {}));
  const runtimeProblems = [
    ...(runtime.version === manifest.version
      ? []
      : [`manifest version ${runtime.version} is not the package's ${manifest.version}`]),
    ...[...Object.values(runtime.imports ?? {}), runtime.stylesheet]
      .filter((file) => typeof file !== "string" || !servable.includes(file))
      .map((file) => `the manifest names ${file}, which is not a servable file`),
    ...[
      "@prismshadow/penguin-ui/package.json",
      "@prismshadow/penguin-ui/index.d.ts",
      "@types/react/package.json",
      "@types/react-dom/package.json",
      "csstype/package.json",
    ]
      .filter((file) => !existsSync(join(runtimeTypes, file)))
      .map((file) => `types/node_modules/${file} is missing`),
    ...servable
      .filter((file) => file.endsWith(".js"))
      .flatMap((file) =>
        importsOf(readFileSync(join(runtimeDir, file), "utf8"))
          .filter(
            (spec) => !spec.startsWith("./") && !spec.startsWith("../") && !specifiers.has(spec),
          )
          .map((spec) => `${file} imports ${spec}, which the import map does not resolve`),
      ),
  ];
  // A copy, as the server's `.harness/ui/` is: through a link, TypeScript would resolve from the
  // tree's real path and climb into this checkout's node_modules for whatever the tree lacks.
  const page = join(work, "page");
  mkdirSync(page);
  cpSync(runtimeTypes, join(page, "node_modules"), { recursive: true });
  writeFileSync(join(page, "package.json"), '{ "type": "module" }\n');
  // The options the server compiles a page's `ui/` with.
  const pageOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
    skipLibCheck: true,
    isolatedModules: true,
    forceConsistentCasingInFileNames: true,
  };
  const pageResult = compile(page, pageOptions);
  // Every module the package's declarations import resolves inside the tree; one that does not
  // would type its props as `any` without a word, as the page compile skips library checks. The
  // package is "type": "module", so they import as ES modules.
  const ownTypes = join(page, "node_modules/@prismshadow/penguin-ui/index.d.ts");
  const resolves = (spec) =>
    ts.resolveModuleName(
      spec,
      ownTypes,
      pageOptions,
      ts.sys,
      undefined,
      undefined,
      ts.ModuleKind.ESNext,
    ).resolvedModule !== undefined;
  const unresolved = [...new Set(importsOf(readFileSync(ownTypes, "utf8")))]
    .filter((spec) => !spec.startsWith("."))
    .filter((spec) => !resolves(spec))
    .map((spec) => `index.d.ts imports ${spec}, which types/node_modules does not carry`);
  check(6, "the runtime's manifest, imports and types", [
    ...runtimeProblems,
    ...unresolved,
    ...verdict(pageResult),
  ]);

  // --- the theme layers --------------------------------------------------------------------
  // A layer's place is where the sheet first names it, so the built sheet must name the four
  // theme layers first in cascade order: the base under the packs, the presets over them, the
  // font pairing last. (packages/ui/test/cascade-layers.test.ts holds the sources to it.)
  const layerOrder = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/@layer\s+([^{;]+)[{;]/g)) {
    for (const layer of m[1].split(",").map((s) => s.trim())) {
      if (layer.startsWith("ui-") && !layerOrder.includes(layer)) layerOrder.push(layer);
    }
  }
  const wantLayers = ["ui-base", "ui-theme", "ui-accent", "ui-font"];
  check(
    7,
    "styles.css names the theme layers in cascade order",
    layerOrder.join(",") === wantLayers.join(",")
      ? []
      : [`styles.css names ${layerOrder.join(", ")}; want ${wantLayers.join(", ")}`],
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`check-ui-package: ${failures.length} problem(s)`);
  process.exit(1);
}
console.log("check-ui-package: the tarball and the runtime are what they should be");
