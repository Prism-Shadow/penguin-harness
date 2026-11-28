import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  cleanTypeWs,
  EMPTY_DOC,
  extractFileTopJsDoc,
  extractJsDoc,
  parseRawJsDocComment,
  slugOf,
} from "./jsdoc.js";
import type {
  AreaKind,
  BindField,
  CliCommandRecord,
  CliOption,
  ComponentRecord,
  ExtractedData,
  HttpContribRecord,
  HttpEndpoint,
  IfaceRecord,
  KernelExport,
  KernelExportKind,
  MemberItem,
  ModuleRecord,
  ParamItem,
  ParsedDoc,
  ProvideField,
  SlotContributor,
  SlotRecord,
  UnionVariant,
  UseField,
} from "./types.js";

const IGNORED_DIRS = new Set(["node_modules", "dist", "__tests__"]);
const KERNEL_DECORATORS = new Set(["Module", "Component", "Use", "Provide", "Bind", "Interface"]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "ALL", "HEAD", "OPTIONS"]);
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);
const AREA_PRIORITY: Record<AreaKind, number> = {
  server: 0,
  cli: 1,
  core: 2,
  library: 3,
  plugin: 4,
  web: 5,
  package: 6,
};

const TS_PRINTER = ts.createPrinter({ removeComments: true });
const SYNTH_SF = ts.createSourceFile(
  "__synth.ts",
  "",
  ts.ScriptTarget.Latest,
  false,
  ts.ScriptKind.TS,
);

