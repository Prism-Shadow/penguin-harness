#!/usr/bin/env node
/**
 * Reference Doc-Sample Verifier using Official Shiki + @shikijs/twoslash + @shikijs/transformers.
 *
 * Zero hand-rolled tokenizers or hover popups:
 *   1. Executes every `.test.ts` file against the real `@prismshadow/penguin-core/kernel`
 *      implementation via `tsx` (and checks strict TypeScript via Twoslash).
 *   2. Renders every `// #docregion <key>` block through Shiki + `@shikijs/twoslash`
 *      (`rendererRich`) + `@shikijs/transformers` (`transformerNotationHighlight`),
 *      using `// ---cut---` so setup declarations stay hidden while providing full
 *      VS Code QuickInfo hover types + JSDoc.
 *   3. Applies one tiny (~20-line) Shiki transformer to turn Kernel API identifiers
 *      into clickable Go-to-Def links (`__KERNEL_ROOT__<slug>/`).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHighlighter } from "shiki";
import { transformerTwoslash, rendererRich } from "@shikijs/twoslash";
import { transformerNotationHighlight, transformerRemoveLineBreak } from "@shikijs/transformers";
import { extractAll, slugOf } from "./extract-real-data.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.PENGUIN_REFS_REPO || path.join(HERE, "..", "worktrees", "refs-main");
const IMPL_NM = path.join(HERE, "..", "impl-238", "node_modules");
const ts = require(path.join(IMPL_NM, "typescript"));
const TSX_BIN = path.join(IMPL_NM, ".bin", "tsx");
const SAMPLES_DIR = path.join(HERE, "doc-samples");
const OUT_FILE = path.join(SAMPLES_DIR, "verified-samples.json");
const ALLOW_FAIL = process.argv.includes("--report-failures");

const REPO_DATA = extractAll(REPO);
const KERNEL_SLUG_BY_NAME = new Map(REPO_DATA.kernel.exports.map((k) => [k.name, k.slug]));
const MODULE_META_PROPS = new Set(["contributes", "context", "children", "exports"]);
const KERNEL_DIR = path.resolve(REPO, "packages/core/src/kernel");

const testFiles = fs
  .readdirSync(SAMPLES_DIR)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => path.join(SAMPLES_DIR, f));

if (!testFiles.length) {
  console.error("No .test.ts files found in", SAMPLES_DIR);
  process.exit(1);
}

// Load real packages/core/src/kernel/*.ts into Twoslash virtual FS so hover popups
// pull real types and JSDoc straight from kernel source.
const kernelExtraFiles = {
  "node_modules/arktype/index.d.ts":
    'export declare function type(def: unknown): any;\nexport type Type<T = unknown> = { (v: unknown): T | { summary: string } };\n',
};
for (const fn of fs.readdirSync(KERNEL_DIR).filter((f) => f.endsWith(".ts"))) {
  kernelExtraFiles[`node_modules/@prismshadow/penguin-core/kernel/${fn}`] = fs.readFileSync(
    path.join(KERNEL_DIR, fn),
    "utf8",
  );
}
kernelExtraFiles["node_modules/@prismshadow/penguin-core/package.json"] = JSON.stringify({
  name: "@prismshadow/penguin-core",
  exports: { "./kernel": "./kernel/index.ts" },
});

function dedent(str) {
  const lines = str.split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const indent = nonEmpty.length ? Math.min(...nonEmpty.map((l) => l.match(/^\s*/)[0].length)) : 0;
  return lines.map((l) => l.slice(indent)).join("\n");
}

/**
 * Extract each `#docregion <key>`, its `@docTarget` doc, and the local helper declarations
 * (classes/interfaces/types/vars) inside the enclosing verify() callback above `#docregion`
 * so Twoslash compiles the sample with full type awareness behind `// ---cut---`.
 */
