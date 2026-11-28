import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ts = require(
  process.env.PENGUIN_TS_PATH ||
    path.join(HERE, "..", "impl-238", "node_modules", "typescript"),
);

export const slugOf = (n) =>
  String(n ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function walkTs(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (
      e.name === "node_modules" ||
      e.name === "dist" ||
      e.name === "__tests__" ||
      e.name.startsWith(".")
    ) {
      continue;
    }
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkTs(full, out);
    else if (
      (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) &&
      !e.name.endsWith(".d.ts") &&
      !e.name.endsWith(".test.ts") &&
      !e.name.endsWith(".test.tsx") &&
      !e.name.endsWith(".spec.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Parse a JSDoc comment into structured blocks preserving paragraphs,
 * bullet lists, fenced code blocks, indented code blocks, and @tags.
 */
export function parseJsDocBlocks(raw) {
  const inner = raw.replace(/^\/\*\*/, "").replace(/\*\/$/, "");
  const rawLines = inner.split(/\r?\n/).map((l) => l.replace(/^\s*\*\s?/, "").replace(/\s+$/, ""));
  while (rawLines.length && rawLines[0].trim() === "") rawLines.shift();
  while (rawLines.length && rawLines[rawLines.length - 1].trim() === "") rawLines.pop();

  const blocks = [];
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    // Fenced code block ```lang
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim() || "ts";
      const codeLines = [];
      i++;
      while (i < rawLines.length && !rawLines[i].trim().startsWith("```")) {
        codeLines.push(rawLines[i]);
        i++;
      }
      if (i < rawLines.length) i++;
      blocks.push({ kind: "code", lang, code: codeLines.join("\n").replace(/^\n+|\n+$/g, "") });
      continue;
    }

    // Indented code block (2+ leading spaces on non-bullet lines, e.g. JSON or CLI examples)
    if (/^  \S/.test(line) && !/^\s*[-*]\s+/.test(line)) {
      const codeLines = [];
      while (i < rawLines.length && (rawLines[i].trim() === "" || /^  /.test(rawLines[i]))) {
        codeLines.push(rawLines[i].replace(/^  /, ""));
        i++;
      }
      while (codeLines.length && codeLines[codeLines.length - 1].trim() === "") codeLines.pop();
      blocks.push({ kind: "code", lang: "ts", code: codeLines.join("\n") });
      continue;
    }

    // Bullet list
    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (i < rawLines.length) {
        const t = rawLines[i].trim();
        if (/^[-*]\s+/.test(t)) {
          items.push(t.replace(/^[-*]\s+/, ""));
          i++;
          while (i < rawLines.length && rawLines[i].trim() !== "" && !/^[-*]\s+/.test(rawLines[i].trim()) && !rawLines[i].trim().startsWith("```") && !/^@\w+/.test(rawLines[i].trim())) {
            items[items.length - 1] += " " + rawLines[i].trim();
            i++;
          }
        } else {
          break;
        }
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    // JSDoc @tag
    const tagMatch = trimmed.match(/^@(param|returns?|see|example|deprecated|remarks|throws|category|group|internal|publicApi|experimental)\b\s*(.*)$/);
    if (tagMatch) {
      let text = tagMatch[2] || "";
      i++;
      while (i < rawLines.length && rawLines[i].trim() !== "" && !/^@\w+/.test(rawLines[i].trim()) && !rawLines[i].trim().startsWith("```") && !/^[-*]\s+/.test(rawLines[i].trim())) {
        text += (text ? " " : "") + rawLines[i].trim();
        i++;
      }
      blocks.push({ kind: "tag", tag: tagMatch[1], text: text.trim() });
      continue;
    }

    // Regular paragraph
    const pLines = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim() !== "" &&
      !rawLines[i].trim().startsWith("```") &&
      !/^[-*]\s+/.test(rawLines[i].trim()) &&
      !/^@(param|returns?|see|example|deprecated|remarks|throws)\b/.test(rawLines[i].trim()) &&
      !(/^  \S/.test(rawLines[i]) && pLines.length === 0)
    ) {
      pLines.push(rawLines[i].trim());
      i++;
    }
    if (pLines.length) blocks.push({ kind: "p", text: pLines.join(" ") });
  }
  return blocks;
}

function blocksToPlainParas(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.kind === "p") out.push(b.text);
    else if (b.kind === "ul") out.push(...b.items.map((x) => "• " + x));
    else if (b.kind === "tag") out.push(`@${b.tag} ${b.text}`);
  }
  return out;
}

function getJsDocFull(sf, node) {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.pos);
  if (!ranges || !ranges.length) return { doc: [], docBlocks: [] };
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    const txt = sf.text.slice(r.pos, r.end);
    if (txt.startsWith("/**")) {
      const docBlocks = parseJsDocBlocks(txt);
      return { doc: blocksToPlainParas(docBlocks), docBlocks };
    }
  }
  return { doc: [], docBlocks: [] };
}

function getFileTopJsDocFull(sf) {
  const ranges = ts.getLeadingCommentRanges(sf.text, 0);
  if (!ranges || !ranges.length) return { doc: [], docBlocks: [] };
  const txt = sf.text.slice(ranges[0].pos, ranges[0].end);
  if (txt.startsWith("/**")) {
    const docBlocks = parseJsDocBlocks(txt);
    return { doc: blocksToPlainParas(docBlocks), docBlocks };
  }
  return { doc: [], docBlocks: [] };
}

function lineOf(sf, pos) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function getDecorators(node) {
  if (typeof ts.getDecorators === "function") return ts.getDecorators(node) || [];
  return node.decorators || [];
}

function decName(dec, sf) {
  const e = dec.expression;
  return ts.isCallExpression(e) ? e.expression.getText(sf) : e.getText(sf);
}

function propNameText(nameNode, sf) {
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text;
  }
  return nameNode.getText(sf).replace(/^["']|["']$/g, "");
}

function evalExpr(node, sf) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return -Number(node.operand.text);
  }
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((el) => evalExpr(el, sf));
  }
  if (ts.isObjectLiteralExpression(node)) {
    const obj = {};
    for (const p of node.properties) {
      if (ts.isPropertyAssignment(p)) {
        obj[propNameText(p.name, sf)] = evalExpr(p.initializer, sf);
      } else if (ts.isShorthandPropertyAssignment(p)) {
        obj[p.name.text] = p.name.text;
      }
    }
    return obj;
  }
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return evalExpr(node.expression, sf);
  }
  return node.getText(sf);
}

