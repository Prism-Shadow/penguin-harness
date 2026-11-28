import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { cleanTypeWs, extractJsDoc, slugOf } from "../jsdoc.js";
import type {
  AreaKind,
  BindField,
  ComponentRecord,
  ExtractedData,
  IfaceRecord,
  ModuleRecord,
  ProvideField,
  UseField,
} from "../types.js";
import {
  AREA_PRIORITY,
  decName,
  evalExpr,
  extractClassDecl,
  extractMembers,
  extractTypeRefNames,
  getDecorators,
  lineOf,
  propNameText,
  resolveIdentifierDecl,
  toPosixRel,
  walkTs,
} from "./ast-utils.js";
import { extractCliCommands } from "./cli.js";
import { extractHttpContribs } from "./http.js";
import { extractKernelPackage } from "./kernel.js";
import { assembleSlots, parseSlotType, type RawSlotIface } from "./slots.js";

interface PkgRoot {
  sub: string;
  pkgName: string;
  area: AreaKind;
  srcDir: string;
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

function unwrapMetaObject(
  arg: ts.Expression,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): { objLit: ts.ObjectLiteralExpression; objSf: ts.SourceFile } | null {
  if (ts.isObjectLiteralExpression(arg)) return { objLit: arg, objSf: sf };
  if (ts.isIdentifier(arg)) {
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
        return { objLit: init, objSf: targetDecl.getSourceFile() };
      }
    }
  }
  return null;
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
              const unwrapped = unwrapMetaObject(arg, sf, checker);
              if (unwrapped) {
                const { objLit, objSf } = unwrapped;
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

  const slots = assembleSlots({
    rawModules,
    allNodes,
    rawSlotIfaces,
    fileHostClasses,
    modsByName,
    compByName,
    resolveModuleFor,
    nodeHref,
  });

  const httpContribs = extractHttpContribs({
    repo,
    allNodes,
    fileSfCache,
    classNodeByKey,
    checker,
    nodeHref,
  });

  const cliCommands = extractCliCommands({
    repo,
    allNodes,
    fileSfCache,
    classNodeByKey,
    checker,
    nodeHref,
  });

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