function extractRegions(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const docs = new Map();
  const regions = new Map();

  const docRe = /\/\*\*([\s\S]*?)\*\//g;
  let dm;
  while ((dm = docRe.exec(text))) {
    const raw = dm[1]
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter(Boolean);
    const targetIdx = raw.findIndex((l) => l.startsWith("@docTarget "));
    if (targetIdx !== -1) {
      const key = raw[targetIdx].replace(/^@docTarget\s+/, "").trim();
      const desc = raw.slice(targetIdx + 1).join(" ").trim();
      if (desc) docs.set(key, desc);
    }
  }

  const startRe = /^[ \t]*\/\/[ \t]*#docregion[ \t]+([^\s]+)[ \t]*\r?\n/gm;
  let sm;
  while ((sm = startRe.exec(text))) {
    const key = sm[1];
    const bodyStart = sm.index + sm[0].length;
    const endRe = new RegExp(`^[ \\t]*\\/\\/[ \\t]*#enddocregion[ \\t]+${key.replace(".", "\\.")}[ \\t]*$`, "m");
    const em = endRe.exec(text.slice(bodyStart));
    if (!em) continue;
    const bodyEnd = bodyStart + em.index;
    const startLine = sf.getLineAndCharacterOfPosition(bodyStart).line + 1;
    const displayCode = dedent(text.slice(bodyStart, bodyEnd));

    // Find enclosing block (the verify() callback body) and grab statements before #docregion as Twoslash prelude
    let prelude = "";
    function findBlock(node) {
      if (ts.isBlock(node) && node.pos <= sm.index && node.end >= bodyEnd) {
        const before = node.statements
          .filter((st) => st.end <= sm.index)
          .map((st) => dedent(st.getText(sf)));
        prelude = before.join("\n");
      }
      ts.forEachChild(node, findBlock);
    }
    findBlock(sf);

    const kernelImports = [
      'import { Bind, Component, Interface, Module, Provide, Use, type ClassCtx, type Contributed, type Json, type Opaque, type Slot } from "@prismshadow/penguin-core/kernel";',
      prelude,
      "// ---cut---",
      displayCode,
    ]
      .filter(Boolean)
      .join("\n");

    regions.set(key, {
      code: displayCode,
      twoslashSource: kernelImports,
      line: startLine,
      file: path.relative(HERE, filePath).replace(/\\/g, "/"),
    });
  }
  return { docs, regions };
}

/**
 * Tiny ~20-line Shiki transformer: turns Kernel API symbols inside Twoslash hover nodes
 * into clickable Go-to-Def links (`__KERNEL_ROOT__<slug>/`) while keeping Twoslash's
 * official rich popup intact.
 */
function hasCls(node, name) {
  const raw = node?.properties?.class ?? node?.properties?.className;
  if (Array.isArray(raw)) return raw.includes(name);
  if (typeof raw === "string") return raw.split(/\s+/).includes(name);
  return false;
}

function textOf(node) {
  if (!node) return "";
  if (node.type === "text") return node.value || "";
  if (Array.isArray(node.children)) return node.children.map(textOf).join("");
  return "";
}

