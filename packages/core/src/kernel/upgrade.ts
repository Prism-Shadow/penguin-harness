/**
 * The upgrade ladder, MVP slice: silent → migrator chain → blocked.
 *
 * "Data is not discarded" is machine-decided by strictParse over the parked
 * document (after running per-node migration chains). Any dropped/missing/
 * invalid path blocks the swap: the old instance keeps running untouched and
 * the caller receives the parked doc plus the exact paths — the input for the
 * next rungs of the ladder (auto-upgrader / agent / human), which live outside
 * the kernel.
 *
 * Validate-then-swap: the running tree is only disposed after the whole
 * document reconciles. Boot itself can still fail after the dispose — that
 * residual risk is surfaced as a RETURNED outcome (`status: "failed"`, carrying
 * the parked document), never a throw: the caller holds everything needed to
 * re-boot the previous implementation from that document, so the worst case is
 * an automatic recovery boot, never data loss and never a half-dead process
 * whose old tree is disposed with nothing booted in its place.
 */
import type { Json } from "./json.js";
import { isJsonObject } from "./json.js";
import type { AnyIface, Iface, Park } from "./iface.js";
import { isKeyed } from "./iface.js";
import type { Impl, Instance, ParkedNode, Resources } from "./boot.js";
import { boot } from "./boot.js";

export interface UpgradeBlocked {
  status: "blocked";
  dropped: string[];
  missing: string[];
  invalid: string[];
  /** The parked (and partially migrated) document — persist it; nothing is lost. */
  doc: Json;
}

export interface UpgradeFailed {
  status: "failed";
  /** What the new implementation's boot threw. */
  error: unknown;
  /**
   * The parked document. The OLD tree is disposed by this point (validate-then-swap
   * disposes before boot, so the new tree can adopt what the old one delivered) — this
   * document is what the previous implementation re-boots from.
   */
  doc: Json;
}

export type UpgradeResult<A extends Park> =
  | { status: "ok"; mode: "silent" | "migrated"; instance: Instance<A>; doc: Json }
  | UpgradeBlocked
  | UpgradeFailed;

/** An undeclared child that is an empty container (no data to lose). */
function isEmptyChildDoc(doc: Json): boolean {
  if (doc === null) return true;
  if (isJsonObject(doc) && Object.keys(doc).length === 1 && isJsonObject(doc.items)) {
    return Object.keys(doc.items).length === 0;
  }
  return false;
}

interface ReconcileState {
  dropped: string[];
  missing: string[];
  invalid: string[];
  migrated: boolean;
}

/** Runs migration chains and strict-parses the whole tree; pure, touches no instance. */
function reconcileNode(iface: AnyIface, doc: Json, path: string, state: ReconcileState): Json {
  if (!isJsonObject(doc) || typeof doc.v !== "number" || doc.self === undefined) {
    state.invalid.push(`${path}: not a parked node document`);
    return doc;
  }
  let version = doc.v;
  let self = doc.self;
  if (version > iface.version) {
    state.invalid.push(`${path}.v: parked under v${version}, newer than iface v${iface.version}`);
    return doc;
  }
  // Migrator chain ships with the code (iface.migrations), auto-chained 1→2→3.
  // MVP scope: migrations transform the node's own `self` document; reshaping
  // children is out of scope for the chain and lands in `blocked` instead.
  while (version < iface.version) {
    const migrate = iface.migrations[version];
    if (migrate === undefined) break;
    self = migrate(self);
    version += 1;
    state.migrated = true;
  }
  if (version < iface.version) {
    state.missing.push(`${path}.v: no migration path from v${version} to v${iface.version}`);
  }

  const parsed = iface.context.strictParse(self, `${path}.self`);
  if (!parsed.ok) {
    state.dropped.push(...parsed.dropped);
    state.missing.push(...parsed.missing);
    state.invalid.push(...parsed.invalid);
  }

  const docChildren = isJsonObject(doc.children) ? doc.children : {};
  const children: { [name: string]: Json } = {};
  for (const [name, decl] of Object.entries(iface.children)) {
    const childPath = `${path}.children.${name}`;
    const childDoc = docChildren[name];
    if (isKeyed(decl)) {
      const items: { [key: string]: Json } = {};
      const itemsDoc = isJsonObject(childDoc) ? childDoc.items : undefined;
      if (isJsonObject(itemsDoc)) {
        for (const [key, itemDoc] of Object.entries(itemsDoc)) {
          items[key] = reconcileNode(decl.iface, itemDoc, `${childPath}.items.${key}`, state);
        }
      }
      children[name] = { items };
    } else if (childDoc === undefined) {
      state.missing.push(childPath);
    } else {
      children[name] = reconcileNode(decl, childDoc, childPath, state);
    }
  }
  // Children the new iface no longer declares are discarded data — report
  // them, UNLESS they are empty containers: an empty keyed collection (or a
  // null slot) carries no data, so dropping it discards nothing (linear
  // state tracks values, not shapes).
  for (const [name, childDoc] of Object.entries(docChildren)) {
    if (name in iface.children) continue;
    if (isEmptyChildDoc(childDoc)) continue;
    state.dropped.push(`${path}.children.${name}`);
  }

  const out: ParkedNode = { v: iface.version, self, children };
  return out;
}

export async function upgrade<A extends Park, C extends Json>(opts: {
  current: Instance<Park>;
  impl: Impl<A, C>;
  iface: Iface<A, C>;
  resources: Resources;
}): Promise<UpgradeResult<A>> {
  const parked = opts.current.park();
  const state: ReconcileState = { dropped: [], missing: [], invalid: [], migrated: false };
  const doc = reconcileNode(opts.iface, parked, "$", state);
  if (state.dropped.length > 0 || state.missing.length > 0 || state.invalid.length > 0) {
    return {
      status: "blocked",
      dropped: state.dropped,
      missing: state.missing,
      invalid: state.invalid,
      doc: parked,
    };
  }
  opts.current.dispose();
  let instance: Instance<A>;
  try {
    instance = await boot(opts.impl, opts.iface, doc, opts.resources);
  } catch (error) {
    return { status: "failed", error, doc: parked };
  }
  return { status: "ok", mode: state.migrated ? "migrated" : "silent", instance, doc };
}