function toPosixRel(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

function isPathInsideOrEqual(parentDir: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(parentDir), path.resolve(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function isSourceTsFile(name: string): boolean {
  const ext = path.extname(name);
  if (ext !== ".ts" && ext !== ".tsx" && ext !== ".mts" && ext !== ".cts") return false;
  if (name.endsWith(".d.ts") || name.endsWith(".d.mts") || name.endsWith(".d.cts")) return false;
  if (
    name.endsWith(".test.ts") ||
    name.endsWith(".test.tsx") ||
    name.endsWith(".spec.ts") ||
    name.endsWith(".spec.tsx")
  ) {
    return false;
  }
  return true;
}

function walkTs(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTs(full, out);
    } else if (isSourceTsFile(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

/** Resolve decorator callee through TypeChecker aliases so `import { Module as M }` and `kernel.Module` resolve accurately. */
function decName(dec: ts.Decorator, sf: ts.SourceFile, checker: ts.TypeChecker): string {
  const expr = ts.isCallExpression(dec.expression) ? dec.expression.expression : dec.expression;
  const targetNode = ts.isPropertyAccessExpression(expr) ? expr.name : expr;
  const sym = checker.getSymbolAtLocation(targetNode);
  if (sym) {
    const resolved = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    if (resolved && resolved.getName() !== "unknown") return resolved.getName();
  }
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isIdentifier(expr)) return expr.text;
  return expr.getText(sf);
}

function propNameText(nameNode: ts.PropertyName, sf: ts.SourceFile): string {
  if (
    ts.isIdentifier(nameNode) ||
    ts.isStringLiteral(nameNode) ||
    ts.isNumericLiteral(nameNode) ||
    ts.isPrivateIdentifier(nameNode)
  ) {
    return nameNode.text;
  }
  if (ts.isComputedPropertyName(nameNode)) {
    const expr = nameNode.expression;
    if (
      ts.isStringLiteral(expr) ||
      ts.isNumericLiteral(expr) ||
      ts.isNoSubstitutionTemplateLiteral(expr)
    ) {
      return expr.text;
    }
  }
  return printNode(nameNode, sf);
}

function hasMod(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function isNonPublic(node: ts.Node, nameNode?: ts.PropertyName): boolean {
  return (
    Boolean(nameNode && ts.isPrivateIdentifier(nameNode)) ||
    hasMod(node, ts.SyntaxKind.PrivateKeyword) ||
    hasMod(node, ts.SyntaxKind.ProtectedKeyword)
  );
}

function printNode(node: ts.Node, sf: ts.SourceFile): string {
  return cleanTypeWs(TS_PRINTER.printNode(ts.EmitHint.Unspecified, node, sf));
}

function extractParams(
  params: ts.NodeArray<ts.ParameterDeclaration>,
  sf: ts.SourceFile,
): ParamItem[] {
  return params.map((p) => ({
    name: p.name.getText(sf),
    optional: Boolean(p.questionToken || p.initializer),
    rest: Boolean(p.dotDotDotToken) || undefined,
    type: p.type ? cleanTypeWs(p.type.getText(sf)) : "unknown",
    defaultVal: p.initializer ? cleanTypeWs(p.initializer.getText(sf)) : "",
  }));
}

/** Extract referenced type names directly from a `ts.TypeNode` AST (no regex slicing on printed type strings). */
function extractTypeRefNames(typeNode: ts.TypeNode | undefined, checker: ts.TypeChecker): string[] {
  if (!typeNode) return [];
  const names = new Set<string>();
  const addRef = (typeName: ts.EntityName): void => {
    const rightText = ts.isQualifiedName(typeName) ? typeName.right.text : typeName.text;
    names.add(rightText);
    const sym = checker.getSymbolAtLocation(typeName);
    if (sym) {
      const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
      const targetName = target.getName();
      if (targetName && targetName !== "unknown") names.add(targetName);
    }
  };
  const visit = (n: ts.TypeNode): void => {
    if (ts.isTypeReferenceNode(n)) {
      addRef(n.typeName);
    } else if (ts.isImportTypeNode(n) && n.qualifier) {
      addRef(n.qualifier);
    } else if (ts.isUnionTypeNode(n) || ts.isIntersectionTypeNode(n)) {
      for (const branch of n.types) visit(branch);
    } else if (ts.isParenthesizedTypeNode(n)) {
      visit(n.type);
    } else if (ts.isTypeOperatorNode(n)) {
      visit(n.type);
    } else if (ts.isArrayTypeNode(n)) {
      visit(n.elementType);
    }
  };
  visit(typeNode);
  return [...names];
}

function evalExpr(
  node: ts.Expression | undefined,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
  seen = new Set<ts.Node>(),
): unknown {
  if (!node || seen.has(node)) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  if (ts.isIdentifier(node)) {
    // Follow `const` bindings (including const aliases like `const alias = values;`) with cycle-safe path tracking
    const decl = resolveIdentifierDecl(node, checker);
    if (
      decl &&
      ts.isVariableDeclaration(decl) &&
      decl.initializer &&
      !seen.has(decl) &&
      (ts.isIdentifier(decl.initializer) ||
        ts.isArrayLiteralExpression(decl.initializer) ||
        ts.isObjectLiteralExpression(decl.initializer) ||
        ts.isStringLiteral(decl.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(decl.initializer) ||
        ts.isNumericLiteral(decl.initializer) ||
        ts.isAsExpression(decl.initializer) ||
        ts.isSatisfiesExpression(decl.initializer) ||
        ts.isParenthesizedExpression(decl.initializer))
    ) {
      seen.add(decl);
      try {
        return evalExpr(decl.initializer, decl.getSourceFile(), checker, seen);
      } finally {
        seen.delete(decl);
      }
    }
    return node.text;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const out: unknown[] = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) {
        const spreadVal = evalExpr(el.expression, sf, checker, seen);
        if (Array.isArray(spreadVal)) out.push(...spreadVal);
      } else {
        out.push(evalExpr(el, sf, checker, seen));
      }
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const obj: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        obj[propNameText(prop.name, sf)] = evalExpr(prop.initializer, sf, checker, seen);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        const valSym = checker.getShorthandAssignmentValueSymbol(prop);
        const target =
          valSym && valSym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(valSym) : valSym;
        const decl = target?.valueDeclaration ?? target?.declarations?.[0];
        if (
          decl &&
          ts.isVariableDeclaration(decl) &&
          decl.initializer &&
          !seen.has(decl) &&
          (ts.isIdentifier(decl.initializer) ||
            ts.isArrayLiteralExpression(decl.initializer) ||
            ts.isObjectLiteralExpression(decl.initializer) ||
            ts.isStringLiteral(decl.initializer) ||
            ts.isNoSubstitutionTemplateLiteral(decl.initializer) ||
            ts.isNumericLiteral(decl.initializer) ||
            ts.isAsExpression(decl.initializer) ||
            ts.isSatisfiesExpression(decl.initializer) ||
            ts.isParenthesizedExpression(decl.initializer))
        ) {
          seen.add(decl);
          try {
            obj[prop.name.text] = evalExpr(decl.initializer, decl.getSourceFile(), checker, seen);
          } finally {
            seen.delete(decl);
          }
        } else {
          obj[prop.name.text] = prop.name.text;
        }
      } else if (ts.isSpreadAssignment(prop)) {
        const spreadVal = evalExpr(prop.expression, sf, checker, seen);
        if (spreadVal && typeof spreadVal === "object" && !Array.isArray(spreadVal)) {
          Object.assign(obj, spreadVal);
        }
      }
    }
    return obj;
  }
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return evalExpr(node.expression, sf, checker, seen);
  }
  return node.getText(sf);
}

function memberFromDecl(
  m: ts.ClassElement | ts.TypeElement,
  sf: ts.SourceFile,
  includeConstructors: boolean,
): MemberItem | null {
  if (includeConstructors && ts.isConstructorDeclaration(m)) {
    const params = extractParams(m.parameters, sf);
    const mp = m.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(", ");
    return {
      name: "constructor",
      kind: "method",
      sig: `constructor(${mp})`,
      params,
      returnType: "",
      doc: extractJsDoc(m, sf),
      line: lineOf(sf, m.getStart(sf)),
    };
  }

  if ((ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) && m.name) {
    if (isNonPublic(m, m.name)) return null;
    const mName = propNameText(m.name, sf);
    const printedName = printNode(m.name, sf);
    const isAsync = ts.isMethodDeclaration(m) && hasMod(m, ts.SyntaxKind.AsyncKeyword);
    const isGen = ts.isMethodDeclaration(m) && Boolean(m.asteriskToken);
    const opt = m.questionToken ? "?" : "";
    const tp = m.typeParameters
      ? `<${m.typeParameters.map((x) => cleanTypeWs(x.getText(sf))).join(", ")}>`
      : "";
    const params = extractParams(m.parameters, sf);
    const paramText = m.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(", ");
    const returnType = m.type ? cleanTypeWs(m.type.getText(sf)) : "";
    return {
      name: mName,
      kind: "method",
      sig: `${isAsync ? "async " : ""}${isGen ? "*" : ""}${printedName}${opt}${tp}(${paramText})${returnType ? `: ${returnType}` : ""}`,
      params,
      returnType,
      doc: extractJsDoc(m, sf),
      line: lineOf(sf, m.getStart(sf)),
    };
  }

  if ((ts.isPropertyDeclaration(m) || ts.isPropertySignature(m)) && m.name) {
    if (isNonPublic(m, m.name)) return null;
    const mName = propNameText(m.name, sf);
    const printedName = printNode(m.name, sf);
    const opt = m.questionToken ? "?" : "";
    const ro = hasMod(m, ts.SyntaxKind.ReadonlyKeyword) ? "readonly " : "";
    const typ = m.type ? cleanTypeWs(m.type.getText(sf)) : "unknown";
    return {
      name: mName,
      kind: "property",
      sig: `${ro}${printedName}${opt}: ${typ}`,
      params: [],
      returnType: typ,
      doc: extractJsDoc(m, sf),
      line: lineOf(sf, m.getStart(sf)),
    };
  }
  return null;
}

function extractMembers(
  members: ts.NodeArray<ts.ClassElement> | ts.NodeArray<ts.TypeElement>,
  sf: ts.SourceFile,
  includeConstructors: boolean,
): MemberItem[] {
  const out: MemberItem[] = [];
  for (const m of members) {
    const item = memberFromDecl(m, sf, includeConstructors);
    if (item) out.push(item);
  }
  return out;
}

/** Remove top-level `undefined` from a TypeScript `UnionTypeNode` AST (never regex-splitting type strings). */
function stripUndefinedFromTypeNode(typeNode: ts.TypeNode): ts.TypeNode {
  if (!ts.isUnionTypeNode(typeNode)) return typeNode;
  const kept = typeNode.types.filter((t) => t.kind !== ts.SyntaxKind.UndefinedKeyword);
  if (kept.length === 0) return typeNode;
  if (kept.length === 1 && kept[0]) return kept[0];
  return ts.factory.createUnionTypeNode(kept);
}

/** Extract resolved property/method members from any TypeScript Type via TypeChecker (handles Omit, Pick, Partial, Readonly, extends, intersections, overloads, and generics natively). */
function extractMembersFromType(
  type: ts.Type,
  checker: ts.TypeChecker,
  location: ts.Node,
): MemberItem[] {
  const locSf = location.getSourceFile();
  const synthNode = checker.typeToTypeNode(type, location, ts.NodeBuilderFlags.NoTruncation);
  const synthMembersByName = new Map<string, ts.TypeElement[]>();
  if (synthNode && ts.isTypeLiteralNode(synthNode)) {
    for (const m of synthNode.members) {
      if ((ts.isPropertySignature(m) || ts.isMethodSignature(m)) && m.name) {
        const key = propNameText(m.name, locSf);
        const list = synthMembersByName.get(key) ?? [];
        list.push(m);
        synthMembersByName.set(key, list);
      }
    }
  }

  const out: MemberItem[] = [];
  for (const propSym of type.getProperties()) {
    const name = propSym.getName();
    const decl = propSym.valueDeclaration ?? propSym.declarations?.[0];
    const sf = decl?.getSourceFile();
    const doc = decl && sf ? extractJsDoc(decl, sf) : EMPTY_DOC;
    const line = decl && sf ? lineOf(sf, decl.getStart(sf)) : 1;
    const isOptional = Boolean(propSym.flags & ts.SymbolFlags.Optional);

    const synths = synthMembersByName.get(name);
    if (synths && synths.length > 0) {
      for (const synth of synths) {
        if (ts.isMethodSignature(synth)) {
          const params: ParamItem[] = synth.parameters.map((p) => ({
            name: printNode(p.name, locSf),
            optional: Boolean(p.questionToken || p.initializer),
            rest: Boolean(p.dotDotDotToken) || undefined,
            type: p.type ? printNode(p.type, locSf) : "unknown",
            defaultVal: p.initializer ? printNode(p.initializer, locSf) : "",
          }));
          const retStr = synth.type ? printNode(synth.type, locSf) : "unknown";
          const sig = printNode(synth, locSf).replace(/;$/, "");
          out.push({
            name,
            kind: "method",
            sig,
            params,
            returnType: retStr,
            doc,
            line,
          });
        } else if (ts.isPropertySignature(synth)) {
          const typStr = synth.type ? printNode(synth.type, locSf) : "unknown";
          const sig = printNode(synth, locSf).replace(/;$/, "");
          out.push({
            name,
            kind: "property",
            sig,
            params: [],
            returnType: typStr,
            doc,
            line,
          });
        }
      }
      continue;
    }

    // Fallback: format via TypeChecker AST (`typeToTypeNode` + AST-level `undefined` removal)
    const propType = checker.getTypeOfSymbolAtLocation(propSym, location);
    const callSigs = propType.getCallSignatures();
    const rawTypNode = checker.typeToTypeNode(propType, location, ts.NodeBuilderFlags.NoTruncation);
    const cleanedNode =
      isOptional && rawTypNode ? stripUndefinedFromTypeNode(rawTypNode) : rawTypNode;
    const typStr = cleanedNode
      ? printNode(cleanedNode, locSf)
      : cleanTypeWs(checker.typeToString(propType, location, ts.TypeFormatFlags.NoTruncation));
    const ro = decl && hasMod(decl, ts.SyntaxKind.ReadonlyKeyword) ? "readonly " : "";
    const firstCallSig = callSigs[0];
    const params: ParamItem[] = firstCallSig
      ? firstCallSig.getParameters().map((ps) => {
          const pDecl = ps.valueDeclaration;
          const pType = checker.getTypeOfSymbolAtLocation(ps, location);
          const pNode = checker.typeToTypeNode(pType, location, ts.NodeBuilderFlags.NoTruncation);
          return {
            name: ps.getName(),
            optional: Boolean(ps.flags & ts.SymbolFlags.Optional),
            rest: Boolean(pDecl && ts.isParameter(pDecl) && pDecl.dotDotDotToken) || undefined,
            type: pNode
              ? printNode(pNode, locSf)
              : cleanTypeWs(checker.typeToString(pType, location, ts.TypeFormatFlags.NoTruncation)),
            defaultVal: "",
          };
        })
      : [];
    out.push({
      name,
      kind: callSigs.length > 0 ? "method" : "property",
      sig: `${ro}${name}${isOptional ? "?" : ""}: ${typStr}`,
      params,
      returnType: typStr,
      doc,
      line,
    });
  }
  return out;
}

function extractClassDecl(
  st: ts.ClassDeclaration,
  sf: ts.SourceFile,
  kind: "module" | "component" | "interface" | "class",
  checker: ts.TypeChecker,
): string {
  const decs = getDecorators(st).map((d) => d.getText(sf));
  const mods = (ts.canHaveModifiers(st) ? (ts.getModifiers(st) ?? []) : [])
    .map((m) => m.getText(sf))
    .join(" ");
  const heritage = st.heritageClauses
    ? ` ${st.heritageClauses.map((h) => h.getText(sf)).join(" ")}`
    : "";
  const typeParams = st.typeParameters
    ? `<${st.typeParameters.map((tp) => tp.getText(sf)).join(", ")}>`
    : "";
  const name = st.name?.text ?? "Anonymous";
  const header = `${decs.length ? `${decs.join("\n")}\n` : ""}${mods ? `${mods} ` : ""}class ${name}${typeParams}${heritage}`;

  if (kind === "interface") {
    const bodyLines = st.members.map((m) => `  ${m.getText(sf).trim().replace(/\r?\n/g, "\n  ")}`);
    return bodyLines.length ? `${header} {\n${bodyLines.join("\n")}\n}` : `${header} {}`;
  }

  const bodyLines: string[] = [];
  for (const m of st.members) {
    const mDecNames = getDecorators(m).map((d) => decName(d, sf, checker));
    if (ts.isConstructorDeclaration(m)) {
      const params = m.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(", ");
      bodyLines.push(`  constructor(${params});`);
    } else if (
      ts.isPropertyDeclaration(m) &&
      (kind === "class" || mDecNames.some((n) => n === "Use" || n === "Provide" || n === "Bind"))
    ) {
      if (kind !== "class" || !isNonPublic(m, m.name)) {
        bodyLines.push(`  ${m.getText(sf).trim().replace(/\r?\n/g, "\n  ")}`);
      }
    } else if (ts.isMethodDeclaration(m) && m.name) {
      if (isNonPublic(m, m.name)) continue;
      const mMods = (ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : [])
        .map((mod) => mod.getText(sf))
        .join(" ");
      const star = m.asteriskToken ? "*" : "";
      const printedName = printNode(m.name, sf);
      const tp = m.typeParameters
        ? `<${m.typeParameters.map((x) => x.getText(sf)).join(", ")}>`
        : "";
      const params = m.parameters.map((p) => p.getText(sf)).join(", ");
      const ret = m.type ? `: ${m.type.getText(sf)}` : "";
      bodyLines.push(`  ${mMods ? `${mMods} ` : ""}${star}${printedName}${tp}(${params})${ret};`);
    } else if (ts.isGetAccessorDeclaration(m) && m.name) {
      if (isNonPublic(m, m.name)) continue;
      const printedName = printNode(m.name, sf);
      const ret = m.type ? `: ${m.type.getText(sf)}` : "";
      bodyLines.push(`  get ${printedName}()${ret};`);
    } else if (ts.isSetAccessorDeclaration(m) && m.name) {
      if (isNonPublic(m, m.name)) continue;
      const printedName = printNode(m.name, sf);
      const params = m.parameters.map((p) => p.getText(sf)).join(", ");
      bodyLines.push(`  set ${printedName}(${params});`);
    }
  }
  return bodyLines.length ? `${header} {\n${bodyLines.join("\n")}\n}` : `${header} {}`;
}

/* ---------- TypeChecker Symbol Resolution ---------- */

function resolveIdentifierDecl(ident: ts.Identifier, checker: ts.TypeChecker): ts.Node | null {
  const sym = checker.getSymbolAtLocation(ident);
  if (!sym) return null;
  const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  const decl = target.valueDeclaration ?? target.declarations?.[0];
  return decl ?? null;
}

function extractEndpointsFromNode(
  root: ts.Node,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): HttpEndpoint[] {
  const eps: HttpEndpoint[] = [];
  const seen = new Set<string>();
  const record = (meth: string, p: string, line: number): void => {
    if (!HTTP_METHODS.has(meth) || (!p.startsWith("/") && p !== "*")) return;
    const key = `${meth} ${p}`;
    if (!seen.has(key)) {
      seen.add(key);
      eps.push({ method: meth, path: p, line });
    }
  };
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methRaw = node.expression.name.text.toUpperCase();
      const line = lineOf(sf, node.getStart(sf));
      if (methRaw === "ON" && node.arguments.length >= 3) {
        const methodsVal = evalExpr(node.arguments[0], sf, checker);
        const pathVal = evalExpr(node.arguments[1], sf, checker);
        const methods = Array.isArray(methodsVal)
          ? methodsVal.filter((x): x is string => typeof x === "string")
          : typeof methodsVal === "string"
            ? [methodsVal]
            : [];
        if (typeof pathVal === "string") {
          for (const m of methods) record(m.toUpperCase(), pathVal, line);
        }
      } else {
        const first = node.arguments[0];
        if (
          HTTP_METHODS.has(methRaw) &&
          node.arguments.length >= 2 &&
          first &&
          (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
        ) {
          record(methRaw, first.text, line);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return eps;
}

function findBoundTargetIdentifiers(
  clsNode: ts.ClassDeclaration,
  bindFields: ReadonlySet<string>,
  sf: ts.SourceFile,
): ts.Identifier[] {
  const idents: ts.Identifier[] = [];
  function collect(expr: ts.Expression): void {
    if (ts.isCallExpression(expr)) {
      if (ts.isIdentifier(expr.expression)) idents.push(expr.expression);
      else if (
        ts.isPropertyAccessExpression(expr.expression) &&
        ts.isIdentifier(expr.expression.name)
      ) {
        idents.push(expr.expression.name);
      }
      for (const a of expr.arguments) collect(a);
    } else if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
      const walkBody = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          if (ts.isIdentifier(n.expression)) idents.push(n.expression);
          else if (
            ts.isPropertyAccessExpression(n.expression) &&
            ts.isIdentifier(n.expression.name)
          ) {
            idents.push(n.expression.name);
          }
        }
        ts.forEachChild(n, walkBody);
      };
      walkBody(expr.body);
    } else if (ts.isIdentifier(expr)) {
      idents.push(expr);
    } else if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
      idents.push(expr.name);
    } else if (ts.isObjectLiteralExpression(expr)) {
      for (const p of expr.properties) {
        if (ts.isPropertyAssignment(p)) collect(p.initializer);
        else if (ts.isShorthandPropertyAssignment(p)) idents.push(p.name);
      }
    }
  }
  function assignedThisField(left: ts.Expression): string | null {
    if (ts.isPropertyAccessExpression(left) && left.expression.kind === ts.SyntaxKind.ThisKeyword) {
      return left.name.text;
    }
    if (
      ts.isElementAccessExpression(left) &&
      left.expression.kind === ts.SyntaxKind.ThisKeyword &&
      (ts.isStringLiteral(left.argumentExpression) ||
        ts.isNoSubstitutionTemplateLiteral(left.argumentExpression))
    ) {
      return left.argumentExpression.text;
    }
    return null;
  }
  function visit(n: ts.Node): void {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const field = assignedThisField(n.left);
      if (field && bindFields.has(field)) collect(n.right);
    } else if (
      ts.isPropertyDeclaration(n) &&
      n.name &&
      n.initializer &&
      bindFields.has(propNameText(n.name, sf))
    ) {
      collect(n.initializer);
    }
    ts.forEachChild(n, visit);
  }
  visit(clsNode);
  return idents;
}

