// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  addJsExtensionToDeclarations,
  buildHostTypeAssets,
  HOST_TYPES_DIR,
  penguinSharedRuntime,
  SHARED_RUNTIME_ENTRIES,
  sharedEntrySource,
} from "../scripts/plugin-shared-runtime";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");

describe("penguinSharedRuntime", () => {
  it("exposes all required host shared specifiers in dev importmap", () => {
    const plugin = penguinSharedRuntime();
    const hook = plugin.transformIndexHtml as unknown as {
      order: string;
      handler: (
        html: string,
        ctx: { bundle?: unknown },
      ) => {
        tags?: { attrs?: Record<string, string>; children?: string }[];
      };
    };
    const res = hook.handler("<html><head></head><body></body></html>", {});
    const mapTag = res.tags?.find((t) => t.attrs?.type === "importmap");
    expect(mapTag).toBeDefined();
    const parsed = JSON.parse(mapTag!.children!) as { imports: Record<string, string> };
    for (const entry of SHARED_RUNTIME_ENTRIES) {
      expect(parsed.imports[entry.specifier]).toBe(`/@penguin-shared/${entry.chunkKey}.js`);
    }
  });

  it("wraps CJS React entries with both default and named exports and ESM host entries with star re-exports", () => {
    const reactSrc = sharedEntrySource(
      SHARED_RUNTIME_ENTRIES.find((e) => e.specifier === "react")!,
    );
    expect(reactSrc).toContain("export default m;");
    expect(reactSrc).toContain("useState");
    expect(reactSrc).toContain("useEffect");
    expect(reactSrc).toContain("createElement");

    const jsxSrc = sharedEntrySource(
      SHARED_RUNTIME_ENTRIES.find((e) => e.specifier === "react/jsx-runtime")!,
    );
    expect(jsxSrc).toContain("jsx");
    expect(jsxSrc).toContain("jsxs");
    expect(jsxSrc).toContain("Fragment");

    const uiSrc = sharedEntrySource(
      SHARED_RUNTIME_ENTRIES.find((e) => e.specifier === "@prismshadow/penguin-ui")!,
    );
    expect(uiSrc.trim()).toBe('export * from "@prismshadow/penguin-ui";');
  });

  it("emits standard types/node_modules declarations without any custom manifest.json", () => {
    const assets = buildHostTypeAssets();
    const names = new Set(assets.map((a) => a.fileName));
    expect(names.has(`${HOST_TYPES_DIR}/manifest.json`)).toBe(false);
    expect(names.has(`${HOST_TYPES_DIR}/node_modules/@prismshadow/penguin-core/package.json`)).toBe(
      true,
    );
    expect(
      names.has(`${HOST_TYPES_DIR}/node_modules/@prismshadow/penguin-core/dist/kernel/index.d.ts`),
    ).toBe(true);
    expect(
      names.has(`${HOST_TYPES_DIR}/node_modules/@prismshadow/penguin-web-plugin/package.json`),
    ).toBe(true);
    expect(
      names.has(`${HOST_TYPES_DIR}/node_modules/@prismshadow/penguin-web-plugin/dist/index.d.ts`),
    ).toBe(true);

    const webPluginIdx = assets.find(
      (a) =>
        a.fileName ===
        `${HOST_TYPES_DIR}/node_modules/@prismshadow/penguin-web-plugin/dist/index.d.ts`,
    );
    expect(String(webPluginIdx?.source)).toContain('./bridge.js"');
  });

  it("when dist/ exists, index.html carries a W3C importmap whose chunks preserve host exports", () => {
    const distDir = path.join(webDir, "dist");
    const htmlPath = path.join(distDir, "index.html");
    if (!fs.existsSync(htmlPath)) return;
    const html = fs.readFileSync(htmlPath, "utf8");
    const mapEl = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector('script[type="importmap"]');
    expect(mapEl).not.toBeNull();
    const parsed = JSON.parse(mapEl!.textContent ?? "") as { imports: Record<string, string> };
    for (const entry of SHARED_RUNTIME_ENTRIES) {
      const target = parsed.imports[entry.specifier];
      expect(target, entry.specifier).toMatch(/^\/assets\/shared-/);
      const diskPath = path.join(distDir, target!.replace(/^\//, ""));
      expect(fs.existsSync(diskPath), diskPath).toBe(true);
    }
    const uiChunk = fs.readFileSync(
      path.join(distDir, parsed.imports["@prismshadow/penguin-ui"]!.replace(/^\//, "")),
      "utf8",
    );
    expect(uiChunk).toContain("Button");
    expect(uiChunk).toContain("Dialog");
    const kernelChunk = fs.readFileSync(
      path.join(distDir, parsed.imports["@prismshadow/penguin-core/kernel"]!.replace(/^\//, "")),
      "utf8",
    );
    expect(kernelChunk).toContain("Module");
    expect(kernelChunk).toContain("Bind");
    expect(kernelChunk).toContain("Provide");
  });

  it("rewrites .d.ts relative specifiers via TypeScript AST without touching comments or non-relative imports", () => {
    const files: Record<string, string> = {
      "/virtual/dep.ts": `export interface Dep { id: string; }`,
      "/virtual/index.ts": [
        `// Comment mentioning export * from "./not-a-real-import" must stay untouched`,
        `import type { Dep } from "./dep";`,
        `export { type Dep } from "./dep";`,
        `export type Ref = import("./dep").Dep;`,
        `export const NOTE = 'from "./literal"';`,
      ].join("\n"),
    };
    const options: ts.CompilerOptions = {
      declaration: true,
      emitDeclarationOnly: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
    };
    const host = ts.createCompilerHost(options);
    const origGetSourceFile = host.getSourceFile.bind(host);
    const origFileExists = host.fileExists.bind(host);
    const origReadFile = host.readFile.bind(host);
    host.fileExists = (f) => f in files || origFileExists(f);
    host.readFile = (f) => files[f] ?? origReadFile(f);
    host.getSourceFile = (f, lang) =>
      f in files ? ts.createSourceFile(f, files[f]!, lang) : origGetSourceFile(f, lang);

    const program = ts.createProgram(["/virtual/index.ts"], options, host);
    const emitted = new Map<string, string>();
    program.emit(
      undefined,
      (fileName, text) => {
        if (fileName.endsWith(".d.ts")) emitted.set(fileName, text);
      },
      undefined,
      true,
      { afterDeclarations: [addJsExtensionToDeclarations()] },
    );
    const dts = emitted.get("/virtual/index.d.ts") ?? "";
    expect(dts).toContain('from "./dep.js"');
    expect(dts).toContain('import("./dep.js").Dep');
    expect(dts).not.toContain('from "./not-a-real-import.js"');
    expect(dts).not.toContain('from "./literal.js"');
  });
});
