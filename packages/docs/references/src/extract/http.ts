import ts from "typescript";
import { slugOf } from "../jsdoc.js";
import type { ComponentRecord, HttpContribRecord, HttpEndpoint, ModuleRecord } from "../types.js";
import {
  evalExpr,
  findBoundTargetIdentifiers,
  lineOf,
  resolveIdentifierDecl,
  toPosixRel,
} from "./ast-utils.js";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "ALL", "HEAD", "OPTIONS"]);

export function extractEndpointsFromNode(
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

export function extractHttpContribs(params: {
  repo: string;
  allNodes: ReadonlyArray<ModuleRecord | ComponentRecord>;
  fileSfCache: ReadonlyMap<string, ts.SourceFile>;
  classNodeByKey: ReadonlyMap<string, ts.ClassDeclaration>;
  checker: ts.TypeChecker;
  nodeHref: (n: ModuleRecord | ComponentRecord) => string;
}): HttpContribRecord[] {
  const { repo, allNodes, fileSfCache, classNodeByKey, checker, nodeHref } = params;

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
  return httpContribs;
}
