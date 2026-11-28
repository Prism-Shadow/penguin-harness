import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { cleanTypeWs, EMPTY_DOC, parsedDocFromRaw, slugOf } from "./jsdoc.js";
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
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "ALL"]);
const AREA_PRIORITY: Record<AreaKind, number> = {
  server: 0,
  cli: 1,
  core: 2,
  library: 3,
  plugin: 4,
  web: 5,
  package: 6,
};

function walkTs(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTs(full, out);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".spec.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function getJsDocFull(sf: ts.SourceFile, node: ts.Node): ParsedDoc {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.pos);
  if (!ranges) return EMPTY_DOC;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i];
    if (!range) continue;
    const txt = sf.text.slice(range.pos, range.end);
    if (txt.startsWith("/**")) return parsedDocFromRaw(txt);
  }
  return EMPTY_DOC;
}

function getFileTopJsDoc(sf: ts.SourceFile): ParsedDoc {
  const ranges = ts.getLeadingCommentRanges(sf.text, 0);
  const first = ranges?.[0];
  if (!first) return EMPTY_DOC;
  const txt = sf.text.slice(first.pos, first.end);
  return txt.startsWith("/**") ? parsedDocFromRaw(txt) : EMPTY_DOC;
}

function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function decName(dec: ts.Decorator, sf: ts.SourceFile): string {
  const expr = dec.expression;
  return ts.isCallExpression(expr) ? expr.expression.getText(sf) : expr.getText(sf);
}

function propNameText(nameNode: ts.PropertyName, sf: ts.SourceFile): string {
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text;
  }
  return nameNode.getText(sf).replace(/^["']|["']$/g, "");
}

function hasMod(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function isNonPublic(node: ts.Node, name: string): boolean {
  return (
    name.startsWith("#") ||
    hasMod(node, ts.SyntaxKind.PrivateKeyword) ||
    hasMod(node, ts.SyntaxKind.ProtectedKeyword)
  );
}

function evalExpr(node: ts.Expression | undefined, sf: ts.SourceFile): unknown {
  if (!node) return undefined;
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
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((el) => evalExpr(el, sf));
  if (ts.isObjectLiteralExpression(node)) {
    const obj: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        obj[propNameText(prop.name, sf)] = evalExpr(prop.initializer, sf);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        obj[prop.name.text] = prop.name.text;
      }
    }
    return obj;
  }
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return evalExpr(node.expression, sf);
  }
  return node.getText(sf);
}

function extractMembers(
  members: ts.NodeArray<ts.ClassElement> | ts.NodeArray<ts.TypeElement>,
  sf: ts.SourceFile,
  includeConstructors: boolean,
): MemberItem[] {
  const out: MemberItem[] = [];
  for (const m of members) {
    if (includeConstructors && ts.isConstructorDeclaration(m)) {
      const mp = m.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(", ");
      const mj = getJsDocFull(sf, m);
      out.push({
        name: "constructor",
        kind: "method",
        sig: `constructor(${mp})`,
        doc: mj.doc,
        docBlocks: mj.docBlocks,
        line: lineOf(sf, m.getStart(sf)),
      });
      continue;
    }

    if ((ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) && m.name) {
      const mName = propNameText(m.name, sf);
      if (isNonPublic(m, mName)) continue;
      const opt = m.questionToken ? "?" : "";
      const tp = m.typeParameters
        ? `<${m.typeParameters.map((x) => cleanTypeWs(x.getText(sf))).join(", ")}>`
        : "";
      const params = m.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(", ");
      const ret = m.type ? `: ${cleanTypeWs(m.type.getText(sf))}` : "";
      const mj = getJsDocFull(sf, m);
      out.push({
        name: mName,
        kind: "method",
        sig: `${mName}${opt}${tp}(${params})${ret}`,
        doc: mj.doc,
        docBlocks: mj.docBlocks,
        line: lineOf(sf, m.getStart(sf)),
      });
    } else if ((ts.isPropertyDeclaration(m) || ts.isPropertySignature(m)) && m.name) {
      const mName = propNameText(m.name, sf);
      if (isNonPublic(m, mName)) continue;
      const opt = m.questionToken ? "?" : "";
      const ro = hasMod(m, ts.SyntaxKind.ReadonlyKeyword) ? "readonly " : "";
      const typ = m.type ? cleanTypeWs(m.type.getText(sf)) : "unknown";
      const mj = getJsDocFull(sf, m);
      out.push({
        name: mName,
        kind: "property",
        sig: `${ro}${mName}${opt}: ${typ}`,
        doc: mj.doc,
        docBlocks: mj.docBlocks,
        line: lineOf(sf, m.getStart(sf)),
      });
    }
  }
  return out;
}

function extractClassDecl(
  st: ts.ClassDeclaration,
  sf: ts.SourceFile,
  kind: "module" | "component" | "interface" | "class",
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
    const mDecNames = getDecorators(m).map((d) => decName(d, sf));
    if (ts.isConstructorDeclaration(m)) {
      const params = m.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(", ");
      bodyLines.push(`  constructor(${params});`);
    } else if (
      ts.isPropertyDeclaration(m) &&
      (kind === "class" || mDecNames.some((n) => n === "Use" || n === "Provide" || n === "Bind"))
    ) {
      const mName = m.name ? propNameText(m.name, sf) : "";
      if (kind !== "class" || !isNonPublic(m, mName)) {
        bodyLines.push(`  ${m.getText(sf).trim().replace(/\r?\n/g, "\n  ")}`);
      }
    } else if (ts.isMethodDeclaration(m) && m.name) {
      const mName = propNameText(m.name, sf);
      if (isNonPublic(m, mName)) continue;
      const mMods = (ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : [])
        .map((mod) => mod.getText(sf))
        .join(" ");
      const tp = m.typeParameters
        ? `<${m.typeParameters.map((x) => x.getText(sf)).join(", ")}>`
        : "";
      const params = m.parameters.map((p) => p.getText(sf)).join(", ");
      const ret = m.type ? `: ${m.type.getText(sf)}` : "";
      bodyLines.push(`  ${mMods ? `${mMods} ` : ""}${mName}${tp}(${params})${ret};`);
    } else if (ts.isGetAccessorDeclaration(m) && m.name) {
      const mName = propNameText(m.name, sf);
      if (isNonPublic(m, mName)) continue;
      const ret = m.type ? `: ${m.type.getText(sf)}` : "";
      bodyLines.push(`  get ${mName}()${ret};`);
    }
  }
  return bodyLines.length ? `${header} {\n${bodyLines.join("\n")}\n}` : `${header} {}`;
}

