# PRFC-0014 Workflow: A Module Tree in the Agent's Directory

[中文版](PRFC-0014-workflow.zh.md)

> **Source**: `rfcs/PRFC-0014-workflow.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — already landed (default branch `main`, commit [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)).
> **Rev**: v1.0.0 (migrated into the main repository); the conventions for this surface are covered in [README.md](README.md), and per-version changes are recorded in `## Changes` at the end of this document.

- Feature Name: `workflow`
- Start Date: 2026-09-18
- PRFC PR: [Prism-Shadow/penguin-harness-design#194](https://github.com/Prism-Shadow/penguin-harness-design/pull/194)
- Implementation PR: [Prism-Shadow/penguin-harness#718](https://github.com/Prism-Shadow/penguin-harness/pull/718)

2026-10-14: The Workflow of this proposal was renamed to Workbench in implementation [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133), with the directory, interfaces, and routes renamed in step. The text below keeps the Workflow naming of the original decision; the names currently in force follow the specs.

## Summary
[summary]: #summary

**Workflow** is a piece of server-side code an Agent keeps in its own directory, together with the pages it contributes to the UI. `<agentDir>/workflows/<id>/` is a plugin package: a manifest in `package.json#penguin.modules`, an `index.ts` default export paired with the manifest by name (Workflow code is TypeScript; JavaScript is not accepted), `ui/` as the root of static files, and a `state.json` kept by the server. The server boots it as an **independent module tree**, using the same machinery as PRFC-0001.

1. **Only two interfaces cross the boundary.** The host publishes `WorkflowHost` to each Workflow tree (run this Agent, one state document, one line of logging); the Workflow provides `WorkflowMain` (a JSON request handler).
2. **Validate first, run later; the types come from the harness that runs it, and the verdict is left to tsc.** One machine can host several harnesses — a release, some checkout, a platform pushed by someone else carrying its own interfaces — none of them a version on npm, so a Workflow installs nothing: on first load, the platform renders **its own generation's** interface table into a `.d.ts` written into the Workflow directory (`.harness/`), and never touches it again. Both checks run before any code does: first, the Workflow's source is TypeScript and is type-checked against that `.d.ts` under `strict` — whether it **implements** its interfaces correctly, and whether the members it calls exist, are caught here; second, the copy of the table left in `.harness/` and the platform's current-generation table are each rendered into a `.d.ts`, and assignability is decided in both directions — whether the interfaces it **depends on** are compatible with the platform it plugs into. We do not write our own type checker. A Workflow that does not pass fails to load with a named problem, and **the previous instance keeps serving**.
3. **Load by content, keep versions by content.** The hash of the directory's content is the revision: it enters the import URL, so changed code is always re-imported; every successful load is recorded as a version, any version can be restored, and `state.json` does not roll back with it.
4. **The UI is declared by contribution, not by directory convention.** A Workflow submits to the slots the host has opened via the manifest's `contributes`: what is open today is tabs beside Chat (`WebModule.sessionTabs`; one Workflow can submit several), written exactly the way a plugin submits to the platform. Making Workflows appear elsewhere later means the host opens one more slot, not another directory convention. A tab can fill the whole app, and pages follow the app's theme.

## Motivation
[motivation]: #motivation

Between an Agent and the user there is only one interface: the conversation. Any work that has structure and recurs — a to-do board, a review queue, a panel that updates as the task progresses — can only be restated in words, over and over; the state stays in the conversation history and is lost the moment the Session changes.

At the other end is the plugin: it can add pages and server-side code to the platform, but its scope is the entire installation, installed by an administrator, facing all Projects and all Agents. A page that one Agent needs for one particular thing should not require a platform-level install; and the most fitting author of that page is the Agent itself — it should be able to write it offhand and change it offhand.

Letting Agents write code that the server will execute raises three questions that must be answered first:

- **What if it is written wrong.** A single edit by an Agent can be syntactically broken, mismatch the manifest, or have a handler of the wrong shape. Errors must be named before anything runs, and must not take the previously working page down with them.
- **How to get back after breaking it.** An Agent will keep editing its own Workflow; both the user and the Agent need a way back, and that way back must not carry away the data already accumulated.
- **What it may touch.** A Workflow should not get hold of the platform's components; what it can do must be written down as an interface, with the host deciding how much to give.

The Future possibilities of PRFC-0001 already pointed out that "a Workflow as a module in the Agent's directory … is a natural extension of the same machinery"; the layering table in 05 "Server-side module tree" also reserves a row for workflow (the Agent's own directory, installed / reloaded per Agent). This proposal makes that layer real.

Scenarios:

- **The Agent builds itself a to-do page.** The user says "give me a to-do list I can check off"; the Agent writes the manifest, the handler, and the page under `workflows/todo/`, and the *todo* tab appears beside Chat right away, no refresh needed. Items are stored in `state.json`; a button on the page hands "process the next item" back to the Agent via `createSession` and `run`.
- **The Agent breaks the handler.** In the new `index.ts` the return type of `handle` is wrong, or it calls a method the host does not have; type checking reports the file, line, and reason before any code runs, the tab shows this load error, and the page and handler remain the previous version. The Agent fixes it after seeing the error, or the user clicks *Restore* in *History*.
- **One Workflow, two tabs.** The to-do Workflow later gains a "stats" page: the Agent submits one more `sessionTabs` entry in the manifest, pointing at `ui/stats.html` — no second Workflow, and no new convention.
- **A page as the whole app.** `penguin web --app default_project/default_agent/todo` opens the browser straight to that page, with no sidebar and no chat.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

Think of a Workflow as a **plugin that belongs to this Agent alone**: the same package shape, the same validation — the differences are only where it lives, who writes it, and who can see it.

```
<agentDir>/
  agent_state/                  Agent State (Workflows not included)
  workflows/<id>/
    package.json                "type": "module" and penguin.modules: the manifest; no dependencies to install
    index.ts                    default export: { modules: { <Name>: { create } } }, satisfies WorkflowPackage
    ui/                         root of static files; what is placed here and how many pages exist are decided by the manifest
    state.json                  the Workflow's own document, read and written by the server
    .harness/                   written by the platform: plugin.d.ts (types), ifaces.json (the part of the table used to render it), harness.json, README.md (a brief account of the conventions); read-only, never modified
    .build/<revision>/          output transpiled by the server; not counted in the revision, do not edit by hand
    .build/status.json          result of the most recent load; the Agent reads it to learn whether an edit took effect
  workflows-history/<id>/
    <revision>/                 a full copy of the directory at each successful load
    versions.json               the version list, newest first
```

A minimal Workflow:

```json
{
  "name": "todo",
  "version": "0.1.0",
  "type": "module",
  "penguin": {
    "modules": [
      {
        "name": "Workflow",
        "requires": { "host": { "iface": "@prismshadow/penguin-server#WorkflowHost", "from": "Host" } },
        "provides": { "main": "@prismshadow/penguin-server#WorkflowMain" },
        "contributes": {
          "WebModule.sessionTabs": [
            { "id": "todo.board", "key": "board", "title": "Todo", "titleZh": "Todo", "renderer": { "iframe": { "src": "ui/index.html" } } }
          ]
        }
      }
    ]
  }
}
```

```ts
// index.ts
import type { WorkflowPackage } from "@prismshadow/penguin-server/plugin";

interface Doc { items: unknown[] }

export default {
  modules: {
    Workflow: {
      create({ use }) {
        return {
          api: {
            main: {
              async handle({ method, path, body }) {
                const doc = (use.host.getState() ?? { items: [] }) as Doc;
                if (method === "POST" && path === "/items") {
                  doc.items.push(body);
                  await use.host.setState(doc);
                }
                return { status: 200, body: doc };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkflowPackage;
```

```html
<!-- ui/index.html: the page is served under ui/, so its own handler is at ../api/ -->
<button class="wf-primary" onclick="add()">Add</button>
<script>
  const add = () => fetch("../api/items", { method: "POST", body: JSON.stringify({ text: "…" }) });
</script>
```

Understand it this way:

- **The files are the install.** There is no install or enable step; a directory that exists and contains `package.json` is a Workflow, and it is gone when the directory is deleted. The Agent uses the file tools it already has.
- **The code is TypeScript.** `satisfies WorkflowPackage` gives types to `use.host` and to the parameters and return values of `handle`; without it, the implicit `any` under `strict` is itself an error, not a silent pass. The server does the type checking and the transpiling; the Agent runs no build step of any kind, and the server writes the output into `.build/` inside the directory.
- **The types come from the harness that runs it.** `@prismshadow/penguin-server/plugin` is not a package here: on first load the platform writes `.harness/plugin.d.ts`, and that is what this import resolves to. Write `package.json` and a minimal `index.ts` first, let the platform load once, then read `.harness/plugin.d.ts` — that is exactly the `WorkflowHost` this harness provides. After the platform changes generation this record stays untouched; existing Workflows are compared against the new platform, and incompatibility is named at load time rather than at first call; delete `.harness/`, and the Workflow goes back to depending on whichever harness runs it now.
- **The UI is declared.** Whether there are tabs, how many, and what they are called are all written in `contributes`; `ui/` is only where those pages' files live. A Workflow that submits nothing is purely server-side, handler only.
- **Saving is reloading.** The server watches `workflows/` and reloads the corresponding Workflow after file changes; an open tab updates on the event, and the page reloads only when `ui/` changed.
- **A bad edit does not take effect.** When the current files fail to load, `error` states the reason and the previous instance keeps answering requests. The `revision` seen in the list is that of the current files, while what is serving may still be the previous one — that is exactly the state signaled by a non-empty `error`.
- **Code can roll back, data cannot.** Rolling back restores the code files of some version; `state.json` is the Workflow's data and belongs to no version.
- **The Agent learns all of this from a Skill, not from the system prompt.** The directory layout, the two interfaces, the theme variables, and the way back are written in the Workflows section of the `penguin-sdk` Skill, loaded only when the Agent is asked to make a Workflow; nothing is appended to any Agent's system prompt.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### Directory and revision

- The Workflow id is the directory's own name and must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; a directory without `package.json` is not a Workflow. A directory whose `package.json` fails to parse **still is** a Workflow — the error is reported by the loading process, not by letting it vanish from the list.
- `name` / `version` are taken from `package.json`; `name` defaults to the id, and `version` may be null.
- **revision** is the first 12 hex characters of the SHA-256 over all files in the directory (relative paths and contents, sorted by path); `state.json`, `node_modules/`, and entries starting with `.` are excluded. **uiRev** is the same algorithm over only the files under `ui/`, null when there is no `ui/`; it is merely the pages' cache key and does not decide whether tabs exist.
- `workflows/` sits at the same level as `agent_state/`: a Workflow is not in Agent State's version chain; its versions are carried by the history described below.

### Loading

1. Read `package.json`: it must have `"type": "module"` (a Workflow is an ES module; otherwise NodeNext would transpile the entry as CommonJS); every entry of `penguin.modules` goes through `parseManifest`, and an empty list is an error.
2. The entry is `index.ts`; a directory with only `index.js` / `index.mjs` fails to load, with an error stating that a Workflow must be written in TypeScript. The entry and the `.ts` files it relatively imports form one tsc program: the compiler options are fixed by the host (`strict`, NodeNext; a `tsconfig.json` in the directory is not adopted — a Workflow cannot turn strict mode off for itself); before compiling, a directory without `.harness/` has one written by the platform first (see "Interface checks"), `@prismshadow/penguin-server/plugin` is resolved by the compiler host straight to `.harness/plugin.d.ts` without passing through any package, and the remaining imports resolve by Node's rules. The program contains one more virtual root file that assigns the default export to `WorkflowPackage`: the shape is checked even when the author wrote no `satisfies WorkflowPackage`. Any type-checking diagnostic fails the load; the diagnostics (file, line, column, reason) become the `error`, at most 12 reported.
3. After the checks pass, the same program transpiles; the output is written to `.build/<revision>/` **inside** the Workflow directory, and that is what gets imported — different revisions are different URLs, so changed code is always re-imported. It is inside the directory so that the output resolves, by Node's rules, to the Workflow's own `node_modules` (its runtime dependencies); it is a dot-directory because the revision hash, the version copies, and the watcher all skip dot-directories, so the output counts toward neither the revision nor the version history and triggers no reload. It is deleted along with the directory, and after a successful load only the copy for the current revision is kept.
4. The default export must be `{ modules: { <name>: { create } | create } }` (type `WorkflowPackage`), paired with the manifest by name; a module named by the manifest but absent from the export, or `children` pointing at an undeclared module, is an error.
5. The root module must be named `Workflow`, and one item of its `provides` must be `@prismshadow/penguin-server#WorkflowMain`.
6. `bootModules(root, { ifaces, resources, published })`: `ifaces` is the platform's own interface table, and `published` publishes the host object into this tree as the module `Host` (PRFC-0001: capabilities published by the host are virtual root-level siblings, visible everywhere). The same `published` also carries the slots the host opens to Workflows (see "Contributions"). Whole-tree validation runs before any `create()`, and the contributed slot names and data shapes are part of it; the interface comparison in both directions is described in "Interface checks".
7. Success: take the `WorkflowMain` provided by the root module, collect the manifest's contributions, release the previous tree, and record a version. Failure: write one log line, keep the previous tree and the previous handler, and set `error` to the problem text; a Workflow that has never succeeded has no handler, and its `api/*` answers 503.

Each `(project, agent, workflow)` has at most one instance at a time, and at most one load in progress at any moment: a load runs the compiler, and the watcher or a request may trigger again before it finishes; the later one queues behind it and loads whatever is on disk at that time, so versions are recorded in order. When the service component disposes, every watcher is closed and every tree released.

### The two interfaces

```ts
// published by the host, module name Host
abstract class WorkflowHost extends Interface<{
  listAgents(): { agentId: string }[];
  createSession(opts?: { agentId?: string }): Promise<{ sessionId: string }>;
  run(sessionId: string, input: { text: string }[]): Promise<{ sessionId: string; queued: boolean }>;
  sessionStatus(sessionId: string): string;
  getState(): unknown;
  setState(state: unknown): Promise<void>;
  log(message: string): void;
}>() {}

// provided by the Workflow
abstract class WorkflowMain extends Interface<{
  handle(request: { method: string; path: string; query: Record<string, string>; body: unknown }):
    Promise<{ status?: number; body?: unknown }>;
}>() {}
```

- **The same verbs as the SDK**, scoped to the Project the Workflow belongs to. `listAgents` lists this Project's Agents — the values the `agentId` of `createSession` may take (the SDK has no matching verb: the SDK's caller holds the Agent itself). `createSession` is the SDK's `agent.createSession`: it opens a Session for this Agent, and `agentId` names another Agent of the same Project. `run` is the SDK's `session.run`: `input` is likewise a list of entries, each today `{ text }` (the SDK builds it with `userText("…")`, but a Workflow installs no packages, so at runtime there is nowhere to import that constructor from — the entry is written out directly); it runs one round in a new or an existing Session and returns as soon as it has started; a busy Session queues the message as a follow-up (`queued: true`) instead of rejecting; a Session outside this Project is rejected; whatever the Workflow writes, what the Agent hears is a message from the server, never from a human. `sessionStatus` returns the run state of one of this Project's Sessions. It goes through the same pair of Session creator and Task runner that scheduled tasks use.
- **Nothing is structured today; the future only adds optional fields.** `opts`, the elements of `input`, and the return values are all objects: naming a model or a Workspace, carrying images, returning more — each is one more optional member, and by the rules of the interface checks, an optional member added on the platform side does not affect existing Workflows.
- `getState` / `setState` read and write this Workflow's `state.json` (the whole document, replaced atomically); the document is read into memory on first use, and `getState` returns synchronously.
- The host object is constructed per `(project, agent, workflow)`; a Workflow has no way to name a different Agent.
- **The only way to give Workflows more capability is to add members to `WorkflowHost`** (interface first); the Workflow tree cannot reach platform components directly.

### Interface checks

The verdict is always left to tsc, in two passes.

**Pass one: the source against the types it was written against.** See step 2 of "Loading". A Workflow is TypeScript; tsc checks its source under `strict`, against the types the platform wrote into `.harness/plugin.d.ts`. The parameters and return value of `handle`, and every call on `use.host`, are verified here; this answers "did the Workflow **implement** the interface correctly". Measured with the example from the Guide section (tsc 5.9.3): passes and transpiles as written, 351 ms; change `handle` to return a string and misspell `setState` as `setStat`, and it reports `TS2322` (`Promise<string>` not assignable to `Promise<WorkflowResponse>`) and `TS2551 Property 'setStat' does not exist on type 'WorkflowHost'. Did you mean 'setState'?`, with file, line, and column; drop `satisfies WorkflowPackage`, and it reports `TS7031 Binding element 'use' implicitly has an 'any' type` — untyped code does not pass.

**Pass two: whether those types are compatible with the platform's current generation.** Pass one only shows the Workflow is consistent with the types it was written against; the platform may have changed generation since, or the very same directory may be being loaded by another harness. This pass needs **two** declarations to compare:

**The carrier is still `ifaces.json`.** It is the self-contained interface table every package carries with it (references never leave the table), so the check needs no module resolution; the by-value validation of contributed slot data and the by-name verification after `create()` keep using it as well. The two copies have different origins:

- **The consumer's copy is the one it carries itself.** A plugin's `ifaces.json` is generated by `gen-ifaces` when it is built. A Workflow has no build step; its copy is `.harness/ifaces.json`:

  **`.harness/` is written by the platform, once.** When loading a directory without `.harness/`, the platform renders `plugin.d.ts` from **its own generation's** table — `WorkflowHost`, `WorkflowMain`, and the types reachable from them, named by export name (`WorkflowHost`, not the table's key), plus the shape of the default export, `WorkflowPackage` — and writes the part of the table used for that rendering as `ifaces.json`, with the origin and time recorded in `harness.json`. The directory is fully written beside its place and then renamed into position, so a half-written directory is never taken as installed. **After that the platform never touches it again**: it is the record of "what this Workflow was written against", and it is exactly what gets compared after a generation change; refreshing it on every load would degrade the comparison back into "comparing itself with itself". To make a Workflow depend on the current harness again, delete `.harness/`, and the compiler will then report what needs changing. It is a dot-directory: not counted in revisions or version history, ignored by the watcher, and not swept away by `npm install` as a stray package.

  Why not take it from npm: several harnesses can coexist on one machine, and any unreleased commit, any customized platform carrying its own interfaces, corresponds to no version on npm; the types must come from the very platform that runs it. The platform's artifacts already inline their interface table, and rendering takes only a few milliseconds, so every commit naturally carries its own `.d.ts`, with no extra build artifact needed.
- **The platform's copy is its own generation's table**, carried along with the platform's artifacts; a hot-pushed generation carries its own copy.

**The verdict: generate `.d.ts`, check with tsc.** At load time a self-contained `.d.ts` is generated from each of the two tables, plus one check file in which each comparison is an assignment statement; tsc's diagnostics are the problem text. Two directions, both before any `create()` runs:

| Direction | Verdict |
| --- | --- |
| Interfaces the Workflow **depends on** | The platform-generation `WorkflowHost` is assignable to the consumer's copy of `WorkflowHost` |
| Interfaces the Workflow **implements** | The consumer's copy of `WorkflowMain` is assignable to the platform-generation `WorkflowMain` — here the platform is the consumer |

After `create()` there is one more check on **values** (that the declared methods are indeed functions on the returned object); it stays, but it does not replace the two above.

There are four constraints:

1. **Requirements always resolve from the consumer's copy, and failure to resolve is a failure.** An unreadable `.harness/ifaces.json`, or a missing interface that the manifest names, is a named problem; there is never a fallback to the platform's copy — that fallback would be exactly "comparing itself with itself". The same comparison applies to plugins, sharing one implementation with Workflows (`plugin/typescript.ts`, `plugin/iface-check.ts`, invoked at plugin load): a plugin's side is the `ifaces.json` generated inside its package; its practical effect today is described below in "The plugin side still compares nothing today".
2. **Generation is lossless, or it is refused.** The table has no "optional parameters", only types that admit `undefined`; when rendering, such trailing parameters are written back as optional, otherwise `createSession()` would not type-check against `createSession(opts?)`. When the generator meets an expression it cannot faithfully write as TypeScript, it reports a named "unsupported" and refuses the load — never writing `unknown` or `never` to let it through. The same holds on the table's side: `gen-ifaces` erasing generic methods to `unknown` was an oversight, a defect; the table must carry enough information to restore them.
3. **Members are generated as function-typed properties** (`line: (a0: string) => void`), not method shorthand: under `strictFunctionTypes` the former's parameters are contravariant — exactly the rule PRFC-0001 wrote down (parameters contravariant, returns covariant); method shorthand is bivariant and would let narrowed parameters slip through.
4. **`typescript` becomes a runtime dependency of the server and ships with pushes and desktop builds alike.** It is loaded only when the first Workflow needs it; the platform's single-file bundle does not bake it in, and at runtime it is resolved in three places in turn: beside the platform's modules, beside the running program, and among the assets carried by the push. The latter two were added after field testing — on a machine with the packaged desktop edition, the server is a single file without `node_modules`, installed before "the compiler became a dependency", and after a push every Workflow reported "compiler unavailable". The compiler is now carried the way node-pty is: the push packs it as an archive among the assets (the entry and the default library files, 101 files, about 12 MB, content-addressed, transferred once), and the desktop build places the same set of files beside the server bundle. When it cannot be found, no Workflow loads and the reason is stated — there is no "skip the check" path. The hand-written assignability checks in the kernel (`satisfies` / `dataExtends`) still stand in the module tree's whole-tree validation, to be retired with the PRFC-0001 revision; both directions for Workflows are already decided by tsc alone.
5. **Only the needed parts are generated.** The `.d.ts` contains only the interfaces asked for and the types reachable from them, so "refuse what is unsupported" can only be triggered by declarations the Workflow actually depends on.

Measured against the real platform table (158 interfaces, 468 named types, tsc 5.9.3): generating the `.d.ts` takes 9 ms (183 KiB, 0 unsupported expressions), and the whole tsc program — the full table self-checked entry by entry plus three cross-version comparisons — takes 418 ms. Whole-table comparison means that any member the platform removes or changes on a published interface rejects Workflows written against the old one — which is a breaking change anyway; pure additions are unaffected. When the consumer's copy records the parameter of `Log.line` as `number` and `Memory` records one method the platform has since removed, the diagnostics are:

```
Type 'server#Log' is not assignable to type 'server#Log'.
  Types of property 'line' are incompatible.
    Type '(a0: string) => void' is not assignable to type '(a0: number) => void'.
      Type 'number' is not assignable to type 'string'.
Property 'removedSince' is missing in type 'server#Memory' but required in type 'server#Memory'.
```

Unchanged interfaces pass. Replacing the checker belongs to the scope of PRFC-0001; its revision is given in a separate document. What this document states are the requirements Workflow places on it and the reasons.

#### The plugin side still compares nothing today

The comparison is already wired into the plugin load path, but tested against every plugin table at the top of the chain, the result is "nothing to compare": 1 of `claude-code`'s 2 problems, 12 of `discord-bot`'s 13 — the plugin tables **carry no copy of the host interfaces**. The cause is in the generator, in two places:

1. **`gen-ifaces` writes only the interfaces the package declares itself.** It skips declaration files and `node_modules`, so the host interfaces a plugin depends on are not projected into the plugin's table — the comment on `PluginHost.ifaces()` saying "the plugin's table carries a copy of the host interfaces as seen at compile time" describes the intent, not the present state.
2. **Interfaces written with `@Interface()` are not recognizable through a `.d.ts`.** Decorators are erased in declaration files, so `declare abstract class WorkflowHost { … }` is indistinguishable from any abstract class; the generator does recognize the `extends Interface<…>()` form (the `X_base` shape). Writing a class-form module against the published types with `@Use() host!: WorkflowHost`, the generator reports "must be a @Component class or an interface class".

Hence the rule splits in two: on the Workflow side it is the **whole table** of the version it carries — what is not in the table truly is not in that version, and that is a failure; a plugin's table today carries no copies, and interfaces without a copy are recorded as "not compared" and written to the log, without failing the load — otherwise one push would stop every plugin depending on host interfaces on every machine. Where the table **does** carry a copy that is no longer compatible, it fails as usual. The same applies on installations whose program predates "`typescript` becomes a dependency": plugins load as before, with the log stating that no comparison was made. Once the two generator problems are fixed, "not compared" should be tightened into a failure.

#### Current state (defects)

Verified case by case against the kernel used by #718 (`checkTree` / `bootModules`):

| Case | Result |
| --- | --- |
| The manifest names an interface absent from the table, `from` points at a nonexistent module, a contributed slot does not exist or its data does not fit the slot shape, or an id or module name collides | Reported, before any code runs |
| The platform's `WorkflowHost` changed — the `setState` the Workflow was calling was removed, or the parameter type of `log` changed | **Not reported**: 0 problems; it fails only at the first call |
| The Workflow's provided `WorkflowMain` disagrees with what the platform requires | **Not compared** |
| The `main` returned by `create()` has no `handle`, or `handle` is not a function | Reported, but after `create()`, and comparing method names only; wrong shapes (parameter count, synchronous return, returning a string) are not reported — #718's entry was an untyped `index.mjs` |
| An object published by the host lacks a method it declares | Not reported |

There is one cause: both the required and the provided are looked up by key in **the same table** (the platform's `ifaces.json`). `requires.host.iface` names `@prismshadow/penguin-server#WorkflowHost`; the "required" it finds and the "provided" the host publishes are the same declaration, so `satisfies(decl, decl)` is always true; the `provides` side likewise only confirms that the key exists. The copy the Workflow itself was written against is never read. The plugin side is another entrance to the same defect: when `PluginHost.ifaces()` merges the two tables, "keys present on both sides resolve to the host's", and the copy brought by the plugin is discarded.

### Contributions

A Workflow's UI is the `contributes` in its manifest — the same data and the same validation as a plugin submitting to the platform; the difference is only **scope**: a Workflow's contributions take effect only for the Agent it belongs to.

- **A Workflow can only submit to the slots the host has opened.** The host publishes the open slots into the Workflow tree under the name of the same-named platform module (a virtual root-level sibling like `Host`), and the slots' data shapes come from the platform's interface table. Submitting to an unopened slot is `no-such-slot`, data that does not fit the slot shape is `bad-contribution`, and a colliding id is `duplicate-id` — all named problems that already exist in PRFC-0001, reported before any code runs, while the previous instance keeps serving. The kernel needs no change: validation of the slots of published modules is already part of whole-tree validation.
- **Only one slot is open today: `WebModule.sessionTabs`** — tabs beside Chat.

  ```ts
  { id: string; key: string; title: string; titleZh?: string;
    renderer: { iframe: { src: string } } | { builtin: string } }
  ```

  `key` is unique within the Workflow and is the tab's stable identity (it appears in the URL); `title` / `titleZh` are the words on the tab. `iframe.src` is a path relative to the Workflow directory and must land under `ui/`, or the load fails and names that contribution. `builtin` names one of the renderers the Web App carries built in; a renderer this version of the app does not recognize has its tab skipped, the same rule as the platform's `pages` slot.
- **Contributions are pure data, with no code half.** The slots the host publishes carry no `code`; whatever behavior a page needs lives behind `WorkflowMain`.
- **The host collects them itself.** Published modules are not created in the tree, so they never see `contributions`; after a successful load the Workflow service reads these (already validated) entries out of the module manifests, resolves `src`, and puts them into the list item's `tabs`.
- **Opening a new location = the host publishing one more slot**: first the slot exists on the platform side (plugins can already submit to it), then a decision on what it means when opened to Workflows and scoped per Agent. Nothing new is needed on the Workflow side.

### Reloading

- Watchers are established per `(project, agent)` and started the first time that Agent's Workflow list is read; `fs.watch(recursive)`, watching the **real path** of `workflows/` (under symlinks and Windows short file names, a path carried by events that disagrees with the declared one would abort the process).
- **An Agent's first `workflows/` directory is discovered the moment it appears.** While that directory does not yet exist, the platform watches the Agent directory itself, switches to normal watching once it appears, and loads what is already inside; otherwise a first Workflow written purely with file tools would wait for the next list read before being loaded.
- **The result of every load is written to a file.** Success or failure, the platform writes the result to `<workflow>/.build/status.json` (`ok`, `revision`, `checkedAt`, `error`, `tabs`). The Agent writing a Workflow has only files, no session with an HTTP API; without this file, to learn "did my last edit load, and what did the compiler say" it would have to find the port, somehow authenticate, and dig through the server's artifacts — in field testing one Agent spent most of its steps doing exactly that. Its work loop is thus three steps: edit the files, wait a moment, read `status.json`; and `.harness/plugin.d.ts` is its single source of knowledge about the host interfaces.
- **Situations that load green but are probably not what was meant are spelled out by the platform.** Both `status.json` and the Workflow returned by the API carry `hints`: each names one such situation and gives the corresponding fix, and it is not a failure (failures are `error`). There is one today — `ui/` has pages while the manifest contributes no tab: the load is green, yet nothing shows in the UI, and `hints` then hands over the `WebModule.sessionTabs` entry that should be written. Likewise, the platform summarizes these conventions in its own words in `.harness/README.md` (the files, the manifest, tabs, the status file), rewritten whenever its content disagrees with the running platform; it is not part of the "types the Workflow was written against" record. The reason: an installed Skill is only a copy — hot pushes do not refresh it, and the Agent may not have installed the Skill at all, while the Workflow directory it always has.
- Events are attributed to a Workflow id by the first path segment; changes to `state.json` trigger no reload. A burst of writes to one Workflow coalesces into one reload after 300 ms of quiet.
- If the directory no longer exists at reload time: discard the instance and notify, keeping the history — history is deleted only on explicit removal.
- Beyond the watcher there is one more content-based comparison: both the list and the `api/*` dispatch first read the directory's revision, and load first if it differs from the loaded one. On platforms where a watcher cannot be created, Workflows are still correct, just one step slower.

### Versions and rollback

- Every **successful** load copies the whole directory (minus `state.json`) to `workflows-history/<id>/<revision>/` and records it in `versions.json` (`revision`, `savedAt`, `name`, `version`, `uiRev`, `files`). When the newest entry already is that revision, nothing is recorded again; a revision seen before moves to the front when loaded again instead of gaining a new entry — a rollback is exactly such a load.
- Each Workflow keeps 20 versions; older ones are deleted along with their copies.
- A rollback restores the directory to **exactly** that version: code files absent from the version are deleted, the version's files are written back over, `state.json` is untouched; a reload follows.
- Removal (`DELETE`) deletes both the directory and `workflows-history/<id>/`: history without an entrance has no reason to exist.

### Routes

Mounted at `/api/projects/:projectId/agents/:agentId/workflows`, as a route group contributed by the platform (`auth: "user"`); every route requires the caller to have access to that Project.

| Method and path | Purpose |
| --- | --- |
| `GET /` | This Agent's list of Workflows (loading whatever changed on disk along the way) |
| `POST /:id/reload` | Reload immediately |
| `GET /:id/history` | The recorded versions, newest first |
| `POST /:id/rollback` `{ revision }` | Restore that version's files and reload |
| `DELETE /:id` | Remove the directory and its versions |
| `GET /:id/ui/*` | Static files under `ui/`; `cache-control: no-cache` |
| `* /:id/api/*` | Handed to `WorkflowMain.handle`; JSON is the default in both directions, other content types below |

**The handler's request and response.** `handle` receives `{ method, path, query, headers, body, bytes? }` and answers `{ status?, headers?, body?, bytes?, stream? }`:

- JSON is the default in both directions: a JSON request body is parsed into `body` (`null` when parsing fails or there is no body); when the answer does not set `content-type`, `body` is sent as JSON.
- Request bodies of other content types (forms, uploads, plain text) are handed to the handler verbatim as `bytes` (`Uint8Array`), capped at 50 MB; `headers` are the lower-cased request headers, with the app's own credentials (`cookie`, `authorization`) not passed in.
- An answer that states its `content-type` in `headers` is sent as written: `body` for strings, `bytes` for binary (taking precedence over `body`); `location` plus a 3xx status is a redirect. `set-cookie` and headers the transport layer decides by itself are dropped — a Workflow does not write the app's cookies. The same origin already serves the files under `ui/` verbatim, so a handler returning HTML is no wider than an HTML file.
- `stream` is an async iterable of strings or bytes (`AsyncIterable<Uint8Array | string>`, named `stream` in the type table), taking precedence over `bytes` and `body`: each chunk the iterator yields, the platform writes to the client, pulling at the speed the client reads and not waiting for the end — server-sent events and forwarded streaming replies get through by it. A client disconnect ends the iteration (calling `return()`); the generator's `finally` is where to abort the upstream request. When forwarded through a machine, the proxy already forwards reply bodies as streams.
- Hence a handler can receive uploads, return pages or downloads, and forward programs running on the local machine: the page runs in the user's browser, and the browser may be on another machine, so `127.0.0.1` inside the page does not name the machine the Workflow lives on; to show a local program, it is the **handler** that fetches `http://127.0.0.1:<port>` and returns the result. The platform therefore provides no port forwarding.
- **The defense against cross-site writes.** Site-wide, write requests accept only content types an HTML form cannot forge (`application/json` and the like); at the handler's mount point this no longer holds, and in its place stands the browser's own statement of the request's origin: `Sec-Fetch-Site` must be `same-origin`; when the browser does not send that header, `Origin` is compared with `Host`; a request carrying neither was not sent by a browser and has no cookies to borrow. Otherwise 403 `cross_origin_write`. The other routes are unchanged, and form types still get 415 across the board.
- In the type table, `Uint8Array` is recorded as `lib#Uint8Array`; types from the language's own standard library are the same type in every program, and the generated `.d.ts` writes them by their own names, not as an unconstructible `Opaque<…>`.

The list item (`WorkflowInfo`) is `id`, `name`, `version`, `revision`, `uiRev`, `tabs`, `loadedAt`, `error`, `hints`; `tabs` is the `sessionTabs` contribution of **the instance that is serving** (`id`, `key`, `title`, `titleZh`, `renderer`, where `iframe.src` is resolved to the address under that Workflow's `ui/` route) — when the current files fail to load, these are still the previous instance's tabs. Path segments are validated; files outside `ui/` cannot be fetched.

### Events

The Project's owner and members receive, on their respective user event streams:

- `workflow_updated { projectId, agentId, workflow }` — after a load succeeds **or fails** (on failure, `workflow.error` is non-empty).
- `workflow_removed { projectId, agentId, workflowId }` — removed via the routes, or the directory deleted on disk.

### Prompt: nothing added

Workflows add nothing to the system prompt. The initial implementation appended a *Workflows* section to every Session of every Agent via a new slot `HostAssembly.promptSections` (about 3.5k characters, 870 tokens), regardless of whether that Agent had ever touched a Workflow — that is making all users pay continuously for a capability most never use; and editing Workflows is not a frequent operation to begin with. The explanation is carried by the `penguin-sdk` Skill instead: the system prompt holds only the Skill's name and a one-line description, with the body loaded on demand. That slot, the `Assembly` mechanism, and its wiring in the session runtime were deleted with it — Workflows had been its only contributor.

### Web App

- The tab strip renders, entry by entry, the `tabs` of that Agent's Workflows — one contribution, one tab, identified as `<workflowId>/<key>`, with one Workflow's tabs adjacent and in manifest order; a Workflow that contributes nothing does not appear on the strip. The strip sits above the chat toolbar; *Chat* is always present and always reachable, and when tabs disappear the view falls back to chat.
- Pages are shown in an iframe laid over the chat, which stays mounted; the iframe is keyed by `uiRev`, so changing only the handler never reloads the page.
- The frame bar belongs to the Workflow, not to any single tab: all tabs of one Workflow see the same bar. It shows the version and revision and the current files' load error, and offers *Reload*, *History* (each version with *Restore*), a two-click *Remove*, and *Fill app*.

### Filling the app

- The route `/app/:projectId/:agentId/:workflowId[/:tabKey]` sits outside the app shell: only that one page, with no sidebar, chat, or tab strip; omitting `tabKey` takes the Workflow's first contribution.
- Three entrances: *Fill app* on the frame bar; the page itself calling `parent.postMessage({ type: "penguin:fill-app" }, "*")`; `penguin web --app <project>/<agent>/<workflow>[/<tab>]` (anything other than three segments, or four non-empty ones, reports `Invalid --app` before anything is started). When the request comes from a page via `postMessage`, what gets filled is the tab that sent it.
- The route **deliberately has no clickable exit**; the exit is the command palette: the palette answers both Ctrl+P and Ctrl+Shift+P (⌘ on macOS), so even a page that captures one of them cannot trap the user; on this route the palette gains *Leave full-page mode (back to chat)*, which remembers the Project and Agent and lands on their chat page.

### Theming

Workflow pages are separate documents; the app's stylesheets and `html.dark` never reach them. The frame, on page load and after appearance settings change:

1. Marks the page's root node `light` / `dark`;
2. Copies the app's **resolved** tokens over — the gray scale, the accent color pair, the font stack, the root font size;
3. Injects `/workflow-ui.css` at the very front of `<head>`, so the page's own rules take precedence.

`workflow-ui.css` styles plain HTML (headings, lists, forms, tables, code) and exposes `--wf-bg`, `--wf-fg`, `--wf-muted`, `--wf-border`, `--wf-surface`, `--wf-accent`, `--wf-accent-fg` and the classes `wf-primary`, `wf-card`, `wf-rows`, `wf-row`, `wf-muted`. The palette has exactly one definition: the stylesheet references the copied values and does not restate the gray scale. A page that hard-codes colors or fonts stays as it is and clashes with the user's theme — which is why the prompt section asks that only these variables be used.

### Which layer it belongs to

`WorkflowsModule` (`WorkflowPrompt` + `WorkflowService` + `WorkflowRoutes`, exporting `Workflows`) is a submodule of the platform's module tree, updated with pushes; the Workflow itself is an independent layer in 05's layering table, its lifecycle tied to the Agent's directory, not to the platform's generation. When the platform is replaced, Workflow instances are released with the old generation and reloaded on demand by the new one; `state.json` and the history live on disk and are unaffected.

## Implementation status
[status]: #status

Everything described in this document is implemented in [penguin-harness#718](https://github.com/Prism-Shadow/penguin-harness/pull/718) (merged):

- Server-side `workflows/{store,service,routes}.ts` and `mechanisms/workflows.ts`; `workflows/compile.ts` (source checking and transpiling), `workflows/harness-types.ts` (writing this platform's types into `.harness/`); shared with plugins, `plugin/typescript.ts` (lazy loading of the compiler) and `plugin/iface-check.ts` (table → `.d.ts` and the verdicts in both directions).
- Nothing is installed: `@prismshadow/penguin-server/plugin` is resolved by the compiler host to `.harness/plugin.d.ts`; the sole definition of `WorkflowPackage` lives in that rendered file; `typescript` moved from devDependency to dependency.
- The slot shape of `WebModule.sessionTabs` changed to the one in this document (adding `title` / `titleZh`, dropping the unused `namespace`), published by the host into the Workflow tree; `WorkflowInfo.tabs`; `ui/*` no longer has a default document.
- The web tab strip renders from `tabs` (titles follow the language), and the full-page route and the CLI's `--app` accept an optional tab key; theming and the command-palette exit as described.
- No global prompt addition: the `HostAssembly.promptSections` slot and the `Assembly` mechanism are deleted, and the explanation lives in the `penguin-sdk` Skill (including the correction that `workflows/` sits beside `agent_state/`).
- The host interfaces are the SDK verbs `createSession` / `run`, scoped to this Project.
- Interface comparison and compiler loading live under `plugin/`, also invoked when plugins load (today most plugins only get "not compared"; see "Interface checks").
- Tests: TypeScript checking and transpiling, rejecting JavaScript, interface comparison in both directions (including "platform additions are unaffected" and "no table means failure"), multiple tabs and unopened slots, directory reload / versions / removal; the web tab model and full-page route; `serve`'s `--app`. Measured against the really built package (the types and the table shipped with it): source checking plus transpiling 399 ms, interface comparison 249 ms.

**Verified on a real installation:** after pushing to a packaged desktop edition (Windows), a temporary Workflow walked the whole chain: `.harness/` written, `strict` compilation, comparison in both directions, the `sessionTabs` contribution, `listAgents()` returning this Project's Agents; after breaking the source, the error carried the file, line, and column, and the previous instance kept answering. This verification caught and fixed two things: the compiler could not be resolved on that machine (see "Interface checks", constraint 4), and `gen-ifaces` projected optional `unknown` members as `{}` — the result of `getNonNullableType(unknown)` — causing `body: null` to be rejected.

**Not yet implemented:** the module tree's whole-tree validation itself (platform and plugins) still uses the hand-written checks and still looks up both sides in one table — that is in the scope of the PRFC-0001 revision.

## Drawbacks
[drawbacks]: #drawbacks

- **Workflow code runs inside the server process, with no sandbox.** Interface validation constrains what the host **hands over**; it cannot govern what the Workflow itself `import`s: a Workflow can `import "node:fs"`. An Agent's shell commands are constrained by the Session's sandbox policy, while the Workflow it writes executes with the server's privileges. This is the design's largest outstanding debt; see Unresolved questions.
- **`typescript` enters the runtime.** A dependency of about 9 MB must ship with the program, and the platform's single-file bundle should not bake it in; every Workflow load runs source checking, transpiling, and the cross-version comparison (about 0.4 s for the whole platform table), redone for existing Workflows at every platform generation. The verdict rules depend on the installed tsc version.
- **Pages share the app's origin.** The iframe carries the user's cookies, so a script in the page can call any API as that user, not only its own `../api/`.
- **Type safety is not soundness.** `as any` and type assertions still bypass the checks; what `strict` guarantees is that untyped code does not pass, not that code carrying assertions is correct.
- **The module cache only grows.** Every revision is a new import URL, and Node offers no unloading; a frequently edited Workflow leaves a module per version for the process's lifetime, until the next restart.
- **The handler only speaks JSON.** No streaming replies, no binary uploads.
- **History is a full copy.** Every version copies the whole directory, 20 at most; a `ui/` with large assets magnifies the disk usage.
- **Watchers are lazy.** Before some Agent's list is read for the first time, that Agent's directories have no watcher; edits made before then wait for the next list read or request to take effect.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **Keep the module machinery instead of inventing a script convention.** "A script that exports `handle`" is shorter, but the answer to "what if it is written wrong" would have to be reinvented. PRFC-0001's whole-tree validation can already name seven kinds of problems before anything runs, and the error text an Agent gets is the same kind a platform developer gets; when a Workflow later grows a second module and needs slots and contributions, it need not change shape either.
- **Workflow, not plugin.** A plugin faces the whole installation and is decided by an administrator; a Workflow faces one Agent and is written by that Agent. The two share the package shape, not the scope or the authorization.
- **The manifest lives in `package.json`.** A platform plugin's manifest is generated by decorators; a Workflow's author is an Agent without a build step, so the manifest must be data that can be written by hand.
- **Workflows accept TypeScript only.** In untyped JavaScript, "is `handle`'s shape right" and "does the host method it calls exist" are known only at run time, and what can be done before load shrinks to checking method names; turning on `checkJs` for JS relies on inference and JSDoc, lets plenty of `any` slip through, and asks the author for annotations without any syntactic enforcement. TypeScript with `strict` turns this into a language-level requirement. Writing TypeScript costs an Agent nothing extra — the server already carries tsc, which does the checking and the transpiling, and no build step appears in the Workflow directory. Transpiling uses tsc rather than relying on runtime type erasure: the latter does no checking and accepts only erasure-compatible syntax.
- **Let tsc decide, instead of writing our own type checker.** A homegrown checker either covers a subset of TypeScript (the current implementation does exactly that, silently passing everything outside the subset) or must forever chase tsc's assignability rules; the saving is not worth it. tsc's rules are the ones interface authors already code against, and its diagnostic text is the one they already know.
- **Keep `ifaces.json` as the carrier and generate `.d.ts` at check time, instead of shipping `.d.ts` directly.** The table is self-contained data: each package carries the copy it saw when it was built, independent of module resolution at check time (`peerDependency` and dependency hoisting cannot touch it), and the by-value validation of slot data and the by-name verification after `create()` need it too. The `.d.ts` is only the form in which this data is handed to tsc, generated in milliseconds.
- **Revisions are content hashes, not mtimes or counters.** The same content is the same revision however it arrives (edit, `git checkout`, rollback): rollbacks therefore deduplicate naturally, and the import URL changes exactly when the content does.
- **`state.json` is not counted in the revision, and history lives outside the directory.** Data changes should not trigger reloads, should not create versions, and should not be carried away by rollbacks; were the history placed inside the directory, it would be seen by its own hash and its own watcher.
- **A narrow interface, not handing over platform components.** Every member of `WorkflowHost` is one explicit grant, checkable by signature; exposing components like `SessionManager` outright would freeze the platform's internals into the Workflow's public API.
- **The UI is declared by contributions, not "having `ui/` means having a tab".** A directory convention can only say "one Workflow, one page, one location": a second tab means either splitting into a second Workflow (state and handler split with it) or another convention (`ui2/`?); appearing anywhere else means one new convention per location. Contribution declarations turn all three into the same thing — one more piece of data written into some slot — and inherit everything the slots already have: validated shapes, named errors, the host deciding openness one by one. The cost is a few more manifest lines in the smallest Workflow.
- **Reuse the platform's slot names, not a Workflow-only `Host.tabs`.** The same thing ("add a tab beside Chat") should be written the same way in a plugin and in a Workflow; should a Workflow be promoted to a plugin later, or the other way around, the contribution need not be rewritten. What is special to Workflows is only the scope, and that is the host's business, not the manifest's.
- **`ui/` remains the root of static files.** `src` could have pointed at any file in the directory, but that would require the server to hold another judgment about "which files may be taken by the browser" (`index.ts` and `state.json` should not be); a fixed static root reduces that judgment to one path prefix. It constrains where files go, no longer how many pages the UI has or where they sit.
- **An iframe, not rendering into the app's DOM.** Pages are arbitrary HTML written by an Agent; a separate document walls them off from the app's styles and script globals. The cost is that the theme does not shine through, hence the "copy the resolved tokens" step; copying rather than restating the palette in a stylesheet keeps the palette defined exactly once.
- **The full-page route has no exit button.** Any fixed exit would take up the page's pixels, and the page belongs to someone else. The command palette takes no pixels; the two shortcuts are both live because the page may capture one of them.
- **Do nothing**: what an Agent produces keeps living only in the conversation; scenarios needing pages can only be built as plugins, installed by an administrator for everyone.

The earlier `feat/workflow-hmr` branch was superseded by this design; all that survives of it is "every Workflow is a tab beside Chat, and chat is always reachable".

## Prior art
[prior-art]: #prior-art

- **PRFC-0001 "Module"**: manifest, interface table, host-published capabilities, whole-tree validation — all borrowed wholesale; this proposal adds nothing to the kernel.
- **HMR (05 "Server-side module tree")**: "a failing new generation leaves the old one serving" and "every successful replacement is a version you can return to" are the same stance; Workflows carry it from the platform down to a single Agent's directory.
- **VS Code Webview**: extension pages are likewise separate documents; the editor injects the theme as `--vscode-*` CSS variables and marks the body `vscode-light` / `vscode-dark`, asking extensions to color with those variables only. `--wf-*` plus `light` / `dark` on the root node is the same approach.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- **The execution boundary of Workflows.** In-process and unsandboxed is the current state, not the conclusion. Candidate directions: run in a separate process under the same sandbox backend as Sessions; or make "this Agent may have Workflows" a grant requiring the user's approval. A position is expected to be settled through discussion before this PRFC merges.
- **Workflows using the plugin class form directly is not yet possible.** The goal is one authoring form for Workflows and plugins (decorated classes plus `export default { modules: [Workflow] }`), with the manifest generated by the server at load time; `WorkflowPackage` and the reading and pairing of hand-written manifests would be deleted with it, and Workflow tables would naturally carry copies of the host interfaces. What stands in the way is precisely the two generator problems above, plus the fact that the generator is today a repository script (`scripts/gen-ifaces.mjs`) and must first become a library the server can call at run time. All three belong to the PRFC-0001 revision.
- **The checker's revision goes in a separate document.** Generating `.d.ts` from tables and leaving the verdict to tsc, retiring `satisfies` / `dataExtends`, `gen-ifaces` no longer erasing generics, requirements always resolving from the consumer's side (including the plugin `??=` override) — these change PRFC-0001's content and need a revision to it.
- **The compiler in the desktop installer is not yet field-tested.** The hot-push path has been verified end to end on a real desktop installation (compilation, interface comparison, tabs, the handler, a bad edit keeping the previous instance); the desktop build placing the compiler beside the bundle has so far only changed the build script and waits for the next packaging to be verified.
- **`.harness/` is not in revisions or history, and may not travel with the Agent package.** The revision hash and the version copies both skip dot-directories; a rollback restores code and leaves `.harness/` as it is — usually just right (what it records is an older basis to begin with), but a Workflow rewritten under new types and rolled back to old code ends up with types and code of different ages. Whether to fold it into versions is left to implementation.
- **Page permissions.** Whether the same-origin iframe should switch to a `sandbox` attribute with requests relayed through the frame, so that the page can reach only its own `api/`.
- **Existing Workflows are JavaScript and contribute nothing.** #718 is not yet merged and not shipped with any release, but development instances already hold Workflows written by Agents: entry `index.mjs`, `ui/` only, no `contributes`. Under this document, the former no longer loads (it must be rewritten as `index.ts` with dependencies installed), and the latter loses its tab until the manifest gains a contribution. The recommendation is no fallback in either place (continuing to accept `index.mjs` means keeping a load path without type checking; "treating `ui/index.html` without a contribution as a default contribution" would let the directory convention live forever) — for the user to decide.
- **The next batch of `WorkflowHost` members.** Today only `sessionStatus` can be polled; subscribing to Session events, reading a Session's output, and reading or writing Workspace files are all still missing. Each is to be proposed one by one under "interface first", outside this document's scope.
- **Taxonomy and usage documentation.** `02-TAXONOMY.md` has no Workflow entry yet, and `06-PROTOTYPE.md` / `07-USAGE.md` do not yet describe tabs and `--app`; left for a later specs PR.

## Future possibilities
[future-possibilities]: #future-possibilities

- **Distributing with the Agent.** The Agent package ([penguin-harness#719](https://github.com/Prism-Shadow/penguin-harness/pull/719)) already packs `workflows/` together with `agent_state/`, `state.json` excepted: the code travels with the Agent, the data stays where it is.
- **Opening more slots.** The mechanism is already in the "Contributions" section; candidate locations are the platform's existing `WebModule.pages` (whole pages scoped per Agent) and `WebModule.agentTabs` (tabs of the Agent settings page), plus the not-yet-existing command palette entries and scheduled triggers. Each opening has only one question to answer: "what does it mean when scoped per Agent".
- **Sender-side preflight.** Same as the like-named question in PRFC-0001: before writing the files, the Agent first checks them against the host-published interface table.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the landed version from the design repository's default branch, identical to the source file.
