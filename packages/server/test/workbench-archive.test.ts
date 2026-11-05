/**
 * Workbench archives: `GET …/workbenches/:id/archive` exports a workbench's source as a zip and
 * `POST …/workbenches/archive` imports one, for any member of the Project.
 *
 * - An export holds the source under `<id>/` and nothing else — no `state.json`, no `.build/`,
 *   `.harness/`, `.plugin.json` or other dot entry, no `node_modules/` — and is named after the id
 *   and package.json's version when it has one.
 * - The export imports into another Agent unchanged, under its top-level directory's name, loads
 *   there, and its History lists that load as the one version.
 * - A root-layout zip takes package.json's name as the id, and a load that fails is still an
 *   import, with the failure in the answer; a scoped name is refused, naming the fix.
 * - A folder holding data but no package.json is no workbench yet: an import into it keeps its
 *   `state.json` and leaves none of the stray files beside it.
 * - Each of these is refused before anything is written: `state.json` in any letter case, a dot
 *   entry, `node_modules/` in any case, a `../`, absolute, drive-letter or backslash path, a
 *   control character, a name Windows cannot hold, a name git reserves, a link, two names a disk that folds case or
 *   Unicode normal form takes for one, an entry that is both a file and a directory, an unusable
 *   package.json, a layout with no one workbench, and a root-layout id that is `node_modules` or a
 *   staging name.
 * - An id that is taken answers 409 `workbench_exists` and changes nothing; an id that differs from
 *   a folder's only in letter case is that folder, for the 409 and for the overwrite.
 * - With `overwrite`, the source becomes exactly the archive's (a stale file and the directory it
 *   emptied are gone), `state.json` and `.plugin.json` survive, `.harness/` is written afresh by
 *   the load, and the answer carries the load result. That holds when an old name differs from a
 *   new one only in letter case, and when a file becomes a directory or a directory a file.
 * - An overwrite the folder cannot take — a link where a new file needs a directory, a directory
 *   holding more than old source where a new file goes — answers 409 and leaves the folder as it
 *   was.
 * - Two imports of one id at once: one is written, the other answers 409, and the folder is the
 *   first's alone.
 * - A staging folder an import left behind over an hour ago is removed by the next import into
 *   that Agent; a younger one, and any other dot entry, stays.
 * - An entry over the per-file cap is refused without being inflated; a folder over the caps does
 *   not export.
 * - Someone outside the Project reaches neither route; a missing Agent or workbench is a 404.
 * - An import into an Agent still in the layout before Agent State migrates it first: its old
 *   workbenches stay listed, with their data, beside the imported one.
 *
 * Every successful load runs the TypeScript compiler, so only two scenarios load a workbench that
 * compiles; the rest write folders by hand or are refused before a load.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { ZipOptions } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ProjectCreateResponse,
  WorkbenchArchiveInstallResponse,
  WorkbenchInfo,
  WorkbenchVersion,
} from "../src/api/types.js";
import { agentDir } from "@prismshadow/penguin-core";
import { workbenchesDir } from "../src/workbenches/store.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const MANIFEST = {
  name: "Workbench",
  requires: { host: { iface: "@prismshadow/penguin-server#WorkbenchHost", from: "Host" } },
  provides: { main: "@prismshadow/penguin-server#WorkbenchMain" },
  contributes: {
    "WebModule.sessionTabs": [
      {
        id: "todo.board",
        key: "board",
        title: "Todo",
        renderer: { iframe: { src: "ui/index.html" } },
      },
    ],
  },
  children: [],
};

/** A workbench that compiles: its manifest, a handler and one page. */
const SOURCE: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "Todo",
    version: "1.2.0",
    type: "module",
    penguin: { modules: [MANIFEST] },
  }),
  // Only ES2022 APIs: loading the DOM declarations would add compile time and prove nothing here.
  "index.ts": `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";
export default {
  modules: { Workbench: { create() { return { api: { main: { async handle() { return { body: "ok" }; } } } }; } } },
} satisfies WorkbenchPackage;
`,
  "ui/index.html": "<h1>todo</h1>",
};

/** What a server leaves in a folder beside the source, and the workbench's own data. */
const SERVER_FILES: Record<string, string> = {
  "state.json": '{"tickets":[1,2]}',
  ".plugin.json": '{"name":"todo","plugin":"todo-plugin","version":"","files":[]}',
  ".harness/plugin.d.ts": "export {};",
  ".build/abc123/index.js": "export default {};",
  "node_modules/left-pad/index.js": "module.exports = 1;",
  "ui/.DS_Store": "x",
};