function transformerKernelLinks() {
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "element" && node.tagName === "span" && hasCls(node, "twoslash-hover")) {
      const popupNode = (node.children || []).find((c) => c.type === "element" && hasCls(c, "twoslash-popup-container"));
      const popupText = textOf(popupNode).trim();
      for (let i = 0; i < (node.children || []).length; i++) {
        const ch = node.children[i];
        if (ch === popupNode) continue;
        const word = textOf(ch).trim();
        let targetHref = null;
        if (MODULE_META_PROPS.has(word) && popupText.includes("ModuleMeta.")) {
          targetHref = `__KERNEL_ROOT__ModuleMeta/#${slugOf(word)}`;
        } else if (KERNEL_SLUG_BY_NAME.has(word) && (/^[A-Z]/.test(word) || popupText.startsWith(`function ${word}`))) {
          targetHref = `__KERNEL_ROOT__${KERNEL_SLUG_BY_NAME.get(word)}/`;
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
    if (Array.isArray(node.children)) node.children.forEach(walk);
  }
  return {
    name: "penguin-kernel-links",
    root(hast) {
      walk(hast);
    },
  };
}

// 1. Initialize official Shiki highlighter + Twoslash transformer
const highlighter = await createHighlighter({
  themes: ["github-light", "github-dark-default"],
  langs: ["ts"],
});

function renderInlineMdToHast(md) {
  const out = [];
  const clean = String(md || "").replace(/\s+/g, " ").trim();
  const re = /\{@link\s+([^}\s]+)(?:\s+([^}]*))?\}|`([^`]+)`/g;
  let last = 0, m;
  while ((m = re.exec(clean))) {
    if (m.index > last) out.push({ type: "text", value: clean.slice(last, m.index) });
    if (m[1]) {
      const sym = m[1].replace(/\(\)$/, "");
      const label = (m[2]?.trim() || m[1]).trim();
      const slug = KERNEL_SLUG_BY_NAME.get(sym);
      const codeEl = { type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: label }] };
      out.push(
        slug
          ? { type: "element", tagName: "a", properties: { class: "twoslash-ref-link", href: `__KERNEL_ROOT__${slug}/` }, children: [codeEl] }
          : codeEl,
      );
    } else if (m[3]) {
      out.push({ type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: m[3] }] });
    }
    last = re.lastIndex;
  }
  if (last < clean.length) out.push({ type: "text", value: clean.slice(last) });
  return out;
}

const twoslashTransformer = transformerTwoslash({
  explicitTrigger: false,
  renderer: rendererRich({
    errorRendering: "hover",
    renderMarkdown(md) {
      // Keep popup docs concise (first paragraph only) and render inline `code` + {@link}
      const firstPara = String(md || "").split(/\r?\n\s*\r?\n/)[0] || "";
      return [{ type: "element", tagName: "p", properties: {}, children: renderInlineMdToHast(firstPara) }];
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
        "@prismshadow/penguin-core/kernel": ["./node_modules/@prismshadow/penguin-core/kernel/index.ts"],
      },
    },
  },
});

// 2. Run every test file against the real kernel via tsx (with ESM resolver for arktype)
const coreReq = createRequire(path.join(HERE, "..", "impl-238", "packages", "core", "package.json"));
const arktypeEntryUrl = "file://" + coreReq.resolve("arktype");
const hookSrc = `import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "arktype") return { url: ${JSON.stringify(arktypeEntryUrl)}, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});`;
const hookUrl = "data:text/javascript;base64," + Buffer.from(hookSrc).toString("base64");

const verified = {};
let anyFailed = false;

for (const tf of testFiles) {
  const { docs, regions } = extractRegions(tf);

  // Render each #docregion with official Shiki + Twoslash (which also type-checks every snippet!)
  const htmlByKey = new Map();
  const tsErrByKey = new Map();
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
          transformerKernelLinks(),
        ],
      });
      htmlByKey.set(key, html);
    } catch (err) {
      anyFailed = true;
      tsErrByKey.set(key, err.message || String(err));
      console.error(`  TWOSLASH FAIL ${key}: ${err.message || err}`);
    }
  }

  // Execute the real runtime assertions via tsx
  try {
    const stdout = execFileSync(TSX_BIN, ["--import", hookUrl, tf], { encoding: "utf8", cwd: HERE });
    const lastLine = stdout.trim().split(/\r?\n/).pop();
    const parsed = JSON.parse(lastLine);
    if (!parsed.ok) throw new Error(`Doc-sample test returned ok=false: ${tf}`);
    for (const r of parsed.results) {
      const reg = regions.get(r.key);
      if (!reg) throw new Error(`Missing #docregion ${r.key} in ${tf}`);
      const tsErr = tsErrByKey.get(r.key) || null;
      verified[r.key] = {
        key: r.key,
        doc: docs.get(r.key) || "",
        code: reg.code,
        html: htmlByKey.get(r.key) || "",
        testFile: reg.file,
        line: reg.line,
        title: r.title,
        assertions: r.assertions,
        verified: !tsErr,
        error: tsErr,
      };
      if (!tsErr) console.log(`  PASS ${r.key} (${r.assertions} assertions) — ${r.title}`);
    }
  } catch (err) {
    anyFailed = true;
    const msg = (err.stderr || err.message || String(err)).toString().trim().split(/\r?\n/).slice(0, 6).join("\n");
    console.error(`  FAIL ${path.relative(HERE, tf)}:\n${msg}`);
    for (const [key, reg] of regions) {
      verified[key] = {
        key,
        doc: docs.get(key) || "",
        code: reg.code,
        html: htmlByKey.get(key) || "",
        testFile: reg.file,
        line: reg.line,
        verified: false,
        error: tsErrByKey.get(key) || msg,
      };
    }
  }
}

highlighter.dispose();
fs.writeFileSync(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), samples: verified }, null, 2));
console.log(`Wrote ${Object.keys(verified).length} Shiki+Twoslash doc-samples -> ${OUT_FILE}`);
if (anyFailed && !ALLOW_FAIL) process.exit(1);
