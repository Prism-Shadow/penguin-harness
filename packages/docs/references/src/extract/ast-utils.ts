import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { cleanTypeWs, EMPTY_DOC, extractJsDoc } from "../jsdoc.js";
import type { AreaKind, MemberItem, ParamItem } from "../types.js";

export const IGNORED_DIRS = new Set(["node_modules", "dist", "__tests__"]);
export const KERNEL_DECORATORS = new Set([
  "Module",
  "Component",
  "Use",
  "Provide",
  "Bind",
  "Interface",
]);
export const AREA_PRIORITY: Record<AreaKind, number> = {
  server: 0,
  cli: 1,
  core: 2,
  library: 3,
  plugin: 4,
  web: 5,
  package: 6,
};

export const TS_PRINTER = ts.createPrinter({ removeComments: true });
export const SYNTH_SF = ts.createSourceFile(
  "__synth.ts",
  "",
  ts.ScriptTarget.Latest,
  false,
  ts.ScriptKind.TS,
);

export function toPosixRel(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

export function isPathInsideOrEqual(parentDir: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(parentDir), path.resolve(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export function isSourceTsFile(name: string): boolean {
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

export function walkTs(dir: string, out: string[] = []): string[] {
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

export function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

export function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

/** Resolve decorator callee through TypeChecker aliases so `import { Module as M }` and `kernel.Module` resolve accurately. */
export function decName(dec: ts.Decorator, sf: ts.SourceFile, checker: ts.TypeChecker): string {
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

export function propNameText(nameNode: ts.PropertyName, sf: ts.SourceFile): string {
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

export function hasMod(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

export function isNonPublic(node: ts.Node, nameNode?: ts.PropertyName): boolean {
  return (
    Boolean(nameNode && ts.isPrivateIdentifier(nameNode)) ||
    hasMod(node, ts.SyntaxKind.PrivateKeyword) ||
    hasMod(node, ts.SyntaxKind.ProtectedKeyword)
  );
}

export function printNode(node: ts.Node, sf: ts.SourceFile): string {
  return cleanTypeWs(TS_PRINTER.printNode(ts.EmitHint.Unspecified, node, sf));
}

export function resolveIdentifierDecl(
  ident: ts.Identifier,
  checker: ts.TypeChecker,
): ts.Node | null {
  const sym = checker.getSymbolAtLocation(ident);
  if (!sym) return null;
  const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  const decl = target.valueDeclaration ?? target.declarations?.[0];
  return decl ?? null;
}

export function extractParams(
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
export function extractTypeRefNames(
  typeNode: ts.TypeNode | undefined,
  checker: ts.TypeChecker,
): string[] {
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

function isEvaluableInitializer(init: ts.Expression): boolean {
  return (
    ts.isIdentifier(init) ||
    ts.isArrayLiteralExpression(init) ||
    ts.isObjectLiteralExpression(init) ||
    ts.isStringLiteral(init) ||
    ts.isNoSubstitutionTemplateLiteral(init) ||
    ts.isNumericLiteral(init) ||
    ts.isAsExpression(init) ||
    ts.isSatisfiesExpression(init) ||
    ts.isParenthesizedExpression(init)
  );
}

export function evalExpr(
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
    const decl = resolveIdentifierDecl(node, checker);
    if (
      decl &&
      ts.isVariableDeclaration(decl) &&
      decl.initializer &&
      !seen.has(decl) &&
      isEvaluableInitializer(decl.initializer)
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
          isEvaluableInitializer(decl.initializer)
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

export function memberFromDecl(
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

export function extractMembers(
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

function stripUndefinedFromTypeNode(typeNode: ts.TypeNode): ts.TypeNode {
  if (!ts.isUnionTypeNode(typeNode)) return typeNode;
  const kept = typeNode.types.filter((t) => t.kind !== ts.SyntaxKind.UndefinedKeyword);
  if (kept.length === 0) return typeNode;
  if (kept.length === 1 && kept[0]) return kept[0];
  return ts.factory.createUnionTypeNode(kept);
}

/** Extract resolved property/method members from any TypeScript Type via TypeChecker. */
export function extractMembersFromType(
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
          out.push({ name, kind: "method", sig, params, returnType: retStr, doc, line });
        } else if (ts.isPropertySignature(synth)) {
          const typStr = synth.type ? printNode(synth.type, locSf) : "unknown";
          const sig = printNode(synth, locSf).replace(/;$/, "");
          out.push({ name, kind: "property", sig, params: [], returnType: typStr, doc, line });
        }
      }
      continue;
    }

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

export function extractClassDecl(
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

export function findBoundTargetIdentifiers(
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
