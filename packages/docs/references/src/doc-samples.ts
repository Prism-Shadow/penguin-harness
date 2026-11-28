import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformerNotationHighlight, transformerRemoveLineBreak } from "@shikijs/transformers";
import { rendererRich, transformerTwoslash } from "@shikijs/twoslash";
import type { Element, ElementContent, Root, RootContent } from "hast";
import { createHighlighter } from "shiki";
import ts from "typescript";
import { extractAll } from "./extract.js";
import { slugOf } from "./jsdoc.js";
import type { VerifiedSample, VerifiedSamplesFile } from "./types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "..");
const REPO = process.env.PENGUIN_REFS_REPO || path.resolve(PKG_ROOT, "../../..");
const SAMPLES_DIR = path.join(PKG_ROOT, "doc-samples");
const OUT_FILE = path.join(SAMPLES_DIR, "verified-samples.json");
const ALLOW_FAIL = process.argv.includes("--report-failures");

const MODULE_META_PROPS = new Set(["contributes", "context", "children", "exports"]);

interface RegionInfo {
  code: string;
  twoslashSource: string;
  line: number;
  file: string;
}

function dedent(str: string): string {
  const lines = str.split(/\r\n|\r|\n/);
  while (lines.length > 0 && !lines[0]?.trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1]?.trim()) lines.pop();
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const indent = nonEmpty.length
    ? Math.min(...nonEmpty.map((l) => l.match(/^\s*/)?.[0].length ?? 0))
    : 0;
  return lines.map((l) => l.slice(indent)).join("\n");
}

function extractRegions(filePath: string): {
  docs: Map<string, string>;
  regions: Map<string, RegionInfo>;
} {
  const text = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const docs = new Map<string, string>();
  const regions = new Map<string, RegionInfo>();

  const docRe = /\/\*\*([\s\S]*?)\*\//g;
  let dm: RegExpExecArray | null;
  while ((dm = docRe.exec(text)) !== null) {
    const raw = (dm[1] ?? "")
      .split(/\r\n|\r|\n/)
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter(Boolean);
    const targetIdx = raw.findIndex((l) => l.startsWith("@docTarget "));
    if (targetIdx !== -1) {
      const key = (raw[targetIdx] ?? "").replace(/^@docTarget\s+/, "").trim();
      const desc = raw
        .slice(targetIdx + 1)
        .join(" ")
        .trim();
      if (key && desc) docs.set(key, desc);
    }
  }

  // Line-by-line region parser: rejects duplicate openers, unclosed regions (including at EOF),
  // nested openers, and extra/mismatched/premature #enddocregion markers.
  const openRe = /^[ \t]*\/\/[ \t]*#docregion[ \t]+([^\s]+)[ \t]*$/;
  const closeRe = /^[ \t]*\/\/[ \t]*#enddocregion[ \t]+([^\s]+)[ \t]*$/;
  const lineRe = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  const seenKeys = new Set<string>();
  let openRegion: {
    key: string;
    markerStart: number;
    bodyStart: number;
    startLine: number;
  } | null = null;
  let lineNo = 0;
  let lm: RegExpExecArray | null;
  while ((lm = lineRe.exec(text)) !== null) {
    const rawLine = lm[0];
    if (rawLine.length === 0) break;
    lineNo++;
    const lineText = rawLine.replace(/(?:\r\n|\r|\n)$/, "");
    const openMatch = openRe.exec(lineText);
    if (openMatch?.[1]) {
      const key = openMatch[1];
      if (openRegion) {
        throw new Error(
          `Nested #docregion ${key} inside unclosed #docregion ${openRegion.key} in ${filePath}:${lineNo}`,
        );
      }
      if (seenKeys.has(key)) {
        throw new Error(`Duplicate #docregion ${key} in ${filePath}:${lineNo}`);
      }
      seenKeys.add(key);
      openRegion = {
        key,
        markerStart: lm.index,
        bodyStart: lm.index + rawLine.length,
        startLine: lineNo + 1,
      };
      continue;
    }

    const closeMatch = closeRe.exec(lineText);
    if (closeMatch?.[1]) {
      const endKey = closeMatch[1];
      if (!openRegion) {
        throw new Error(
          `Unexpected #enddocregion ${endKey} without matching opener in ${filePath}:${lineNo}`,
        );
      }
      if (openRegion.key !== endKey) {
        throw new Error(
          `Mismatched #enddocregion ${endKey} (expected ${openRegion.key}) in ${filePath}:${lineNo}`,
        );
      }
      const bodyEnd = lm.index;
      const displayCode = dedent(text.slice(openRegion.bodyStart, bodyEnd));
      const markerStart = openRegion.markerStart;
      let prelude = "";
      const findBlock = (node: ts.Node): void => {
        if (ts.isBlock(node) && node.pos <= markerStart && node.end >= bodyEnd) {
          prelude = node.statements
            .filter((st) => st.end <= markerStart)
            .map((st) => dedent(st.getText(sf)))
            .join("\n");
        }
        ts.forEachChild(node, findBlock);
      };
      findBlock(sf);

      const twoslashSource = [
        'import { Bind, Component, Interface, Module, Provide, Use, type ClassCtx, type Contributed, type Json, type Opaque, type Slot } from "@prismshadow/penguin-core/kernel";',
        prelude,
        "// ---cut---",
        displayCode,
      ]
        .filter(Boolean)
        .join("\n");

      regions.set(openRegion.key, {
        code: displayCode,
        twoslashSource,
        line: openRegion.startLine,
        file: path.relative(PKG_ROOT, filePath).replace(/\\/g, "/"),
      });
      openRegion = null;
    }
  }
  if (openRegion) {
    throw new Error(
      `Unclosed #docregion ${openRegion.key} (missing #enddocregion ${openRegion.key}) in ${filePath}`,
    );
  }
  return { docs, regions };
}