function extractEndpointsFromNode(root: ts.Node, sf: ts.SourceFile): HttpEndpoint[] {
  const eps: HttpEndpoint[] = [];
  const seen = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const meth = node.expression.name.text.toUpperCase();
      const first = node.arguments[0];
      if (
        HTTP_METHODS.has(meth) &&
        node.arguments.length >= 2 &&
        first &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
      ) {
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
    ts.forEachChild(node, visit);
  }
  visit(root);
  return eps;
}

function findTopLevelDecl(sf: ts.SourceFile, name: string): ts.Node | null {
  for (const st of sf.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === name) {
      return st;
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) return d;
      }
    }
  }
  return null;
}

function resolveExportedDecl(
  sf: ts.SourceFile,
  fileRel: string,
  symbolName: string,
  fileSfCache: ReadonlyMap<string, ts.SourceFile>,
  pkgSrcRelByName: ReadonlyMap<string, string>,
  depth = 0,
): { sf: ts.SourceFile; rel: string; decl: ts.Node } | null {
  if (depth > 5) return null;
  if (symbolName !== "default") {
    const direct = findTopLevelDecl(sf, symbolName);
    if (direct) return { sf, rel: fileRel, decl: direct };
  }
  for (const st of sf.statements) {
    if (
      !ts.isExportDeclaration(st) ||
      !st.moduleSpecifier ||
      !ts.isStringLiteral(st.moduleSpecifier)
    ) {
      continue;
    }
    const spec = st.moduleSpecifier.text;
    const targetRel = resolveModuleSpecifier(spec, fileRel, fileSfCache, pkgSrcRelByName);
    if (!targetRel) continue;
    const targetSf = fileSfCache.get(targetRel);
    if (!targetSf) continue;

    if (!st.exportClause) {
      const starHit = resolveExportedDecl(
        targetSf,
        targetRel,
        symbolName,
        fileSfCache,
        pkgSrcRelByName,
        depth + 1,
      );
      if (starHit) return starHit;
    } else if (ts.isNamedExports(st.exportClause)) {
      const hit = st.exportClause.elements.find((e) => e.name.text === symbolName);
      if (hit) {
        const orig = hit.propertyName ? hit.propertyName.text : hit.name.text;
        return resolveExportedDecl(
          targetSf,
          targetRel,
          orig,
          fileSfCache,
          pkgSrcRelByName,
          depth + 1,
        );
      }
    }
  }
  return null;
}

function resolveModuleSpecifier(
  spec: string,
  fromFileRel: string,
  fileSfCache: ReadonlyMap<string, ts.SourceFile>,
  pkgSrcRelByName: ReadonlyMap<string, string>,
): string | null {
  const tryRel = (baseRel: string): string | null => {
    const normalized = path.normalize(baseRel).replace(/\\/g, "/");
    for (const cand of [
      normalized,
      `${normalized}.ts`,
      `${normalized}.tsx`,
      `${normalized}/index.ts`,
      `${normalized}/index.tsx`,
    ]) {
      if (fileSfCache.has(cand)) return cand;
    }
    return null;
  };

  if (spec.startsWith("./") || spec.startsWith("../")) {
    return tryRel(path.join(path.dirname(fromFileRel), spec.replace(/\.js$/, "")));
  }

  // Workspace package specifier (e.g. `@prismshadow/penguin-library-session` or `@pkg/subpath`)
  for (const [pkgName, srcRel] of pkgSrcRelByName) {
    if (spec === pkgName) {
      return tryRel(`${srcRel}/index`);
    }
    if (spec.startsWith(`${pkgName}/`)) {
      const sub = spec.slice(pkgName.length + 1).replace(/\.js$/, "");
      return tryRel(`${srcRel}/${sub}`);
    }
  }
  return null;
}

function findImportedSymbolFile(
  sf: ts.SourceFile,
  fileRel: string,
  symbolName: string,
  fileSfCache: ReadonlyMap<string, ts.SourceFile>,
  pkgSrcRelByName: ReadonlyMap<string, string>,
): { sf: ts.SourceFile; rel: string; origName: string; decl: ts.Node | null } | null {
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    const clause = st.importClause;
    let origName: string | null = null;
    if (clause?.name?.text === symbolName) {
      origName = "default";
    } else if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      const hit = clause.namedBindings.elements.find((e) => e.name.text === symbolName);
      if (hit) origName = hit.propertyName ? hit.propertyName.text : hit.name.text;
    }
    if (!origName) continue;
    const targetRel = resolveModuleSpecifier(spec, fileRel, fileSfCache, pkgSrcRelByName);
    if (!targetRel) continue;
    const targetSf = fileSfCache.get(targetRel);
    if (!targetSf) continue;
    const resolved =
      origName === "default"
        ? null
        : resolveExportedDecl(targetSf, targetRel, origName, fileSfCache, pkgSrcRelByName);
    if (resolved) {
      return { sf: resolved.sf, rel: resolved.rel, origName, decl: resolved.decl };
    }
    return { sf: targetSf, rel: targetRel, origName, decl: null };
  }
  return null;
}