/** A zip of `files`, base64 as the route takes it; an entry may carry its zip attributes. */
const zipB64 = (files: Record<string, string | Uint8Array | [string, ZipOptions]>): string =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, body]) => [
          name,
          typeof body === "string"
            ? strToU8(body)
            : Array.isArray(body)
              ? ([strToU8(body[0]), body[1]] as const)
              : body,
        ]),
      ),
    ),
  ).toString("base64");

/** A package.json that parses but does not load: its load fails at once instead of compiling. */
const brokenPkg = (name: string) => JSON.stringify({ name, penguin: { modules: [MANIFEST] } });

/** The files under one top-level directory, as the export lays them out. */
const under = (dir: string, files: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).map(([rel, body]) => [`${dir}/${rel}`, body]));

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), body);
  }
}

/** Every regular file under `dir` (relative, "/"-separated, sorted), dot entries included. */
async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      out.push(
        path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
      );
    }
  }
  return out.sort();
}

const messageOf = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: { message: string } }).error.message;

// Two cases run the TypeScript compiler; on a CI runner one compile can pass 5s by itself.
describe("workbench archives", { timeout: 30_000 }, () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  const base = (agentId: string) => `/api/projects/${projectId}/agents/${agentId}/workbenches`;
  const folder = (agentId: string, id: string) =>
    path.join(workbenchesDir(t.root, projectId, agentId), id);

  async function createAgent(agentId: string): Promise<void> {
    const res = await owner.post(`/api/projects/${projectId}/agents`, { agentId });
    expect(res.status, await res.text()).toBe(201);
  }

  // Every case works on an Agent of its own, so one app serves them all.
  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_wa");
    const b = await provisionUser(t.app, "member_wa");
    const c = await provisionUser(t.app, "outsider_wa");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_wa-archive", name: "archive" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_wa" })).status,
    ).toBe(201);
    // Refused archives write nothing, so they can all go to one Agent.
    await createAgent("refuse_agent");
    // The export's source: a workbench as a server leaves it after loads, plus one with no version.
    await createAgent("source_agent");
    await writeFiles(folder("source_agent", "todo"), { ...SOURCE, ...SERVER_FILES });
    await writeFiles(folder("source_agent", "plain"), {
      ...SOURCE,
      "package.json": JSON.stringify({
        name: "Plain",
        type: "module",
        penguin: { modules: [MANIFEST] },
      }),
    });
  }, 30_000);
  afterAll(async () => {
    await t.cleanup();
  });

  it("an export holds the source under <id>/ and nothing of the server's or the workbench's data", async () => {
    const res = await member.get(`${base("source_agent")}/todo/archive`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''todo-v1.2.0.zip",
    );
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(Object.keys(under("todo", SOURCE)).sort());
    for (const [name, body] of Object.entries(under("todo", SOURCE))) {
      expect(strFromU8(entries[name]!)).toBe(body);
    }

    const plain = await member.get(`${base("source_agent")}/plain/archive`);
    expect(plain.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''plain.zip");
  });

  it("an export imports into another Agent unchanged, under its top-level directory's name, and loads", async () => {
    await createAgent("copy_agent");
    const exported = await (await member.get(`${base("source_agent")}/todo/archive`)).arrayBuffer();
    const res = await member.post(`${base("copy_agent")}/archive`, {
      dataBase64: Buffer.from(exported).toString("base64"),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { workbench } = (await res.json()) as WorkbenchArchiveInstallResponse;
    expect(workbench).toMatchObject({ id: "todo", name: "Todo", version: "1.2.0", error: null });
    const dir = folder("copy_agent", "todo");
    const source = (await filesUnder(dir)).filter((rel) => !rel.startsWith("."));
    expect(source).toEqual(Object.keys(SOURCE).sort());
    for (const [rel, body] of Object.entries(SOURCE)) {
      expect(await fs.readFile(path.join(dir, rel), "utf8")).toBe(body);
    }
    const listed = (await (await member.get(base("copy_agent"))).json()) as {
      workbenches: WorkbenchInfo[];
    };
    expect(listed.workbenches.map((w) => [w.id, w.revision])).toEqual([
      ["todo", workbench.revision],
    ]);
    const history = await member.get(`${base("copy_agent")}/todo/history`);
    expect(
      ((await history.json()) as { versions: WorkbenchVersion[] }).versions.map((v) => v.revision),
    ).toEqual([workbench.revision]);
  });

  it("the root layout takes package.json's name as the id, a failing load is in the answer, and a scoped name is refused naming the fix", async () => {
    await createAgent("root_agent");
    // Data restored ahead of its source, and a file left over from a folder that was never loaded.
    await writeFiles(folder("root_agent", "notes"), {
      "state.json": SERVER_FILES["state.json"]!,
      "leftover.ts": "export {};",
    });
    // No "type": "module": written, then refused by the load, which the answer reports.
    const pkg = { name: "notes", penguin: { modules: [MANIFEST] } };
    const res = await member.post(`${base("root_agent")}/archive`, {
      dataBase64: zipB64({ ...SOURCE, "package.json": JSON.stringify(pkg) }),
    });
    expect(res.status).toBe(201);
    const { workbench } = (await res.json()) as WorkbenchArchiveInstallResponse;
    expect(workbench.id).toBe("notes");
    expect(workbench.error).toContain('"type": "module"');
    const notes = folder("root_agent", "notes");
    expect((await filesUnder(notes)).filter((rel) => !rel.startsWith("."))).toEqual(
      [...Object.keys(SOURCE), "state.json"].sort(),
    );
    expect(await fs.readFile(path.join(notes, "state.json"), "utf8")).toBe(
      SERVER_FILES["state.json"],
    );
    expect(await fs.readFile(path.join(notes, "index.ts"), "utf8")).toBe(SOURCE["index.ts"]);

    const scoped = await member.post(`${base("root_agent")}/archive`, {
      dataBase64: zipB64({
        ...SOURCE,
        "package.json": JSON.stringify({ ...pkg, name: "@acme/notes" }),
      }),
    });
    expect(scoped.status).toBe(400);
    expect(await messageOf(scoped)).toContain(
      "put the files under a directory named after the workbench",
    );
    expect(await fs.readdir(workbenchesDir(t.root, projectId, "root_agent"))).toEqual(["notes"]);
  });

  const valid = under("todo", SOURCE);
  it.each<[string, Record<string, string | [string, ZipOptions]>, string]>([
    ["state.json", { ...valid, "todo/state.json": "{}" }, "state.json is the workbench's data"],
    ["a dot entry", { ...valid, "todo/.harness/plugin.d.ts": "" }, "dot entries are the server's"],
    [
      "node_modules",
      { ...valid, "todo/node_modules/a/index.js": "" },
      "node_modules is never imported",
    ],
    ["a ../ entry", { ...valid, "todo/../evil.ts": "" }, "Invalid zip entry path (traversal)"],
    [
      "a file that is also a directory",
      { ...valid, "todo/lib": "", "todo/lib/a.ts": "" },
      "both a file and a directory: todo/lib",
    ],
    [
      "a package.json that does not parse",
      { ...valid, "todo/package.json": "{" },
      "package.json is not valid JSON",
    ],
    [
      "a package.json with no modules",
      { ...valid, "todo/package.json": '{"type":"module"}' },
      "under penguin.modules",
    ],
    [
      "two top-level directories",
      { ...valid, "other/index.ts": "" },
      "exactly one top-level directory",
    ],
    ["a directory name that is no id", under("my app", SOURCE), "Invalid workbench id"],
    [
      "a root package.json with no name",
      { "package.json": '{"penguin":{"modules":[{}]}}' },
      "must set name",
    ],
    ["an archive with no files", {}, "contains no files"],
    ["State.json", { ...valid, "todo/State.json": "{}" }, "state.json is the workbench's data"],
    ["NODE_MODULES", { ...valid, "todo/NODE_MODULES/x.js": "" }, "node_modules is never imported"],
    ["an absolute path", { ...valid, "/abs.ts": "" }, "Invalid zip entry path (absolute)"],
    ["a drive letter", { ...valid, "C:/x.ts": "" }, "Invalid zip entry path (absolute)"],
    ["a backslash", { ...valid, "todo\\x.ts": "" }, "Invalid zip entry path (backslash)"],
    ["a NUL", { ...valid, "todo/ui/nul\u0000.js": "" }, "control character"],
    ["a reserved device name", { ...valid, "todo/ui/CON.html": "" }, "a name Windows cannot hold"],
    ["a colon", { ...valid, "todo/ui/x:y.js": "" }, "a name Windows cannot hold"],
    ["a trailing dot", { ...valid, "todo/ui/trail.": "" }, "a name Windows cannot hold"],
    ["a name git reserves", { ...valid, "todo/git~1/x.ts": "" }, "a name git reserves"],
    [
      "a name that is .. once HFS+ drops what it ignores",
      { ...valid, "todo/\u200c../x.ts": "" },
      "a name git reserves",
    ],
    [
      "a symbolic link",
      { ...valid, "todo/ui/lib": ["../../secret", { os: 3, attrs: 0o120777 << 16 }] },
      "a link or a special file: todo/ui/lib",
    ],
    [
      "names that differ only in letter case",
      { ...valid, "todo/ui/A.js": "", "todo/ui/a.js": "" },
      "where letter case is ignored",
    ],
    [
      "names that differ only in Unicode normal form",
      { ...valid, "todo/ui/caf\u00e9.js": "", "todo/ui/cafe\u0301.js": "" },
      "where letter case is ignored",
    ],
    [
      "a root-layout id node_modules",
      { "package.json": brokenPkg("node_modules"), "index.ts": "" },
      "which no folder can be",
    ],
    [
      "a root-layout id that is a staging name",
      { "package.json": brokenPkg("notes.penguin-tmp1"), "index.ts": "" },
      "which no folder can be",
    ],
  ])("an archive with %s is refused before anything is written", async (_case, files, message) => {
    const res = await member.post(`${base("refuse_agent")}/archive`, { dataBase64: zipB64(files) });
    expect(res.status).toBe(400);
    expect(await messageOf(res)).toContain(message);
    await expect(fs.stat(workbenchesDir(t.root, projectId, "refuse_agent"))).rejects.toThrow();
  });

  it("an id that is taken answers 409 workbench_exists and changes nothing", async () => {
    await createAgent("taken_agent");
    const dir = folder("taken_agent", "todo");
    await writeFiles(dir, {
      "package.json": '{"name":"Mine"}',
      "index.ts": "mine",
      "state.json": "{}",
    });
    const before = await filesUnder(dir);
    const res = await member.post(`${base("taken_agent")}/archive`, {
      dataBase64: zipB64(under("todo", SOURCE)),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "workbench_exists",
        message: "Workbench already exists: todo",
        details: { workbenchId: "todo" },
      },
    });
    expect(await filesUnder(dir)).toEqual(before);
    expect(await fs.readFile(path.join(dir, "index.ts"), "utf8")).toBe("mine");
  });

  it("an overwrite makes the source exactly the archive's, keeps the data and the receipt, and the load writes .harness/ afresh", async () => {
    await createAgent("over_agent");
    const dir = folder("over_agent", "todo");
    await writeFiles(dir, {
      "package.json": JSON.stringify({ name: "Todo", version: "1.0.0", type: "module" }),
      "index.ts": "export default {};",
      "stale.ts": "export {};",
      "lib/old.ts": "export {};",
      "state.json": SERVER_FILES["state.json"]!,
      ".plugin.json": SERVER_FILES[".plugin.json"]!,
      ".harness/marker.txt": "written against an older host",
    });
    const res = await member.post(`${base("over_agent")}/archive`, {
      dataBase64: zipB64(under("todo", SOURCE)),
      overwrite: true,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { workbench } = (await res.json()) as WorkbenchArchiveInstallResponse;
    expect(workbench).toMatchObject({ id: "todo", version: "1.2.0", error: null });
    expect(workbench.tabs.map((tab) => tab.key)).toEqual(["board"]);
    const files = await filesUnder(dir);
    expect(files.filter((rel) => !rel.startsWith("."))).toEqual(
      [...Object.keys(SOURCE), "state.json"].sort(),
    );
    await expect(fs.stat(path.join(dir, "lib"))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, "state.json"), "utf8")).toBe(
      SERVER_FILES["state.json"],
    );
    expect(await fs.readFile(path.join(dir, ".plugin.json"), "utf8")).toBe(
      SERVER_FILES[".plugin.json"],
    );
    expect(files).not.toContain(".harness/marker.txt");
    expect(files).toContain(".harness/harness.json");
  });

  it("an id that differs from a folder's only in letter case is that folder, for the 409 and for the overwrite", async () => {
    await createAgent("case_agent");
    await writeFiles(folder("case_agent", "todo"), {
      "package.json": brokenPkg("todo"),
      "index.ts": "old",
    });
    const zip = zipB64({ "Todo/package.json": brokenPkg("todo"), "Todo/index.ts": "new" });
    const taken = await member.post(`${base("case_agent")}/archive`, { dataBase64: zip });
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: { details: unknown } }).error.details).toEqual({
      workbenchId: "todo",
    });
    const res = await member.post(`${base("case_agent")}/archive`, {
      dataBase64: zip,
      overwrite: true,
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as WorkbenchArchiveInstallResponse).workbench.id).toBe("todo");
    expect(await fs.readdir(workbenchesDir(t.root, projectId, "case_agent"))).toEqual(["todo"]);
    expect(await fs.readFile(path.join(folder("case_agent", "todo"), "index.ts"), "utf8")).toBe(
      "new",
    );
  });

  it("an overwrite is exact across names that differ only in letter case and across files that become directories and back", async () => {
    await createAgent("swap_agent");
    const dir = folder("swap_agent", "todo");
    await writeFiles(dir, {
      "package.json": brokenPkg("todo"),
      "Index.ts": "old index",
      "lib/a.ts": "old lib",
      src: "old src file",
      "state.json": "{}",
    });
    await fs.mkdir(path.join(dir, "assets", "empty"), { recursive: true });
    const archive: Record<string, string> = {
      "package.json": brokenPkg("todo"),
      "index.ts": "new index",
      lib: "new lib file",
      "src/x.ts": "new src",
      assets: "new assets file",
    };
    const res = await member.post(`${base("swap_agent")}/archive`, {
      dataBase64: zipB64(under("todo", archive)),
      overwrite: true,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    expect((await filesUnder(dir)).filter((rel) => !rel.startsWith("."))).toEqual(
      [...Object.keys(archive), "state.json"].sort(),
    );
    for (const [rel, body] of Object.entries(archive)) {
      expect(await fs.readFile(path.join(dir, rel), "utf8")).toBe(body);
    }
  });

  it("a staging folder an import left behind over an hour ago is removed by the next import into that Agent", async () => {
    await createAgent("leftover_agent");
    const workbenches = workbenchesDir(t.root, projectId, "leftover_agent");
    const old = ".archive.penguin-tmp-todo-0123456789ab";
    const young = ".archive.penguin-tmp-todo-ba9876543210";
    for (const name of [old, young, ".kept"]) {
      await writeFiles(path.join(workbenches, name), { "package.json": brokenPkg("todo") });
    }
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(path.join(workbenches, old), twoHoursAgo, twoHoursAgo);
    await fs.utimes(path.join(workbenches, ".kept"), twoHoursAgo, twoHoursAgo);
    const res = await member.post(`${base("leftover_agent")}/archive`, {
      dataBase64: zipB64(under("notes", { "package.json": brokenPkg("notes") })),
    });
    expect(res.status).toBe(201);
    expect((await fs.readdir(workbenches)).sort()).toEqual([".kept", young, "notes"].sort());
  });

  it("an overwrite the folder cannot take answers 409 and leaves the folder as it was", async () => {
    await createAgent("conflict_agent");
    const outside = path.join(t.root, "outside-lib");
    await writeFiles(outside, { "kept.ts": "outside" });
    const linked = folder("conflict_agent", "linked");
    await writeFiles(linked, { "package.json": brokenPkg("linked"), "old.ts": "old" });
    await fs.symlink(outside, path.join(linked, "lib"), "junction");
    const held = folder("conflict_agent", "held");
    await writeFiles(held, {
      "package.json": brokenPkg("held"),
      "old.ts": "old",
      "lib/.cache/x": "not source",
    });
    for (const [id, dir, archive] of [
      ["linked", linked, { "lib/x.ts": "new" }],
      ["held", held, { lib: "new" }],
    ] as const) {
      const before = await filesUnder(dir);
      const res = await member.post(`${base("conflict_agent")}/archive`, {
        dataBase64: zipB64(under(id, { "package.json": brokenPkg(id), ...archive })),
        overwrite: true,
      });
      expect(res.status).toBe(409);
      expect(await messageOf(res)).toContain("lib");
      expect(await filesUnder(dir)).toEqual(before);
      expect(await fs.readFile(path.join(dir, "old.ts"), "utf8")).toBe("old");
    }
    expect(await fs.readdir(outside)).toEqual(["kept.ts"]);
  });

  it("two imports of one id at once: one is written, the other answers 409, and the folder is the first's alone", async () => {
    await createAgent("race_agent");
    const upload = (marker: string) =>
      member.post(`${base("race_agent")}/archive`, {
        dataBase64: zipB64(
          under("todo", { "package.json": brokenPkg("todo"), [`${marker}.ts`]: marker }),
        ),
      });
    const answers = await Promise.all([upload("first"), upload("second")]);
    expect(answers.map((res) => res.status).sort()).toEqual([201, 409]);
    const winner = answers[0]!.status === 201 ? "first" : "second";
    expect(
      (await filesUnder(folder("race_agent", "todo"))).filter((rel) => !rel.startsWith(".")),
    ).toEqual([`${winner}.ts`, "package.json"]);
  });

  it("an entry over the per-file cap is refused without being inflated, and a folder over the caps does not export", async () => {
    await createAgent("cap_agent");
    // 8MB of zeros deflate to a few KB: only a cap read before inflating stops it.
    const zip = zipSync({
      ...Object.fromEntries(Object.entries(valid).map(([n, b]) => [n, strToU8(b)])),
      "todo/pad.bin": new Uint8Array(8 * 1024 * 1024),
    });
    expect(zip.byteLength).toBeLessThan(64 * 1024);
    const res = await member.post(`${base("cap_agent")}/archive`, {
      dataBase64: Buffer.from(zip).toString("base64"),
    });
    expect(res.status).toBe(400);
    expect(await messageOf(res)).toContain("5MB uncompressed limit: todo/pad.bin");
    await expect(fs.stat(workbenchesDir(t.root, projectId, "cap_agent"))).rejects.toThrow();

    const many: Record<string, string> = { "package.json": SOURCE["package.json"]! };
    for (let i = 0; i < 200; i++) many[`ui/page-${i}.html`] = "";
    await writeFiles(folder("cap_agent", "big"), many);
    const big = await member.get(`${base("cap_agent")}/big/archive`);
    expect(big.status).toBe(413);
    expect(((await big.json()) as { error: { code: string } }).error.code).toBe(
      "workbench_too_large",
    );
  });

  it("an import into an Agent in the layout before Agent State migrates it first, so its old workbenches stay listed beside the new one", async () => {
    await createAgent("legacy_agent");
    const home = agentDir(t.root, projectId, "legacy_agent");
    // Neither package loads, so neither compiles: what is asserted is where the folders are.
    const legacy = path.join(home, "workbenches", "legacy");
    await writeFiles(legacy, {
      "package.json": brokenPkg("legacy"),
      "index.ts": SOURCE["index.ts"]!,
      "state.json": SERVER_FILES["state.json"]!,
    });
    // Written long ago, as an upgraded install's are: a folder still being written is left be.
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const file of ["package.json", "index.ts", "state.json"]) {
      await fs.utimes(path.join(legacy, file), longAgo, longAgo);
    }
    const res = await member.post(`${base("legacy_agent")}/archive`, {
      dataBase64: zipB64({ "package.json": brokenPkg("notes"), "index.ts": SOURCE["index.ts"]! }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const listed = await member.get(base("legacy_agent"));
    expect(listed.status).toBe(200);
    const { workbenches } = (await listed.json()) as { workbenches: WorkbenchInfo[] };
    expect(workbenches.map((w) => w.id)).toEqual(["legacy", "notes"]);
    // The old place leads to the same folders now.
    expect((await fs.readdir(path.join(home, "workbenches"))).sort()).toEqual(["legacy", "notes"]);
    expect(
      await fs.readFile(path.join(folder("legacy_agent", "legacy"), "state.json"), "utf8"),
    ).toBe(SERVER_FILES["state.json"]);
  });

  it("someone outside the Project reaches neither route, and a missing Agent or workbench is a 404", async () => {
    const zip = zipB64(under("todo", SOURCE));
    expect((await outsider.get(`${base("source_agent")}/todo/archive`)).status).toBe(404);
    expect(
      (await outsider.post(`${base("source_agent")}/archive`, { dataBase64: zip })).status,
    ).toBe(404);
    const ghost = await member.post(`${base("no_such_agent")}/archive`, { dataBase64: zip });
    expect(ghost.status).toBe(404);
    expect(((await ghost.json()) as { error: { code: string } }).error.code).toBe(
      "agent_not_found",
    );
    await expect(fs.stat(workbenchesDir(t.root, projectId, "no_such_agent"))).rejects.toThrow();
    expect((await member.get(`${base("source_agent")}/nope/archive`)).status).toBe(404);
    expect((await member.get(`${base("source_agent")}/-nope/archive`)).status).toBe(404);
  });
});