function extractClassDecl(st, sf, kind) {
  const decs = getDecorators(st).map((d) => d.getText(sf));
  const mods = (st.modifiers || [])
    .filter((m) => !ts.isDecorator(m))
    .map((m) => m.getText(sf))
    .join(" ");
  const heritage = st.heritageClauses ? " " + st.heritageClauses.map((h) => h.getText(sf)).join(" ") : "";
  const typeParams = st.typeParameters ? `<${st.typeParameters.map((tp) => tp.getText(sf)).join(", ")}>` : "";
  const header = `${decs.length ? decs.join("\n") + "\n" : ""}${mods ? mods + " " : ""}class ${st.name.text}${typeParams}${heritage}`;

  if (kind === "interface") {
    const bodyLines = [];
    for (const m of st.members) {
      const mText = m.getText(sf).trim();
      bodyLines.push("  " + mText.replace(/\r?\n/g, "\n  "));
    }
    return bodyLines.length ? `${header} {\n${bodyLines.join("\n")}\n}` : `${header} {}`;
  }

  const bodyLines = [];
  for (const m of st.members) {
    const mDecs = getDecorators(m);
    const mDecNames = mDecs.map((d) => decName(d, sf));
    if (ts.isConstructorDeclaration(m)) {
      const params = m.parameters.map((p) => p.getText(sf).replace(/\s+/g, " ")).join(", ");
      bodyLines.push(`  constructor(${params});`);
    } else if (ts.isPropertyDeclaration(m) && (kind === "class" || mDecNames.some((n) => n === "Use" || n === "Provide" || n === "Bind"))) {
      const isPrivate = (m.modifiers || []).some(
        (mod) => mod.kind === ts.SyntaxKind.PrivateKeyword || mod.kind === ts.SyntaxKind.ProtectedKeyword,
      );
      const mName = m.name ? propNameText(m.name, sf) : "";
      if (kind !== "class" || (!isPrivate && !mName.startsWith("#"))) {
        bodyLines.push("  " + m.getText(sf).trim().replace(/\r?\n/g, "\n  "));
      }
    } else if (ts.isMethodDeclaration(m) && m.name) {
      const mName = propNameText(m.name, sf);
      const isPrivate = (m.modifiers || []).some(
        (mod) => mod.kind === ts.SyntaxKind.PrivateKeyword || mod.kind === ts.SyntaxKind.ProtectedKeyword,
      );
      if (!isPrivate && !mName.startsWith("#")) {
        const mMods = (m.modifiers || [])
          .filter((mod) => !ts.isDecorator(mod))
          .map((mod) => mod.getText(sf))
          .join(" ");
        const tp = m.typeParameters ? `<${m.typeParameters.map((x) => x.getText(sf)).join(", ")}>` : "";
        const params = m.parameters.map((p) => p.getText(sf)).join(", ");
        const ret = m.type ? `: ${m.type.getText(sf)}` : "";
        bodyLines.push(`  ${mMods ? mMods + " " : ""}${mName}${tp}(${params})${ret};`);
      }
    } else if (ts.isGetAccessorDeclaration(m) && m.name) {
      const mName = propNameText(m.name, sf);
      const isPrivate = (m.modifiers || []).some(
        (mod) => mod.kind === ts.SyntaxKind.PrivateKeyword || mod.kind === ts.SyntaxKind.ProtectedKeyword,
      );
      if (!isPrivate && !mName.startsWith("#")) {
        const ret = m.type ? `: ${m.type.getText(sf)}` : "";
        bodyLines.push(`  get ${mName}()${ret};`);
      }
    }
  }
  return bodyLines.length ? `${header} {\n${bodyLines.join("\n")}\n}` : `${header} {}`;
}