function hasCls(node: RootContent | undefined, name: string): boolean {
  if (!node || node.type !== "element") return false;
  const raw = node.properties?.class ?? node.properties?.className;
  if (Array.isArray(raw)) return raw.includes(name);
  if (typeof raw === "string") return raw.split(/\s+/).includes(name);
  return false;
}

function textOf(node: RootContent | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

function renderInlineMdToHast(
  md: string,
  kernelSlugByName: ReadonlyMap<string, string>,
): ElementContent[] {
  const out: ElementContent[] = [];
  const clean = md.replace(/\s+/g, " ").trim();
  const re = /\{@link\s+([^}\s]+)(?:\s+([^}]*))?\}|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    if (m.index > last) out.push({ type: "text", value: clean.slice(last, m.index) });
    if (m[1]) {
      const sym = m[1].replace(/\(\)$/, "");
      const label = (m[2]?.trim() || m[1]).trim();
      const slug = kernelSlugByName.get(sym);
      const codeEl: Element = {
        type: "element",
        tagName: "code",
        properties: {},
        children: [{ type: "text", value: label }],
      };
      out.push(
        slug
          ? {
              type: "element",
              tagName: "a",
              properties: { class: "twoslash-ref-link", href: `__KERNEL_ROOT__${slug}/` },
              children: [codeEl],
            }
          : codeEl,
      );
    } else if (m[3]) {
      out.push({
        type: "element",
        tagName: "code",
        properties: {},
        children: [{ type: "text", value: m[3] }],
      });
    }
    last = re.lastIndex;
  }
  if (last < clean.length) out.push({ type: "text", value: clean.slice(last) });
  return out;
}

function transformerKernelLinks(kernelSlugByName: ReadonlyMap<string, string>) {
  function walk(node: Root | RootContent): void {
    if (node.type === "element" && node.tagName === "span" && hasCls(node, "twoslash-hover")) {
      const popupNode = node.children.find((c) => hasCls(c, "twoslash-popup-container"));
      const popupText = textOf(popupNode).trim();
      for (let i = 0; i < node.children.length; i++) {
        const ch = node.children[i];
        if (!ch || ch === popupNode) continue;
        const word = textOf(ch).trim();
        let targetHref: string | null = null;
        if (MODULE_META_PROPS.has(word) && popupText.includes("ModuleMeta.")) {
          targetHref = `__KERNEL_ROOT__ModuleMeta/#${slugOf(word)}`;
        } else if (
          kernelSlugByName.has(word) &&
          (/^[A-Z]/.test(word) || popupText.startsWith(`function ${word}`))
        ) {
          targetHref = `__KERNEL_ROOT__${kernelSlugByName.get(word)}/`;
        }
        if (targetHref) {
          node.children[i] = {
            type: "element",
            tagName: "a",
            properties: { class: "twoslash-ref-link", href: targetHref, "data-k-sym": word },
            children: [ch],
          };
        }
      }
      return;
    }
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }
  return {
    name: "penguin-kernel-links",
    root(hast: Root): void {
      walk(hast);
    },
  };
}

export function computeSamplesSourceHash(repoDir: string = REPO): string {
  const hash = createHash("sha256");
  const testFiles = fs
    .readdirSync(SAMPLES_DIR)
    .filter((f) => f.endsWith(".test.ts"))
    .sort();
  for (const fn of testFiles) {
    hash.update(`sample:${fn}\n`).update(fs.readFileSync(path.join(SAMPLES_DIR, fn), "utf8"));
  }
  const kernelDir = path.resolve(repoDir, "packages/core/src/kernel");
  if (fs.existsSync(kernelDir)) {
    for (const fn of fs
      .readdirSync(kernelDir)
      .filter((f) => f.endsWith(".ts"))
      .sort()) {
      hash.update(`kernel:${fn}\n`).update(fs.readFileSync(path.join(kernelDir, fn), "utf8"));
    }
  }
  return hash.digest("hex").slice(0, 16);
}

