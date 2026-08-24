/**
 * Hot-update kernel: Park + boot + a static instance tree, ~300 lines.
 *
 * No Node/React/SDK dependencies (arktype is the one library, for context
 * schemas) so both the server platform and the web platform run the same
 * code. See the architecture proposal ("可热更新、可分发的 Agent Harness").
 */
export type { Json, JsonObject } from "./json.js";
export { isJsonObject } from "./json.js";
export type { ParseFail, ParseResult, Schema } from "./schema.js";
export { schema, type } from "./schema.js";
export type { AnyIface, ChildDecl, Iface, KeyedDecl, Park } from "./iface.js";
export { defineIface, ifaceData, isKeyed, keyed } from "./iface.js";
export type {
  AnyImpl,
  Impl,
  Instance,
  KeyedHandle,
  NodeCtx,
  ParkedNode,
  Resources,
} from "./boot.js";
export { boot, BootError, initialDoc } from "./boot.js";
export type { UpgradeBlocked, UpgradeFailed, UpgradeResult } from "./upgrade.js";
export { upgrade } from "./upgrade.js";
