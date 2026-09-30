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
 * and then leaves them alone. (`README.md` beside them is not part of that record: it is this
 * harness describing its own contract, rewritten whenever it differs — see {@link README}.) They are the record of what the workflow was written against:
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

/**
 * The contract in the words of the harness that enforces it. The Agent writing a workflow may
 * carry an old copy of the SDK skill, or none — installed skills are copies, and a platform
 * can be pushed without them — but it always has this folder. What it most often gets wrong
 * without being told is the last step: a page under `ui/` is only a file until the manifest
 * contributes a tab for it, and a workflow with no tab loads clean and shows nothing.
 */
const README = `# This workflow, as the harness running it sees it

Written by the harness; edits here are overwritten. \`plugin.d.ts\` and \`ifaces.json\` in this
folder are the types this workflow was written against — delete \`.harness/\` to take the
running harness's types afresh.

## Files

- \`package.json\` — \`"type": "module"\`, and the manifest under \`penguin.modules\`: a module named
  \`Workflow\` that requires \`host\` (\`@prismshadow/penguin-server#WorkflowHost\`, from \`Host\`),
  provides \`main\` (\`@prismshadow/penguin-server#WorkflowMain\`) and contributes its tabs.
- \`index.ts\` — TypeScript, never JavaScript. \`export default { modules: { Workflow: { create(ctx) {
  … } } } } satisfies WorkflowPackage\`, types imported from \`@prismshadow/penguin-server/plugin\`
  (it resolves to \`.harness/plugin.d.ts\`; nothing to install).
- \`ui/\` — pages and their assets. A page calls the workflow's handler at \`../api/<path>\`.

The handler speaks JSON by default. A request body of another content type arrives as
\`req.bytes\`; a response that names a \`content-type\` in \`headers\` is sent as written (\`body\` a
string, or \`bytes\`, or \`stream\` — an \`async function*\` whose chunks go out as they are yielded:
server-sent events, a relayed streaming answer). A page runs in the user's browser, which may be on another machine: to
show a program running on THIS machine, fetch \`http://127.0.0.1:<port>\` from the handler and
return the answer — never from the page. When branches of \`handle\` answer with different
headers, declare its return type (\`Promise<WorkflowResponse>\`) so they are not inferred apart.

## A page shows only if a tab is contributed for it

\`\`\`json
"contributes": {
  "WebModule.sessionTabs": [
    { "key": "main", "title": "Board", "titleZh": "看板",
      "renderer": { "iframe": { "src": "ui/index.html" } } }
  ]
}
\`\`\`

One entry per tab, beside the chat of this Agent; \`key\` is unique in the workflow; \`src\` is a
file under \`ui/\`. \`"contributes": {}\` is a server-only workflow with no UI — also how a UI is
taken away again.

## Did it load

Every save reloads the workflow. \`.build/status.json\` says what came of it: \`ok\`, the compiler's
\`error\` when it did not load (the previous version keeps serving), the \`tabs\` now showing, and
\`hints\` — things that loaded but are probably not what you meant, each with the edit that
settles it. Read it after every edit before telling anyone the work is done.
`;

/** Keeps `.harness/README.md` at this harness's text; best effort, it is documentation. */
function writeReadme(target: string): void {
  try {
    const file = path.join(target, "README.md");
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === README) return;
    fs.writeFileSync(`${file}.tmp`, README);
    fs.renameSync(`${file}.tmp`, file);
  } catch {
    // The folder may have just been removed.
  }
}

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
  if (fs.existsSync(target)) {
    writeReadme(target);
    return;
  }
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
  writeReadme(target);
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
