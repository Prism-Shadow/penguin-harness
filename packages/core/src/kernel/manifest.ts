/**
 * A module's manifest: its static description, as a JSON file that is read and checked
 * WITHOUT executing the module — the same split VS Code makes between package.json's
 * `contributes` and the plugin's code.
 *
 *   {
 *     "name": "agents",
 *     "requires": { "projects": { "iface": "ProjectsNeeded", "from": "projects" } },
 *     "provides": { "agents": "Agents" },
 *     "contributes": { "http.routes": [{ "id": "agents.routes", "prefix": "/api/…", "auth": "user" }] },
 *     "context": { "version": 1, "schema": "{ collapsed?: string[] }" },
 *     "children": ["vault", { "keyed": "workflows" }]
 *   }
 *
 * - `provides`: alias → an interface class this module declares, keyed
 *   `<name>#<Export>` in the bundle's iface table.
 * - `requires`: alias → the SHAPE needed (an interface class the consumer declares —
 *   the Go habit of declaring the interface where it is consumed — or `<pkg>#<Export>`,
 *   copied into this bundle's table at build) and `from`, the module WIRED to provide
 *   it. Satisfaction is structural; `from` only says whose implementation.
 * - `contributes`: `<module>.<slot>` → entries, each with a unique `id`. Pure data.
 * - `context`: the parked state's version and schema; migrations are code and live on
 *   the module implementation.
 */
import { type } from "arktype";
import type { Json, JsonObject } from "./json.js";

export interface Requirement {
  readonly iface: string;
  readonly from?: string;
}

export interface ContextDecl {
  readonly version: number;
  /** An arktype definition; absent = opaque (anything parks). */
  readonly schema?: Json;
}

export type ChildRef = string | { readonly keyed: string };

export interface Manifest {
  readonly name: string;
  readonly requires: Readonly<Record<string, Requirement>>;
  readonly provides: Readonly<Record<string, string>>;
  readonly contributes: Readonly<
    Record<string, ReadonlyArray<{ readonly id: string } & JsonObject>>
  >;
  readonly context?: ContextDecl;
  readonly children: ReadonlyArray<ChildRef>;
  /**
   * Aliases in `provides` that are FORWARDED from a child: the module exports what one of
   * its children provides under that interface, so the subtree's other provisions stay
   * private to it. Resolved at boot to the child declaring the interface (else the one
   * child whose provision satisfies it).
   */
  readonly exports?: ReadonlyArray<string>;
  /** What the class was declared as: a component exports itself, a module exports others. Informational. */
  readonly kind?: "module" | "component";
}

const ManifestType = type({
  name: "string > 0",
  requires: { "[string]": { iface: "string > 0", "from?": "string > 0" } },
  provides: { "[string]": "string > 0" },
  contributes: { "[string]": type({ id: "string > 0", "[string]": "unknown" }).array() },
  "context?": { version: "number.integer >= 1", "schema?": "unknown" },
  children: type("string").or({ keyed: "string" }).array(),
  "exports?": "string[]",
  "kind?": "'module' | 'component'",
});

/** Strict parse of a manifest document; throws with the arktype summary on failure. */
export function parseManifest(doc: unknown, where = "manifest"): Manifest {
  const out = ManifestType(doc);
  if (out instanceof type.errors) throw new Error(`${where}: ${out.summary}`);
  return out as unknown as Manifest;
}

/** The iface-table key a manifest reference resolves to. */
export function ifaceKey(moduleName: string, ref: string): string {
  return ref.includes("#") ? ref : `${moduleName}#${ref}`;
}

/** `<module>.<slot>` → its two halves. */
export function splitSlotKey(key: string): { module: string; slot: string } | null {
  const at = key.lastIndexOf(".");
  if (at <= 0 || at === key.length - 1) return null;
  return { module: key.slice(0, at), slot: key.slice(at + 1) };
}
