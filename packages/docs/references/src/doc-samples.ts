import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformerNotationHighlight, transformerRemoveLineBreak } from "@shikijs/transformers";
import { rendererRich, transformerTwoslash } from "@shikijs/twoslash";
import type { Element, ElementContent, Root } from "hast";
import { toHtml } from "hast-util-to-html";
import { createHighlighter } from "shiki";
import { parse as parseTokens } from "space-separated-tokens";
import ts from "typescript";
import { visit } from "unist-util-visit";
import { extractAll } from "./extract.js";
import { extractJsDoc, markdownFirstBlockToHast, slugOf } from "./jsdoc.js";
import type { VerifiedSample, VerifiedSamplesFile } from "./types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "..");
const REPO = process.env.PENGUIN_REFS_REPO || path.resolve(PKG_ROOT, "../../..");
const SAMPLES_DIR = path.join(PKG_ROOT, "doc-samples");
const OUT_FILE = path.join(SAMPLES_DIR, "verified-samples.json");
const ALLOW_FAIL = process.argv.includes("--report-failures");

const MODULE_META_PROPS = new Set(["contributes", "context", "children", "exports"]);
const KERNEL_INTERNAL_ORIGIN = "https://kernel-internal.penguin-refs.invalid";

interface RegionInfo {
  code: string;
  twoslashSource: string;
  line: number;
  file: string;
}

function toPosixRel(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

/**
 * AST-aware TypeScript dedent: strips common leading indentation ONLY on lines whose start
 * does not lie inside a multiline template literal (preserving exact runtime string values).
 */
function dedentTs(str: string): string {
  const sf = ts.createSourceFile(
    "__dedent.ts",
    str,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const templateRanges: Array<[number, number]> = [];
  const collectLiterals = (n: ts.Node): void => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      templateRanges.push([n.getStart(sf), n.end]);
    }
    ts.forEachChild(n, collectLiterals);
  };
  collectLiterals(sf);

  const lineStarts = [...sf.getLineStarts()];
  const rawLines = lineStarts.map((start, i) => {
    const nextStart = lineStarts[i + 1] ?? str.length;
    return str.slice(start, nextStart).replace(/(?:\r\n|\r|\n|\u2028|\u2029)$/, "");
  });
  const lines = rawLines.map((text, i) => ({
    text,
    inTemplate: templateRanges.some(
      ([s, e]) => (lineStarts[i] ?? 0) > s && (lineStarts[i] ?? 0) < e,
    ),
  }));

  while (lines.length > 0 && !lines[0]?.text.trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1]?.text.trim()) lines.pop();

  const eligible = lines.filter((l) => !l.inTemplate && l.text.trim().length > 0);
  const indent = eligible.length
    ? Math.min(...eligible.map((l) => l.text.match(/^[ \t]*/)?.[0].length ?? 0))
    : 0;

  return lines.map((l) => (l.inTemplate ? l.text : l.text.slice(indent))).join("\n");
}

