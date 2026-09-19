/**
 * The types a workflow is written against come from the harness that is running it.
 *
 * One machine can run several harnesses — a release, a checkout, a platform someone pushed
 * with interfaces of their own — and none of them is a version on npm. So a workflow does
 * not install its types: the first load writes them into `<workflow>/.harness/`, rendered
 * from THIS platform's interface table —
 *
 *   plugin.d.ts   what `@prismshadow/penguin-server/plugin` resolves to for this workflow
 *                 (./compile.ts): `WorkflowHost`, `WorkflowMain` and what they reach, plus
 *                 the shape of the default export
 *   ifaces.json   the slice of the table those declarations were rendered from — the
 *                 workflow's side of the interface comparison (../plugin/iface-check.ts)
 *   harness.json  which table wrote them, and when
 *
 * and then leaves them alone. They are the record of what the workflow was written against:
 * a later generation of the platform, or another harness on the same machine, is compared
 * WITH them rather than overwriting them, which is what lets a removed host method be named
 * before the first call instead of failing at it. Deleting the directory is how a workflow
 * is moved onto the harness that runs it now. A dot-directory: no part of the revision or
 * the recorded versions, nothing the watcher reacts to, nothing `npm install` prunes.
 */
import fs from "node:fs";
import path from "node:path";
import type { IfaceTable } from "@prismshadow/penguin-core/kernel";
import { renderDts } from "../plugin/iface-check.js";

export const HARNESS_DIR = ".harness";
const TYPES_FILE = "plugin.d.ts";
const TABLE_FILE = "ifaces.json";

/**
 * The default export's shape, in terms of the two rendered interfaces. The root module's
 * manifest requires the host under the alias `host` and provides the handler under `main`.
 */
const PACKAGE_TYPES = `
export interface WorkflowModuleCtx<Use> {
  use: Use;
  /** Runs when the tree is disposed (a reload, a removal, the platform going away). */
  effect(dispose: () => void): void;
}
export interface WorkflowRootModule {
  create(ctx: WorkflowModuleCtx<{ host: WorkflowHost }>): {
    api: { main: WorkflowMain } & Record<string, unknown>;
  };
}
/** Any other module of the package: what it uses is whatever its own manifest requires. */
export interface WorkflowModule {
  create(ctx: WorkflowModuleCtx<Record<string, unknown>>): { api?: Record<string, unknown> };
}
/** The default export of index.ts: \`export default { … } satisfies WorkflowPackage\`. */
export interface WorkflowPackage {
  modules: { Workflow: WorkflowRootModule; [name: string]: WorkflowRootModule | WorkflowModule };
}
`;

export function harnessTypesFile(dir: string): string {
  return path.join(dir, HARNESS_DIR, TYPES_FILE);
}

/** Writes this harness's types into the workflow folder, unless it already holds some. */
export function installHarnessTypes(
  dir: string,
  platform: IfaceTable & { hash?: string },
  keys: readonly string[],
  now: Date,
): void {
  const target = path.join(dir, HARNESS_DIR);
  if (fs.existsSync(target)) return;
  const { text, slice } = renderDts(platform, keys);
  // Built aside and moved into place: a half-written directory must never read as installed.
  const staging = `${target}.${process.pid}.tmp`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, TYPES_FILE), `${text}\n${PACKAGE_TYPES}`);
  fs.writeFileSync(path.join(staging, TABLE_FILE), `${JSON.stringify(slice, null, 1)}\n`);
  fs.writeFileSync(
    path.join(staging, "harness.json"),
    `${JSON.stringify({ ifaces: platform.hash ?? null, installedAt: now.toISOString() }, null, 1)}\n`,
  );
  fs.renameSync(staging, target);
}

/** The table the workflow was written against, or why it cannot be read. */
export function readHarnessTable(dir: string): IfaceTable | string {
  const file = path.join(dir, HARNESS_DIR, TABLE_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<IfaceTable>;
    if (typeof parsed.ifaces !== "object" || parsed.ifaces === null) throw new Error("no ifaces");
    return { ifaces: parsed.ifaces, types: parsed.types ?? {} };
  } catch (err) {
    return `${HARNESS_DIR}/${TABLE_FILE} cannot be read (${err instanceof Error ? err.message : String(err)}) — delete ${HARNESS_DIR}/ to take this harness's types afresh`;
  }
}