function findBoundTargetNames(
  clsNode: ts.ClassDeclaration,
  bindFields: ReadonlySet<string>,
  sf: ts.SourceFile,
): string[] {
  const fnNames: string[] = [];
  function collectCalls(expr: ts.Expression): void {
    if (ts.isCallExpression(expr)) {
      if (ts.isIdentifier(expr.expression)) fnNames.push(expr.expression.text);
      for (const a of expr.arguments) collectCalls(a);
    } else if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
      const visitBody = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
          fnNames.push(n.expression.text);
        }
        ts.forEachChild(n, visitBody);
      };
      visitBody(expr.body);
    } else if (ts.isIdentifier(expr)) {
      fnNames.push(expr.text);
    } else if (ts.isObjectLiteralExpression(expr)) {
      for (const p of expr.properties) {
        if (ts.isPropertyAssignment(p)) collectCalls(p.initializer);
        else if (ts.isShorthandPropertyAssignment(p)) fnNames.push(p.name.text);
      }
    }
  }
  function visit(n: ts.Node): void {
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(n.left) &&
      n.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
      bindFields.has(n.left.name.text)
    ) {
      collectCalls(n.right);
    } else if (
      ts.isPropertyDeclaration(n) &&
      n.name &&
      n.initializer &&
      bindFields.has(propNameText(n.name, sf))
    ) {
      collectCalls(n.initializer);
    }
    ts.forEachChild(n, visit);
  }
  visit(clsNode);
  return [...new Set(fnNames)];
}

function joinCmdPath(parent: string, sub: string): string {
  const cleanSub = sub.trim();
  if (!parent) return cleanSub;
  if (!cleanSub) return parent;
  if (cleanSub === parent || cleanSub.startsWith(`${parent} `)) return cleanSub;
  return `${parent} ${cleanSub}`;
}

