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

function extractParams(
  params: ts.NodeArray<ts.ParameterDeclaration>,
  sf: ts.SourceFile,
): ParamItem[] {
  return params.map((p) => ({
    name: p.name.getText(sf),
    optional: Boolean(p.questionToken || p.initializer),
    type: p.type ? cleanTypeWs(p.type.getText(sf)) : "unknown",
    defaultVal: p.initializer ? cleanTypeWs(p.initializer.getText(sf)) : "",
  }));
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
    const mName = propNameText(m.name, sf);
    if (isNonPublic(m, mName)) return null;
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
      sig: `${mName}${opt}${tp}(${paramText})${returnType ? `: ${returnType}` : ""}`,
      params,
      returnType,
      doc: extractJsDoc(m, sf),
      line: lineOf(sf, m.getStart(sf)),
    };
  }

  if ((ts.isPropertyDeclaration(m) || ts.isPropertySignature(m)) && m.name) {
    const mName = propNameText(m.name, sf);
    if (isNonPublic(m, mName)) return null;
    const opt = m.questionToken ? "?" : "";
    const ro = hasMod(m, ts.SyntaxKind.ReadonlyKeyword) ? "readonly " : "";
    const typ = m.type ? cleanTypeWs(m.type.getText(sf)) : "unknown";
    return {
      name: mName,
      kind: "property",
      sig: `${ro}${mName}${opt}: ${typ}`,
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

const TS_PRINTER = ts.createPrinter({ removeComments: true });

function printNode(node: ts.Node, sf: ts.SourceFile): string {
  return cleanTypeWs(TS_PRINTER.printNode(ts.EmitHint.Unspecified, node, sf));
}

/** Extract resolved property/method members from any TypeScript Type via TypeChecker (handles Omit, Pick, Partial, Readonly, extends, intersections, and generics natively). */
function extractMembersFromType(
  type: ts.Type,
  checker: ts.TypeChecker,
  location: ts.Node,
): MemberItem[] {
  const locSf = location.getSourceFile();
  const synthNode = checker.typeToTypeNode(type, location, ts.NodeBuilderFlags.NoTruncation);
  const synthMemberByName = new Map<string, ts.TypeElement>();
  if (synthNode && ts.isTypeLiteralNode(synthNode)) {
    for (const m of synthNode.members) {
      if ((ts.isPropertySignature(m) || ts.isMethodSignature(m)) && m.name) {
        const key =
          ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) || ts.isNumericLiteral(m.name)
            ? m.name.text
            : printNode(m.name, locSf).replace(/^["']|["']$/g, "");
        synthMemberByName.set(key, m);
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

    const synth = synthMemberByName.get(name);
    if (synth && ts.isMethodSignature(synth)) {
      const params: ParamItem[] = synth.parameters.map((p) => ({
        name: printNode(p.name, locSf),
        optional: Boolean(p.questionToken || p.initializer),
        type: p.type ? printNode(p.type, locSf) : "unknown",
        defaultVal: p.initializer ? printNode(p.initializer, locSf) : "",
      }));
      const retStr = synth.type ? printNode(synth.type, locSf) : "unknown";
      const paramText = params
        .map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`)
        .join(", ");
      out.push({
        name,
        kind: "method",
        sig: `${name}${isOptional ? "?" : ""}(${paramText}): ${retStr}`,
        params,
        returnType: retStr,
        doc,
        line,
      });
      continue;
    }

    if (synth && ts.isPropertySignature(synth)) {
      const ro = hasMod(synth, ts.SyntaxKind.ReadonlyKeyword) ? "readonly " : "";
      const typStr = synth.type ? printNode(synth.type, locSf) : "unknown";
      out.push({
        name,
        kind: "property",
        sig: `${ro}${name}${isOptional ? "?" : ""}: ${typStr}`,
        params: [],
        returnType: typStr,
        doc,
        line,
      });
      continue;
    }

    // Fallback: format directly via TypeChecker while preserving explicit `null` in optional unions
    const propType = checker.getTypeOfSymbolAtLocation(propSym, location);
    const typNode = checker.typeToTypeNode(propType, location, ts.NodeBuilderFlags.NoTruncation);
    let typStr = typNode
      ? printNode(typNode, locSf)
      : cleanTypeWs(checker.typeToString(propType, location, ts.TypeFormatFlags.NoTruncation));
    if (isOptional) {
      typStr =
        typStr
          .split(/\s*\|\s*/)
          .filter((part) => part !== "undefined")
          .join(" | ") || "undefined";
    }
    const ro = decl && hasMod(decl, ts.SyntaxKind.ReadonlyKeyword) ? "readonly " : "";
    out.push({
      name,
      kind: propType.getCallSignatures().length > 0 ? "method" : "property",
      sig: `${ro}${name}${isOptional ? "?" : ""}: ${typStr}`,
      params: [],
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

/* ---------- TypeChecker Symbol Resolution (Replaces Hand-Rolled Module/Export Resolver) ---------- */

function resolveIdentifierDecl(ident: ts.Identifier, checker: ts.TypeChecker): ts.Node | null {
  const sym = checker.getSymbolAtLocation(ident);
  if (!sym) return null;
  const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  const decl = target.valueDeclaration ?? target.declarations?.[0];
  return decl ?? null;
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

function findBoundTargetIdentifiers(
  clsNode: ts.ClassDeclaration,
  bindFields: ReadonlySet<string>,
  sf: ts.SourceFile,
): ts.Identifier[] {
  const idents: ts.Identifier[] = [];
  function collect(expr: ts.Expression): void {
    if (ts.isCallExpression(expr)) {
      if (ts.isIdentifier(expr.expression)) idents.push(expr.expression);
      for (const a of expr.arguments) collect(a);
    } else if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
      const walkBody = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) idents.push(n.expression);
        ts.forEachChild(n, walkBody);
      };
      walkBody(expr.body);
    } else if (ts.isIdentifier(expr)) {
      idents.push(expr);
    } else if (ts.isObjectLiteralExpression(expr)) {
      for (const p of expr.properties) {
        if (ts.isPropertyAssignment(p)) collect(p.initializer);
        else if (ts.isShorthandPropertyAssignment(p)) idents.push(p.name);
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
      collect(n.right);
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

function joinCmdPath(parent: string, sub: string): string {
  const cleanSub = sub.trim();
  if (!parent) return cleanSub;
  if (!cleanSub) return parent;
  if (cleanSub === parent || cleanSub.startsWith(`${parent} `)) return cleanSub;
  return `${parent} ${cleanSub}`;
}

function extractCommanderInfo(
  root: ts.Node,
  checker: ts.TypeChecker,
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
  const sf = root.getSourceFile();
  const visitKey = `${sf.fileName}:${root.pos}:${rootPrefix}:${cmdParamIdx}`;
  if (visited.has(visitKey)) return { commands: [], options: [], descriptions: [] };
  visited.add(visitKey);

  const commands: string[] = [];
  const options: CliOption[] = [];
  const descriptions: string[] = [];
  const varPaths = new Map<string, string>();

  const seedParam = (params: ts.NodeArray<ts.ParameterDeclaration>): void => {
    const param = params[cmdParamIdx];
    if (param && ts.isIdentifier(param.name)) varPaths.set(param.name.text, rootPrefix);
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
          const targetDecl = resolveIdentifierDecl(node.expression, checker);
          if (targetDecl) {
            const sub = extractCommanderInfo(
              targetDecl,
              checker,
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

/* ---------- @prismshadow/penguin-core/kernel Extraction via Official TypeScript Program + TypeChecker ---------- */

function sanitizeKernelSlug(rawName: string): string {
  const candidate = /^[A-Za-z0-9_$][A-Za-z0-9_$.-]*$/.test(rawName) ? rawName : slugOf(rawName);
  if (!candidate || candidate === "." || candidate === ".." || /[/\\]/.test(candidate)) {
    throw new Error(`Unsafe kernel export slug derived from "${rawName}"`);
  }
  return candidate;
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

  // Collect export order & isTypeOnly flags from index.ts, while resolving every symbol through TypeChecker!
  interface BarrelEntry {
    name: string;
    isTypeOnly: boolean;
    specifier: ts.ExportSpecifier;
    stmt: ts.ExportDeclaration;
  }
  const barrelEntries: BarrelEntry[] = [];
  for (const st of idxSf.statements) {
    if (!ts.isExportDeclaration(st) || !st.exportClause || !ts.isNamedExports(st.exportClause)) {
      continue;
    }
    for (const el of st.exportClause.elements) {
      barrelEntries.push({
        name: el.name.text,
        isTypeOnly: Boolean(st.isTypeOnly || el.isTypeOnly),
        specifier: el,
        stmt: st,
      });
    }
  }

  const indexModSym = checker.getSymbolAtLocation(idxSf);
  const modExportByName = new Map(
    (indexModSym ? checker.getExportsOfModule(indexModSym) : []).map((s) => [s.getName(), s]),
  );

  // Build declaration-node -> exported-name map so TypeChecker cross-references resolve natively!
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
    let origName = entry.specifier.propertyName ? entry.specifier.propertyName.text : entry.name;

    // Walk immediate alias hops to preserve any local re-export from an external package (e.g. schema.ts -> "arktype")
    let curSym: ts.Symbol | undefined = expSym;
    for (let hop = 0; hop < 8 && curSym; hop++) {
      for (const d of curSym.declarations ?? []) {
        if (ts.isExportSpecifier(d) && d.getSourceFile().fileName.startsWith(kdir)) {
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
      if (!next || next === curSym) break;
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

  // First pass: assign Scheme B slugs deterministically so expandedOptions can link to typeSlug
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
    const importStmt = entry.isTypeOnly
      ? `import type { ${entry.name} } from "@prismshadow/penguin-core/kernel";`
      : `import { ${entry.name} } from "@prismshadow/penguin-core/kernel";`;

    if (externalFrom || !decl || !decl.getSourceFile().fileName.startsWith(kdir)) {
      const reexpStmt = externalReexpStmt ?? entry.stmt;
      const sf = reexpStmt.getSourceFile();
      const fn = path.basename(sf.fileName);
      const jsd = extractJsDoc(reexpStmt, sf);
      const fromLabel = externalFrom ?? "external";
      const fallback = `Re-exported from \`${fromLabel}\` for defining versioned context schemas passed to \`schema()\`.`;
      exportsList.push({
        name: entry.name,
        slug: entry.name,
        isTypeOnly: entry.isTypeOnly,
        kind: "function",
        sourceFile: fn,
        file: `packages/core/src/kernel/${fn}`,
        line: lineOf(sf, reexpStmt.getStart(sf)),
        importStmt,
        sig: `export { ${origName}${origName !== entry.name ? ` as ${entry.name}` : ""} } from "${fromLabel}";`,
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
    const fn = path.basename(sf.fileName);
    const rel = `packages/core/src/kernel/${fn}`;
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
      const tp = decl.typeParameters
        ? `<${decl.typeParameters.map((x) => x.getText(sf)).join(", ")}>`
        : "";
      params = extractParams(decl.parameters, sf);
      returnType = decl.type ? cleanTypeWs(decl.type.getText(sf)) : "";
      const paramsFormatted =
        decl.parameters.length > 2
          ? `\n  ${decl.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(",\n  ")},\n`
          : decl.parameters.map((p) => cleanTypeWs(p.getText(sf))).join(", ");
      sig = `export ${isAsync ? "async " : ""}function ${entry.name}${tp}(${paramsFormatted})${returnType ? `: ${returnType}` : ""}`;
    } else if (ts.isClassDeclaration(decl)) {
      kind = "class";
      sig = extractClassDecl(decl, sf, "class");
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
            const slice = sf.text.slice(prevEnd, branch.getStart(sf));
            const ranges = ts.getLeadingCommentRanges(slice, 0) ?? [];
            const lastRange = ranges[ranges.length - 1];
            if (lastRange) {
              const rawC = slice.slice(lastRange.pos, lastRange.end);
              if (rawC.startsWith("/**")) bj = parseRawJsDocComment(rawC);
            }
          }
          variants.push({ type: cleanTypeWs(branch.getText(sf)), doc: bj });
          prevEnd = branch.end;
        }
      } else if (ts.isTypeLiteralNode(decl.type)) {
        members = extractMembers(decl.type.members, sf, false);
      } else if (targetSym) {
        // Native TypeChecker evaluation for Omit<...>, Pick<...>, Partial<...>, intersections, etc.!
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
      sourceFile: fn,
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

  // Finalize Scheme B slugs + collision check
  const seenLowerSlugs = new Set<string>();
  const slugByName = new Map<string, string>();
  for (const e of exportsList) {
    const base = sanitizeKernelSlug(e.name);
    e.slug = (lowerCounts.get(base.toLowerCase()) ?? 0) > 1 ? `${base}.${e.kind}` : base;
    const slugLc = e.slug.toLowerCase();
    if (seenLowerSlugs.has(slugLc)) {
      throw new Error(`Unresolved case-insensitive kernel slug collision: ${e.slug}`);
    }
    seenLowerSlugs.add(slugLc);
    slugByName.set(e.name, e.slug);
  }

  // Resolve decorator/function expandedOptions & AST/TypeChecker cross-reference graph natively!
  for (const e of exportsList) {
    const decl = resolvedByName.get(e.name)?.decl;
    if (
      decl &&
      ts.isFunctionDeclaration(decl) &&
      (e.kind === "decorator" || e.kind === "function")
    ) {
      for (const p of decl.parameters) {
        const pName = p.name.getText(decl.getSourceFile());
        const pTypeText = p.type ? cleanTypeWs(p.type.getText(decl.getSourceFile())) : "";
        const isOptParam =
          e.kind === "decorator" ||
          /^(opts|options|meta|config|cfg)$/i.test(pName) ||
          /(Options|Meta|Config)\b/.test(pTypeText);
        if (!isOptParam || !p.type) continue;
        const pType = checker.getTypeAtLocation(p.type);
        const nonNullable = checker.getNonNullableType(pType);
        const typeSym = nonNullable.aliasSymbol ?? nonNullable.getSymbol();
        const typeName = typeSym
          ? (canonicalSymToExportName.get(typeSym) ?? typeSym.getName())
          : "";
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

    // Native TypeChecker cross-reference graph on the declaration signature (excluding function bodies!)
    const rootNode = declNodesByExportName.get(e.name);
    if (rootNode) {
      const refs = new Set<string>();
      const walkRefs = (n: ts.Node): void => {
        // Do not descend into function/method/constructor implementation bodies
        if (
          (ts.isFunctionDeclaration(n) ||
            ts.isMethodDeclaration(n) ||
            ts.isConstructorDeclaration(n) ||
            ts.isGetAccessorDeclaration(n)) &&
          n.body
        ) {
          for (const ch of n.getChildren()) {
            if (ch !== n.body) walkRefs(ch);
          }
          return;
        }
        if (ts.isTypeReferenceNode(n)) {
          const sym = checker.getSymbolAtLocation(n.typeName);
          if (sym) {
            const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
            const refName = canonicalSymToExportName.get(target);
            if (refName && refName !== e.name) refs.add(refName);
          }
        } else if (ts.isExpressionWithTypeArguments(n) && ts.isIdentifier(n.expression)) {
          const sym = checker.getSymbolAtLocation(n.expression);
          if (sym) {
            const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
            const refName = canonicalSymToExportName.get(target);
            if (refName && refName !== e.name) refs.add(refName);
          }
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

  // Build workspace `paths` map for a single official TypeScript Program across the monorepo!
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

  for (const absFile of allFiles) {
    const pr = filePkgMap.get(path.resolve(absFile));
    const sf = program.getSourceFile(absFile);
    if (!pr || !sf) continue;
    const rel = path.relative(repo, absFile).replace(/\\/g, "/");
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
            rawDecl: extractClassDecl(st, sf, "interface"),
          });
        }
      } else if (ts.isInterfaceDeclaration(st) && st.name.text.endsWith("Slots")) {
        const baseName = st.name.text.slice(0, -"Slots".length);
        const parentDoc = extractJsDoc(st, sf);
        for (const m of st.members) {
          if (!ts.isPropertySignature(m) || !m.name) continue;
          const { data, code } = parseSlotType(m.type, sf);
          rawSlotIfaces.push({
            slotsIface: st.name.text,
            baseName,
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

  // Contribution slots (preferring @Module exports & @Provide ownership across files)
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
      const ifaceName = p.type.replace(/[<[\s|&?].*$/, "");
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
    const hostClass = key.split(".")[0] ?? s.baseName;
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
            const declRel = path.relative(repo, declSf.fileName).replace(/\\/g, "/");
            addEndpoints(extractEndpointsFromNode(decl, declSf), {
              ...meta,
              fileOverride: declRel !== node.file ? declRel : undefined,
            });
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

    if (
      endpoints.length === 0 &&
      sf &&
      parsedEntries.length === 1 &&
      (httpCountByFile.get(node.file) ?? 0) === 1
    ) {
      const only = parsedEntries[0];
      addEndpoints(extractEndpointsFromNode(sf, sf), {
        mountPrefix: only?.prefix || undefined,
        auth: only?.auth || undefined,
        entryId: only?.id || undefined,
      });
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
      binds: node.binds,
      entries: parsedEntries,
      endpoints,
    });
  }
  httpContribs.sort((a, b) => a.cls.localeCompare(b.cls));

  // CLI commands (per @Bind -> TypeChecker-resolved helper tree)
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
      const topDoc = sf ? extractFileTopJsDoc(sf) : EMPTY_DOC;
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
          for (const ident of findBoundTargetIdentifiers(clsNode, bindFields, sf)) {
            const decl = resolveIdentifierDecl(ident, checker);
            if (!decl) continue;
            const info = extractCommanderInfo(decl, checker, rootCmdPath);
            cmdInfo.commands.push(...info.commands);
            cmdInfo.options.push(...info.options);
            cmdInfo.descriptions.push(...info.descriptions);
          }
          if (cmdInfo.commands.length === 0 && cmdInfo.options.length === 0) {
            const clsInfo = extractCommanderInfo(clsNode, checker, rootCmdPath);
            cmdInfo.commands.push(...clsInfo.commands);
            cmdInfo.options.push(...clsInfo.options);
            cmdInfo.descriptions.push(...clsInfo.descriptions);
          }
        }
        if (cmdInfo.commands.length === 0 && cmdInfo.options.length === 0 && sf && isSoleInFile) {
          cmdInfo = extractCommanderInfo(sf, checker, rootCmdPath);
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
          doc: node.doc.markdown ? node.doc : topDoc,
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
        ? extractCommanderInfo(sf, checker, cmdName)
        : { commands: [], options: [], descriptions: [] };
      const topDoc = sf ? extractFileTopJsDoc(sf) : EMPTY_DOC;
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
          brief: cmdInfo.descriptions[0] || topDoc.summary || "",
          briefZh: "",
          doc: topDoc,
          subcommands: cmdInfo.commands,
          options: cmdInfo.options,
        });
      } else {
        if (!existing.subcommands.length && cmdInfo.commands.length) {
          existing.subcommands = cmdInfo.commands;
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
