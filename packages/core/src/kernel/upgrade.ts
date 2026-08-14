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
 * document reconciles. MVP accepts the residual risk that boot itself may still
 * throw after dispose — the doc is returned to the caller for persistence, so
 * the worst case is "old impl + parked doc, re-boot by hand", never data loss.
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

export type UpgradeResult<A extends Park> =
  { status: "ok"; mode: "silent" | "migrated"; instance: Instance<A>; doc: Json } | UpgradeBlocked;

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
  // Children the new iface no longer declares are discarded data — report them.
  for (const name of Object.keys(docChildren)) {
    if (!(name in iface.children)) state.dropped.push(`${path}.children.${name}`);
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
  const instance = await boot(opts.impl, opts.iface, doc, opts.resources);
  return { status: "ok", mode: state.migrated ? "migrated" : "silent", instance, doc };
}