function extractRegions(filePath: string): {
  docs: Map<string, string>;
  regions: Map<string, RegionInfo>;
} {
  const text = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const docs = new Map<string, string>();
  const regions = new Map<string, RegionInfo>();

  // Extract ALL `@docTarget <key> <description>` tags via structured `comment-parser` fields
  for (const st of sf.statements) {
    const parsed = extractJsDoc(st, sf);
    for (const targetTag of parsed.tags) {
      if (targetTag.tag !== "docTarget") continue;
      const key = targetTag.name?.trim() ?? "";
      const desc = targetTag.markdown.trim();
      if (!key || !desc) {
        throw new Error(`Invalid @docTarget tag (missing key or description) in ${filePath}`);
      }
      if (docs.has(key)) {
        throw new Error(`Duplicate @docTarget ${key} in ${filePath}`);
      }
      docs.set(key, desc);
    }
  }

  // Official TypeScript parser-backed comment ranges (`ts.getLeadingCommentRanges` / `ts.getTrailingCommentRanges`):
  // recognizes ONLY real SingleLineCommentTrivia (immune to template literals with `${...}`, regexes, and block comments)
  // and computes line numbers via `sf.getLineAndCharacterOfPosition()` (including U+2028/U+2029).
  const commentByPos = new Map<number, ts.CommentRange>();
  const addRanges = (ranges: readonly ts.CommentRange[] | undefined): void => {
    if (!ranges) return;
    for (const r of ranges) {
      if (r.kind === ts.SyntaxKind.SingleLineCommentTrivia) commentByPos.set(r.pos, r);
    }
  };
  const walkComments = (node: ts.Node): void => {
    addRanges(ts.getLeadingCommentRanges(text, node.pos));
    addRanges(ts.getTrailingCommentRanges(text, node.end));
    for (const ch of node.getChildren(sf)) walkComments(ch);
  };
  walkComments(sf);
  const singleLineComments = [...commentByPos.values()].sort((a, b) => a.pos - b.pos);

  const lineStarts = sf.getLineStarts();
  const seenKeys = new Set<string>();
  let openRegion: {
    key: string;
    markerStart: number;
    bodyStart: number;
    startLine: number;
  } | null = null;

  for (const range of singleLineComments) {
    const tokStart = range.pos;
    const commentText = text.slice(range.pos, range.end);

    const lc = sf.getLineAndCharacterOfPosition(tokStart);
    const lineNo = lc.line + 1;
    const lineStart = lineStarts[lc.line] ?? 0;
    const nextLineStart = lineStarts[lc.line + 1] ?? text.length;
    // Directive must occupy its own comment-only line
    if (text.slice(lineStart, tokStart).trim().length > 0) continue;

    const directive = /^\/\/[ \t]*#(end)?docregion[ \t]+([^\s]+)[ \t]*$/.exec(commentText);
    if (!directive) continue;

    const isEnd = Boolean(directive[1]);
    const key = directive[2] ?? "";

    if (!isEnd) {
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
        markerStart: lineStart,
        bodyStart: nextLineStart,
        startLine: lineNo + 1,
      };
    } else {
      if (!openRegion) {
        throw new Error(
          `Unexpected #enddocregion ${key} without matching opener in ${filePath}:${lineNo}`,
        );
      }
      if (openRegion.key !== key) {
        throw new Error(
          `Mismatched #enddocregion ${key} (expected ${openRegion.key}) in ${filePath}:${lineNo}`,
        );
      }
      const bodyEnd = lineStart;
      const displayCode = dedentTs(text.slice(openRegion.bodyStart, bodyEnd));
      const markerStart = openRegion.markerStart;

      // Collect preceding declarations across all enclosing Blocks (preserving outer helper scopes)
      const preludeParts: string[] = [];
      const collectEnclosingPreludes = (node: ts.Node): void => {
        if (ts.isBlock(node) && node.pos <= markerStart && node.end >= bodyEnd) {
          for (const st of node.statements) {
            if (st.end <= markerStart) {
              preludeParts.push(dedentTs(st.getText(sf)));
            }
          }
        }
        ts.forEachChild(node, collectEnclosingPreludes);
      };
      collectEnclosingPreludes(sf);

      const twoslashSource = [
        'import { Bind, Component, Interface, Module, Provide, Use, type ClassCtx, type Contributed, type Json, type Opaque, type Slot } from "@prismshadow/penguin-core/kernel";',
        ...preludeParts,
        "// ---cut---",
        displayCode,
      ]
        .filter(Boolean)
        .join("\n");

      regions.set(openRegion.key, {
        code: displayCode,
        twoslashSource,
        line: openRegion.startLine,
        file: toPosixRel(PKG_ROOT, filePath),
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

function hasCls(node: Root["children"][number] | undefined, name: string): boolean {
  if (!node || node.type !== "element") return false;
  const raw = node.properties?.class ?? node.properties?.className;
  if (Array.isArray(raw)) return raw.includes(name);
  if (typeof raw === "string") return parseTokens(raw).includes(name);
  return false;
}

function textOf(node: Root["children"][number] | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

/** Convert temporary `KERNEL_INTERNAL_ORIGIN` URLs emitted by `markdownFirstBlockToHast` into structured `data-k-href` markers. */
function convertInternalKernelAnchors(root: Root): void {
  visit(root, "element", (el) => {
    if (el.tagName !== "a" || !el.properties) return;
    const href = typeof el.properties.href === "string" ? el.properties.href : "";
    try {
      const parsed = new URL(href);
      if (parsed.origin === KERNEL_INTERNAL_ORIGIN) {
        el.properties["data-k-href"] = `${parsed.pathname.replace(/^\/+/, "")}${parsed.hash}`;
        el.properties.href = "#";
      }
    } catch {
      // Relative or non-internal URL — leave untouched
    }
  });
}

function transformerKernelLinks(kernelSlugByName: ReadonlyMap<string, string>) {
  return {
    name: "penguin-kernel-links",
    root(hast: Root): void {
      visit(hast, "element", (node: Element) => {
        if (node.tagName !== "span" || !hasCls(node, "twoslash-hover")) return;
        const popupNode = node.children.find((c) => hasCls(c, "twoslash-popup-container"));
        const popupText = textOf(popupNode).trim();
        for (let i = 0; i < node.children.length; i++) {
          const ch = node.children[i];
          if (!ch || ch === popupNode) continue;
          const word = textOf(ch).trim();
          let relTarget: string | null = null;
          if (MODULE_META_PROPS.has(word) && popupText.includes("ModuleMeta.")) {
            relTarget = `ModuleMeta/#${slugOf(word)}`;
          } else if (
            kernelSlugByName.has(word) &&
            (popupText.startsWith("(alias)") ||
              popupText.startsWith("import ") ||
              popupText.startsWith(`function ${word}`) ||
              popupText.startsWith(`interface ${word}`) ||
              popupText.startsWith(`type ${word}`) ||
              popupText.startsWith(`class ${word}`))
          ) {
            // Do not falsely link a sample-local `class Module {}` unless it is an imported alias
            if (!popupText.startsWith(`class ${word}`) || popupText.includes("(alias)")) {
              relTarget = `${kernelSlugByName.get(word)}/`;
            }
          }
          if (relTarget) {
            node.children[i] = {
              type: "element",
              tagName: "a",
              properties: {
                className: ["twoslash-ref-link"],
                href: "#",
                "data-k-href": relTarget,
                "data-k-sym": word,
              },
              children: [ch],
            };
          }
        }
      });
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
        const hast = markdownFirstBlockToHast(md, {
          linkClass: "twoslash-ref-link",
          resolveSymbolHref: (sym) => {
            const slug = kernelSlugByName.get(sym);
            return slug ? `${KERNEL_INTERNAL_ORIGIN}/${slug}/` : null;
          },
        });
        convertInternalKernelAnchors(hast);
        return hast.children.filter((c): c is ElementContent => c.type !== "doctype");
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
      const hastByKey = new Map<string, Root>();
      const tsErrByKey = new Map<string, string>();

      for (const [key, reg] of regions) {
        try {
          const hast = highlighter.codeToHast(reg.twoslashSource, {
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
          hastByKey.set(key, hast);
        } catch (err) {
          anyFailed = true;
          const msg = err instanceof Error ? err.message : String(err);
          tsErrByKey.set(key, msg);
          console.error(`  TWOSLASH FAIL ${key}: ${msg}`);
        }
      }

      const resultFile = path.join(
        os.tmpdir(),
        `penguin-sample-res-${process.pid}-${randomBytes(6).toString("hex")}.json`,
      );
      try {
        const args = ["--import", loaderHookUrl, tf];
        const stdout = execFileSync(tsxBin, args, {
          encoding: "utf8",
          cwd: PKG_ROOT,
          env: {
            ...process.env,
            PENGUIN_REFS_REPO: REPO,
            PENGUIN_SAMPLE_RESULT_FILE: resultFile,
          },
        });
        const rawJson = fs.existsSync(resultFile)
          ? fs.readFileSync(resultFile, "utf8")
          : (stdout.trim().split(/\r?\n/).pop() ?? "");
        const parsed = JSON.parse(rawJson) as {
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
          const hast = hastByKey.get(r.key);
          verified[r.key] = {
            key: r.key,
            doc: docs.get(r.key) ?? "",
            code: reg.code,
            hast,
            html: hast ? toHtml(hast) : "",
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
          .split(/\r\n|\r|\n/)
          .slice(0, 6)
          .join("\n");
        console.error(`  FAIL ${toPosixRel(PKG_ROOT, tf)}:\n${msg}`);
        for (const [key, reg] of regions) {
          const hast = hastByKey.get(key);
          verified[key] = {
            key,
            doc: docs.get(key) ?? "",
            code: reg.code,
            hast,
            html: hast ? toHtml(hast) : "",
            testFile: reg.file,
            line: reg.line,
            verified: false,
            error: tsErrByKey.get(key) ?? msg,
          };
        }
      } finally {
        fs.rmSync(resultFile, { force: true });
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
