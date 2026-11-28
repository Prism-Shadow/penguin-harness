import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginHost } from "../src/plugin/host.js";
import {
  buildPluginWebState,
  compilePluginWeb,
  ensureHostWebPluginTypes,
  parseDocumentImportMap,
  parsePluginStaticPath,
  PluginWebCompileError,
  resolveCompiledPluginAsset,
  resolvePluginBrowserEntry,
  resolveStaticModuleFile,
  trimBrowserIfaces,
} from "../src/plugin/web-compile.js";

const WEB_DIST = path.resolve(import.meta.dirname, "../../web/dist");
const tmpDirs: string[] = [];

function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writePluginFixture(
  root: string,
  specifier: string,
  files: Record<string, string>,
  pkgOverrides: Record<string, unknown> = {},
): { pkgDir: string; entryFile: string } {
  const pkgDir = path.join(root, specifier.replace("/", "__"));
  fs.mkdirSync(pkgDir, { recursive: true });
  const pkg = {
    name: specifier,
    version: "0.0.1",
    type: "module",
    main: "./dist/index.js",
    browser: "./src/web/index.ts",
    exports: {
      ".": { import: "./dist/index.js" },
    },
    ...pkgOverrides,
  };
  fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(pkg, null, 2));
  fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
  const entryFile = path.join(pkgDir, "dist", "index.js");
  fs.writeFileSync(entryFile, "export default { modules: [] };\n");
  fs.writeFileSync(
    path.join(pkgDir, "ifaces.json"),
    JSON.stringify({
      hash: "test",
      ifaces: {},
      types: {},
      modules: {},
      browser: { entry: "./src/web/index.ts", modules: [], replaces: [] },
    }),
  );
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(pkgDir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return { pkgDir, entryFile };
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe("plugin/web-compile (browser entry, non-recursive graph)", () => {
  it("compiles a browser entry + shared pure TS module + JSON + decorators without touching server files", async () => {
    const tmp = mkTmp("pweb-ok-");
    const cacheRoot = path.join(tmp, "cache");
    const types = ensureHostWebPluginTypes({ kind: "dir", dir: WEB_DIST }, cacheRoot);
    expect(types).not.toBeNull();

    const { entryFile } = writePluginFixture(tmp, "@example/valid-pet", {
      // Unused server file with Node builtin — must NEVER be touched because we do not scan recursively!
      "src/server/index.ts": `import fs from "node:fs"; export const S = fs.existsSync;`,
      // Shared pure TS module imported by the browser entry
      "src/shared/path-helper.ts": `export function joinPath(a: string, b: string): string { return a + "/" + b; }`,
      "src/web/params.json": JSON.stringify({ scale: 1.5 }),
      "src/web/view.tsx": `
import { useState } from "react";
import { Button } from "@prismshadow/penguin-ui";
import { joinPath } from "../shared/path-helper.js";
import params from "./params.json" with { type: "json" };

export function PetView() {
  const [n, setN] = useState<number>(params.scale);
  return <Button onClick={() => setN(n + 1)}>{joinPath("pet", String(n))}</Button>;
}
`,
      "src/web/index.ts": `
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { PetView } from "./view.js";

@Module({
  contributes: {
    "WebAppModule.layers": [{ id: "valid-pet.layer", order: 30 }],
  },
})
export class ValidPetWebModule {
  @Bind("valid-pet.layer") layer = PetView;
}

export default { modules: [ValidPetWebModule] } as const;
`,
    });

    const host = new PluginHost();
    host.use({ specifier: "@example/valid-pet", file: entryFile, modules: [], replaces: [] });

    const state = await buildPluginWebState(host, { kind: "dir", dir: WEB_DIST }, cacheRoot);
    expect(state.manifest.unsatisfied).toEqual([]);
    expect(state.manifest.modules).toHaveLength(1);
    const entry = state.manifest.modules[0]!;
    expect(entry.specifier).toBe("@example/valid-pet");
    expect(entry.entry).toMatch(
      /^\/assets\/modules\/@example\/valid-pet\/[0-9a-f]{16}\/web\/index\.js$/,
    );
    expect(entry.ifacesUrl).toBe(`/assets/modules/@example/valid-pet/${entry.hash}/ifaces.json`);
    expect(entry.browser).toEqual({ entry: "./src/web/index.ts", modules: [], replaces: [] });

    const outDir = state.compiledDirs.get(`${entry.specifier}\0${entry.hash}`)!;
    const emittedIndex = fs.readFileSync(path.join(outDir, "web", "index.js"), "utf8");
    const emittedView = fs.readFileSync(path.join(outDir, "web", "view.js"), "utf8");
    expect(emittedIndex).toContain('from "@prismshadow/penguin-core/kernel"');
    expect(emittedIndex).not.toContain("__PENGUIN_WEB_HOST__");
    expect(emittedView).toContain('from "react/jsx-runtime"');
    expect(emittedView).toContain('from "@prismshadow/penguin-ui"');
    expect(emittedView).toContain("../shared/path-helper.js");
    expect(fs.existsSync(path.join(outDir, "shared", "path-helper.js"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "web", "params.json"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "server", "index.js"))).toBe(false);

    // Warm cache hit via latest.json (same hash, zero recompilation)
    const state2 = await buildPluginWebState(host, { kind: "dir", dir: WEB_DIST }, cacheRoot);
    expect(state2.manifest.modules[0]?.hash).toBe(entry.hash);
  });

  it("strictly rejects plugins with TypeScript errors, Node builtins, disallowed bare imports, CSS imports, escaped paths, or prebuilt JS browser entry", async () => {
    const tmp = mkTmp("pweb-reject-");
    const cacheRoot = path.join(tmp, "cache");
    const types = ensureHostWebPluginTypes({ kind: "dir", dir: WEB_DIST }, cacheRoot)!;
    expect(types).not.toBeNull();

    // 1. Type error against host @prismshadow/penguin-ui
    const badTypes = writePluginFixture(
      tmp,
      "@example/bad-types",
      {
        "src/web/index.tsx": `
import { NonExistentHostWidget } from "@prismshadow/penguin-ui";
export const X = () => <NonExistentHostWidget />;
`,
      },
      { browser: "./src/web/index.tsx" },
    );
    await expect(
      compilePluginWeb({
        pkgDir: badTypes.pkgDir,
        specifier: "@example/bad-types",
        entryRel: "src/web/index.tsx",
        typesDir: types.typesDir,
        typesHash: types.hash,
        allowedImports: types.imports,
        cacheRoot,
      }),
    ).rejects.toThrow(PluginWebCompileError);

    // 2. Node builtin imported from browser entry is refused cleanly
    const badNode = writePluginFixture(tmp, "@example/bad-node", {
      "src/web/index.ts": `import fs from "node:fs"; export const x = fs;`,
    });
    await expect(
      compilePluginWeb({
        pkgDir: badNode.pkgDir,
        specifier: "@example/bad-node",
        entryRel: "src/web/index.ts",
        typesDir: types.typesDir,
        typesHash: types.hash,
        allowedImports: types.imports,
        cacheRoot,
      }),
    ).rejects.toThrow(/imports 'node:fs'/);

    // 3. Disallowed bare import
    const badImport = writePluginFixture(tmp, "@example/bad-import", {
      "src/web/index.ts": `import _ from "lodash"; export const x = _;`,
    });
    await expect(
      compilePluginWeb({
        pkgDir: badImport.pkgDir,
        specifier: "@example/bad-import",
        entryRel: "src/web/index.ts",
        typesDir: types.typesDir,
        typesHash: types.hash,
        allowedImports: types.imports,
        cacheRoot,
      }),
    ).rejects.toThrow(/imports 'lodash'/);

    // 4. CSS import refused cleanly with issue reference
    const badCss = writePluginFixture(tmp, "@example/bad-css", {
      "src/web/index.ts": `import "./style.css"; export const x = 1;`,
    });
    await expect(
      compilePluginWeb({
        pkgDir: badCss.pkgDir,
        specifier: "@example/bad-css",
        entryRel: "src/web/index.ts",
        typesDir: types.typesDir,
        typesHash: types.hash,
        allowedImports: types.imports,
        cacheRoot,
      }),
    ).rejects.toThrow(/#1935/);

    // 5. Relative import escaping src/
    const badEscape = writePluginFixture(tmp, "@example/bad-escape", {
      "secret.ts": `export const SECRET = "nope";`,
      "src/web/index.ts": `import { SECRET } from "../../secret.js"; export const x = SECRET;`,
    });
    await expect(
      compilePluginWeb({
        pkgDir: badEscape.pkgDir,
        specifier: "@example/bad-escape",
        entryRel: "src/web/index.ts",
        typesDir: types.typesDir,
        typesHash: types.hash,
        allowedImports: types.imports,
        cacheRoot,
      }),
    ).rejects.toThrow(/must stay inside src\//);

    // 6. Prebuilt JS browser entry is refused (must be .ts/.tsx)
    const badJs = writePluginFixture(
      tmp,
      "@example/bad-js",
      { "dist/web/index.js": "export default {};" },
      { browser: "./dist/web/index.js" },
    );
    expect(() => resolvePluginBrowserEntry(badJs.pkgDir)).toThrow(
      /must ship TypeScript\/TSX source/,
    );

    // 7. When wired into PluginHost, unsatisfied plugins are omitted from manifest.plugins and listed in manifest.unsatisfied
    const host = new PluginHost();
    host.use({
      specifier: "@example/bad-types",
      file: badTypes.entryFile,
      modules: [],
      replaces: [],
    });
    host.use({
      specifier: "@example/bad-import",
      file: badImport.entryFile,
      modules: [],
      replaces: [],
    });
    const state = await buildPluginWebState(host, { kind: "dir", dir: WEB_DIST }, cacheRoot);
    expect(state.manifest.modules).toEqual([]);
    expect(state.manifest.unsatisfied.map((u) => u.specifier)).toEqual([
      "@example/bad-types",
      "@example/bad-import",
    ]);
    expect(state.manifest.unsatisfied[0]!.error).toContain("src/web/index.tsx:");
    expect(state.manifest.unsatisfied[1]!.error).toContain("lodash");
  });

  it("validates static plugin paths and prevents path traversal", () => {
    expect(
      parsePluginStaticPath("/assets/modules/@penguinharness/pet/0123456789abcdef/web/index.js"),
    ).toEqual({
      specifier: "@penguinharness/pet",
      hash: "0123456789abcdef",
      relPath: "web/index.js",
    });
    expect(
      parsePluginStaticPath("/assets/modules/my-pet/0123456789abcdef/sub/params.json"),
    ).toEqual({
      specifier: "my-pet",
      hash: "0123456789abcdef",
      relPath: "sub/params.json",
    });
    expect(
      parsePluginStaticPath("/assets/modules/@penguinharness/pet/0123456789abcdef/../secret.js"),
    ).toBeNull();
    expect(
      parsePluginStaticPath("/assets/modules/@penguinharness/pet/notahash/index.js"),
    ).toBeNull();
    expect(
      parsePluginStaticPath("/assets/modules/@penguinharness/pet/0123456789abcdef/index.ts"),
    ).toBeNull();

    const tmp = mkTmp("pweb-contain-");
    fs.writeFileSync(path.join(tmp, "index.js"), "export {};");
    expect(resolveCompiledPluginAsset(tmp, "index.js")).not.toBeNull();
    expect(resolveCompiledPluginAsset(tmp, "../package.json")).toBeNull();
  });

  it("supports hot-pushed in-memory WebSource ({ kind: 'mem' }) identically to on-disk dist", async () => {
    const tmp = mkTmp("pweb-mem-");
    const cacheRoot = path.join(tmp, "cache");
    const files = new Map<string, Buffer>();
    files.set("index.html", fs.readFileSync(path.join(WEB_DIST, "index.html")));
    for (const subdir of ["workbench-runtime/types", "types"]) {
      const root = path.join(WEB_DIST, subdir);
      for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const abs = path.join(entry.parentPath, entry.name);
        const rel = path.relative(WEB_DIST, abs).split(path.sep).join("/");
        files.set(rel, fs.readFileSync(abs));
      }
    }
    const { entryFile } = writePluginFixture(tmp, "@example/mem-pet", {
      "src/web/index.ts": `
import { Module } from "@prismshadow/penguin-core/kernel";
@Module()
export class MemPetWebModule {}
export default { modules: [MemPetWebModule] } as const;
`,
    });
    const host = new PluginHost();
    host.use({ specifier: "@example/mem-pet", file: entryFile, modules: [], replaces: [] });
    const state = await buildPluginWebState(host, { kind: "mem", files }, cacheRoot);
    expect(state.manifest.unsatisfied).toEqual([]);
    expect(state.manifest.modules).toHaveLength(1);
    expect(state.manifest.modules[0]!.specifier).toBe("@example/mem-pet");
  });

  it("compiles plugins installed under a node_modules directory (real PluginHost install layout)", async () => {
    const tmp = mkTmp("pweb-nm-");
    const installRoot = path.join(tmp, "plugins", "node_modules");
    const cacheRoot = path.join(tmp, "cache");
    const { entryFile } = writePluginFixture(installRoot, "@example/installed-pet", {
      "src/web/index.ts": `
import { Module } from "@prismshadow/penguin-core/kernel";
@Module()
export class InstalledPetWebModule {}
export default { modules: [InstalledPetWebModule] } as const;
`,
    });
    const host = new PluginHost();
    host.use({ specifier: "@example/installed-pet", file: entryFile, modules: [], replaces: [] });
    const state = await buildPluginWebState(host, { kind: "dir", dir: WEB_DIST }, cacheRoot);
    expect(state.manifest.unsatisfied).toEqual([]);
    expect(state.manifest.modules).toHaveLength(1);
    const entry = state.manifest.modules[0]!;
    const outDir = state.compiledDirs.get(`${entry.specifier}\0${entry.hash}`)!;
    expect(fs.existsSync(path.join(outDir, "web", "index.js"))).toBe(true);
  });

  it("emits every imported module when the plugin is loaded through a symlinked/linked package directory", async () => {
    const tmp = mkTmp("pweb-link-");
    const realRoot = path.join(tmp, "real");
    const linkRoot = path.join(tmp, "installed", "node_modules", "@example");
    const cacheRoot = path.join(tmp, "cache");
    const { pkgDir } = writePluginFixture(realRoot, "@example/linked-pet", {
      "src/web/helper.ts": `export const GREETING = "hi";`,
      "src/web/index.ts": `
import { Module } from "@prismshadow/penguin-core/kernel";
import { GREETING } from "./helper.js";
@Module()
export class LinkedPetWebModule { greeting = GREETING; }
export default { modules: [LinkedPetWebModule] } as const;
`,
    });
    fs.mkdirSync(linkRoot, { recursive: true });
    const linkedPkgDir = path.join(linkRoot, "linked-pet");
    fs.symlinkSync(pkgDir, linkedPkgDir, process.platform === "win32" ? "junction" : "dir");

    const host = new PluginHost();
    host.use({
      specifier: "@example/linked-pet",
      file: path.join(linkedPkgDir, "dist", "index.js"),
      modules: [],
      replaces: [],
    });
    const state = await buildPluginWebState(host, { kind: "dir", dir: WEB_DIST }, cacheRoot);
    expect(state.manifest.unsatisfied).toEqual([]);
    expect(state.manifest.modules).toHaveLength(1);
    const entry = state.manifest.modules[0]!;
    const outDir = state.compiledDirs.get(`${entry.specifier}\0${entry.hash}`)!;
    expect(fs.existsSync(path.join(outDir, "web", "index.js"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "web", "helper.js"))).toBe(true);
  });

  it("strips server-only modules from emitted ifaces.json and resolves single files in O(1)", async () => {
    const trimmed = trimBrowserIfaces(
      {
        ifaces: {
          "@example/pkg#ServerOnly": { name: "ServerOnly", methods: {}, slots: {} },
          "@example/pkg#WebSvc": { name: "WebSvc", methods: {}, slots: {} },
        },
        types: {
          "@example/pkg#ServerType": { a: "string" },
          "@example/pkg#WebType": { b: "number" },
        },
        modules: {
          ServerMod: {
            name: "ServerMod",
            kind: "component",
            requires: {},
            provides: { s: "@example/pkg#ServerOnly" },
            contributes: { "PluginLibraryModule.cards": [{ id: "big.card", desc: "huge" }] },
            children: [],
          },
          WebMod: {
            name: "WebMod",
            kind: "module",
            requires: {},
            provides: { w: "@example/pkg#WebSvc" },
            contributes: {},
            children: [],
          },
        },
      },
      { entry: "./src/web/index.ts", modules: ["WebMod"], replaces: [] },
    );
    expect(Object.keys(trimmed.modules)).toEqual(["WebMod"]);
    expect(Object.keys(trimmed.ifaces)).toEqual(["@example/pkg#WebSvc"]);
    expect(trimmed.ifaces["@example/pkg#ServerOnly"]).toBeUndefined();

    const tmp = mkTmp("pweb-o1-");
    const cacheRoot = path.join(tmp, "cache");
    const { entryFile } = writePluginFixture(tmp, "@example/o1-pet", {
      "src/web/index.ts": `
import { Module } from "@prismshadow/penguin-core/kernel";
@Module()
export class O1PetWebModule {}
export default { modules: [O1PetWebModule] } as const;
`,
    });
    const host = new PluginHost();
    host.use({ specifier: "@example/o1-pet", file: entryFile, modules: [], replaces: [] });
    const state = await buildPluginWebState(host, { kind: "dir", dir: WEB_DIST }, cacheRoot);
    const mod = state.manifest.modules[0]!;
    const resolvedJs = await resolveStaticModuleFile(
      host,
      { kind: "dir", dir: WEB_DIST },
      cacheRoot,
      mod.specifier,
      mod.hash,
      "web/index.js",
    );
    const resolvedIfaces = await resolveStaticModuleFile(
      host,
      { kind: "dir", dir: WEB_DIST },
      cacheRoot,
      mod.specifier,
      mod.hash,
      "ifaces.json",
    );
    expect(resolvedJs).not.toBeNull();
    expect(resolvedIfaces).not.toBeNull();
  });

  it("parses W3C <script type=importmap> via parse5 HTML parser (ignoring comments/templates and handling HTML attribute forms)", () => {
    const htmlWithCommentTrap = [
      "<!doctype html>",
      "<html><head>",
      `<!-- <script type="importmap">{"imports":{"evil":"/evil.js"}}</script> -->`,
      `<template><script type="importmap">{"imports":{"tpl":"/tpl.js"}}</script></template>`,
      `<script data-note="a > b" TYPE=ImportMap>{"imports":{"react":"/assets/shared-react.js","@prismshadow/penguin-ui":"/assets/shared-ui.js"}}</script>`,
      "</head><body></body></html>",
    ].join("\n");
    expect(parseDocumentImportMap(htmlWithCommentTrap)).toEqual({
      "@prismshadow/penguin-ui": "/assets/shared-ui.js",
      react: "/assets/shared-react.js",
    });

    expect(parseDocumentImportMap("<html><head></head><body></body></html>")).toBeNull();
    expect(parseDocumentImportMap(`<script type="importmap">{"imports":{}}</script>`)).toBeNull();
    expect(parseDocumentImportMap(`<script type="importmap">{not valid json}</script>`)).toBeNull();
  });
});
