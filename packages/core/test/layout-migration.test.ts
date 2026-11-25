/**
 * The data root's layout migration (state/layout-migration/, PRFC-0034), on data roots built in
 * the layout before `projects/` — never a real root:
 *
 * - Every Project folder at the top level moves under `projects/`, a link at its old place
 *   reaches it, and the Projects are listed from `projects/` alone; the server's own folders stay.
 * - The absolute paths the Project's files record under the old folder are rewritten (a user's
 *   path outside the data root is not); Traces are not; a Workspace's Memory follows it to its new
 *   key; the moves are handed to the host's store, or kept in the journal for the server.
 * - A link an Agent keeps with an absolute target inside the moved folder (Windows' `workbenches`
 *   junction) is re-pointed.
 * - A run cut short after the move is finished by the next; a second run changes nothing; a
 *   Project folder an older build made after the migration is moved by the next run.
 * - A Project folder that cannot be moved (Windows refusing while a program holds it open) leaves
 *   the root as it was, the other Projects included, and the next run moves them all.
 * - A Project called `projects` stops the run with nothing on disk changed, and so does a root
 *   that is another root's Projects folder.
 * - Benchmarks move into the Evaluation Center's data folder and their old absolute paths still
 *   reach them; a Project whose `system_agent` is the user's own keeps them where they are.
 * - The SDK migrates a root no server holds, refuses one a server holds, and an old conversation
 *   in a temporary Workspace resumes afterwards.
 */
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { sessionMeta, userText } from "@prismshadow/amsp/records";
import {
  benchmarksDir,
  createAgent,
  defaultSystemConfig,
  LayoutMigrationError,
  listProjectDirs,
  memoryScopeDir,
  migrateDataRootLayout,
  projectDir,
  resolveBenchmarksDir,
  WORKSPACE_MARKER_FILENAME,
  workspaceMemoryKeyForRealPath,
  type PathMove,
} from "../src/index.js";
import { stubProviderKeys } from "./provider-keys.js";
import { seedProject } from "./seeded-project.js";

let root: string;
let restoreKeys: () => void;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-layout-"));
  restoreKeys = stubProviderKeys();
});

afterEach(async () => {
  vi.restoreAllMocks();
  restoreKeys();
  await fs.rm(root, { recursive: true, force: true });
});

const old = (...parts: string[]) => path.join(root, ...parts);
const moved = (...parts: string[]) => path.join(root, "projects", ...parts);

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, "utf8");
}

/** A valid Agent State for `agentId` in the old layout; `system` makes it the system Agent. */
async function oldAgent(projectId: string, agentId: string, system = false): Promise<void> {
  const config = { ...defaultSystemConfig(), ...(system ? { system: true } : {}) };
  await write(
    old(projectId, "agents", agentId, "agent_state", "system_config.yaml"),
    stringifyYaml(config),
  );
}

/** A Project folder in the old layout, at `<root>/<id>`, with its config. */
async function oldProject(id: string, extra = ""): Promise<void> {
  await write(old(id, ".project_config.toml"), extra);
}