function resolveRuntimeDeps(repoDir: string): { tsxBin: string; loaderHookUrl: string } {
  const candidates = [
    process.env.PENGUIN_TSX_BIN,
    path.join(PKG_ROOT, "node_modules/.bin/tsx"),
    path.join(repoDir, "node_modules/.bin/tsx"),
    process.env.PENGUIN_NODE_MODULES
      ? path.join(process.env.PENGUIN_NODE_MODULES, ".bin/tsx")
      : undefined,
  ].filter((x): x is string => Boolean(x));
  const tsxBin = candidates.find((p) => fs.existsSync(p)) ?? "tsx";

  const kernelEntry = path.resolve(repoDir, "packages/core/src/kernel/index.ts");
  if (!fs.existsSync(kernelEntry)) {
    throw new Error(`Kernel entry not found for doc-sample execution: ${kernelEntry}`);
  }
  const kernelEntryUrl = pathToFileURL(kernelEntry).href;

  let arktypeUrl: string | null = null;
  const arkCandidates = [
    path.join(repoDir, "packages/core/package.json"),
    process.env.PENGUIN_CORE_PKG_JSON,
  ].filter((x): x is string => typeof x === "string" && x.length > 0 && fs.existsSync(x));

  for (const pkgJson of arkCandidates) {
    try {
      arktypeUrl = pathToFileURL(createRequire(pkgJson).resolve("arktype")).href;
      break;
    } catch {
      // Try next candidate
    }
  }

  const hookSrc = `import { registerHooks } from "node:module";
const kernelUrl = ${JSON.stringify(kernelEntryUrl)};
const arktypeUrl = ${JSON.stringify(arktypeUrl)};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@prismshadow/penguin-core/kernel") {
      return { url: kernelUrl, shortCircuit: true };
    }
    if (arktypeUrl && specifier === "arktype") {
      return { url: arktypeUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});`;

  return {
    tsxBin,
    loaderHookUrl: `data:text/javascript;base64,${Buffer.from(hookSrc).toString("base64")}`,
  };
}

