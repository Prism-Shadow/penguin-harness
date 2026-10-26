/**
 * The types a workbench is written against come from the harness that is running it.
 *
 * One machine can run several harnesses — a release, a checkout, a platform someone pushed
 * with interfaces of their own — and none of them is a version on npm. So a workbench does
 * not install its types: the first load writes them into `<workbench>/.harness/`, rendered
 * from THIS platform's interface table —
 *
 *   plugin.d.ts   what `@prismshadow/penguin-server/plugin` resolves to for this workbench
 *                 (./compile.ts): `WorkbenchHost`, `WorkbenchMain` and what they reach, plus
 *                 the shape of the default export
 *   ifaces.json   the slice of the table those declarations were rendered from — the
 *                 workbench's side of the interface comparison (../plugin/iface-check.ts)
 *   harness.json  which table wrote them, and when
 *
 * and then leaves them alone. (`README.md` beside them is not part of that record: it is this
 * harness describing its own contract, rewritten whenever it differs — see {@link README}.) They are the record of what the workbench was written against:
 * a later generation of the platform, or another harness on the same machine, is compared
 * WITH them rather than overwriting them, which is what lets a removed host method be named
 * before the first call instead of failing at it. Deleting the directory is how a workbench
 * is moved onto the harness that runs it now. A dot-directory: no part of the revision or
 * the recorded versions, nothing the watcher reacts to, nothing `npm install` prunes.
 */
import fs from "node:fs";
import path from "node:path";
import type { IfaceTable } from "@prismshadow/penguin-core/kernel";
import { renderDts } from "../plugin/iface-check.js";
import { IDLE_RELEASE_MS } from "./subscribe.js";

export const HARNESS_DIR = ".harness";
const TYPES_FILE = "plugin.d.ts";
const TABLE_FILE = "ifaces.json";

/**
 * The default export's shape, in terms of the two rendered interfaces. The root module's
 * manifest requires the host under the alias `host` and provides the handler under `main`.
 */
const PACKAGE_TYPES = `
export type WorkbenchRequest = Parameters<WorkbenchMain["handle"]>[0];
export type WorkbenchResponse = Awaited<ReturnType<WorkbenchMain["handle"]>>;
export interface WorkbenchModuleCtx<Use> {
  use: Use;
  /** Runs when the tree is disposed (a reload, a removal, the platform going away). */
  effect(dispose: () => void): void;
}
export interface WorkbenchRootModule {
  create(ctx: WorkbenchModuleCtx<{ host: WorkbenchHost }>): {
    api: { main: WorkbenchMain } & Record<string, unknown>;
  };
}
/** Any other module of the package: what it uses is whatever its own manifest requires. */
export interface WorkbenchModule {
  create(ctx: WorkbenchModuleCtx<Record<string, unknown>>): { api?: Record<string, unknown> };
}
/** The default export of index.ts: \`export default { … } satisfies WorkbenchPackage\`. */
export interface WorkbenchPackage {
  modules: { Workbench: WorkbenchRootModule; [name: string]: WorkbenchRootModule | WorkbenchModule };
}
`;

/**
 * The contract in the words of the harness that enforces it. The Agent writing a workbench may
 * carry an old copy of the SDK skill, or none — installed skills are copies, and a platform
 * can be pushed without them — but it always has this folder. What it most often gets wrong
 * without being told is the last step: a page under `ui/` is only a file until the manifest
 * contributes a tab for it, and a workbench with no tab loads clean and shows nothing.
 */
const README = `# This workbench, as the harness running it sees it

Written by the harness; edits here are overwritten. \`plugin.d.ts\` and \`ifaces.json\` in this
folder are the types this workbench was written against — delete \`.harness/\` to take the
running harness's types afresh.

## Files

- \`package.json\` — \`"type": "module"\`, and the manifest under \`penguin.modules\`: a module named
  \`Workbench\` that requires \`host\` (\`@prismshadow/penguin-server#WorkbenchHost\`, from \`Host\`),
  provides \`main\` (\`@prismshadow/penguin-server#WorkbenchMain\`) and contributes its tabs.
- \`index.ts\` — TypeScript, never JavaScript. \`export default { modules: { Workbench: { create(ctx) {
  … } } } } satisfies WorkbenchPackage\`, types imported from \`@prismshadow/penguin-server/plugin\`
  (it resolves to \`.harness/plugin.d.ts\`; nothing to install).
- \`ui/\` — pages and their assets. A page calls the workbench's handler at \`../api/<path>\`.

The handler speaks JSON by default. A request body of another content type arrives as
\`req.bytes\`; a response that names a \`content-type\` in \`headers\` is sent as written (\`body\` a
string, or \`bytes\`, or \`stream\` — an \`async function*\` whose chunks go out as they are yielded:
server-sent events, a relayed streaming answer). A page runs in the user's browser, which may be on another machine: to
show a program running on THIS machine, fetch \`http://127.0.0.1:<port>\` from the handler and
return the answer — never from the page. When branches of \`handle\` answer with different
headers, declare its return type (\`Promise<WorkbenchResponse>\`) so they are not inferred apart.

## A page shows only if a tab is contributed for it

\`\`\`json
"contributes": {
  "WebModule.sessionTabs": [
    { "id": "board.main", "key": "main", "title": "Board", "titleZh": "看板",
      "renderer": { "iframe": { "src": "ui/index.html" } } }
  ]
}
\`\`\`

One entry per tab, beside the chat of this Agent; \`key\` is unique in the workbench; \`src\` is a
file under \`ui/\`. \`"contributes": {}\` is a server-only workbench with no UI — also how a UI is
taken away again.

## Background work

\`host.run\` starts a turn; it does not wait for completion. \`host.sessionResult(id)\` is a
snapshot: \`running\`, \`completed\` with the final \`text\`, or \`failed\` with an \`error\`.
Persist the Session id with \`host.setState\`, then poll from GET requests until terminal. Do not
mark a running snapshot failed because its text is empty. Store small reports in host state;
keep uploaded files outside this watched source directory. Never edit state.json by hand.

## Following a Session live

\`host.subscribe(sessionId, listener)\` hands \`listener\` every record the Session publishes from
now on: the AMSP records \`GET /api/sessions/<id>/amsp\` streams, partial deltas and a subagent's
records (\`origin\` set) included. Nothing is replayed, so subscribe before \`host.run\`. A record
(\`WorkbenchRecord\`) is \`{ timestamp, type, payload, origin? }\`, and \`payload.type\` names it:
\`task_begin\`, \`partial_text\`, \`tool_call\`, \`task_end\`, … A \`task_end\` without \`origin\` ends a
task of the Session itself. The Session reads idle only after it, and until then
\`host.sessionResult\` answers \`running\`: once \`host.sessionStatus(id)\` reads \`idle\`, take the
answer and call the function \`subscribe\` returned (a second call does nothing). Listeners run
after the record is published, in order; one that throws is logged and keeps its subscription.

Reloading or removing this workbench ends all of its subscriptions, so \`create()\` subscribes
again to the Sessions its state says are still running. A subscription whose Session stays idle
with nothing published for ${IDLE_RELEASE_MS / 60_000} minutes ends by itself, and a server restart ends them all,
so keep polling from GET requests as above. A \`plugin.d.ts\` here without \`subscribe\` predates
it; delete \`.harness/\` to take it.

## Did it load

Every save reloads the workbench. \`.build/status.json\` says what came of it: \`ok\`, the compiler's
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

/** Writes this harness's types into the workbench folder, unless it already holds some. */
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

/** The table the workbench was written against, or why it cannot be read. */
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
