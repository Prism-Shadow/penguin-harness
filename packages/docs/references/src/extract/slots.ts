import ts from "typescript";
import { cleanTypeWs, EMPTY_DOC } from "../jsdoc.js";
import type {
  AreaKind,
  ComponentRecord,
  ModuleRecord,
  ParsedDoc,
  SlotContributor,
  SlotRecord,
} from "../types.js";

export interface RawSlotIface {
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

/** Resolve `Slot<Data, Code>` via TypeChecker aliases (`import type { Slot as KernelSlot }`) and `TypeFlags.Never`. */
export function parseSlotType(
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
export function splitSlotKey(key: string): { module: string; slot: string } | null {
  const dot = key.lastIndexOf(".");
  if (dot <= 0 || dot === key.length - 1) return null;
  const mod = key.slice(0, dot);
  const slot = key.slice(dot + 1);
  if (!mod || !slot) return null;
  return { module: mod, slot };
}

export function assembleSlots(params: {
  rawModules: readonly ModuleRecord[];
  allNodes: ReadonlyArray<ModuleRecord | ComponentRecord>;
  rawSlotIfaces: readonly RawSlotIface[];
  fileHostClasses: ReadonlyMap<
    string,
    ReadonlyArray<{ name: string; kind: "module" | "component" }>
  >;
  modsByName: ReadonlyMap<string, ModuleRecord[]>;
  compByName: ReadonlyMap<string, ComponentRecord>;
  resolveModuleFor: (name: string, callerArea: AreaKind, callerFile: string) => ModuleRecord | null;
  nodeHref: (n: ModuleRecord | ComponentRecord) => string;
}): SlotRecord[] {
  const {
    rawModules,
    allNodes,
    rawSlotIfaces,
    fileHostClasses,
    modsByName,
    compByName,
    resolveModuleFor,
    nodeHref,
  } = params;

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

  return [...slotMap.values()].sort((a, b) => a.key.localeCompare(b.key));
}