export async function runDocSamples(): Promise<void> {
  const repoData = extractAll(REPO);
  const kernelSlugByName = new Map(repoData.kernel.exports.map((k) => [k.name, k.slug]));
  const kernelDir = path.resolve(REPO, "packages/core/src/kernel");

  const testFiles = fs
    .readdirSync(SAMPLES_DIR)
    .filter((f) => f.endsWith(".test.ts"))
    .sort()
    .map((f) => path.join(SAMPLES_DIR, f));

  if (testFiles.length === 0) {
    throw new Error(`No .test.ts files found in ${SAMPLES_DIR}`);
  }

  const kernelExtraFiles: Record<string, string> = {
    "node_modules/arktype/index.d.ts":
      "export declare function type(def: unknown): any;\nexport type Type<T = unknown> = { (v: unknown): T | { summary: string } };\n",
    "node_modules/@prismshadow/penguin-core/package.json": JSON.stringify({
      name: "@prismshadow/penguin-core",
      exports: { "./kernel": "./kernel/index.ts" },
    }),
  };
  for (const fn of fs.readdirSync(kernelDir).filter((f) => f.endsWith(".ts"))) {
    kernelExtraFiles[`node_modules/@prismshadow/penguin-core/kernel/${fn}`] = fs.readFileSync(
      path.join(kernelDir, fn),
      "utf8",
    );
  }

  const highlighter = await createHighlighter({
    themes: ["github-light", "github-dark-default"],
    langs: ["ts"],
  });

  const twoslashTransformer = transformerTwoslash({
    explicitTrigger: false,
    renderer: rendererRich({
      errorRendering: "hover",
      renderMarkdown(md) {
        const firstPara = md.split(/\r?\n\s*\r?\n/)[0] ?? "";
        return [
          {
            type: "element",
            tagName: "p",
            properties: {},
            children: renderInlineMdToHast(firstPara, kernelSlugByName),
          },
        ];
      },
    }),
    twoslashOptions: {
      extraFiles: kernelExtraFiles,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
        paths: {
          "@prismshadow/penguin-core/kernel": [
            "./node_modules/@prismshadow/penguin-core/kernel/index.ts",
          ],
        },
      },
    },
  });

  const { tsxBin, loaderHookUrl } = resolveRuntimeDeps(REPO);
  const verified: Record<string, VerifiedSample> = {};
  const globalRegionKeys = new Set<string>();
  const globalResultKeys = new Set<string>();
  let anyFailed = false;

  try {
    for (const tf of testFiles) {
      const { docs, regions } = extractRegions(tf);
      for (const key of regions.keys()) {
        if (globalRegionKeys.has(key)) {
          throw new Error(`Duplicate #docregion ${key} across sample files (found again in ${tf})`);
        }
        globalRegionKeys.add(key);
      }
      const htmlByKey = new Map<string, string>();
      const tsErrByKey = new Map<string, string>();

      for (const [key, reg] of regions) {
        try {
          const html = highlighter.codeToHtml(reg.twoslashSource, {
            lang: "ts",
            themes: { light: "github-light", dark: "github-dark-default" },
            defaultColor: false,
            transformers: [
              twoslashTransformer,
              transformerNotationHighlight(),
              transformerRemoveLineBreak(),
              transformerKernelLinks(kernelSlugByName),
            ],
          });
          htmlByKey.set(key, html);
        } catch (err) {
          anyFailed = true;
          const msg = err instanceof Error ? err.message : String(err);
          tsErrByKey.set(key, msg);
          console.error(`  TWOSLASH FAIL ${key}: ${msg}`);
        }
      }

      try {
        const args = ["--import", loaderHookUrl, tf];
        const stdout = execFileSync(tsxBin, args, {
          encoding: "utf8",
          cwd: PKG_ROOT,
          env: { ...process.env, PENGUIN_REFS_REPO: REPO },
        });
        const lastLine = stdout.trim().split(/\r?\n/).pop() ?? "";
        const parsed = JSON.parse(lastLine) as {
          ok: boolean;
          results: Array<{ key: string; title: string; assertions: number }>;
        };
        if (!parsed.ok) throw new Error(`Doc-sample test returned ok=false: ${tf}`);
        const seenKeys = new Set<string>();
        for (const r of parsed.results) {
          if (seenKeys.has(r.key) || globalResultKeys.has(r.key)) {
            throw new Error(`Duplicate doc-sample result key ${r.key} in ${tf}`);
          }
          seenKeys.add(r.key);
          globalResultKeys.add(r.key);
          const reg = regions.get(r.key);
          if (!reg) throw new Error(`Missing #docregion ${r.key} in ${tf}`);
          const tsErr = tsErrByKey.get(r.key) ?? null;
          verified[r.key] = {
            key: r.key,
            doc: docs.get(r.key) ?? "",
            code: reg.code,
            html: htmlByKey.get(r.key) ?? "",
            testFile: reg.file,
            line: reg.line,
            title: r.title,
            assertions: r.assertions,
            verified: !tsErr,
            error: tsErr,
          };
          if (!tsErr) console.log(`  PASS ${r.key} (${r.assertions} assertions) — ${r.title}`);
        }
        const missingResults = [...regions.keys()].filter((k) => !seenKeys.has(k));
        if (missingResults.length > 0) {
          throw new Error(
            `Doc regions without runtime verification in ${tf}: ${missingResults.join(", ")}`,
          );
        }
      } catch (err) {
        anyFailed = true;
        const e = err as { stderr?: Buffer | string; message?: string };
        const msg = String(e.stderr || e.message || err)
          .trim()
          .split(/\r?\n/)
          .slice(0, 6)
          .join("\n");
        console.error(`  FAIL ${path.relative(PKG_ROOT, tf)}:\n${msg}`);
        for (const [key, reg] of regions) {
          verified[key] = {
            key,
            doc: docs.get(key) ?? "",
            code: reg.code,
            html: htmlByKey.get(key) ?? "",
            testFile: reg.file,
            line: reg.line,
            verified: false,
            error: tsErrByKey.get(key) ?? msg,
          };
        }
      }
    }
  } finally {
    highlighter.dispose();
  }

  const unverifiedGlobal = [...globalRegionKeys].filter((k) => !globalResultKeys.has(k));
  if (unverifiedGlobal.length > 0) {
    anyFailed = true;
    console.error(`Global #docregion mismatch: unverified keys: ${unverifiedGlobal.join(", ")}`);
  }

  if (anyFailed && !ALLOW_FAIL) {
    console.error("Doc-sample verification failed; not updating verified-samples.json.");
    process.exit(1);
  }

  const out: VerifiedSamplesFile = {
    generatedAt: new Date().toISOString(),
    gitSha: repoData.git.sha,
    sourceHash: computeSamplesSourceHash(REPO),
    allPassed: !anyFailed,
    samples: verified,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`Wrote ${Object.keys(verified).length} Shiki+Twoslash doc-samples -> ${OUT_FILE}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runDocSamples();
}