/** Extract the pure command name (without Commander `<arg>` / `[opt]` positional syntax) for nested path ancestry. */
function commanderNameToken(rawSpec: string): string {
  const trimmed = rawSpec.trim();
  const wsIdx = trimmed.search(/[ \t]/);
  return wsIdx === -1 ? trimmed : trimmed.slice(0, wsIdx);
}

function appendCmdSegments(parent: readonly string[], rawSub: string): string[] {
  const cleanSub = rawSub.trim();
  if (!cleanSub) return [...parent];
  const subName = commanderNameToken(cleanSub);
  return [...parent, subName];
}

function formatCmdDisplay(parent: readonly string[], rawSub: string): string {
  const cleanSub = rawSub.trim();
  if (parent.length === 0) return cleanSub;
  if (!cleanSub) return parent.join(" ");
  return `${parent.join(" ")} ${cleanSub}`;
}

function extractCommanderInfo(
  root: ts.Node,
  checker: ts.TypeChecker,
  rootSegments: readonly string[] = [],
  visited = new Set<string>(),
  depth = 0,
  cmdParamIdx = 0,
): {
  commands: string[];
  options: CliOption[];
  descriptions: string[];
} {
  if (depth > 6) return { commands: [], options: [], descriptions: [] };
  const sf = root.getSourceFile();
  const visitKey = `${sf.fileName}:${root.pos}:${rootSegments.join("\0")}:${cmdParamIdx}`;
  if (visited.has(visitKey)) return { commands: [], options: [], descriptions: [] };
  visited.add(visitKey);

  const commands: string[] = [];
  const options: CliOption[] = [];
  const descriptions: string[] = [];
  const varPaths = new Map<string, readonly string[]>();

  const seedParam = (params: ts.NodeArray<ts.ParameterDeclaration>): void => {
    const param = params[cmdParamIdx];
    if (param && ts.isIdentifier(param.name)) varPaths.set(param.name.text, rootSegments);
  };
  if (ts.isFunctionDeclaration(root) || ts.isArrowFunction(root) || ts.isFunctionExpression(root)) {
    seedParam(root.parameters);
  } else if (
    ts.isVariableDeclaration(root) &&
    root.initializer &&
    (ts.isArrowFunction(root.initializer) || ts.isFunctionExpression(root.initializer))
  ) {
    seedParam(root.initializer.parameters);
  }

  const resolveExprPath = (expr: ts.Expression): readonly string[] | null => {
    if (ts.isIdentifier(expr)) {
      return varPaths.get(expr.text) ?? null;
    }
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) {
      return resolveExprPath(expr.expression);
    }
    if (
      ts.isNewExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === "Command"
    ) {
      const arg0 = expr.arguments?.[0];
      if (arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) {
        return appendCmdSegments(rootSegments, arg0.text);
      }
      return rootSegments;
    }
    if (ts.isCallExpression(expr)) {
      if (ts.isPropertyAccessExpression(expr.expression)) {
        const meth = expr.expression.name.text;
        const parentPath = resolveExprPath(expr.expression.expression);
        if (meth === "command") {
          const arg0 = expr.arguments[0];
          if (arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) {
            return appendCmdSegments(parentPath ?? rootSegments, arg0.text);
          }
        }
        const isSetterWithArg =
          expr.arguments.length > 0 &&
          (meth === "description" ||
            meth === "alias" ||
            meth === "summary" ||
            meth === "usage" ||
            meth === "version");
        const isChainableBuilder =
          meth === "option" ||
          meth === "requiredOption" ||
          meth === "addOption" ||
          meth === "addCommand" ||
          meth === "argument" ||
          meth === "action" ||
          meth === "addHelpText" ||
          meth === "allowUnknownOption" ||
          meth === "passThroughOptions" ||
          meth === "configureHelp" ||
          meth === "showHelpAfterError";
        if (parentPath !== null && (isSetterWithArg || isChainableBuilder)) {
          return parentPath;
        }
        return null;
      }
      for (const a of expr.arguments) {
        const p = resolveExprPath(a);
        if (p !== null) return p;
      }
    }
    return null;
  };

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const boundPath = resolveExprPath(node.initializer);
      if (boundPath !== null) varPaths.set(node.name.text, boundPath);
    }

    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text;
        const arg0 = node.arguments[0];
        const arg1 = node.arguments[1];
        const receiverSegs = resolveExprPath(node.expression.expression) ?? rootSegments;
        const receiverDisplay = receiverSegs.join(" ");

        if (name === "addCommand" && arg0) {
          const subSegs = resolveExprPath(arg0);
          if (subSegs && subSegs.length > rootSegments.length) {
            commands.push(subSegs.join(" "));
          }
        } else if (
          name === "addOption" &&
          arg0 &&
          ts.isNewExpression(arg0) &&
          ts.isIdentifier(arg0.expression) &&
          arg0.expression.text === "Option"
        ) {
          const fArg = arg0.arguments?.[0];
          const dArg = arg0.arguments?.[1];
          if (fArg && (ts.isStringLiteral(fArg) || ts.isNoSubstitutionTemplateLiteral(fArg))) {
            const desc =
              dArg && (ts.isStringLiteral(dArg) || ts.isNoSubstitutionTemplateLiteral(dArg))
                ? dArg.text
                : "";
            options.push({
              flag: fArg.text,
              desc,
              required: false,
              command: receiverDisplay || undefined,
            });
          }
        } else if (arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) {
          if (name === "command") {
            commands.push(formatCmdDisplay(receiverSegs, arg0.text));
          } else if (name === "description") {
            descriptions.push(arg0.text);
          } else if (name === "option" || name === "requiredOption") {
            const desc =
              arg1 && (ts.isStringLiteral(arg1) || ts.isNoSubstitutionTemplateLiteral(arg1))
                ? arg1.text
                : "";
            options.push({
              flag: arg0.text,
              desc,
              required: name === "requiredOption",
              command: receiverDisplay || undefined,
            });
          }
        }
      } else if (ts.isIdentifier(node.expression) && node.arguments.length > 0) {
        let cmdArgIdx = -1;
        let cmdArgSegs: readonly string[] | null = null;
        for (let i = 0; i < node.arguments.length; i++) {
          const arg = node.arguments[i];
          const p = arg ? resolveExprPath(arg) : null;
          if (p !== null) {
            cmdArgIdx = i;
            cmdArgSegs = p;
            break;
          }
        }
        if (cmdArgSegs !== null && cmdArgIdx !== -1) {
          const targetDecl = resolveIdentifierDecl(node.expression, checker);
          if (targetDecl) {
            const sub = extractCommanderInfo(
              targetDecl,
              checker,
              cmdArgSegs,
              visited,
              depth + 1,
              cmdArgIdx,
            );
            commands.push(...sub.commands);
            options.push(...sub.options);
            descriptions.push(...sub.descriptions);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return { commands, options, descriptions };
}

/** Resolve `Slot<Data, Code>` via TypeChecker aliases (`import type { Slot as KernelSlot }`) and `TypeFlags.Never`. */
function parseSlotType(
  typeNode: ts.TypeNode | undefined,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): { data: string; code: string | null } {
  if (!typeNode) return { data: "unknown", code: null };
  if (ts.isTypeReferenceNode(typeNode)) {
    const sym = checker.getSymbolAtLocation(typeNode.typeName);
    const resolved = sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const isSlot =
      resolved?.getName() === "Slot" ||
      (ts.isIdentifier(typeNode.typeName) && typeNode.typeName.text === "Slot");
    if (isSlot) {
      const args = typeNode.typeArguments ?? [];
      const data = args[0] ? cleanTypeWs(args[0].getText(sf)) : "unknown";
      const codeArg = args[1];
      if (!codeArg) return { data, code: null };
      const codeType = checker.getTypeFromTypeNode(codeArg);
      const isNever =
        codeArg.kind === ts.SyntaxKind.NeverKeyword || Boolean(codeType.flags & ts.TypeFlags.Never);
      return { data, code: isNever ? null : cleanTypeWs(codeArg.getText(sf)) };
    }
  }
  return { data: cleanTypeWs(typeNode.getText(sf)), code: null };
}

/** Match kernel `splitSlotKey` (`packages/core/src/kernel/manifest.ts`): splits on the LAST dot and validates both halves. */
function splitSlotKey(key: string): { module: string; slot: string } | null {
  const dot = key.lastIndexOf(".");
  if (dot <= 0 || dot === key.length - 1) return null;
  const mod = key.slice(0, dot);
  const slot = key.slice(dot + 1);
  if (!mod || !slot) return null;
  return { module: mod, slot };
}

/* ---------- @prismshadow/penguin-core/kernel Extraction via Official TypeScript Program + TypeChecker ---------- */

function sanitizeKernelSlug(rawName: string): string {
  let candidate = /^[A-Za-z0-9_$][A-Za-z0-9_$.-]*$/.test(rawName) ? rawName : slugOf(rawName);
  candidate = candidate.replace(/[. ]+$/, "");
  if (!candidate || candidate === "." || candidate === ".." || /[/\\]/.test(candidate)) {
    candidate = slugOf(rawName);
  }
  const stem = candidate.split(".")[0]?.toLowerCase() ?? "";
  if (WINDOWS_RESERVED_NAMES.has(stem)) {
    candidate = `_${candidate}`;
  }
  return candidate;
}

const STRICT_FORBIDDEN_BINDINGS = new Set(["eval", "arguments"]);

function isValidTsIdent(name: string): boolean {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    name,
  );
  return scanner.scan() === ts.SyntaxKind.Identifier && scanner.getTokenEnd() === name.length;
}

function isValidStrictLocalBinding(name: string): boolean {
  return isValidTsIdent(name) && !STRICT_FORBIDDEN_BINDINGS.has(name);
}

function toSafeLocalIdent(exportName: string): string {
  if (isValidStrictLocalBinding(exportName)) return exportName;
  const cleaned = slugOf(exportName).replace(/[^A-Za-z0-9_$]+/g, "_");
  if (cleaned && isValidStrictLocalBinding(cleaned)) return cleaned;
  return `_${cleaned || "export"}`;
}

function printKernelImportStmt(exportName: string, isTypeOnly: boolean): string {
  const localName = toSafeLocalIdent(exportName);
  const localIdent = ts.factory.createIdentifier(localName);
  const propName =
    localName === exportName
      ? undefined
      : isValidTsIdent(exportName)
        ? ts.factory.createIdentifier(exportName)
        : ts.factory.createStringLiteral(exportName);
  const spec = ts.factory.createImportSpecifier(false, propName, localIdent);
  const decl = ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(isTypeOnly, undefined, ts.factory.createNamedImports([spec])),
    ts.factory.createStringLiteral("@prismshadow/penguin-core/kernel"),
  );
  return TS_PRINTER.printNode(ts.EmitHint.Unspecified, decl, SYNTH_SF);
}