function extractCommanderInfo(
  root: ts.Node,
  sf: ts.SourceFile,
  fileRel: string,
  fileSfCache: ReadonlyMap<string, ts.SourceFile>,
  pkgSrcRelByName: ReadonlyMap<string, string>,
  rootPrefix = "",
  visited = new Set<string>(),
  depth = 0,
  cmdParamIdx = 0,
): {
  commands: string[];
  options: CliOption[];
  descriptions: string[];
} {
  if (depth > 6) return { commands: [], options: [], descriptions: [] };
  const visitKey = `${fileRel}:${root.pos}:${rootPrefix}:${cmdParamIdx}`;
  if (visited.has(visitKey)) return { commands: [], options: [], descriptions: [] };
  visited.add(visitKey);

  const commands: string[] = [];
  const options: CliOption[] = [];
  const descriptions: string[] = [];
  const varPaths = new Map<string, string>();

  // Seed Commander parameter identifier at `cmdParamIdx` (supports Command in any parameter position)
  const seedParam = (params: ts.NodeArray<ts.ParameterDeclaration>): void => {
    const param = params[cmdParamIdx];
    if (param && ts.isIdentifier(param.name)) {
      varPaths.set(param.name.text, rootPrefix);
    }
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

  const resolveExprPath = (expr: ts.Expression): string | null => {
    if (ts.isIdentifier(expr)) {
      return varPaths.has(expr.text) ? (varPaths.get(expr.text) ?? "") : null;
    }
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) {
      return resolveExprPath(expr.expression);
    }
    if (ts.isCallExpression(expr)) {
      if (ts.isPropertyAccessExpression(expr.expression)) {
        const meth = expr.expression.name.text;
        const parentPath = resolveExprPath(expr.expression.expression);
        if (meth === "command") {
          const arg0 = expr.arguments[0];
          if (arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) {
            return joinCmdPath(parentPath ?? rootPrefix, arg0.text);
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
      // Wrapper helper like `scoped(ticket.command("show <id>"), t)` or `node(command)`
      for (const a of expr.arguments) {
        const p = resolveExprPath(a);
        if (p !== null) return p;
      }
    }
    return null;
  };

  function visit(node: ts.Node): void {
    // Track `const ticket = org.command("ticket")...`
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const boundPath = resolveExprPath(node.initializer);
      if (boundPath !== null) {
        varPaths.set(node.name.text, boundPath);
      }
    }

    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text;
        const arg0 = node.arguments[0];
        const arg1 = node.arguments[1];
        if (arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) {
          const receiverPath = resolveExprPath(node.expression.expression) ?? rootPrefix;
          if (name === "command") {
            commands.push(joinCmdPath(receiverPath, arg0.text));
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
              command: receiverPath || undefined,
            });
          }
        }
      } else if (ts.isIdentifier(node.expression) && node.arguments.length > 0) {
        // Follow any local or imported helper receiving a tracked Commander instance in any argument position
        const callee = node.expression.text;
        let cmdArgIdx = -1;
        let cmdArgPath: string | null = null;
        for (let i = 0; i < node.arguments.length; i++) {
          const arg = node.arguments[i];
          const p = arg ? resolveExprPath(arg) : null;
          if (p !== null) {
            cmdArgIdx = i;
            cmdArgPath = p;
            break;
          }
        }
        if (cmdArgPath !== null && cmdArgIdx !== -1) {
          const localDecl = findTopLevelDecl(sf, callee);
          if (localDecl) {
            const sub = extractCommanderInfo(
              localDecl,
              sf,
              fileRel,
              fileSfCache,
              pkgSrcRelByName,
              cmdArgPath,
              visited,
              depth + 1,
              cmdArgIdx,
            );
            commands.push(...sub.commands);
            options.push(...sub.options);
            descriptions.push(...sub.descriptions);
          } else {
            const imp = findImportedSymbolFile(sf, fileRel, callee, fileSfCache, pkgSrcRelByName);
            if (imp) {
              const sub = extractCommanderInfo(
                imp.decl ?? imp.sf,
                imp.sf,
                imp.rel,
                fileSfCache,
                pkgSrcRelByName,
                cmdArgPath,
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
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return { commands, options, descriptions };
}

function parseSlotType(
  typeNode: ts.TypeNode | undefined,
  sf: ts.SourceFile,
): { data: string; code: string | null } {
  if (!typeNode) return { data: "unknown", code: null };
  if (ts.isTypeReferenceNode(typeNode) && typeNode.typeName.getText(sf) === "Slot") {
    const args = typeNode.typeArguments ?? [];
    const data = args[0] ? cleanTypeWs(args[0].getText(sf)) : "unknown";
    const code = args[1] ? cleanTypeWs(args[1].getText(sf)) : null;
    return { data, code: code === "never" ? null : code };
  }
  return { data: cleanTypeWs(typeNode.getText(sf)), code: null };
}

/* ---------- @prismshadow/penguin-core/kernel Extraction ---------- */

interface KernelFileEntry {
  fn: string;
  rel: string;
  sf: ts.SourceFile;
}

type ResolvedKernelSymbol =
  | {
      externalReexport: {
        from: string;
        orig: string;
        sf: ts.SourceFile;
        st: ts.ExportDeclaration;
        fn: string;
        rel: string;
      };
    }
  | {
      externalReexport?: undefined;
      st: ts.Statement;
      sf: ts.SourceFile;
      fn: string;
      rel: string;
    };

function extractKernelPackage(repo: string): { exports: KernelExport[] } {
  const kdir = path.join(repo, "packages/core/src/kernel");
  const idxPath = path.join(kdir, "index.ts");
  if (!fs.existsSync(idxPath)) return { exports: [] };

  const sfByFile = new Map<string, KernelFileEntry>();
  for (const fn of fs
    .readdirSync(kdir)
    .filter((x) => x.endsWith(".ts"))
    .sort()) {
    const full = path.join(kdir, fn);
    const text = fs.readFileSync(full, "utf8");
    sfByFile.set(fn, {
      fn,
      rel: `packages/core/src/kernel/${fn}`,
      sf: ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    });
  }

  function resolveSymbolInFile(
    fn: string,
    origName: string,
    depth = 0,
  ): ResolvedKernelSymbol | null {
    if (depth > 4) return null;
    const entry = sfByFile.get(fn);
    if (!entry) return null;
    const { sf, rel } = entry;

    for (const st of sf.statements) {
      if (
        (ts.isFunctionDeclaration(st) ||
          ts.isClassDeclaration(st) ||
          ts.isInterfaceDeclaration(st) ||
          ts.isTypeAliasDeclaration(st)) &&
        st.name?.text === origName
      ) {
        return { st, sf, fn, rel };
      }
      if (ts.isVariableStatement(st)) {
        for (const decl of st.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === origName) {
            return { st, sf, fn, rel };
          }
        }
      }
      if (
        ts.isExportDeclaration(st) &&
        st.moduleSpecifier &&
        ts.isStringLiteral(st.moduleSpecifier) &&
        st.exportClause &&
        ts.isNamedExports(st.exportClause)
      ) {
        for (const el of st.exportClause.elements) {
          if (el.name.text !== origName) continue;
          const targetName = el.propertyName ? el.propertyName.text : el.name.text;
          const spec = st.moduleSpecifier.text;
          if (spec.startsWith("./")) {
            return resolveSymbolInFile(
              spec.slice(2).replace(/\.js$/, ".ts"),
              targetName,
              depth + 1,
            );
          }
          return {
            externalReexport: { from: spec, orig: targetName, sf, st, fn, rel },
          };
        }
      }
    }
    return null;
  }

  const idxEntry = sfByFile.get("index.ts");
  if (!idxEntry) return { exports: [] };
  const exportsList: KernelExport[] = [];

  for (const st of idxEntry.sf.statements) {
    if (
      !ts.isExportDeclaration(st) ||
      !st.moduleSpecifier ||
      !ts.isStringLiteral(st.moduleSpecifier) ||
      !st.exportClause ||
      !ts.isNamedExports(st.exportClause)
    ) {
      continue;
    }
    const fromFile = st.moduleSpecifier.text.slice(2).replace(/\.js$/, ".ts");
    const stmtTypeOnly = st.isTypeOnly;
    for (const el of st.exportClause.elements) {
      const name = el.name.text;
      const orig = el.propertyName ? el.propertyName.text : name;
      const isTypeOnly = stmtTypeOnly || el.isTypeOnly;
      const resolved = resolveSymbolInFile(fromFile, orig);
      if (!resolved) continue;

      const importStmt = isTypeOnly
        ? `import type { ${name} } from "@prismshadow/penguin-core/kernel";`
        : `import { ${name} } from "@prismshadow/penguin-core/kernel";`;

      if (resolved.externalReexport) {
        const ex = resolved.externalReexport;
        const jsd = getJsDocFull(ex.sf, ex.st);
        const fallback = `Re-exported from \`${ex.from}\` for defining versioned context schemas passed to \`schema()\`.`;
        exportsList.push({
          name,
          slug: name,
          isTypeOnly,
          kind: "function",
          sourceFile: ex.fn,
          file: ex.rel,
          line: lineOf(ex.sf, ex.st.getStart(ex.sf)),
          importStmt,
          sig: `export { ${ex.orig}${ex.orig !== name ? ` as ${name}` : ""} } from "${ex.from}";`,
          doc: jsd.doc.length ? jsd.doc : [fallback],
          docBlocks: jsd.docBlocks.length ? jsd.docBlocks : [{ kind: "p", text: fallback }],
          params: [],
          returnType: "",
          members: [],
          variants: [],
        });
        continue;
      }

      const { st: node, sf, fn, rel } = resolved;
      const jsd = getJsDocFull(sf, node);
      let kind: KernelExportKind = "type_alias";
      let sig = "";
      let params: ParamItem[] = [];
      let returnType = "";
      let members: MemberItem[] = [];
      const variants: UnionVariant[] = [];

      if (ts.isFunctionDeclaration(node)) {
        kind = KERNEL_DECORATORS.has(name) ? "decorator" : "function";
        const isAsync = hasMod(node, ts.SyntaxKind.AsyncKeyword);
        const tp = node.typeParameters
          ? `<${node.typeParameters.map((x) => x.getText(sf)).join(", ")}>`
          : "";
        params = node.parameters.map((p) => ({
          name: p.name.getText(sf),
          optional: Boolean(p.questionToken || p.initializer),
          type: p.type ? cleanTypeWs(p.type.getText(sf)) : "unknown",
          defaultVal: p.initializer ? cleanTypeWs(p.initializer.getText(sf)) : "",
        }));
        returnType = node.type ? cleanTypeWs(node.type.getText(sf)) : "";
        const paramsFormatted =
          node.parameters.length > 2
            ? `\n  ${node.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(",\n  ")},\n`
            : node.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(", ");
        sig = `export ${isAsync ? "async " : ""}function ${name}${tp}(${paramsFormatted})${returnType ? `: ${returnType}` : ""}`;
      } else if (ts.isClassDeclaration(node)) {
        kind = "class";
        sig = extractClassDecl(node, sf, "class");
        members = extractMembers(node.members, sf, true);
      } else if (ts.isInterfaceDeclaration(node)) {
        kind = "interface";
        sig = node.getText(sf);
        members = extractMembers(node.members, sf, false);
      } else if (ts.isTypeAliasDeclaration(node)) {
        kind = "type_alias";
        sig = node.getText(sf);
        if (ts.isUnionTypeNode(node.type)) {
          let prevEnd = node.type.pos;
          for (const branch of node.type.types) {
            let bj = getJsDocFull(sf, branch);
            if (!bj.doc.length) {
              const slice = sf.text.slice(prevEnd, branch.getStart(sf));
              const m = slice.match(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*\|?\s*$/);
              if (m?.[1]) bj = parsedDocFromRaw(`/**${m[1]}*/`);
            }
            variants.push({
              type: cleanTypeWs(branch.getText(sf)),
              doc: bj.doc,
              docBlocks: bj.docBlocks,
            });
            prevEnd = branch.end;
          }
        } else if (ts.isTypeLiteralNode(node.type)) {
          members = extractMembers(node.type.members, sf, false);
        }
      } else {
        kind = "function";
        sig = node.getText(sf);
      }

      exportsList.push({
        name,
        slug: name,
        isTypeOnly,
        kind,
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
      });
    }
  }

  // Scheme B (Angular-style exact identifier slug): preserve original casing for safe single-segment
  // identifiers, sanitize any non-identifier alias, and disambiguate case-insensitive collisions by kind.
  const sanitizeKernelSlug = (rawName: string): string => {
    const candidate = /^[A-Za-z0-9_$][A-Za-z0-9_$.-]*$/.test(rawName) ? rawName : slugOf(rawName);
    if (!candidate || candidate === "." || candidate === ".." || /[/\\]/.test(candidate)) {
      throw new Error(`Unsafe kernel export slug derived from "${rawName}"`);
    }
    return candidate;
  };
  const lowerCounts = new Map<string, number>();
  for (const e of exportsList) {
    const base = sanitizeKernelSlug(e.name);
    const lc = base.toLowerCase();
    lowerCounts.set(lc, (lowerCounts.get(lc) ?? 0) + 1);
  }
  const seenLowerSlugs = new Set<string>();
  for (const e of exportsList) {
    const base = sanitizeKernelSlug(e.name);
    e.slug = (lowerCounts.get(base.toLowerCase()) ?? 0) > 1 ? `${base}.${e.kind}` : base;
    const slugLc = e.slug.toLowerCase();
    if (seenLowerSlugs.has(slugLc)) {
      throw new Error(`Unresolved case-insensitive kernel slug collision: ${e.slug}`);
    }
    seenLowerSlugs.add(slugLc);
  }

  return { exports: exportsList };
}

/* ---------- Full Monorepo AST Extraction ---------- */

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
  doc: string[];
  docBlocks: ParsedDoc["docBlocks"];
  parentDoc: string[];
  parentDocBlocks: ParsedDoc["docBlocks"];
  pkg: string;
  area: AreaKind;
  file: string;
  line: number;
}

function readGitStamp(repo: string): { sha: string; date: string; subject: string } {
  const git = (args: string[]): string =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  try {
    return {
      sha: git(["rev-parse", "--short", "HEAD"]),
      date: git(["log", "-1", "--format=%ci"]),
      subject: git(["log", "-1", "--format=%s"]),
    };
  } catch {
    return { sha: "main", date: "", subject: "" };
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
  const pkgSrcRelByName = new Map(
    pkgRoots.map((pr) => [pr.pkgName, path.relative(repo, pr.srcDir).replace(/\\/g, "/")]),
  );

  const rawModules: ModuleRecord[] = [];
  const rawComponents: ComponentRecord[] = [];
  const rawIfaces: IfaceRecord[] = [];
  const rawSlotIfaces: RawSlotIface[] = [];
  const fileSfCache = new Map<string, ts.SourceFile>();
  const fileHostClasses = new Map<string, Array<{ name: string; kind: "module" | "component" }>>();
  const classNodeByKey = new Map<string, ts.ClassDeclaration>();

  for (const pr of pkgRoots) {
    for (const f of walkTs(pr.srcDir)) {
      const rel = path.relative(repo, f).replace(/\\/g, "/");
      const text = fs.readFileSync(f, "utf8");
      const sf = ts.createSourceFile(
        f,
        text,
        ts.ScriptTarget.Latest,
        true,
        f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      fileSfCache.set(rel, sf);

      const hostClasses: Array<{ name: string; kind: "module" | "component" }> = [];
      for (const st of sf.statements) {
        if (ts.isClassDeclaration(st) && st.name) {
          const name = st.name.text;
          const decs = getDecorators(st);
          const decNames = decs.map((d) => decName(d, sf));
          const isModule = decNames.includes("Module");
          const isComp = decNames.includes("Component");
          const isIface = decNames.includes("Interface");

          if (isModule || isComp) {
            const nodeKind = isModule ? "module" : "component";
            hostClasses.push({ name, kind: nodeKind });
            classNodeByKey.set(`${rel}#${name}`, st);
            const dec = decs.find((d) => decName(d, sf) === (isModule ? "Module" : "Component"));
            let meta: Record<string, unknown> = {};
            let contextRaw: string | null = null;
            if (dec && ts.isCallExpression(dec.expression) && dec.expression.arguments.length > 0) {
              const arg = dec.expression.arguments[0];
              if (arg && ts.isObjectLiteralExpression(arg)) {
                const evaluated = evalExpr(arg, sf);
                if (evaluated && typeof evaluated === "object") {
                  meta = evaluated as Record<string, unknown>;
                }
                for (const prop of arg.properties) {
                  if (ts.isPropertyAssignment(prop) && propNameText(prop.name, sf) === "context") {
                    contextRaw = prop.initializer.getText(sf);
                  }
                }
              }
            }

            const uses: UseField[] = [];
            const provides: ProvideField[] = [];
            const binds: BindField[] = [];
            for (const m of st.members) {
              if (!ts.isPropertyDeclaration(m) || !m.name) continue;
              const field = propNameText(m.name, sf);
              const typeStr = m.type ? cleanTypeWs(m.type.getText(sf)) : "unknown";
              const raw = m.getText(sf).trim();
              for (const md of getDecorators(m)) {
                const dn = decName(md, sf);
                const firstArg =
                  ts.isCallExpression(md.expression) && md.expression.arguments.length > 0
                    ? evalExpr(md.expression.arguments[0], sf)
                    : undefined;
                if (dn === "Use") {
                  uses.push({
                    field,
                    type: typeStr,
                    from: typeof firstArg === "string" ? firstArg : null,
                    raw,
                  });
                } else if (dn === "Provide") {
                  provides.push({ field, type: typeStr, raw });
                } else if (dn === "Bind") {
                  binds.push({ field, id: String(firstArg ?? ""), type: typeStr, raw });
                }
              }
            }

            const impls: string[] = [];
            for (const hc of st.heritageClauses ?? []) {
              if (hc.token === ts.SyntaxKind.ImplementsKeyword) {
                for (const t of hc.types) impls.push(t.expression.getText(sf));
              }
            }

            const clsJsd = getJsDocFull(sf, st);
            const methods = extractMembers(st.members, sf, false).filter(
              (m) => m.kind === "method",
            );
            const baseRec = {
              name,
              slug: "",
              pkg: pr.pkgName,
              pkgSub: pr.sub,
              area: pr.area,
              file: rel,
              line: lineOf(sf, st.getStart(sf)),
              doc: clsJsd.doc,
              docBlocks: clsJsd.docBlocks,
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
              rawDecl: extractClassDecl(st, sf, nodeKind),
              parents: [] as ModuleRecord[],
            };
            if (isModule) {
              rawModules.push({ ...baseRec, kind: "module", resolvedChildren: [] });
            } else {
              rawComponents.push({ ...baseRec, kind: "component", primaryParent: null, href: "" });
            }
          }

          if (isIface) {
            const ij = getJsDocFull(sf, st);
            rawIfaces.push({
              name,
              slug: "",
              pkg: pr.pkgName,
              pkgSub: pr.sub,
              area: pr.area,
              file: rel,
              line: lineOf(sf, st.getStart(sf)),
              doc: ij.doc,
              docBlocks: ij.docBlocks,
              members: extractMembers(st.members, sf, false),
              rawDecl: extractClassDecl(st, sf, "interface"),
            });
          }
        } else if (ts.isInterfaceDeclaration(st) && st.name.text.endsWith("Slots")) {
          const baseName = st.name.text.slice(0, -"Slots".length);
          const ifaceDoc = getJsDocFull(sf, st);
          for (const m of st.members) {
            if (!ts.isPropertySignature(m) || !m.name) continue;
            const { data, code } = parseSlotType(m.type, sf);
            const mj = getJsDocFull(sf, m);
            rawSlotIfaces.push({
              slotsIface: st.name.text,
              baseName,
              prop: propNameText(m.name, sf),
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
      fileHostClasses.set(rel, hostClasses);
    }
  }

  // Assign deterministic module slugs
  const usedModSlugs = new Set<string>();
  rawModules.sort(
    (a, b) => AREA_PRIORITY[a.area] - AREA_PRIORITY[b.area] || a.name.localeCompare(b.name),
  );
  for (const m of rawModules) {
    let base = slugOf(m.name.replace(/Module$/, "") || m.name);
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
    while (usedModSlugs.has(slug)) slug += "-2";
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
  for (const c of rawComponents) {
    c.slug = slugOf(c.name);
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

  for (const m of rawModules) {
    for (const cname of m.children) {
      const childMod = resolveModuleFor(cname, m.area, m.file);
      const childComp = childMod ? null : compByName.get(cname);
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
    while (usedIfaceSlugs.has(slug)) slug += "-2";
    usedIfaceSlugs.add(slug);
    it.slug = slug;
  }

  const kernel = extractKernelPackage(repo);

  const allNodes: Array<ModuleRecord | ComponentRecord> = [...rawModules, ...rawComponents];
  const nodeHref = (n: ModuleRecord | ComponentRecord): string =>
    n.kind === "module" ? `modules/${n.slug}/` : n.href;

  // Slots & contributors
  const contribBySlot = new Map<string, SlotContributor[]>();
  for (const node of allNodes) {
    for (const [slotKey, val] of Object.entries(node.contributes)) {
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

  // Map explicit `@Module({ exports })` and `@Provide()` interface names to their host nodes across files.
  // Never let a bare `@Component implements X` override the `@Module` that exports/owns `X` (e.g. `ProjectsModule.appSeeds` vs `HostAppSeeds`).
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
    const providedIfaces = new Set<string>(
      node.provides.map((p) => p.type.replace(/[<[\s|&?].*$/, "")),
    );
    for (const ifaceName of providedIfaces) {
      if (!ifaceName) continue;
      const list = provideHosts.get(ifaceName) ?? [];
      list.push(node);
      provideHosts.set(ifaceName, list);
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
      ...exportedMods.map((h) => ({ name: h.name, kind: h.kind, area: h.area, pkg: h.pkg })),
      ...providedNodes.map((h) => ({ name: h.name, kind: h.kind, area: h.area, pkg: h.pkg })),
      ...sameFileHosts.map((h) => ({ name: h.name, kind: h.kind, area: s.area, pkg: s.pkg })),
    ];

    let key = candidateHosts
      .map((h) => `${h.name}.${s.prop}`)
      .find((cand) => contribBySlot.has(cand));
    if (!key) {
      const preferredOwner =
        exportedMods.find((h) => h.pkg === s.pkg) ??
        exportedMods.find((h) => h.area === s.area) ??
        providedNodes.find((h) => h.kind === "module" && h.pkg === s.pkg) ??
        providedNodes.find((h) => h.kind === "module" && h.area === s.area) ??
        providedNodes.find((h) => h.pkg === s.pkg) ??
        exportedMods[0] ??
        providedNodes[0];
      if (preferredOwner) {
        key = `${preferredOwner.name}.${s.prop}`;
      } else {
        const modHost =
          sameFileHosts.find((h) => h.kind === "module" && h.name.startsWith(s.baseName)) ??
          sameFileHosts.find((h) => h.kind === "module") ??
          sameFileHosts[0];
        key = `${modHost ? modHost.name : s.baseName}.${s.prop}`;
      }
    }
    const hostClass = key.split(".")[0] ?? s.baseName;
    const hostMod = resolveModuleFor(hostClass, s.area, s.file);
    const hostComp = compByName.get(hostClass);
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
      doc: s.doc.length ? s.doc : s.parentDoc.slice(0, 1),
      docBlocks: s.docBlocks.length ? s.docBlocks : s.parentDocBlocks.slice(0, 1),
      contributors: contribBySlot.get(key) ?? [],
    });
  }
  for (const [slotKey, contributors] of contribBySlot) {
    if (slotMap.has(slotKey)) continue;
    const [hostClass = slotKey, prop = slotKey] = slotKey.split(".");
    const hostMod = modsByName.get(hostClass)?.[0];
    const hostComp = compByName.get(hostClass);
    slotMap.set(slotKey, {
      key: slotKey,
      slotsIface: null,
      prop,
      host: hostClass,
      hostHref: hostMod ? `modules/${hostMod.slug}/` : (hostComp?.href ?? null),
      pkg: hostMod?.pkg ?? hostComp?.pkg ?? "@prismshadow/penguin-server",
      area: hostMod?.area ?? hostComp?.area ?? "server",
      file: hostMod?.file ?? hostComp?.file ?? "",
      line: hostMod?.line ?? hostComp?.line ?? 1,
      data: "unknown",
      code: null,
      doc: [],
      docBlocks: [],
      contributors,
    });
  }
  const slots = [...slotMap.values()].sort((a, b) => a.key.localeCompare(b.key));

  // HTTP route contributions (scoped per contribution ID & matching @Bind router)
  const httpCountByFile = new Map<string, number>();
  for (const node of allNodes) {
    const entries = node.contributes["HttpModule.routes"];
    if (Array.isArray(entries) && entries.length > 0) {
      httpCountByFile.set(node.file, (httpCountByFile.get(node.file) ?? 0) + 1);
    }
  }
  const httpContribs: HttpContribRecord[] = [];
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
          const targetFns = findBoundTargetNames(clsNode, fields, sf);
          for (const fnName of targetFns) {
            const localDecl = findTopLevelDecl(sf, fnName);
            if (localDecl) {
              addEndpoints(extractEndpointsFromNode(localDecl, sf), meta);
              continue;
            }
            const imp = findImportedSymbolFile(sf, node.file, fnName, fileSfCache, pkgSrcRelByName);
            if (imp) {
              addEndpoints(extractEndpointsFromNode(imp.decl ?? imp.sf, imp.sf), {
                ...meta,
                fileOverride: imp.rel,
              });
            }
          }
        }
      }
      if (endpoints.length === 0 && parsedEntries.length === 1) {
        const only = parsedEntries[0];
        addEndpoints(extractEndpointsFromNode(clsNode, sf), {
          mountPrefix: only?.prefix || undefined,
          auth: only?.auth || undefined,
          entryId: only?.id || undefined,
        });
      }
    }

    // Fallback to file-wide scan ONLY when this class is the sole HTTP contributor in its file and has a single mount
    if (
      endpoints.length === 0 &&
      sf &&
      parsedEntries.length === 1 &&
      (httpCountByFile.get(node.file) ?? 0) === 1
    ) {
      const only = parsedEntries[0];
      const meta = {
        mountPrefix: only?.prefix || undefined,
        auth: only?.auth || undefined,
        entryId: only?.id || undefined,
      };
      addEndpoints(extractEndpointsFromNode(sf, sf), meta);
      if (endpoints.length === 0) {
        for (const st of sf.statements) {
          if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
          const spec = st.moduleSpecifier.text;
          if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
          const targetRel = path
            .normalize(path.join(path.dirname(node.file), spec.replace(/\.js$/, ".ts")))
            .replace(/\\/g, "/");
          const impSf = fileSfCache.get(targetRel);
          if (!impSf) continue;
          const more = extractEndpointsFromNode(impSf, impSf);
          if (more.length > 0) {
            addEndpoints(more, { ...meta, fileOverride: targetRel });
            break;
          }
        }
      }
    }

    httpContribs.push({
      cls: node.name,
      slug: slugOf(node.name),
      kind: node.kind,
      nodeHref: nodeHref(node),
      pkg: node.pkg,
      file: node.file,
      line: node.line,
      doc: node.doc,
      docBlocks: node.docBlocks,
      binds: node.binds,
      entries: parsedEntries,
      endpoints,
    });
  }
  httpContribs.sort((a, b) => a.cls.localeCompare(b.cls));

  // CLI commands (scoped per @Bind command factory, following registration helpers & command chains)
  const cliMap = new Map<string, CliCommandRecord>();
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
      const topDoc = sf ? getFileTopJsDoc(sf) : EMPTY_DOC;
      const isSoleInFile = (cliCountByFile.get(node.file) ?? 0) === 1;

      for (const rawEntry of list) {
        const entry = (rawEntry ?? {}) as Record<string, unknown>;
        const key = String(entry.key ?? node.name);
        const entryId = String(entry.id ?? "");
        const slug = slugOf(key);
        const rootCmdPath = key.replace(/\./g, " ");

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
          const targetFns = findBoundTargetNames(clsNode, bindFields, sf);
          for (const fnName of targetFns) {
            const localDecl = findTopLevelDecl(sf, fnName);
            if (localDecl) {
              const info = extractCommanderInfo(
                localDecl,
                sf,
                node.file,
                fileSfCache,
                pkgSrcRelByName,
                rootCmdPath,
              );
              cmdInfo.commands.push(...info.commands);
              cmdInfo.options.push(...info.options);
              cmdInfo.descriptions.push(...info.descriptions);
              continue;
            }
            const imp = findImportedSymbolFile(sf, node.file, fnName, fileSfCache, pkgSrcRelByName);
            if (imp) {
              const info = extractCommanderInfo(
                imp.decl ?? imp.sf,
                imp.sf,
                imp.rel,
                fileSfCache,
                pkgSrcRelByName,
                rootCmdPath,
              );
              cmdInfo.commands.push(...info.commands);
              cmdInfo.options.push(...info.options);
              cmdInfo.descriptions.push(...info.descriptions);
            }
          }
          if (cmdInfo.commands.length === 0 && cmdInfo.options.length === 0) {
            const clsInfo = extractCommanderInfo(
              clsNode,
              sf,
              node.file,
              fileSfCache,
              pkgSrcRelByName,
              rootCmdPath,
            );
            cmdInfo.commands.push(...clsInfo.commands);
            cmdInfo.options.push(...clsInfo.options);
            cmdInfo.descriptions.push(...clsInfo.descriptions);
          }
        }
        if (cmdInfo.commands.length === 0 && cmdInfo.options.length === 0 && sf && isSoleInFile) {
          cmdInfo = extractCommanderInfo(
            sf,
            sf,
            node.file,
            fileSfCache,
            pkgSrcRelByName,
            rootCmdPath,
          );
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
        cliMap.set(slug, {
          name: key,
          slug,
          id: entryId,
          slot: sk,
          cls: node.name,
          nodeHref: nodeHref(node),
          pkg: node.pkg,
          file: node.file,
          line: node.line,
          brief: summaryEn || summaryZh || cmdInfo.descriptions[0] || "",
          briefZh: summaryZh,
          doc: node.doc.length ? node.doc : topDoc.doc,
          docBlocks: node.docBlocks.length ? node.docBlocks : topDoc.docBlocks,
          subcommands: [...new Set(cmdInfo.commands)],
          options: dedupedOpts,
        });
      }
    }
  }
  const cliCmdDir = path.join(repo, "packages/cli/src/commands");
  if (fs.existsSync(cliCmdDir)) {
    for (const f of fs
      .readdirSync(cliCmdDir)
      .filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))
      .sort()) {
      const cmdName = f.replace(/\.ts$/, "");
      const slug = slugOf(cmdName);
      const rel = `packages/cli/src/commands/${f}`;
      const sf = fileSfCache.get(rel);
      const cmdInfo = sf
        ? extractCommanderInfo(sf, sf, rel, fileSfCache, pkgSrcRelByName, cmdName)
        : { commands: [], options: [], descriptions: [] };
      const topDoc = sf ? getFileTopJsDoc(sf) : EMPTY_DOC;
      const existing = cliMap.get(slug);
      if (!existing) {
        cliMap.set(slug, {
          name: cmdName,
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
        if (!existing.subcommands.length && cmdInfo.commands.length)
          existing.subcommands = cmdInfo.commands;
        if (!existing.options.length && cmdInfo.options.length) existing.options = cmdInfo.options;
        if (!existing.doc.length && topDoc.doc.length) {
          existing.doc = topDoc.doc;
          existing.docBlocks = topDoc.docBlocks;
        }
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