function extractEndpointsFromSf(sf) {
  const eps = [];
  const seen = new Set();
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const meth = node.expression.name.text.toUpperCase();
      if (["GET", "POST", "PUT", "PATCH", "DELETE", "ALL"].includes(meth) && node.arguments.length >= 2) {
        const first = node.arguments[0];
        if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) {
          const p = first.text;
          if (p.startsWith("/") || p === "*") {
            const key = `${meth} ${p}`;
            if (!seen.has(key)) {
              seen.add(key);
              eps.push({ method: meth, path: p, line: lineOf(sf, node.getStart(sf)) });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return eps;
}

function extractCommanderInfo(sf) {
  const commands = [];
  const options = [];
  const descriptions = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const arg0 = node.arguments[0];
      const arg1 = node.arguments[1];
      if (name === "command" && arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) {
        commands.push(arg0.text);
      } else if (name === "description" && arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) {
        descriptions.push(arg0.text);
      } else if (name === "option" && arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) {
        const desc = arg1 && (ts.isStringLiteral(arg1) || ts.isNoSubstitutionTemplateLiteral(arg1)) ? arg1.text : "";
        options.push({ flag: arg0.text, desc });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { commands, options, descriptions };
}

function parseSlotType(typeNode, sf) {
  if (!typeNode) return { data: "unknown", code: null };
  if (ts.isTypeReferenceNode(typeNode) && typeNode.typeName.getText(sf) === "Slot") {
    const args = typeNode.typeArguments || [];
    const data = args[0] ? args[0].getText(sf).replace(/\s+/g, " ") : "unknown";
    const code = args[1] ? args[1].getText(sf).replace(/\s+/g, " ") : null;
    return { data, code: code === "never" ? null : code };
  }
  return { data: typeNode.getText(sf).replace(/\s+/g, " "), code: null };
}

/* ---------- Full @prismshadow/penguin-core/kernel Extraction ---------- */

const KERNEL_SUBSYSTEMS = [
  {
    id: "decorators",
    title: "Decorators & Type Markers",
    files: ["decorators.ts", "markers.ts"],
    blurb: "Class-form authoring API (`@Module`, `@Component`, `@Use`, `@Provide`, `@Bind`, `@Interface`, `Slot`, `Opaque`) — recorded via `Symbol.for` across bundle boundaries.",
  },
  {
    id: "module-tree",
    title: "Module Assembly & Booting",
    files: ["module.ts"],
    blurb: "Translating decorated classes and manifests into a verified dependency graph and booting instances in topological order.",
  },
  {
    id: "manifest-check",
    title: "Manifests & Static Verification",
    files: ["manifest.ts", "check.ts"],
    blurb: "JSON manifest parsing and whole-tree validation (`checkTree`) that verifies every requirement, slot, and context schema before executing any module code.",
  },
  {
    id: "signatures",
    title: "Structural Signatures & Data Algebra",
    files: ["sig.ts", "data.ts"],
    blurb: "Go-style structural interface satisfaction (`satisfies`, `assignable`) and arktype-backed data subtyping (`dataExtends`).",
  },
  {
    id: "runtime-upgrade",
    title: "Low-Level Kernel Boot & Hot Upgrade",
    files: ["boot.ts", "upgrade.ts", "iface.ts"],
    blurb: "Core instance-tree booter, live resource registry (`Resources`), `park()` state handoff, and atomic in-process `upgrade()`.",
  },
  {
    id: "schema-json",
    title: "Context Schemas & Wire JSON",
    files: ["schema.ts", "json.ts"],
    blurb: "Arktype schema adapters for versioned parked contexts and JSON wire-level currency types.",
  },
];

function subsystemOfKernelFile(baseName) {
  for (const s of KERNEL_SUBSYSTEMS) {
    if (s.files.includes(baseName)) return s.id;
  }
  return "module-tree";
}

const cleanTypeWs = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/([<(\[])\s+/g, "$1")
    .replace(/\s+([>)\],;])/g, "$1")
    .trim();

function extractKernelPackage(REPO, kernelImporters) {
  const kdir = path.join(REPO, "packages/core/src/kernel");
  const idxPath = path.join(kdir, "index.ts");
  if (!fs.existsSync(idxPath)) return { files: [], exports: [], subsystems: KERNEL_SUBSYSTEMS, indexDoc: { doc: [], docBlocks: [] } };

  const sfByFile = new Map();
  for (const fn of fs.readdirSync(kdir).filter((x) => x.endsWith(".ts")).sort()) {
    const full = path.join(kdir, fn);
    const text = fs.readFileSync(full, "utf8");
    sfByFile.set(fn, {
      fn,
      rel: `packages/core/src/kernel/${fn}`,
      sf: ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    });
  }

  // Extract file-top documentation essays for every kernel source file
  const kernelFiles = [];
  for (const [fn, entry] of sfByFile.entries()) {
    const top = getFileTopJsDocFull(entry.sf);
    kernelFiles.push({
      fn,
      rel: entry.rel,
      subsystem: fn === "index.ts" ? "overview" : subsystemOfKernelFile(fn),
      doc: top.doc,
      docBlocks: top.docBlocks,
      lines: entry.sf.text.split(/\r?\n/).length,
    });
  }
  const indexDoc = kernelFiles.find((f) => f.fn === "index.ts") || { doc: [], docBlocks: [] };

  // Follow export declarations recursively from index.ts -> local .ts files
  function resolveSymbolInFile(fn, name, visited = new Set()) {
    if (visited.has(`${fn}:${name}`)) return null;
    visited.add(`${fn}:${name}`);
    const entry = sfByFile.get(fn);
    if (!entry) return null;
    const { sf, rel } = entry;

    for (const st of sf.statements) {
      const isExp = (st.modifiers || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (isExp) {
        if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) && st.name?.text === name) {
          return { st, sf, fn, rel };
        }
        if (ts.isVariableStatement(st)) {
          for (const decl of st.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.name.text === name) {
              return { st, decl, sf, fn, rel };
            }
          }
        }
      }
      // Re-export?
      if (ts.isExportDeclaration(st) && st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          if (el.name.text === name) {
            const orig = el.propertyName ? el.propertyName.text : el.name.text;
            const modSpec = st.moduleSpecifier.text;
            if (modSpec.startsWith("./")) {
              return resolveSymbolInFile(modSpec.slice(2).replace(/\.js$/, ".ts"), orig, visited);
            }
            return { externalReexport: { from: modSpec, orig, st, sf, fn, rel } };
          }
        }
      }
    }
    return null;
  }

  const idxEntry = sfByFile.get("index.ts");
  const exportsList = [];

  for (const st of idxEntry.sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
    const fromFile = st.moduleSpecifier.text.slice(2).replace(/\.js$/, ".ts");
    const stmtTypeOnly = st.isTypeOnly;
    for (const el of st.exportClause.elements) {
      const name = el.name.text;
      const orig = el.propertyName ? el.propertyName.text : name;
      const isTypeOnly = stmtTypeOnly || el.isTypeOnly;
      const resolved = resolveSymbolInFile(fromFile, orig);
      if (!resolved) continue;

      const slug = name;

      const importStmt = isTypeOnly
        ? `import type { ${name} } from "@prismshadow/penguin-core/kernel";`
        : `import { ${name} } from "@prismshadow/penguin-core/kernel";`;

      if (resolved.externalReexport) {
        const ex = resolved.externalReexport;
        const jsd = getJsDocFull(ex.sf, ex.st);
        exportsList.push({
          name,
          slug,
          isTypeOnly,
          kind: "function",
          subsystem: subsystemOfKernelFile(ex.fn),
          sourceFile: ex.fn,
          file: ex.rel,
          line: lineOf(ex.sf, ex.st.getStart(ex.sf)),
          importStmt,
          sig: `export { ${ex.orig}${ex.orig !== name ? ` as ${name}` : ""} } from "${ex.from}";`,
          doc: jsd.doc.length ? jsd.doc : [`Re-exported from \`${ex.from}\` for defining versioned context schemas passed to \`schema()\`.`],
          docBlocks: jsd.docBlocks.length ? jsd.docBlocks : [{ kind: "p", text: `Re-exported from \`${ex.from}\` for defining versioned context schemas passed to \`schema()\`.` }],
          params: [],
          returnType: "",
          members: [],
          variants: [],
          importers: kernelImporters.get(name) || [],
        });
        continue;
      }

      const { st: node, decl, sf, fn, rel } = resolved;
      const jsd = getJsDocFull(sf, node);
      let kind = "type_alias";
      let sig = "";
      let params = [];
      let returnType = "";
      let members = [];
      let variants = [];

      if (ts.isFunctionDeclaration(node)) {
        const isDec = ["Module", "Component", "Use", "Provide", "Bind", "Interface"].includes(name);
        kind = isDec ? "decorator" : "function";
        const isAsync = (node.modifiers || []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
        const tp = node.typeParameters ? `<${node.typeParameters.map((x) => x.getText(sf)).join(", ")}>` : "";
        params = node.parameters.map((p) => ({
          name: p.name.getText(sf),
          optional: !!p.questionToken || !!p.initializer,
          type: p.type ? cleanTypeWs(p.type.getText(sf)) : "unknown",
          defaultVal: p.initializer ? cleanTypeWs(p.initializer.getText(sf)) : "",
        }));
        returnType = node.type ? cleanTypeWs(node.type.getText(sf)) : "";
        const paramsFormatted = node.parameters.length > 2
          ? "\n  " + node.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(",\n  ") + ",\n"
          : node.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(", ");
        sig = `export ${isAsync ? "async " : ""}function ${name}${tp}(${paramsFormatted})${returnType ? `: ${returnType}` : ""}`;
      } else if (ts.isClassDeclaration(node)) {
        kind = "class";
        sig = extractClassDecl(node, sf, "class");
        for (const m of node.members) {
          if (ts.isConstructorDeclaration(m)) {
            const mp = m.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(", ");
            const mj = getJsDocFull(sf, m);
            members.push({ name: "constructor", kind: "method", sig: `constructor(${mp})`, doc: mj.doc, docBlocks: mj.docBlocks, line: lineOf(sf, m.getStart(sf)) });
          } else if ((ts.isPropertyDeclaration(m) || ts.isMethodDeclaration(m)) && m.name) {
            const mName = propNameText(m.name, sf);
            const isPriv = (m.modifiers || []).some((mod) => mod.kind === ts.SyntaxKind.PrivateKeyword || mod.kind === ts.SyntaxKind.ProtectedKeyword);
            if (isPriv || mName.startsWith("#")) continue;
            const mj = getJsDocFull(sf, m);
            if (ts.isMethodDeclaration(m)) {
              const mp = m.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(", ");
              const ret = m.type ? `: ${cleanTypeWs(m.type.getText(sf))}` : "";
              members.push({ name: mName, kind: "method", sig: `${mName}(${mp})${ret}`, doc: mj.doc, docBlocks: mj.docBlocks, line: lineOf(sf, m.getStart(sf)) });
            } else {
              const ro = (m.modifiers || []).some((mod) => mod.kind === ts.SyntaxKind.ReadonlyKeyword) ? "readonly " : "";
              const typ = m.type ? cleanTypeWs(m.type.getText(sf)) : "unknown";
              members.push({ name: mName, kind: "property", sig: `${ro}${mName}: ${typ}`, doc: mj.doc, docBlocks: mj.docBlocks, line: lineOf(sf, m.getStart(sf)) });
            }
          }
        }
      } else if (ts.isInterfaceDeclaration(node)) {
        kind = "interface";
        sig = node.getText(sf);
        for (const m of node.members) {
          if ((ts.isPropertySignature(m) || ts.isMethodSignature(m)) && m.name) {
            const mName = propNameText(m.name, sf);
            const mj = getJsDocFull(sf, m);
            members.push({
              name: mName,
              kind: ts.isMethodSignature(m) ? "method" : "property",
              sig: cleanTypeWs(m.getText(sf).replace(/;$/, "")),
              doc: mj.doc,
              docBlocks: mj.docBlocks,
              line: lineOf(sf, m.getStart(sf)),
            });
          }
        }
      } else if (ts.isTypeAliasDeclaration(node)) {
        kind = "type_alias";
        sig = node.getText(sf);
        if (ts.isUnionTypeNode(node.type)) {
          for (const branch of node.type.types) {
            // Check comment immediately preceding branch or preceding "|" token
            let bj = getJsDocFull(sf, branch);
            if (!bj.doc.length) {
              // Look backward in sf.text before branch.pos for a /** ... */ between previous branch and this one
              const slice = sf.text.slice(Math.max(node.pos, branch.pos - 260), branch.getStart(sf));
              const m = slice.match(/\/\*\*([\s\S]*?)\*\/\s*\|?\s*$/);
              if (m) {
                const db = parseJsDocBlocks(`/**${m[1]}*/`);
                bj = { doc: blocksToPlainParas(db), docBlocks: db };
              }
            }
            variants.push({
              type: cleanTypeWs(branch.getText(sf)),
              doc: bj.doc,
              docBlocks: bj.docBlocks,
            });
          }
        } else if (ts.isTypeLiteralNode(node.type)) {
          for (const m of node.type.members) {
            if ((ts.isPropertySignature(m) || ts.isMethodSignature(m)) && m.name) {
              const mj = getJsDocFull(sf, m);
              members.push({
                name: propNameText(m.name, sf),
                kind: ts.isMethodSignature(m) ? "method" : "property",
                sig: cleanTypeWs(m.getText(sf).replace(/;$/, "")),
                doc: mj.doc,
                docBlocks: mj.docBlocks,
                line: lineOf(sf, m.getStart(sf)),
              });
            }
          }
        }
      } else if (ts.isVariableStatement(node) && decl) {
        kind = "function";
        sig = node.getText(sf);
      }

      exportsList.push({
        name,
        slug,
        isTypeOnly,
        kind,
        subsystem: subsystemOfKernelFile(fn),
        sourceFile: fn,
        file: rel,
        line: lineOf(sf, node.getStart(sf)),
        importStmt,
        sig,
        doc: jsd.doc,
        docBlocks: jsd.docBlocks,
        params,
        returnType,
        members,
        variants,
        importers: kernelImporters.get(name) || [],
      });
    }
  }

  // Scheme B (Angular-style exact identifier slug): preserve original casing, and deterministically
  // disambiguate case-insensitive collisions (e.g. `Schema` interface vs `schema` function) by kind.
  const lowerCounts = new Map();
  for (const e of exportsList) {
    const lc = e.name.toLowerCase();
    lowerCounts.set(lc, (lowerCounts.get(lc) || 0) + 1);
  }
  const seenLowerSlugs = new Set();
  for (const e of exportsList) {
    const lc = e.name.toLowerCase();
    e.slug = lowerCounts.get(lc) > 1 ? `${e.name}.${e.kind}` : e.name;
    const slugLc = e.slug.toLowerCase();
    if (seenLowerSlugs.has(slugLc)) {
      throw new Error(`Unresolved case-insensitive kernel slug collision: ${e.slug}`);
    }
    seenLowerSlugs.add(slugLc);
  }

  return { files: kernelFiles, exports: exportsList, subsystems: KERNEL_SUBSYSTEMS, indexDoc };
}

export function extractAll(repoPath) {
  const REPO = path.resolve(repoPath);
  let gitSha = "main", gitDate = "", gitSubject = "";
  try {
    gitSha = execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    gitDate = execFileSync("git", ["-C", REPO, "log", "-1", "--format=%ci"], { encoding: "utf8" }).trim();
    gitSubject = execFileSync("git", ["-C", REPO, "log", "-1", "--format=%s"], { encoding: "utf8" }).trim();
  } catch {}

  const pkgRoots = [];
  for (const root of ["packages", "library", "plugins"]) {
    const base = path.join(REPO, root);
    if (!fs.existsSync(base)) continue;
    for (const sub of fs.readdirSync(base, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const pkgDir = path.join(base, sub.name);
      const srcDir = path.join(pkgDir, "src");
      if (!fs.existsSync(srcDir)) continue;
      let pkgName = `${root}/${sub.name}`;
      let pkgDesc = "";
      try {
        const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
        if (pj.name) pkgName = pj.name;
        if (pj.description) pkgDesc = pj.description;
      } catch {}
      const area =
        root === "plugins"
          ? "plugin"
          : root === "library"
            ? "library"
            : sub.name === "server"
              ? "server"
              : sub.name === "web"
                ? "web"
                : sub.name === "cli"
                  ? "cli"
                  : sub.name === "core"
                    ? "core"
                    : "package";
      pkgRoots.push({ root, sub: sub.name, pkgName, pkgDesc, area, pkgDir, srcDir });
    }
  }

  const rawModules = [];
  const rawComponents = [];
  const rawIfaces = [];
  const rawSlotIfaces = [];
  const fileSfCache = new Map();
  const fileHostClasses = new Map();
  const kernelImporters = new Map(); // kernelSymbolName -> [{ file, pkg, line }]

  for (const pr of pkgRoots) {
    const files = walkTs(pr.srcDir);
    for (const f of files) {
      const rel = path.relative(REPO, f).replace(/\\/g, "/");
      const text = fs.readFileSync(f, "utf8");
      const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      fileSfCache.set(rel, { sf, text, pr });

      const hostClasses = [];
      for (const st of sf.statements) {
        // Track real imports from @prismshadow/penguin-core/kernel
        if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
          const spec = st.moduleSpecifier.text;
          if (spec === "@prismshadow/penguin-core/kernel" && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
            const ln = lineOf(sf, st.getStart(sf));
            for (const el of st.importClause.namedBindings.elements) {
              const sym = el.propertyName ? el.propertyName.text : el.name.text;
              if (!kernelImporters.has(sym)) kernelImporters.set(sym, []);
              kernelImporters.get(sym).push({ file: rel, pkg: pr.pkgName, line: ln });
            }
          }
        }

        if (ts.isClassDeclaration(st) && st.name) {
          const name = st.name.text;
          const decs = getDecorators(st);
          const decNames = decs.map((d) => decName(d, sf));
          const isModule = decNames.includes("Module");
          const isComp = decNames.includes("Component");
          const isIface = decNames.includes("Interface");

          if (isModule || isComp) hostClasses.push({ name, kind: isModule ? "module" : "component" });

          if (isModule || isComp) {
            const dec = decs.find((d) => decName(d, sf) === (isModule ? "Module" : "Component"));
            let meta = {};
            let contextRaw = null;
            if (dec && ts.isCallExpression(dec.expression) && dec.expression.arguments.length) {
              const arg = dec.expression.arguments[0];
              if (ts.isObjectLiteralExpression(arg)) {
                meta = evalExpr(arg, sf) || {};
                for (const p of arg.properties) {
                  if (ts.isPropertyAssignment(p) && propNameText(p.name, sf) === "context") {
                    contextRaw = p.initializer.getText(sf);
                  }
                }
              }
            }

            const uses = [], provides = [], binds = [], pubMethods = [];
            for (const m of st.members) {
              const mDecs = getDecorators(m);
              if (ts.isPropertyDeclaration(m) && m.name) {
                const field = propNameText(m.name, sf);
                const typeStr = m.type ? m.type.getText(sf).replace(/\s+/g, " ") : "unknown";
                for (const md of mDecs) {
                  const dn = decName(md, sf);
                  if (dn === "Use") {
                    const from =
                      ts.isCallExpression(md.expression) && md.expression.arguments.length
                        ? evalExpr(md.expression.arguments[0], sf)
                        : null;
                    uses.push({ field, type: typeStr, from: typeof from === "string" ? from : null, raw: m.getText(sf).trim() });
                  } else if (dn === "Provide") {
                    provides.push({ field, type: typeStr, raw: m.getText(sf).trim() });
                  } else if (dn === "Bind") {
                    const id =
                      ts.isCallExpression(md.expression) && md.expression.arguments.length
                        ? evalExpr(md.expression.arguments[0], sf)
                        : "";
                    binds.push({ field, id: String(id ?? ""), type: typeStr, raw: m.getText(sf).trim() });
                  }
                }
              } else if (ts.isMethodDeclaration(m) && m.name) {
                const mName = propNameText(m.name, sf);
                const isPriv = (m.modifiers || []).some(
                  (mod) => mod.kind === ts.SyntaxKind.PrivateKeyword || mod.kind === ts.SyntaxKind.ProtectedKeyword,
                );
                if (!isPriv && !mName.startsWith("#")) {
                  const tp = m.typeParameters ? `<${m.typeParameters.map((x) => x.getText(sf)).join(", ")}>` : "";
                  const params = m.parameters.map((p) => p.getText(sf).replace(/\s+/g, " ")).join(", ");
                  const ret = m.type ? `: ${m.type.getText(sf).replace(/\s+/g, " ")}` : "";
                  const mj = getJsDocFull(sf, m);
                  pubMethods.push({
                    name: mName,
                    sig: `${mName}${tp}(${params})${ret}`,
                    doc: mj.doc,
                    docBlocks: mj.docBlocks,
                    line: lineOf(sf, m.getStart(sf)),
                  });
                }
              }
            }

            const impls = [];
            for (const hc of st.heritageClauses || []) {
              if (hc.token === ts.SyntaxKind.ImplementsKeyword) {
                for (const t of hc.types) impls.push(t.expression.getText(sf));
              }
            }

            const clsJsd = getJsDocFull(sf, st);
            const fJsd = getFileTopJsDocFull(sf);
            const rec = {
              name,
              kind: isModule ? "module" : "component",
              pkg: pr.pkgName,
              pkgSub: pr.sub,
              area: pr.area,
              file: rel,
              line: lineOf(sf, st.getStart(sf)),
              doc: clsJsd.doc,
              docBlocks: clsJsd.docBlocks,
              fileDoc: fJsd.doc,
              fileDocBlocks: fJsd.docBlocks,
              children: Array.isArray(meta.children) ? meta.children.filter((x) => typeof x === "string") : [],
              exports: Array.isArray(meta.exports) ? meta.exports.filter((x) => typeof x === "string") : [],
              contributes: meta.contributes && typeof meta.contributes === "object" ? meta.contributes : {},
              context: contextRaw,
              uses,
              provides,
              binds,
              implements: impls,
              methods: pubMethods,
              rawDecl: extractClassDecl(st, sf, isModule ? "module" : "component"),
            };
            if (isModule) rawModules.push(rec);
            else rawComponents.push(rec);
          }

          if (isIface) {
            const members = [];
            for (const m of st.members) {
              if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) {
                const mName = propNameText(m.name, sf);
                const opt = m.questionToken ? "?" : "";
                const tp = m.typeParameters ? `<${m.typeParameters.map((x) => x.getText(sf)).join(", ")}>` : "";
                const params = m.parameters.map((p) => p.getText(sf).replace(/\s+/g, " ")).join(", ");
                const ret = m.type ? `: ${m.type.getText(sf).replace(/\s+/g, " ")}` : "";
                const mj = getJsDocFull(sf, m);
                members.push({
                  name: mName,
                  kind: "method",
                  sig: `${mName}${opt}${tp}(${params})${ret}`,
                  doc: mj.doc,
                  docBlocks: mj.docBlocks,
                  line: lineOf(sf, m.getStart(sf)),
                });
              } else if (ts.isPropertyDeclaration(m) || ts.isPropertySignature(m)) {
                const mName = propNameText(m.name, sf);
                const opt = m.questionToken ? "?" : "";
                const ro = (m.modifiers || []).some((mod) => mod.kind === ts.SyntaxKind.ReadonlyKeyword) ? "readonly " : "";
                const typ = m.type ? m.type.getText(sf).replace(/\s+/g, " ") : "unknown";
                const mj = getJsDocFull(sf, m);
                members.push({
                  name: mName,
                  kind: "property",
                  sig: `${ro}${mName}${opt}: ${typ}`,
                  doc: mj.doc,
                  docBlocks: mj.docBlocks,
                  line: lineOf(sf, m.getStart(sf)),
                });
              }
            }
            const ij = getJsDocFull(sf, st);
            rawIfaces.push({
              name,
              pkg: pr.pkgName,
              pkgSub: pr.sub,
              area: pr.area,
              file: rel,
              line: lineOf(sf, st.getStart(sf)),
              doc: ij.doc,
              docBlocks: ij.docBlocks,
              members,
              rawDecl: extractClassDecl(st, sf, "interface"),
            });
          }
        } else if (ts.isInterfaceDeclaration(st) && st.name && st.name.text.endsWith("Slots")) {
          const baseName = st.name.text.slice(0, -"Slots".length);
          const ifaceDoc = getJsDocFull(sf, st);
          for (const m of st.members) {
            if (ts.isPropertySignature(m) && m.name) {
              const prop = propNameText(m.name, sf);
              const { data, code } = parseSlotType(m.type, sf);
              const mj = getJsDocFull(sf, m);
              rawSlotIfaces.push({
                slotsIface: st.name.text,
                baseName,
                prop,
                data,
                code,
                doc: mj.doc,
                docBlocks: mj.docBlocks,
                parentDoc: ifaceDoc.doc,
                parentDocBlocks: ifaceDoc.docBlocks,
                pkg: pr.pkgName,
                area: pr.area,
                file: rel,
                line: lineOf(sf, m.getStart(sf)),
              });
            }
          }
        }
      }
      fileHostClasses.set(rel, hostClasses);
    }
  }

  const usedModSlugs = new Set();
  const areaPriority = { server: 0, cli: 1, core: 2, library: 3, plugin: 4, web: 5, package: 6 };
  rawModules.sort((a, b) => (areaPriority[a.area] ?? 9) - (areaPriority[b.area] ?? 9) || a.name.localeCompare(b.name));
  for (const m of rawModules) {
    let base = slugOf(m.name.replace(/Module$/, "") || m.name);
    if (m.name === "PlatformModule") base = "platform";
    if (m.name === "WebAppModule") base = "web-app";
    let slug = base;
    if (usedModSlugs.has(slug)) {
      const prefix = m.area === "web" ? "web" : m.area === "plugin" ? (m.file.includes("/web/") ? `${slugOf(m.pkgSub)}-web` : slugOf(m.pkgSub)) : slugOf(m.pkgSub);
      slug = `${prefix}-${base}`;
    }
    while (usedModSlugs.has(slug)) slug += "-2";
    usedModSlugs.add(slug);
    m.slug = slug;
  }

  const modsByName = new Map();
  for (const m of rawModules) {
    if (!modsByName.has(m.name)) modsByName.set(m.name, []);
    modsByName.get(m.name).push(m);
  }
  const compByName = new Map();
  for (const c of rawComponents) {
    c.slug = slugOf(c.name);
    compByName.set(c.name, c);
  }

  function resolveModuleFor(name, callerArea, callerFile) {
    const hits = modsByName.get(name);
    if (!hits || !hits.length) return null;
    if (hits.length === 1) return hits[0];
    const isCallerWeb = callerArea === "web" || callerFile.includes("/web/");
    return (
      hits.find((h) => (h.area === "web" || h.file.includes("/web/")) === isCallerWeb) ||
      hits.find((h) => h.area === callerArea) ||
      hits[0]
    );
  }

  for (const m of rawModules) {
    m.parents = [];
    m.resolvedChildren = [];
  }
  for (const c of rawComponents) c.parents = [];

  for (const m of rawModules) {
    for (const cname of m.children) {
      const childMod = resolveModuleFor(cname, m.area, m.file);
      if (childMod) {
        childMod.parents.push(m);
        m.resolvedChildren.push({ kind: "module", name: cname, target: childMod });
      } else if (compByName.has(cname)) {
        const comp = compByName.get(cname);
        comp.parents.push(m);
        m.resolvedChildren.push({ kind: "component", name: cname, target: comp });
      } else {
        m.resolvedChildren.push({ kind: "external", name: cname, target: null });
      }
    }
  }

  const cliMod = resolveModuleFor("CliCommandsModule", "cli", "packages/cli/src/cli-commands.ts");
  const shippedCliMod = resolveModuleFor("ShippedCommandsModule", "cli", "packages/cli/src/cli-modules.ts");
  for (const c of rawComponents) {
    if (c.parents.length === 0) {
      if (c.contributes["CliCommandsModule.commands"] && cliMod) {
        c.parents.push(cliMod);
        cliMod.resolvedChildren.push({ kind: "component", name: c.name, target: c, viaSlot: "CliCommandsModule.commands" });
      } else if (c.contributes["ShippedCommandsModule.commands"] && shippedCliMod) {
        c.parents.push(shippedCliMod);
        shippedCliMod.resolvedChildren.push({ kind: "component", name: c.name, target: c, viaSlot: "ShippedCommandsModule.commands" });
      }
    }
  }

  for (const c of rawComponents) {
    if (c.parents.length) {
      c.primaryParent = c.parents[0];
      c.href = `modules/${c.primaryParent.slug}/components/${c.slug}/`;
    } else {
      c.primaryParent = null;
      c.href = `modules/standalone/components/${c.slug}/`;
    }
  }

  for (const m of rawModules) {
    if (m.name === "PlatformModule" || m.name === "WebAppModule" || m.name === "CliCommandsModule") {
      m.isRoot = true;
    }
  }

  rawIfaces.sort((a, b) => (areaPriority[a.area] ?? 9) - (areaPriority[b.area] ?? 9) || a.name.localeCompare(b.name));
  const usedIfaceSlugs = new Set();
  for (const it of rawIfaces) {
    let slug = slugOf(it.name);
    if (usedIfaceSlugs.has(slug)) slug = `${slugOf(it.pkgSub)}-${slug}`;
    while (usedIfaceSlugs.has(slug)) slug += "-2";
    usedIfaceSlugs.add(slug);
    it.slug = slug;
  }

  // Full @prismshadow/penguin-core/kernel extraction (all 91 exports!)
  const kernel = extractKernelPackage(REPO, kernelImporters);

  const contribBySlot = new Map();
  for (const node of [...rawModules, ...rawComponents]) {
    for (const [slotKey, val] of Object.entries(node.contributes || {})) {
      if (!contribBySlot.has(slotKey)) contribBySlot.set(slotKey, []);
      const count = Array.isArray(val) ? val.length : 1;
      contribBySlot.get(slotKey).push({
        name: node.name,
        kind: node.kind,
        href: node.kind === "module" ? `modules/${node.slug}/` : node.href,
        count,
        entries: Array.isArray(val) ? val : [val],
        file: node.file,
        line: node.line,
      });
    }
  }

  const slotMap = new Map();
  for (const s of rawSlotIfaces) {
    const hosts = fileHostClasses.get(s.file) || [];
    let key = null;
    for (const h of hosts) {
      const cand = `${h.name}.${s.prop}`;
      if (contribBySlot.has(cand)) { key = cand; break; }
    }
    if (!key) {
      const modHost = hosts.find((h) => h.kind === "module" && h.name.startsWith(s.baseName)) || hosts.find((h) => h.kind === "module") || hosts[0];
      key = `${modHost ? modHost.name : s.baseName}.${s.prop}`;
    }
    const hostClass = key.split(".")[0];
    const hostMod = resolveModuleFor(hostClass, s.area, s.file);
    const hostComp = compByName.get(hostClass);
    slotMap.set(key, {
      key,
      slotsIface: s.slotsIface,
      prop: s.prop,
      host: hostClass,
      hostHref: hostMod ? `modules/${hostMod.slug}/` : hostComp ? hostComp.href : null,
      pkg: s.pkg,
      area: s.area,
      file: s.file,
      line: s.line,
      data: s.data,
      code: s.code,
      doc: s.doc.length ? s.doc : s.parentDoc.slice(0, 1),
      docBlocks: s.docBlocks.length ? s.docBlocks : s.parentDocBlocks.slice(0, 1),
      contributors: contribBySlot.get(key) || [],
    });
  }
  for (const [slotKey, contributors] of contribBySlot.entries()) {
    if (!slotMap.has(slotKey)) {
      const hostClass = slotKey.split(".")[0];
      const hostMod = modsByName.get(hostClass)?.[0];
      const hostComp = compByName.get(hostClass);
      slotMap.set(slotKey, {
        key: slotKey,
        slotsIface: null,
        prop: slotKey.split(".")[1] || slotKey,
        host: hostClass,
        hostHref: hostMod ? `modules/${hostMod.slug}/` : hostComp ? hostComp.href : null,
        pkg: hostMod?.pkg || hostComp?.pkg || "@prismshadow/penguin-server",
        area: hostMod?.area || hostComp?.area || "server",
        file: hostMod?.file || hostComp?.file || "",
        line: hostMod?.line || hostComp?.line || 1,
        data: "unknown",
        code: null,
        doc: [],
        docBlocks: [],
        contributors,
      });
    }
  }
  const slots = [...slotMap.values()].sort((a, b) => a.key.localeCompare(b.key));

  const httpContribs = [];
  for (const node of [...rawModules, ...rawComponents]) {
    const entries = node.contributes?.["HttpModule.routes"];
    if (!Array.isArray(entries) || !entries.length) continue;
    const cached = fileSfCache.get(node.file);
    let endpoints = cached ? extractEndpointsFromSf(cached.sf) : [];
    if (!endpoints.length && cached) {
      for (const st of cached.sf.statements) {
        if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
          const spec = st.moduleSpecifier.text;
          if (spec.startsWith("./") || spec.startsWith("../")) {
            const targetRel = path
              .normalize(path.join(path.dirname(node.file), spec.replace(/\.js$/, ".ts")))
              .replace(/\\/g, "/");
            const imp = fileSfCache.get(targetRel);
            if (imp) {
              const more = extractEndpointsFromSf(imp.sf);
              if (more.length) {
                endpoints = more.map((ep) => ({ ...ep, file: targetRel }));
                break;
              }
            }
          }
        }
      }
    }
    httpContribs.push({
      cls: node.name,
      slug: slugOf(node.name),
      kind: node.kind,
      nodeHref: node.kind === "module" ? `modules/${node.slug}/` : node.href,
      pkg: node.pkg,
      file: node.file,
      line: node.line,
      doc: node.doc,
      docBlocks: node.docBlocks,
      binds: node.binds,
      entries: entries.map((e) => ({
        id: String(e?.id ?? ""),
        prefix: String(e?.prefix ?? ""),
        auth: String(e?.auth ?? ""),
        order: e?.order ?? "",
        origin: e?.origin ? String(e.origin) : "",
      })),
      endpoints,
    });
  }
  httpContribs.sort((a, b) => a.cls.localeCompare(b.cls));

  const cliMap = new Map();
  const cliSlotKeys = [
    "CliCommandsModule.commands",
    "ShippedCommandsModule.commands",
    "CompanyCommandsModule.commands",
    "PluginCliCommandsProvider.commands",
  ];
  for (const node of [...rawModules, ...rawComponents]) {
    for (const sk of cliSlotKeys) {
      const list = node.contributes?.[sk];
      if (!Array.isArray(list)) continue;
      const cached = fileSfCache.get(node.file);
      const cmdInfo = cached ? extractCommanderInfo(cached.sf) : { commands: [], options: [], descriptions: [] };
      const topDoc = cached ? getFileTopJsDocFull(cached.sf) : { doc: [], docBlocks: [] };
      for (const entry of list) {
        const key = String(entry?.key || node.name);
        const slug = slugOf(key);
        const summaryEn = typeof entry?.summary === "object" ? entry.summary?.en : typeof entry?.summary === "string" ? entry.summary : "";
        const summaryZh = typeof entry?.summary === "object" ? entry.summary?.zh : "";
        cliMap.set(slug, {
          name: key,
          slug,
          id: String(entry?.id || ""),
          slot: sk,
          cls: node.name,
          nodeHref: node.kind === "module" ? `modules/${node.slug}/` : node.href,
          pkg: node.pkg,
          file: node.file,
          line: node.line,
          brief: summaryEn || summaryZh || cmdInfo.descriptions[0] || "",
          briefZh: summaryZh || "",
          doc: node.doc.length ? node.doc : topDoc.doc,
          docBlocks: node.docBlocks.length ? node.docBlocks : topDoc.docBlocks,
          subcommands: cmdInfo.commands,
          options: cmdInfo.options,
        });
      }
    }
  }
  const cliCmdDir = path.join(REPO, "packages/cli/src/commands");
  if (fs.existsSync(cliCmdDir)) {
    for (const f of fs.readdirSync(cliCmdDir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts")).sort()) {
      const slug = slugOf(f.replace(/\.ts$/, ""));
      const rel = `packages/cli/src/commands/${f}`;
      const cached = fileSfCache.get(rel);
      const cmdInfo = cached ? extractCommanderInfo(cached.sf) : { commands: [], options: [], descriptions: [] };
      const topDoc = cached ? getFileTopJsDocFull(cached.sf) : { doc: [], docBlocks: [] };
      if (!cliMap.has(slug)) {
        cliMap.set(slug, {
          name: f.replace(/\.ts$/, ""),
          slug,
          id: "",
          slot: "packages/cli/src/commands",
          cls: null,
          nodeHref: null,
          pkg: "@prismshadow/penguin-cli",
          file: rel,
          line: 1,
          brief: cmdInfo.descriptions[0] || topDoc.doc[0] || "",
          briefZh: "",
          doc: topDoc.doc,
          docBlocks: topDoc.docBlocks,
          subcommands: cmdInfo.commands,
          options: cmdInfo.options,
        });
      } else {
        const cur = cliMap.get(slug);
        if (!cur.subcommands.length && cmdInfo.commands.length) cur.subcommands = cmdInfo.commands;
        if (!cur.options.length && cmdInfo.options.length) cur.options = cmdInfo.options;
        if (!cur.doc.length && topDoc.doc.length) {
          cur.doc = topDoc.doc;
          cur.docBlocks = topDoc.docBlocks;
        }
      }
    }
  }
  const cliCommands = [...cliMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    repo: REPO,
    git: { sha: gitSha, date: gitDate, subject: gitSubject },
    modules: rawModules,
    components: rawComponents,
    ifaces: rawIfaces,
    kernel,
    slots,
    httpContribs,
    cliCommands,
  };
}

if (process.argv.includes("--stats")) {
  const repo = process.env.PENGUIN_REFS_REPO || path.join(HERE, "..", "worktrees", "refs-main");
  const t0 = Date.now();
  const d = extractAll(repo);
  const kWithDoc = d.kernel.exports.filter((e) => e.doc.length).length;
  const kKinds = {};
  for (const e of d.kernel.exports) kKinds[e.kind] = (kKinds[e.kind] || 0) + 1;
  console.log(`Extracted in ${Date.now() - t0}ms from ${d.git.sha}`);
  console.log(`Kernel exports: ${d.kernel.exports.length} (with JSDoc: ${kWithDoc}), kinds:`, kKinds);
  console.log("Top imported kernel symbols:", [...d.kernel.exports].sort((a, b) => b.importers.length - a.importers.length).slice(0, 12).map((e) => `${e.name}(${e.importers.length})`).join(", "));
  const te = d.kernel.exports.find((e) => e.name === "TypeExpr");
  const iface = d.kernel.exports.find((e) => e.name === "Interface");
  console.log("TypeExpr variants:", te?.variants.length, "with doc:", te?.variants.filter((v) => v.doc.length).length);
  console.log("Interface docBlocks kinds:", iface?.docBlocks.map((b) => b.kind));
}