/** Every file and link under `dir`, with its contents or target: what "nothing changed" compares. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (at: string) => {
    for (const entry of await fs.readdir(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      const rel = path.relative(dir, full);
      if (entry.isSymbolicLink()) out[rel] = `-> ${await fs.readlink(full)}`;
      else if (entry.isDirectory()) await walk(full);
      else out[rel] = await fs.readFile(full, "utf8");
    }
  };
  await walk(dir);
  return out;
}

describe("the projects/ level", () => {
  it("moves every Project under projects/, links its old place, and lists Projects from there alone", async () => {
    await oldProject("acme");
    await oldAgent("acme", "writer");
    await oldProject("default_project");
    // The server's own folders and files stay where they are: neither holds a Project config.
    await write(old("plugins", "package.json"), "{}");
    await write(old("web.db"), "");

    const result = await migrateDataRootLayout(root);

    expect(result.movedProjects).toEqual(["acme", "default_project"]);
    expect((await listProjectDirs(root)).map((p) => p.id)).toEqual(["acme", "default_project"]);
    expect(await fs.realpath(old("acme"))).toBe(await fs.realpath(moved("acme")));
    // An old path still reaches the same file, and a write through it lands in the new place.
    await fs.writeFile(old("acme", "agents", "writer", "note.txt"), "through the link");
    expect(await fs.readFile(moved("acme", "agents", "writer", "note.txt"), "utf8")).toBe(
      "through the link",
    );
    expect(await fs.readFile(old("plugins", "package.json"), "utf8")).toBe("{}");
    expect((await fs.lstat(old("plugins"))).isDirectory()).toBe(true);
  });

  it("rewrites the paths the Project's files record under the old folder, and no other", async () => {
    const desk = old("acme", "organizations", "co_one", "workspace", "hr");
    await oldProject("acme", `[default_chat]\nworkspace = ${JSON.stringify(desk)}\n`);
    await write(
      old("acme", "organizations", "co_one", "desks.toml"),
      `# the desks\n[writer]\nsession_id = "s1"\nworkspace = ${JSON.stringify(desk)}\n`,
    );
    await write(
      old("acme", "agents", "writer", "agent_state", "schedule", "daily.toml"),
      `prompt = "hi"\nworkspace = "/srv/elsewhere"\n# and ${old("acme2", "x")}\n`,
    );
    const trace = old("acme", "agents", "writer", "traces", "2026-11-01", "s1_001.jsonl");
    await write(trace, `${JSON.stringify({ workspace: desk })}\n`);

    await migrateDataRootLayout(root);

    const newDesk = moved("acme", "organizations", "co_one", "workspace", "hr");
    expect(await fs.readFile(moved("acme", ".project_config.toml"), "utf8")).toBe(
      `[default_chat]\nworkspace = ${JSON.stringify(newDesk)}\n`,
    );
    // Rewritten where it stands: the comment and the other keys are kept.
    expect(await fs.readFile(moved("acme", "organizations", "co_one", "desks.toml"), "utf8")).toBe(
      `# the desks\n[writer]\nsession_id = "s1"\nworkspace = ${JSON.stringify(newDesk)}\n`,
    );
    // A path outside the data root, and another Project's whose name only starts the same, stay.
    expect(
      await fs.readFile(
        moved("acme", "agents", "writer", "agent_state", "schedule", "daily.toml"),
        "utf8",
      ),
    ).toBe(`prompt = "hi"\nworkspace = "/srv/elsewhere"\n# and ${old("acme2", "x")}\n`);
    // A Trace is never rewritten.
    expect(
      await fs.readFile(
        moved("acme", "agents", "writer", "traces", "2026-11-01", "s1_001.jsonl"),
        "utf8",
      ),
    ).toBe(`${JSON.stringify({ workspace: desk })}\n`);
  });

  it("hands every move to the host's store, or keeps it in the journal for the server's next start", async () => {
    await oldProject("acme");
    await migrateDataRootLayout(root);
    const journal = JSON.parse(await fs.readFile(old(".layout-migration.json"), "utf8")) as {
      pendingStore: PathMove[];
    };
    expect(journal.pendingStore).toEqual([{ from: old("acme"), to: moved("acme") }]);

    await oldProject("beta");
    const seen: PathMove[][] = [];
    await migrateDataRootLayout(root, {
      store: { rewritePaths: (moves) => void seen.push([...moves]) },
    });
    expect(seen).toEqual([
      [
        { from: old("acme"), to: moved("acme") },
        { from: old("beta"), to: moved("beta") },
      ],
    ]);
    // Nothing is left to finish, so the journal is gone.
    await expect(fs.access(old(".layout-migration.json"))).rejects.toThrow();
  });

  it("moves a Workspace's Memory to the key of its new path", async () => {
    await oldProject("acme");
    await oldAgent("acme", "writer");
    const desk = old("acme", "organizations", "co_one", "workspace");
    await fs.mkdir(desk, { recursive: true });
    const realDesk = await fs.realpath(desk);
    const oldKey = workspaceMemoryKeyForRealPath(realDesk);
    const scope = old("acme", "agents", "writer", "agent_state", "memory", oldKey);
    await write(path.join(scope, "MEMORY.md"), "- [style](style.md)\n");
    await write(path.join(scope, WORKSPACE_MARKER_FILENAME), `${realDesk}\n`);

    await migrateDataRootLayout(root);

    const newReal = await fs.realpath(moved("acme", "organizations", "co_one", "workspace"));
    const newScope = memoryScopeDir(root, "acme", "writer", workspaceMemoryKeyForRealPath(newReal));
    expect(await fs.readFile(path.join(newScope, "MEMORY.md"), "utf8")).toBe(
      "- [style](style.md)\n",
    );
    expect(await fs.readFile(path.join(newScope, WORKSPACE_MARKER_FILENAME), "utf8")).toBe(
      `${newReal}\n`,
    );
    await expect(fs.access(memoryScopeDir(root, "acme", "writer", oldKey))).rejects.toThrow();
  });

  it("re-points an Agent's workbenches link whose absolute target was inside the moved folder", async () => {
    await oldProject("acme");
    await oldAgent("acme", "writer");
    const target = old("acme", "agents", "writer", "agent_state", "workbenches");
    await fs.mkdir(target, { recursive: true });
    await write(path.join(target, "board", "package.json"), "{}");
    // What PRFC-0020's move left on Windows: a junction, whose target is absolute. Elsewhere it
    // left a relative symlink; an absolute one here takes the same branch.
    await fs.symlink(
      target,
      old("acme", "agents", "writer", "workbenches"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await migrateDataRootLayout(root);

    const link = moved("acme", "agents", "writer", "workbenches");
    const pointed = (await fs.readlink(link)).replace(/^\\\\\?\\/, "");
    expect(path.resolve(pointed)).toBe(
      path.resolve(moved("acme", "agents", "writer", "agent_state", "workbenches")),
    );
    expect(await fs.readFile(path.join(link, "board", "package.json"), "utf8")).toBe("{}");
  });

  it.runIf(process.platform === "win32")(
    "leaves a directory junction, not a symbolic link, at a Project's old place on Windows",
    async () => {
      await oldProject("acme");
      await migrateDataRootLayout(root);
      const target = (await fs.readlink(old("acme"))).replace(/^\\\\\?\\/, "");
      expect(path.isAbsolute(target)).toBe(true);
      expect(path.resolve(target)).toBe(path.resolve(moved("acme")));
    },
  );

  it("finishes a run that was cut short after the move", async () => {
    await oldProject("acme", `[default_chat]\nworkspace = ${JSON.stringify(old("acme", "w"))}\n`);
    // The previous run journaled the step, renamed the folder, and stopped before the link.
    await write(
      old(".layout-migration.json"),
      JSON.stringify({
        version: 1,
        inProgress: [{ step: "2026-11-projects-level", projectId: "acme" }],
        pendingStore: [],
      }),
    );
    await fs.mkdir(moved(), { recursive: true });
    await fs.rename(old("acme"), moved("acme"));

    const result = await migrateDataRootLayout(root);

    expect(result.movedProjects).toEqual(["acme"]);
    expect(await fs.realpath(old("acme"))).toBe(await fs.realpath(moved("acme")));
    expect(await fs.readFile(moved("acme", ".project_config.toml"), "utf8")).toContain(
      JSON.stringify(moved("acme", "w")),
    );
  });

  it("changes nothing on a second run", async () => {
    await oldProject("acme");
    await oldAgent("acme", "writer");
    await migrateDataRootLayout(root, { store: { rewritePaths: () => {} } });
    const before = await snapshot(root);

    const again = await migrateDataRootLayout(root, { store: { rewritePaths: () => {} } });

    expect(again.movedProjects).toEqual([]);
    expect(await snapshot(root)).toEqual(before);
  });

  it("moves a Project folder an older build made at the top level after the migration", async () => {
    await oldProject("acme");
    await migrateDataRootLayout(root);
    // A downgrade: the older build lists its Projects from web.db and makes a new one where it
    // always did.
    await oldProject("later");

    const result = await migrateDataRootLayout(root);

    expect(result.movedProjects).toEqual(["later"]);
    expect((await listProjectDirs(root)).map((p) => p.id)).toEqual(["acme", "later"]);
  });

  it("moves no Project when one cannot be moved, and the next run moves them all", async () => {
    await oldProject("acme");
    await oldAgent("acme", "writer");
    await oldProject("default_project");
    await write(old("web.db"), "");
    const entries = await fs.readdir(root);
    const before = await snapshot(root);
    // What Windows answers while a terminal, an editor or a command holds the folder open.
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation((from, to) =>
      String(from) === old("default_project")
        ? Promise.reject(Object.assign(new Error("EPERM: injected"), { code: "EPERM" }))
        : rename(from, to),
    );

    const run = migrateDataRootLayout(root);

    await expect(run).rejects.toBeInstanceOf(LayoutMigrationError);
    await expect(run).rejects.toThrow(/default_project.*Nothing was moved/s);
    expect(await fs.readdir(root)).toEqual(entries);
    expect(await snapshot(root)).toEqual(before);

    vi.restoreAllMocks();
    const again = await migrateDataRootLayout(root);

    expect(again.movedProjects).toEqual(["acme", "default_project"]);
  });

  it("stops before anything moves when a Project is called projects", async () => {
    await oldProject("projects");
    await oldProject("acme");
    const before = await snapshot(root);

    const run = migrateDataRootLayout(root);

    await expect(run).rejects.toBeInstanceOf(LayoutMigrationError);
    await expect(run).rejects.toMatchObject({ code: "projects_id_collision" });
    await expect(run).rejects.toThrow(/Project named "projects".*Nothing was moved/s);
    expect(await snapshot(root)).toEqual(before);
  });

  it("refuses a root that is another data root's Projects folder", async () => {
    await oldProject("acme");
    await migrateDataRootLayout(root);
    await write(old("web.db"), "");
    const before = await snapshot(root);

    // What a stale `PENGUIN_HOME="$(dirname "$PROJECT_DIR")"` would point a server at.
    await expect(migrateDataRootLayout(moved())).rejects.toMatchObject({
      code: "nested_data_root",
    });
    expect(await snapshot(root)).toEqual(before);
  });
});

describe("Benchmarks into the Evaluation Center's data folder", () => {
  it("moves them to the system Agent's app data, and an old absolute path still reaches them", async () => {
    await oldProject("acme");
    await oldAgent("acme", "system_agent", true);
    await write(old("acme", "benchmarks", "b1", "benchmark_config.toml"), 'id = "b1"\n');

    await migrateDataRootLayout(root);

    const folder = benchmarksDir(root, "acme");
    expect(folder).toBe(moved("acme", "agents", "system_agent", "app", "data", "benchmark"));
    expect(await fs.readFile(path.join(folder, "b1", "benchmark_config.toml"), "utf8")).toBe(
      'id = "b1"\n',
    );
    expect(await resolveBenchmarksDir(root, "acme")).toBe(folder);
    // Through both links: the Project's old place, then its old `benchmarks/`.
    await fs.writeFile(old("acme", "benchmarks", "b1", "scoreboard.yaml"), "evaluations: []\n");
    expect(await fs.readFile(path.join(folder, "b1", "scoreboard.yaml"), "utf8")).toBe(
      "evaluations: []\n",
    );
  });

  it("gives an older Project its system Agent first", async () => {
    await oldProject("acme");
    await write(old("acme", "benchmarks", "b1", "benchmark_config.toml"), 'id = "b1"\n');

    await migrateDataRootLayout(root);

    expect(
      await fs.readFile(
        moved("acme", "agents", "system_agent", "agent_state", "system_config.yaml"),
        "utf8",
      ),
    ).toMatch(/^system: true$/m);
    await expect(fs.access(path.join(benchmarksDir(root, "acme"), "b1"))).resolves.toBeUndefined();
  });

  it("leaves them in place in a Project whose system_agent is an Agent of the user's", async () => {
    await oldProject("acme");
    await oldAgent("acme", "system_agent");
    await write(old("acme", "benchmarks", "b1", "benchmark_config.toml"), 'id = "b1"\n');
    const lines: string[] = [];

    await migrateDataRootLayout(root, { log: (line) => lines.push(line) });

    const legacy = moved("acme", "benchmarks");
    expect((await fs.lstat(legacy)).isDirectory()).toBe(true);
    expect(await resolveBenchmarksDir(root, "acme")).toBe(legacy);
    expect(lines.some((line) => line.includes("an Agent of the user's"))).toBe(true);
  });

  it("keeps a Benchmark whose id the new folder already holds in the old folder, and moves the rest", async () => {
    await oldProject("acme");
    await oldAgent("acme", "system_agent", true);
    await write(old("acme", "benchmarks", "b1", "benchmark_config.toml"), "old");
    await write(old("acme", "benchmarks", "b2", "benchmark_config.toml"), "two");
    await write(
      old(
        "acme",
        "agents",
        "system_agent",
        "app",
        "data",
        "benchmark",
        "b1",
        "benchmark_config.toml",
      ),
      "by hand",
    );

    await migrateDataRootLayout(root);

    const folder = benchmarksDir(root, "acme");
    expect(await fs.readFile(path.join(folder, "b1", "benchmark_config.toml"), "utf8")).toBe(
      "by hand",
    );
    expect(await fs.readFile(path.join(folder, "b2", "benchmark_config.toml"), "utf8")).toBe("two");
    expect(
      await fs.readFile(moved("acme", "benchmarks", "b1", "benchmark_config.toml"), "utf8"),
    ).toBe("old");
    expect((await fs.lstat(moved("acme", "benchmarks"))).isDirectory()).toBe(true);
  });
});

describe("the SDK's rule", () => {
  /** An old-layout `default_project` with its models, as a host would have seeded it. */
  async function oldSeededProject(): Promise<void> {
    await seedProject(root);
    await fs.rename(moved("default_project"), old("default_project"));
    await fs.rmdir(moved());
  }

  it("migrates a root no server holds before it opens the Agent", async () => {
    await oldSeededProject();

    const agent = await createAgent({ root });

    expect(agent.state.stateDir).toBe(
      moved("default_project", "agents", "default_agent", "agent_state"),
    );
    expect(await fs.realpath(old("default_project"))).toBe(
      await fs.realpath(projectDir(root, "default_project")),
    );
  });

  it("refuses a root in the old layout while a server holds it, and moves nothing", async () => {
    await oldSeededProject();
    const listener = net.createServer();
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const { port } = listener.address() as net.AddressInfo;
    await write(old("server.lock"), JSON.stringify({ pid: process.pid, port, startedAt: "" }));
    try {
      await expect(createAgent({ root })).rejects.toMatchObject({ code: "server_holds_root" });
      expect((await fs.lstat(old("default_project"))).isDirectory()).toBe(true);
      await expect(fs.access(moved())).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
    // Once no server answers on the lock, the next call migrates.
    await createAgent({ root });
    expect((await fs.lstat(old("default_project"))).isSymbolicLink()).toBe(true);
  });

  it("resumes a conversation recorded in a temporary Workspace under the old folder", async () => {
    await oldSeededProject();
    const workspace = old(
      "default_project",
      "agents",
      "default_agent",
      "workspaces",
      "tmp-0a1b2c3d",
    );
    await fs.mkdir(workspace, { recursive: true });
    const sessionId = "session-2026-11-01-10-00-00-abcdef01";
    await write(
      old(
        "default_project",
        "agents",
        "default_agent",
        "traces",
        "2026-11-01",
        `${sessionId}_001.jsonl`,
      ),
      [
        sessionMeta({
          session_id: sessionId,
          provider: "deepseek",
          model_id: "deepseek-flash",
          model_context_window: 1_000_000,
          system_prompt: `App Data Dir: ${old("default_project")}`,
          agent_state: old("default_project", "agents", "default_agent", "agent_state"),
          workspace,
          source: "user",
        }),
        userText("hello"),
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    );

    const agent = await createAgent({ root });
    const session = await agent.resumeSession({ sessionId });

    // The recorded Workspace is the old path, and it is still there: through the link.
    expect(session.workspaceDir).toBe(workspace);
    expect(await fs.realpath(workspace)).toBe(
      await fs.realpath(
        moved("default_project", "agents", "default_agent", "workspaces", "tmp-0a1b2c3d"),
      ),
    );
  });
});