function printExternalReexportStmt(
  origName: string,
  exportName: string,
  fromLabel: string,
): string {
  const propNode =
    origName === exportName
      ? undefined
      : isValidTsIdent(origName)
        ? ts.factory.createIdentifier(origName)
        : ts.factory.createStringLiteral(origName);
  const nameNode = isValidTsIdent(exportName)
    ? ts.factory.createIdentifier(exportName)
    : ts.factory.createStringLiteral(exportName);
  const spec = ts.factory.createExportSpecifier(false, propNode, nameNode);
  const decl = ts.factory.createExportDeclaration(
    undefined,
    false,
    ts.factory.createNamedExports([spec]),
    ts.factory.createStringLiteral(fromLabel),
  );
  return TS_PRINTER.printNode(ts.EmitHint.Unspecified, decl, SYNTH_SF);
}

function extractKernelPackage(repo: string): { exports: KernelExport[] } {
  const kdir = path.join(repo, "packages/core/src/kernel");
  const idxPath = path.join(kdir, "index.ts");
  if (!fs.existsSync(idxPath)) return { exports: [] };

  const program = ts.createProgram([idxPath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const idxSf = program.getSourceFile(idxPath);
  if (!idxSf) return { exports: [] };

  interface BarrelEntry {
    name: string;
    isTypeOnly: boolean;
    specifier: ts.ExportSpecifier | null;
    stmt: ts.ExportDeclaration | null;
  }
  const barrelEntries: BarrelEntry[] = [];
  const seenBarrelNames = new Set<string>();
  for (const st of idxSf.statements) {
    if (!ts.isExportDeclaration(st) || !st.exportClause || !ts.isNamedExports(st.exportClause)) {
      continue;
    }
    for (const el of st.exportClause.elements) {
      const name = el.name.text;
      if (seenBarrelNames.has(name)) continue;
      seenBarrelNames.add(name);
      barrelEntries.push({
        name,
        isTypeOnly: Boolean(st.isTypeOnly || el.isTypeOnly),
        specifier: el,
        stmt: st,
      });
    }
  }

  // Track names exposed solely via `export type * from "..."` so they receive `import type`
  const valueStarNames = new Set<string>();
  const typeStarNames = new Set<string>();
  for (const st of idxSf.statements) {
    if (ts.isExportDeclaration(st) && !st.exportClause && st.moduleSpecifier) {
      const targetModSym = checker.getSymbolAtLocation(st.moduleSpecifier);
      if (!targetModSym) continue;
      for (const ms of checker.getExportsOfModule(targetModSym)) {
        if (st.isTypeOnly) typeStarNames.add(ms.getName());
        else valueStarNames.add(ms.getName());
      }
    }
  }

  // Authoritative export list from TypeChecker (captures `export *` and direct exports as well!)
  const indexModSym = checker.getSymbolAtLocation(idxSf);
  const modExports = indexModSym ? checker.getExportsOfModule(indexModSym) : [];
  const modExportByName = new Map(modExports.map((s) => [s.getName(), s]));
  for (const sym of modExports) {
    const name = sym.getName();
    if (seenBarrelNames.has(name)) continue;
    seenBarrelNames.add(name);
    const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const onlyViaTypeStar = typeStarNames.has(name) && !valueStarNames.has(name);
    const isTypeOnly =
      onlyViaTypeStar ||
      (Boolean(target.flags & ts.SymbolFlags.Type) && !(target.flags & ts.SymbolFlags.Value));
    barrelEntries.push({ name, isTypeOnly, specifier: null, stmt: null });
  }

  const canonicalSymToExportName = new Map<ts.Symbol, string>();
  const resolvedByName = new Map<
    string,
    {
      entry: BarrelEntry;
      targetSym: ts.Symbol | null;
      decl: ts.Declaration | null;
      externalFrom: string | null;
      externalReexpStmt: ts.ExportDeclaration | null;
      origName: string;
    }
  >();

  for (const entry of barrelEntries) {
    const expSym = modExportByName.get(entry.name);
    let targetSym: ts.Symbol | null = null;
    let externalFrom: string | null = null;
    let externalReexpStmt: ts.ExportDeclaration | null = null;
    let origName = entry.specifier?.propertyName ? entry.specifier.propertyName.text : entry.name;

    // Cycle-safe immediate alias walk (no fixed hop cap) with segment-boundary containment check
    const visitedSyms = new Set<ts.Symbol>();
    let curSym: ts.Symbol | undefined = expSym;
    while (curSym && !visitedSyms.has(curSym)) {
      visitedSyms.add(curSym);
      for (const d of curSym.declarations ?? []) {
        if (ts.isExportSpecifier(d) && isPathInsideOrEqual(kdir, d.getSourceFile().fileName)) {
          const expDecl = d.parent.parent;
          if (expDecl.moduleSpecifier && ts.isStringLiteral(expDecl.moduleSpecifier)) {
            const spec = expDecl.moduleSpecifier.text;
            if (!spec.startsWith(".")) {
              externalFrom = spec;
              externalReexpStmt = expDecl;
              origName = d.propertyName ? d.propertyName.text : d.name.text;
            }
          }
        }
      }
      if (!(curSym.flags & ts.SymbolFlags.Alias)) break;
      const next = checker.getImmediateAliasedSymbol(curSym);
      if (!next) break;
      curSym = next;
    }

    if (expSym) {
      try {
        targetSym = expSym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(expSym) : expSym;
      } catch {
        targetSym = expSym;
      }
    }
    const decl =
      targetSym?.valueDeclaration ??
      targetSym?.declarations?.find((d) => !ts.isExportSpecifier(d)) ??
      targetSym?.declarations?.[0] ??
      null;

    if (targetSym && !externalFrom) canonicalSymToExportName.set(targetSym, entry.name);
    resolvedByName.set(entry.name, {
      entry,
      targetSym,
      decl,
      externalFrom,
      externalReexpStmt,
      origName,
    });
  }

  const lowerCounts = new Map<string, number>();
  for (const entry of barrelEntries) {
    const lc = sanitizeKernelSlug(entry.name).toLowerCase();
    lowerCounts.set(lc, (lowerCounts.get(lc) ?? 0) + 1);
  }

  const exportsList: KernelExport[] = [];
  const declNodesByExportName = new Map<string, ts.Node>();

  for (const entry of barrelEntries) {
    const info = resolvedByName.get(entry.name);
    if (!info) continue;
    const { targetSym, decl, externalFrom, externalReexpStmt, origName } = info;
    const importStmt = printKernelImportStmt(entry.name, entry.isTypeOnly);

    if (externalFrom || !decl || !isPathInsideOrEqual(kdir, decl.getSourceFile().fileName)) {
      const reexpStmt = externalReexpStmt ?? entry.stmt ?? idxSf;
      const sf = reexpStmt.getSourceFile();
      const relFile = toPosixRel(repo, sf.fileName);
      const sourceFile = toPosixRel(kdir, sf.fileName);
      const jsd = reexpStmt === idxSf ? EMPTY_DOC : extractJsDoc(reexpStmt, sf);
      const fromLabel = externalFrom ?? "external";
      const fallback = `Re-exported from \`${fromLabel}\` for defining versioned context schemas passed to \`schema()\`.`;
      exportsList.push({
        name: entry.name,
        slug: entry.name,
        isTypeOnly: entry.isTypeOnly,
        kind: "function",
        sourceFile,
        file: relFile,
        line: reexpStmt === idxSf ? 1 : lineOf(sf, reexpStmt.getStart(sf)),
        importStmt,
        sig: printExternalReexportStmt(origName, entry.name, fromLabel),
        doc: jsd.markdown ? jsd : { markdown: fallback, summary: fallback, tags: [] },
        params: [],
        returnType: "",
        members: [],
        variants: [],
        expandedOptions: null,
        references: [],
      });
      continue;
    }

    const sf = decl.getSourceFile();
    const sourceFile = toPosixRel(kdir, sf.fileName);
    const rel = toPosixRel(repo, sf.fileName);
    const stmtNode =
      ts.isVariableDeclaration(decl) && ts.isVariableDeclarationList(decl.parent)
        ? decl.parent.parent
        : decl;
    const jsd = extractJsDoc(stmtNode, sf);

    let kind: KernelExportKind = "type_alias";
    let sig = "";
    let params: ParamItem[] = [];
    let returnType = "";
    let members: MemberItem[] = [];
    const variants: UnionVariant[] = [];

    if (ts.isFunctionDeclaration(decl)) {
      kind = KERNEL_DECORATORS.has(entry.name) ? "decorator" : "function";
      const isAsync = hasMod(decl, ts.SyntaxKind.AsyncKeyword);
      const isGen = Boolean(decl.asteriskToken);
      const tp = decl.typeParameters
        ? `<${decl.typeParameters.map((x) => x.getText(sf)).join(", ")}>`
        : "";
      params = extractParams(decl.parameters, sf);
      returnType = decl.type ? cleanTypeWs(decl.type.getText(sf)) : "";
      const paramsFormatted =
        decl.parameters.length > 2
          ? `\n  ${decl.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(",\n  ")},\n`
          : decl.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(", ");
      sig = `export ${isAsync ? "async " : ""}function${isGen ? "*" : ""} ${entry.name}${tp}(${paramsFormatted})${returnType ? `: ${returnType}` : ""}`;
    } else if (ts.isClassDeclaration(decl)) {
      kind = "class";
      sig = extractClassDecl(decl, sf, "class", checker);
      members = extractMembers(decl.members, sf, true);
    } else if (ts.isInterfaceDeclaration(decl)) {
      kind = "interface";
      sig = decl.getText(sf);
      members = extractMembers(decl.members, sf, false);
    } else if (ts.isTypeAliasDeclaration(decl)) {
      kind = "type_alias";
      sig = decl.getText(sf);
      if (ts.isUnionTypeNode(decl.type)) {
        let prevEnd = decl.type.pos;
        for (const branch of decl.type.types) {
          let bj = extractJsDoc(branch, sf);
          if (!bj.markdown) {
            // Scan the full gap between previous branch end and this branch start (crossing `|` tokens)
            const gapStart = prevEnd;
            const gapEnd = branch.getStart(sf);
            const gapScanner = ts.createScanner(
              ts.ScriptTarget.Latest,
              false,
              ts.LanguageVariant.Standard,
              sf.text.slice(gapStart, gapEnd),
            );
            let lastJsDoc: string | null = null;
            for (
              let k = gapScanner.scan();
              k !== ts.SyntaxKind.EndOfFileToken;
              k = gapScanner.scan()
            ) {
              if (k === ts.SyntaxKind.MultiLineCommentTrivia) {
                const rawC = gapScanner.getTokenText();
                if (rawC.startsWith("/**")) lastJsDoc = rawC;
              }
            }
            if (lastJsDoc) bj = parseRawJsDocComment(lastJsDoc);
          }
          variants.push({ type: cleanTypeWs(branch.getText(sf)), doc: bj });
          prevEnd = branch.end;
        }
      } else if (ts.isTypeLiteralNode(decl.type)) {
        members = extractMembers(decl.type.members, sf, false);
      } else if (targetSym) {
        const resolvedType = checker.getDeclaredTypeOfSymbol(targetSym);
        if (resolvedType.flags & ts.TypeFlags.Object || resolvedType.isIntersection()) {
          members = extractMembersFromType(resolvedType, checker, decl);
        }
      }
    } else {
      kind = "function";
      sig = stmtNode.getText(sf);
    }

    declNodesByExportName.set(entry.name, stmtNode);
    exportsList.push({
      name: entry.name,
      slug: entry.name,
      isTypeOnly: entry.isTypeOnly,
      kind,
      sourceFile,
      file: rel,
      line: lineOf(sf, stmtNode.getStart(sf)),
      importStmt,
      sig,
      doc: jsd,
      params,
      returnType,
      members,
      variants,
      expandedOptions: null,
      references: [],
    });
  }

  // Finalize Scheme B slugs with deterministic disambiguation for any same-kind case collisions
  const seenLowerSlugs = new Set<string>();
  const slugByName = new Map<string, string>();
  for (const e of exportsList) {
    const base = sanitizeKernelSlug(e.name);
    let candidate = (lowerCounts.get(base.toLowerCase()) ?? 0) > 1 ? `${base}.${e.kind}` : base;
    let suffix = 2;
    while (seenLowerSlugs.has(candidate.toLowerCase())) {
      candidate = `${base}.${e.kind}-${suffix++}`;
    }
    e.slug = candidate;
    seenLowerSlugs.add(candidate.toLowerCase());
    slugByName.set(e.name, e.slug);
  }

  // Resolve decorator/function expandedOptions & AST/TypeChecker cross-reference graph
  for (const e of exportsList) {
    const decl = resolvedByName.get(e.name)?.decl;
    if (
      decl &&
      ts.isFunctionDeclaration(decl) &&
      (e.kind === "decorator" || e.kind === "function")
    ) {
      for (const p of decl.parameters) {
        if (!p.type) continue;
        const pName = p.name.getText(decl.getSourceFile());
        const pType = checker.getTypeAtLocation(p.type);
        const nonNullable = checker.getNonNullableType(pType);
        const typeSym = nonNullable.aliasSymbol ?? nonNullable.getSymbol();
        const typeName = typeSym
          ? (canonicalSymToExportName.get(typeSym) ?? typeSym.getName())
          : "";
        const isOptParam =
          e.kind === "decorator" ||
          /^(opts|options|meta|config|cfg)$/i.test(pName) ||
          /(?:Options|Meta|Config)$/.test(typeName);
        if (!isOptParam) continue;
        const typeSlug = slugByName.get(typeName);
        if (
          typeName &&
          typeSlug &&
          (nonNullable.flags & ts.TypeFlags.Object || nonNullable.isIntersection())
        ) {
          const optMembers = extractMembersFromType(nonNullable, checker, p.type);
          if (optMembers.length > 0) {
            e.expandedOptions = {
              paramName: pName,
              defaultVal: p.initializer
                ? cleanTypeWs(p.initializer.getText(decl.getSourceFile()))
                : "",
              typeName,
              typeSlug,
              members: optMembers,
            };
            break;
          }
        }
      }
    }

    // Native TypeChecker cross-reference graph (including `ImportTypeNode` & qualified heritage expressions)
    const rootNode = declNodesByExportName.get(e.name);
    if (rootNode) {
      const refs = new Set<string>();
      const addSymRef = (nodeToCheck: ts.Node): void => {
        const sym = checker.getSymbolAtLocation(nodeToCheck);
        if (!sym) return;
        const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
        const refName = canonicalSymToExportName.get(target);
        if (refName && refName !== e.name) refs.add(refName);
      };
      const walkRefs = (n: ts.Node): void => {
        if (
          (ts.isFunctionDeclaration(n) ||
            ts.isMethodDeclaration(n) ||
            ts.isConstructorDeclaration(n) ||
            ts.isGetAccessorDeclaration(n) ||
            ts.isSetAccessorDeclaration(n)) &&
          n.body
        ) {
          for (const ch of n.getChildren()) {
            if (ch !== n.body) walkRefs(ch);
          }
          return;
        }
        if (ts.isTypeReferenceNode(n)) {
          addSymRef(n.typeName);
        } else if (ts.isImportTypeNode(n) && n.qualifier) {
          addSymRef(n.qualifier);
        } else if (ts.isExpressionWithTypeArguments(n)) {
          if (ts.isIdentifier(n.expression)) addSymRef(n.expression);
          else if (ts.isPropertyAccessExpression(n.expression)) addSymRef(n.expression.name);
        }
        ts.forEachChild(n, walkRefs);
      };
      walkRefs(rootNode);
      e.references = [...refs].sort((a, b) => a.localeCompare(b));
    }
  }

  return { exports: exportsList };
}

/* ---------- Full Monorepo Extraction via Official TypeScript Program + TypeChecker ---------- */

interface PkgRoot {
  sub: string;
  pkgName: string;
  area: AreaKind;
  srcDir: string;
}

interface RawSlotIface {
  slotsIface: string;
  baseName: string;
  prop: string;
  data: string;
  code: string | null;
  doc: ParsedDoc;
  parentDoc: ParsedDoc;
  pkg: string;
  area: AreaKind;
  file: string;
  line: number;
}

function readGitStamp(repo: string): {
  sha: string;
  date: string;
  shortDate: string;
  subject: string;
} {
  const git = (args: string[]): string =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  try {
    return {
      sha: git(["rev-parse", "--short", "HEAD"]),
      date: git(["log", "-1", "--format=%ci"]),
      shortDate: git(["log", "-1", "--format=%cs"]),
      subject: git(["log", "-1", "--format=%s"]),
    };
  } catch {
    return { sha: "main", date: "", shortDate: "", subject: "" };
  }
}

function areaFor(root: string, sub: string): AreaKind {
  if (root === "plugins") return "plugin";
  if (root === "library") return "library";
  if (sub === "server" || sub === "web" || sub === "cli" || sub === "core") return sub;
  return "package";
}

function discoverPackages(repo: string): PkgRoot[] {
  const pkgRoots: PkgRoot[] = [];
  for (const root of ["packages", "library", "plugins"]) {
    const base = path.join(repo, root);
    if (!fs.existsSync(base)) continue;
    for (const sub of fs.readdirSync(base, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const pkgDir = path.join(base, sub.name);
      const srcDir = path.join(pkgDir, "src");
      if (!fs.existsSync(srcDir)) continue;
      let pkgName = `${root}/${sub.name}`;
      const pjPath = path.join(pkgDir, "package.json");
      if (fs.existsSync(pjPath)) {
        const pj = JSON.parse(fs.readFileSync(pjPath, "utf8")) as { name?: string };
        if (pj.name) pkgName = pj.name;
      }
      pkgRoots.push({ sub: sub.name, pkgName, area: areaFor(root, sub.name), srcDir });
    }
  }
  return pkgRoots;
}

export function extractAll(repoPath: string): ExtractedData {
  const repo = path.resolve(repoPath);
  const git = readGitStamp(repo);
  const pkgRoots = discoverPackages(repo);

  const allFiles: string[] = [];
  const filePkgMap = new Map<string, PkgRoot>();
  const tsPaths: Record<string, string[]> = {};
  for (const pr of pkgRoots) {
    tsPaths[pr.pkgName] = [path.join(pr.srcDir, "index.ts")];
    tsPaths[`${pr.pkgName}/*`] = [path.join(pr.srcDir, "*")];
    for (const f of walkTs(pr.srcDir)) {
      allFiles.push(f);
      filePkgMap.set(path.resolve(f), pr);
    }
  }

  const program = ts.createProgram(allFiles, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    noLib: true,
    baseUrl: repo,
    paths: tsPaths,
  });
  const checker = program.getTypeChecker();

  const rawModules: ModuleRecord[] = [];
  const rawComponents: ComponentRecord[] = [];
  const rawIfaces: IfaceRecord[] = [];
  const rawSlotIfaces: RawSlotIface[] = [];
  const fileSfCache = new Map<string, ts.SourceFile>();
  const fileHostClasses = new Map<string, Array<{ name: string; kind: "module" | "component" }>>();
  const classNodeByKey = new Map<string, ts.ClassDeclaration>();
  const nodeByClassDecl = new Map<ts.Node, ModuleRecord | ComponentRecord>();
  const childTargetDeclsByModKey = new Map<string, Map<string, ts.Node>>();

  for (const absFile of allFiles) {
    const pr = filePkgMap.get(path.resolve(absFile));
    const sf = program.getSourceFile(absFile);
    if (!pr || !sf) continue;
    const rel = toPosixRel(repo, absFile);
    fileSfCache.set(rel, sf);

    const hostClasses: Array<{ name: string; kind: "module" | "component" }> = [];
    for (const st of sf.statements) {
      if (ts.isClassDeclaration(st) && st.name) {
        const name = st.name.text;
        const decs = getDecorators(st);
        const decNames = decs.map((d) => decName(d, sf, checker));
        const isModule = decNames.includes("Module");
        const isComp = decNames.includes("Component");
        const isIface = decNames.includes("Interface");

        if (isModule || isComp) {
          const nodeKind = isModule ? "module" : "component";
          hostClasses.push({ name, kind: nodeKind });
          const nodeKey = `${rel}#${name}`;
          classNodeByKey.set(nodeKey, st);
          const dec = decs.find(
            (d) => decName(d, sf, checker) === (isModule ? "Module" : "Component"),
          );
          let meta: Record<string, unknown> = {};
          let contextRaw: string | null = null;
          const childTargetDecls = new Map<string, ts.Node>();
          if (dec && ts.isCallExpression(dec.expression) && dec.expression.arguments.length > 0) {
            const arg = dec.expression.arguments[0];
            if (arg) {
              const evaluated = evalExpr(arg, sf, checker);
              if (evaluated && typeof evaluated === "object" && !Array.isArray(evaluated)) {
                meta = evaluated as Record<string, unknown>;
              }
              let objLit: ts.ObjectLiteralExpression | null = null;
              let objSf = sf;
              if (ts.isObjectLiteralExpression(arg)) {
                objLit = arg;
              } else if (ts.isIdentifier(arg)) {
                const targetDecl = resolveIdentifierDecl(arg, checker);
                if (targetDecl && ts.isVariableDeclaration(targetDecl) && targetDecl.initializer) {
                  let init: ts.Expression = targetDecl.initializer;
                  while (
                    ts.isAsExpression(init) ||
                    ts.isSatisfiesExpression(init) ||
                    ts.isParenthesizedExpression(init)
                  ) {
                    init = init.expression;
                  }
                  if (ts.isObjectLiteralExpression(init)) {
                    objLit = init;
                    objSf = targetDecl.getSourceFile();
                  }
                }
              }
              if (objLit) {
                for (const prop of objLit.properties) {
                  if (ts.isPropertyAssignment(prop)) {
                    const pName = propNameText(prop.name, objSf);
                    if (pName === "context") {
                      contextRaw = prop.initializer.getText(objSf);
                    } else if (
                      pName === "children" &&
                      ts.isArrayLiteralExpression(prop.initializer)
                    ) {
                      for (const el of prop.initializer.elements) {
                        if (ts.isIdentifier(el)) {
                          const targetDecl = resolveIdentifierDecl(el, checker);
                          if (targetDecl) childTargetDecls.set(el.text, targetDecl);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          if (childTargetDecls.size > 0) childTargetDeclsByModKey.set(nodeKey, childTargetDecls);

          const uses: UseField[] = [];
          const provides: ProvideField[] = [];
          const binds: BindField[] = [];
          for (const m of st.members) {
            if (!ts.isPropertyDeclaration(m) || !m.name) continue;
            const field = propNameText(m.name, sf);
            const typeStr = m.type ? cleanTypeWs(m.type.getText(sf)) : "unknown";
            const typeRefs = extractTypeRefNames(m.type, checker);
            const raw = m.getText(sf).trim();
            for (const md of getDecorators(m)) {
              const dn = decName(md, sf, checker);
              const firstArg =
                ts.isCallExpression(md.expression) && md.expression.arguments.length > 0
                  ? evalExpr(md.expression.arguments[0], sf, checker)
                  : undefined;
              if (dn === "Use") {
                uses.push({
                  field,
                  type: typeStr,
                  typeRefs,
                  from: typeof firstArg === "string" ? firstArg : null,
                  raw,
                });
              } else if (dn === "Provide") {
                provides.push({ field, type: typeStr, typeRefs, raw });
              } else if (dn === "Bind") {
                binds.push({ field, id: String(firstArg ?? ""), type: typeStr, typeRefs, raw });
              }
            }
          }

          const impls: string[] = [];
          for (const hc of st.heritageClauses ?? []) {
            if (hc.token === ts.SyntaxKind.ImplementsKeyword) {
              for (const t of hc.types) {
                impls.push(
                  ts.isPropertyAccessExpression(t.expression)
                    ? t.expression.name.text
                    : t.expression.getText(sf),
                );
              }
            }
          }

          const methods = extractMembers(st.members, sf, false).filter((m) => m.kind === "method");
          const baseRec = {
            name,
            slug: "",
            pkg: pr.pkgName,
            pkgSub: pr.sub,
            area: pr.area,
            file: rel,
            line: lineOf(sf, st.getStart(sf)),
            doc: extractJsDoc(st, sf),
            children: Array.isArray(meta.children)
              ? meta.children.filter((x): x is string => typeof x === "string")
              : [],
            exports: Array.isArray(meta.exports)
              ? meta.exports.filter((x): x is string => typeof x === "string")
              : [],
            contributes:
              meta.contributes && typeof meta.contributes === "object"
                ? (meta.contributes as Record<string, unknown>)
                : {},
            context: contextRaw,
            uses,
            provides,
            binds,
            implements: impls,
            methods,
            rawDecl: extractClassDecl(st, sf, nodeKind, checker),
            parents: [] as ModuleRecord[],
          };
          if (isModule) {
            const rec: ModuleRecord = { ...baseRec, kind: "module", resolvedChildren: [] };
            rawModules.push(rec);
            nodeByClassDecl.set(st, rec);
          } else {
            const rec: ComponentRecord = {
              ...baseRec,
              kind: "component",
              primaryParent: null,
              href: "",
            };
            rawComponents.push(rec);
            nodeByClassDecl.set(st, rec);
          }
        }

        if (isIface) {
          rawIfaces.push({
            name,
            slug: "",
            pkg: pr.pkgName,
            pkgSub: pr.sub,
            area: pr.area,
            file: rel,
            line: lineOf(sf, st.getStart(sf)),
            doc: extractJsDoc(st, sf),
            members: extractMembers(st.members, sf, false),
            rawDecl: extractClassDecl(st, sf, "interface", checker),
          });
        }
      } else if (ts.isInterfaceDeclaration(st) && st.name.text.endsWith("Slots")) {
        const stem = st.name.text.slice(0, -"Slots".length);
        if (!stem) continue;
        const parentDoc = extractJsDoc(st, sf);
        for (const m of st.members) {
          if (!ts.isPropertySignature(m) || !m.name) continue;
          const { data, code } = parseSlotType(m.type, sf, checker);
          rawSlotIfaces.push({
            slotsIface: st.name.text,
            baseName: stem,
            prop: propNameText(m.name, sf),
            data,
            code,
            doc: extractJsDoc(m, sf),
            parentDoc,
            pkg: pr.pkgName,
            area: pr.area,
            file: rel,
            line: lineOf(sf, m.getStart(sf)),
          });
        }
      }
    }
    fileHostClasses.set(rel, hostClasses);
  }

  // Assign deterministic module slugs
  const usedModSlugs = new Set<string>();
  rawModules.sort(
    (a, b) => AREA_PRIORITY[a.area] - AREA_PRIORITY[b.area] || a.name.localeCompare(b.name),
  );
  for (const m of rawModules) {
    const stem = m.name.endsWith("Module") ? m.name.slice(0, -"Module".length) : m.name;
    let base = slugOf(stem || m.name);
    if (m.name === "PlatformModule") base = "platform";
    if (m.name === "WebAppModule") base = "web-app";
    let slug = base;
    if (usedModSlugs.has(slug)) {
      const prefix =
        m.area === "web"
          ? "web"
          : m.area === "plugin" && m.file.includes("/web/")
            ? `${slugOf(m.pkgSub)}-web`
            : slugOf(m.pkgSub);
      slug = `${prefix}-${base}`;
    }
    let suffix = 2;
    const origSlug = slug;
    while (usedModSlugs.has(slug)) slug = `${origSlug}-${suffix++}`;
    usedModSlugs.add(slug);
    m.slug = slug;
  }

  const modsByName = new Map<string, ModuleRecord[]>();
  for (const m of rawModules) {
    const list = modsByName.get(m.name);
    if (list) list.push(m);
    else modsByName.set(m.name, [m]);
  }
  const compByName = new Map<string, ComponentRecord>();
  const usedCompSlugs = new Set<string>();
  for (const c of rawComponents) {
    let slug = slugOf(c.name);
    let suffix = 2;
    const baseSlug = slug;
    while (usedCompSlugs.has(slug)) slug = `${baseSlug}-${suffix++}`;
    usedCompSlugs.add(slug);
    c.slug = slug;
    compByName.set(c.name, c);
  }

  function resolveModuleFor(
    name: string,
    callerArea: AreaKind,
    callerFile: string,
  ): ModuleRecord | null {
    const hits = modsByName.get(name);
    if (!hits || hits.length === 0) return null;
    if (hits.length === 1) return hits[0] ?? null;
    const isCallerWeb = callerArea === "web" || callerFile.includes("/web/");
    return (
      hits.find((h) => (h.area === "web" || h.file.includes("/web/")) === isCallerWeb) ??
      hits.find((h) => h.area === callerArea) ??
      hits[0] ??
      null
    );
  }

  // Prefer TypeChecker-resolved declaration identity for `children`, falling back to area disambiguation
  for (const m of rawModules) {
    const declMap = childTargetDeclsByModKey.get(`${m.file}#${m.name}`);
    for (const cname of m.children) {
      const resolvedDecl = declMap?.get(cname);
      const exactTarget = resolvedDecl ? nodeByClassDecl.get(resolvedDecl) : undefined;
      const childMod =
        exactTarget?.kind === "module"
          ? exactTarget
          : exactTarget
            ? null
            : resolveModuleFor(cname, m.area, m.file);
      const childComp =
        exactTarget?.kind === "component" ? exactTarget : childMod ? null : compByName.get(cname);
      if (childMod) {
        childMod.parents.push(m);
        m.resolvedChildren.push({ kind: "module", name: cname, target: childMod });
      } else if (childComp) {
        childComp.parents.push(m);
        m.resolvedChildren.push({ kind: "component", name: cname, target: childComp });
      } else {
        m.resolvedChildren.push({ kind: "external", name: cname, target: null });
      }
    }
  }

  const cliMod = resolveModuleFor("CliCommandsModule", "cli", "packages/cli/src/cli-commands.ts");
  const shippedCliMod = resolveModuleFor(
    "ShippedCommandsModule",
    "cli",
    "packages/cli/src/cli-modules.ts",
  );
  for (const c of rawComponents) {
    if (c.parents.length === 0) {
      if (c.contributes["CliCommandsModule.commands"] && cliMod) {
        c.parents.push(cliMod);
        cliMod.resolvedChildren.push({
          kind: "component",
          name: c.name,
          target: c,
          viaSlot: "CliCommandsModule.commands",
        });
      } else if (c.contributes["ShippedCommandsModule.commands"] && shippedCliMod) {
        c.parents.push(shippedCliMod);
        shippedCliMod.resolvedChildren.push({
          kind: "component",
          name: c.name,
          target: c,
          viaSlot: "ShippedCommandsModule.commands",
        });
      }
    }
    const primary = c.parents[0] ?? null;
    c.primaryParent = primary;
    c.href = primary
      ? `modules/${primary.slug}/components/${c.slug}/`
      : `modules/standalone/components/${c.slug}/`;
  }

  for (const m of rawModules) {
    if (
      m.name === "PlatformModule" ||
      m.name === "WebAppModule" ||
      m.name === "CliCommandsModule"
    ) {
      m.isRoot = true;
    }
  }

  rawIfaces.sort(
    (a, b) => AREA_PRIORITY[a.area] - AREA_PRIORITY[b.area] || a.name.localeCompare(b.name),
  );
  const usedIfaceSlugs = new Set<string>();
  for (const it of rawIfaces) {
    let slug = slugOf(it.name);
    if (usedIfaceSlugs.has(slug)) slug = `${slugOf(it.pkgSub)}-${slug}`;
    let suffix = 2;
    const baseSlug = slug;
    while (usedIfaceSlugs.has(slug)) slug = `${baseSlug}-${suffix++}`;
    usedIfaceSlugs.add(slug);
    it.slug = slug;
  }

  const kernel = extractKernelPackage(repo);

  const allNodes: Array<ModuleRecord | ComponentRecord> = [...rawModules, ...rawComponents];
  const nodeHref = (n: ModuleRecord | ComponentRecord): string =>
    n.kind === "module" ? `modules/${n.slug}/` : n.href;

  // Contribution slots (using AST-extracted `p.typeRefs` and kernel `splitSlotKey` semantics)
  const contribBySlot = new Map<string, SlotContributor[]>();
  for (const node of allNodes) {
    for (const [slotKey, val] of Object.entries(node.contributes)) {
      if (!splitSlotKey(slotKey)) continue;
      const list = contribBySlot.get(slotKey) ?? [];
      const entries = Array.isArray(val) ? val : [val];
      list.push({
        name: node.name,
        kind: node.kind,
        href: nodeHref(node),
        count: entries.length,
        entries,
        file: node.file,
        line: node.line,
      });
      contribBySlot.set(slotKey, list);
    }
  }

  const moduleExportsHosts = new Map<string, ModuleRecord[]>();
  for (const mod of rawModules) {
    for (const expName of mod.exports) {
      const list = moduleExportsHosts.get(expName) ?? [];
      list.push(mod);
      moduleExportsHosts.set(expName, list);
    }
  }
  const provideHosts = new Map<string, Array<ModuleRecord | ComponentRecord>>();
  for (const node of allNodes) {
    for (const p of node.provides) {
      for (const ifaceName of p.typeRefs) {
        const list = provideHosts.get(ifaceName) ?? [];
        list.push(node);
        provideHosts.set(ifaceName, list);
      }
    }
  }

  const slotMap = new Map<string, SlotRecord>();
  for (const s of rawSlotIfaces) {
    const exportedMods = [
      ...(moduleExportsHosts.get(s.slotsIface) ?? []),
      ...(moduleExportsHosts.get(s.baseName) ?? []),
    ];
    const providedNodes = [
      ...(provideHosts.get(s.slotsIface) ?? []),
      ...(provideHosts.get(s.baseName) ?? []),
    ];
    const sameFileHosts = fileHostClasses.get(s.file) ?? [];

    const candidateHosts = [
      ...exportedMods.map((h) => ({ name: h.name, kind: h.kind })),
      ...providedNodes.map((h) => ({ name: h.name, kind: h.kind })),
      ...sameFileHosts,
    ];
    let key = candidateHosts
      .map((h) => `${h.name}.${s.prop}`)
      .find((cand) => contribBySlot.has(cand));
    if (!key) {
      const owner =
        exportedMods.find((h) => h.pkg === s.pkg) ??
        exportedMods.find((h) => h.area === s.area) ??
        providedNodes.find((h) => h.kind === "module" && h.pkg === s.pkg) ??
        providedNodes.find((h) => h.kind === "module" && h.area === s.area) ??
        providedNodes.find((h) => h.pkg === s.pkg) ??
        exportedMods[0] ??
        providedNodes[0];
      if (owner) {
        key = `${owner.name}.${s.prop}`;
      } else {
        const modHost =
          sameFileHosts.find((h) => h.kind === "module" && h.name.startsWith(s.baseName)) ??
          sameFileHosts.find((h) => h.kind === "module") ??
          sameFileHosts[0];
        key = `${modHost ? modHost.name : s.baseName}.${s.prop}`;
      }
    }
    const split = splitSlotKey(key);
    const hostClass = split?.module ?? s.baseName;
    const hostMod = resolveModuleFor(hostClass, s.area, s.file);
    const hostComp = compByName.get(hostClass);
    const fallbackDoc: ParsedDoc = s.parentDoc.summary
      ? { markdown: s.parentDoc.summary, summary: s.parentDoc.summary, tags: [] }
      : EMPTY_DOC;
    slotMap.set(key, {
      key,
      slotsIface: s.slotsIface,
      prop: s.prop,
      host: hostClass,
      hostHref: hostMod ? `modules/${hostMod.slug}/` : (hostComp?.href ?? null),
      pkg: s.pkg,
      area: s.area,
      file: s.file,
      line: s.line,
      data: s.data,
      code: s.code,
      doc: s.doc.markdown ? s.doc : fallbackDoc,
      contributors: contribBySlot.get(key) ?? [],
    });
  }
  for (const [slotKey, contributors] of contribBySlot) {
    if (slotMap.has(slotKey)) continue;
    const parsed = splitSlotKey(slotKey);
    if (!parsed) continue;
    const hostMod = modsByName.get(parsed.module)?.[0];
    const hostComp = compByName.get(parsed.module);
    slotMap.set(slotKey, {
      key: slotKey,
      slotsIface: null,
      prop: parsed.slot,
      host: parsed.module,
      hostHref: hostMod ? `modules/${hostMod.slug}/` : (hostComp?.href ?? null),
      pkg: hostMod?.pkg ?? hostComp?.pkg ?? "@prismshadow/penguin-server",
      area: hostMod?.area ?? hostComp?.area ?? "server",
      file: hostMod?.file ?? hostComp?.file ?? "",
      line: hostMod?.line ?? hostComp?.line ?? 1,
      data: "unknown",
      code: null,
      doc: EMPTY_DOC,
      contributors,
    });
  }
  const slots = [...slotMap.values()].sort((a, b) => a.key.localeCompare(b.key));

  // HTTP route contributions (per contribution ID -> @Bind -> TypeChecker-resolved router function)
  const httpCountByFile = new Map<string, number>();
  for (const node of allNodes) {
    const entries = node.contributes["HttpModule.routes"];
    if (Array.isArray(entries) && entries.length > 0) {
      httpCountByFile.set(node.file, (httpCountByFile.get(node.file) ?? 0) + 1);
    }
  }
  const httpContribs: HttpContribRecord[] = [];
  const usedHttpSlugs = new Set<string>();
  for (const node of allNodes) {
    const entries = node.contributes["HttpModule.routes"];
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const sf = fileSfCache.get(node.file);
    const clsNode = classNodeByKey.get(`${node.file}#${node.name}`);
    const parsedEntries = entries.map((rawEntry) => {
      const e = (rawEntry ?? {}) as Record<string, unknown>;
      const ord = e.order;
      return {
        id: String(e.id ?? ""),
        prefix: String(e.prefix ?? ""),
        auth: String(e.auth ?? ""),
        order: typeof ord === "number" || typeof ord === "string" ? ord : "",
        origin: e.origin ? String(e.origin) : "",
      };
    });

    const endpoints: HttpEndpoint[] = [];
    const seenEp = new Set<string>();
    const addEndpoints = (
      list: HttpEndpoint[],
      meta: { mountPrefix?: string; auth?: string; entryId?: string; fileOverride?: string },
    ): void => {
      for (const ep of list) {
        const key = `${meta.entryId ?? ""} ${meta.mountPrefix ?? ""} ${ep.method} ${ep.path} ${meta.fileOverride ?? node.file}`;
        if (seenEp.has(key)) continue;
        seenEp.add(key);
        endpoints.push({
          ...ep,
          ...(meta.fileOverride ? { file: meta.fileOverride } : {}),
          ...(meta.mountPrefix ? { mountPrefix: meta.mountPrefix } : {}),
          ...(meta.auth ? { auth: meta.auth } : {}),
          ...(meta.entryId ? { entryId: meta.entryId } : {}),
        });
      }
    };

    if (sf && clsNode) {
      for (const entry of parsedEntries) {
        const entryBinds = node.binds.filter((b) => entry.id && b.id === entry.id);
        const fields = new Set(
          (entryBinds.length > 0 ? entryBinds : parsedEntries.length === 1 ? node.binds : []).map(
            (b) => b.field,
          ),
        );
        const meta = {
          mountPrefix: entry.prefix || undefined,
          auth: entry.auth || undefined,
          entryId: entry.id || undefined,
        };
        if (fields.size > 0) {
          for (const ident of findBoundTargetIdentifiers(clsNode, fields, sf)) {
            const decl = resolveIdentifierDecl(ident, checker);
            if (!decl) continue;
            const declSf = decl.getSourceFile();
            const declRel = toPosixRel(repo, declSf.fileName);
            addEndpoints(extractEndpointsFromNode(decl, declSf, checker), {
              ...meta,
              fileOverride: declRel !== node.file ? declRel : undefined,
            });
          }
        }
      }
      if (endpoints.length === 0 && parsedEntries.length === 1) {
        const only = parsedEntries[0];
        addEndpoints(extractEndpointsFromNode(clsNode, sf, checker), {
          mountPrefix: only?.prefix || undefined,
          auth: only?.auth || undefined,
          entryId: only?.id || undefined,
        });
      }
    }

    if (
      endpoints.length === 0 &&
      sf &&
      parsedEntries.length === 1 &&
      (httpCountByFile.get(node.file) ?? 0) === 1
    ) {
      const only = parsedEntries[0];
      addEndpoints(extractEndpointsFromNode(sf, sf, checker), {
        mountPrefix: only?.prefix || undefined,
        auth: only?.auth || undefined,
        entryId: only?.id || undefined,
      });
    }

    let slug = slugOf(node.name);
    let suffix = 2;
    const baseSlug = slug;
    while (usedHttpSlugs.has(slug)) slug = `${baseSlug}-${suffix++}`;
    usedHttpSlugs.add(slug);

    httpContribs.push({
      cls: node.name,
      slug,
      kind: node.kind,
      nodeHref: nodeHref(node),
      pkg: node.pkg,
      file: node.file,
      line: node.line,
      doc: node.doc,
      binds: node.binds,
      entries: parsedEntries,
      endpoints,
    });
  }
  httpContribs.sort((a, b) => a.cls.localeCompare(b.cls));

  // CLI commands (keyed by canonical command name, with separate unique slug allocation)
  const cliMap = new Map<string, CliCommandRecord>();
  const usedCliSlugs = new Set<string>();
  const allocCliSlug = (key: string): string => {
    const base = slugOf(key);
    let cand = base;
    let suffix = 2;
    while (usedCliSlugs.has(cand)) cand = `${base}-${suffix++}`;
    usedCliSlugs.add(cand);
    return cand;
  };
  const cliSlotKeys = [
    "CliCommandsModule.commands",
    "ShippedCommandsModule.commands",
    "CompanyCommandsModule.commands",
    "PluginCliCommandsProvider.commands",
  ];
  const cliCountByFile = new Map<string, number>();
  for (const node of allNodes) {
    for (const sk of cliSlotKeys) {
      const list = node.contributes[sk];
      if (Array.isArray(list) && list.length > 0) {
        cliCountByFile.set(node.file, (cliCountByFile.get(node.file) ?? 0) + list.length);
      }
    }
  }
  for (const node of allNodes) {
    for (const sk of cliSlotKeys) {
      const list = node.contributes[sk];
      if (!Array.isArray(list)) continue;
      const sf = fileSfCache.get(node.file);
      const clsNode = classNodeByKey.get(`${node.file}#${node.name}`);
      const topDoc = sf ? extractFileTopJsDoc(sf) : EMPTY_DOC;
      const isSoleInFile = (cliCountByFile.get(node.file) ?? 0) === 1;

      for (const rawEntry of list) {
        const entry = (rawEntry ?? {}) as Record<string, unknown>;
        const key = String(entry.key ?? node.name);
        const entryId = String(entry.id ?? "");
        const rootSegs = key.split(".").filter(Boolean);

        let cmdInfo = {
          commands: [] as string[],
          options: [] as CliOption[],
          descriptions: [] as string[],
        };
        if (sf && clsNode) {
          const matchingBinds = node.binds.filter((b) => !entryId || b.id === entryId);
          const bindFields = new Set(
            (matchingBinds.length > 0 ? matchingBinds : node.binds).map((b) => b.field),
          );
          for (const ident of findBoundTargetIdentifiers(clsNode, bindFields, sf)) {
            const decl = resolveIdentifierDecl(ident, checker);
            if (!decl) continue;
            const info = extractCommanderInfo(decl, checker, rootSegs);
            cmdInfo.commands.push(...info.commands);
            cmdInfo.options.push(...info.options);
            cmdInfo.descriptions.push(...info.descriptions);
          }
          if (cmdInfo.commands.length === 0 && cmdInfo.options.length === 0) {
            const clsInfo = extractCommanderInfo(clsNode, checker, rootSegs);
            cmdInfo.commands.push(...clsInfo.commands);
            cmdInfo.options.push(...clsInfo.options);
            cmdInfo.descriptions.push(...clsInfo.descriptions);
          }
        }
        if (cmdInfo.commands.length === 0 && cmdInfo.options.length === 0 && sf && isSoleInFile) {
          cmdInfo = extractCommanderInfo(sf, checker, rootSegs);
        }

        const dedupedOpts: CliOption[] = [];
        const seenOpt = new Set<string>();
        for (const opt of cmdInfo.options) {
          const ok = `${opt.command ?? ""}|${opt.flag}`;
          if (seenOpt.has(ok)) continue;
          seenOpt.add(ok);
          dedupedOpts.push(opt);
        }

        const summary = entry.summary as { en?: string; zh?: string } | string | undefined;
        const summaryEn = typeof summary === "object" ? (summary?.en ?? "") : (summary ?? "");
        const summaryZh = typeof summary === "object" ? (summary?.zh ?? "") : "";
        const existingSlug = cliMap.get(key)?.slug ?? allocCliSlug(key);
        cliMap.set(key, {
          name: key,
          slug: existingSlug,
          id: entryId,
          slot: sk,
          cls: node.name,
          nodeHref: nodeHref(node),
          pkg: node.pkg,
          file: node.file,
          line: node.line,
          brief: summaryEn || summaryZh || cmdInfo.descriptions[0] || "",
          briefZh: summaryZh,
          doc: node.doc.markdown ? node.doc : topDoc,
          subcommands: [...new Set(cmdInfo.commands)],
          options: dedupedOpts,
        });
      }
    }
  }
  const cliCmdDir = path.join(repo, "packages/cli/src/commands");
  if (fs.existsSync(cliCmdDir)) {
    for (const f of fs.readdirSync(cliCmdDir).filter(isSourceTsFile).sort()) {
      const cmdName = path.parse(f).name;
      const rel = `packages/cli/src/commands/${f}`;
      const sf = fileSfCache.get(rel);
      const cmdInfo = sf
        ? extractCommanderInfo(sf, checker, [cmdName])
        : { commands: [], options: [], descriptions: [] };
      const topDoc = sf ? extractFileTopJsDoc(sf) : EMPTY_DOC;
      const existing =
        cliMap.get(cmdName) ?? [...cliMap.values()].find((entry) => entry.file === rel);
      if (!existing) {
        cliMap.set(cmdName, {
          name: cmdName,
          slug: allocCliSlug(cmdName),
          id: "",
          slot: "packages/cli/src/commands",
          cls: null,
          nodeHref: null,
          pkg: "@prismshadow/penguin-cli",
          file: rel,
          line: 1,
          brief: cmdInfo.descriptions[0] || topDoc.summary || "",
          briefZh: "",
          doc: topDoc,
          subcommands: [...new Set(cmdInfo.commands)],
          options: cmdInfo.options,
        });
      } else {
        if (!existing.subcommands.length && cmdInfo.commands.length) {
          existing.subcommands = [...new Set(cmdInfo.commands)];
        }
        if (!existing.options.length && cmdInfo.options.length) existing.options = cmdInfo.options;
        if (!existing.doc.markdown && topDoc.markdown) existing.doc = topDoc;
      }
    }
  }
  const cliCommands = [...cliMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    repo,
    git,
    modules: rawModules,
    components: rawComponents,
    ifaces: rawIfaces,
    kernel,
    slots,
    httpContribs,
    cliCommands,
  };
}
