import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { cleanTypeWs, EMPTY_DOC, extractJsDoc, parseRawJsDocComment, slugOf } from "../jsdoc.js";
import type {
  KernelExport,
  KernelExportKind,
  MemberItem,
  ParamItem,
  UnionVariant,
} from "../types.js";
import {
  extractClassDecl,
  extractMembers,
  extractMembersFromType,
  extractParams,
  hasMod,
  isPathInsideOrEqual,
  KERNEL_DECORATORS,
  lineOf,
  SYNTH_SF,
  toPosixRel,
  TS_PRINTER,
} from "./ast-utils.js";

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

const STRICT_FORBIDDEN_BINDINGS = new Set(["eval", "arguments"]);

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

export function extractKernelPackage(repo: string): { exports: KernelExport[] } {
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
            const gapScanner = ts.createScanner(
              ts.ScriptTarget.Latest,
              false,
              ts.LanguageVariant.Standard,
              sf.text.slice(prevEnd, branch.getStart(sf)),
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
