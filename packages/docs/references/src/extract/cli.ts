import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { EMPTY_DOC, extractFileTopJsDoc, slugOf } from "../jsdoc.js";
import type { CliCommandRecord, CliOption, ComponentRecord, ModuleRecord } from "../types.js";
import { findBoundTargetIdentifiers, isSourceTsFile, resolveIdentifierDecl } from "./ast-utils.js";

const CLI_SLOT_KEYS = [
  "CliCommandsModule.commands",
  "ShippedCommandsModule.commands",
  "CompanyCommandsModule.commands",
  "PluginCliCommandsProvider.commands",
] as const;

function commanderNameToken(rawSpec: string): string {
  const trimmed = rawSpec.trim();
  const wsIdx = trimmed.search(/[ \t]/);
  return wsIdx === -1 ? trimmed : trimmed.slice(0, wsIdx);
}

function appendCmdSegments(parent: readonly string[], rawSub: string): string[] {
  const cleanSub = rawSub.trim();
  if (!cleanSub) return [...parent];
  return [...parent, commanderNameToken(cleanSub)];
}

function formatCmdDisplay(parent: readonly string[], rawSub: string): string {
  const cleanSub = rawSub.trim();
  if (parent.length === 0) return cleanSub;
  if (!cleanSub) return parent.join(" ");
  return `${parent.join(" ")} ${cleanSub}`;
}

export function extractCommanderInfo(
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

export function extractCliCommands(params: {
  repo: string;
  allNodes: ReadonlyArray<ModuleRecord | ComponentRecord>;
  fileSfCache: ReadonlyMap<string, ts.SourceFile>;
  classNodeByKey: ReadonlyMap<string, ts.ClassDeclaration>;
  checker: ts.TypeChecker;
  nodeHref: (n: ModuleRecord | ComponentRecord) => string;
}): CliCommandRecord[] {
  const { repo, allNodes, fileSfCache, classNodeByKey, checker, nodeHref } = params;

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

  const cliCountByFile = new Map<string, number>();
  for (const node of allNodes) {
    for (const sk of CLI_SLOT_KEYS) {
      const list = node.contributes[sk];
      if (Array.isArray(list) && list.length > 0) {
        cliCountByFile.set(node.file, (cliCountByFile.get(node.file) ?? 0) + list.length);
      }
    }
  }

  for (const node of allNodes) {
    for (const sk of CLI_SLOT_KEYS) {
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

  return [...cliMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}
