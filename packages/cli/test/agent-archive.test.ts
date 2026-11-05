/**
 * `penguin agent export` and `penguin agent import`, driven through `cli()` in-process against the
 * fake server's Agent archive routes, with real temp directories for the files on either end.
 *
 * - By default `export` asks for the export dialog's parts (everything but schedules and Traces)
 *   and writes the server's zip into `--out` under the name the server gives it.
 * - Every export option reaches the query, the agent-porting Skill's own command line among them.
 * - `--out` naming a file writes there, its parent created; `--json` names the file and its size.
 * - A name the server gives cannot take the zip out of `--out`.
 * - A malformed `--traces` fails before any request, and nothing is written.
 * - A download that breaks off leaves no file behind.
 * - `import <folder>` uploads the folder as a raw zip (`application/octet-stream`) with its
 *   manifest at the root and without `.git`; the Agent id comes from the manifest.
 * - A taken id fails with the server's `agent_exists` and says how to import anyway; `--agent-id`
 *   then imports it under another id.
 * - A folder without `manifest.json` at its root is refused before any request.
 * - `import <file>` uploads the file's bytes as they are, and `--overwrite` asks for the existing
 *   agent to be replaced.
 * - A file larger than an import accepts is refused before anything is sent.
 * - The text report names the mode and version, the backup, what came along, the Sessions left
 *   out, what is left to fill in and the server's notes; `--json` prints the response as it is.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { AgentArchiveImportResponse } from "@prismshadow/penguin-server/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");

let server: FakeServer;
let uninstall: () => void;
let stdout: string[];
let stderr: string[];
let restore: Array<{ mockRestore(): void }>;
let scratch: string;

beforeEach(() => {
  server = new FakeServer();
  uninstall = server.install();
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-archive-"));
  stdout = [];
  stderr = [];
  restore = [
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    }),
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    }),
  ];
});
afterEach(() => {
  for (const spy of restore) spy.mockRestore();
  uninstall();
  fs.rmSync(scratch, { recursive: true, force: true });
});

const out = () => stdout.join("");
const err = () => stderr.join("");
/** A fresh directory under the test's scratch root. */
function dirIn(name: string): string {
  const dir = path.join(scratch, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
/** The query of the one archive download, as a plain object. */
const exportQuery = () => {
  const get = server.requests.find((r) => r.path.endsWith("/archive"));
  return Object.fromEntries(new URLSearchParams(get?.search ?? ""));
};
/** The one import upload. */
const upload = () => server.requests.find((r) => r.path.endsWith("/agents/import"));

/** A zip the fake serves as the export, distinct per test. */
const servedZip = (agentId: string) =>
  zipSync({ [`${agentId}/agent_state/AGENTS.md`]: strToU8(`# ${agentId}\n`) });

/** Writes `files` (relative path → text) under a new folder and returns it. */
function folder(name: string, files: Record<string, string>): string {
  const root = dirIn(name);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

/** A folder as the agent-porting Skill writes it, plus a `.git` that must not travel. */
const portFolder = () =>
  folder("port", {
    "manifest.json": JSON.stringify({ format: "penguin-agent-zip/1", agentId: "writer" }),
    "agent_state/AGENTS.md": "# Writer\n",
    "agent_state/skills/notes/SKILL.md": "---\nname: notes\ndescription: Take notes.\n---\n",
    ".git/HEAD": "ref: refs/heads/main\n",
  });

describe("penguin agent export", () => {
  it("asks for the dialog's parts by default and writes the server's zip under its name into --out", async () => {
    const zip = servedZip("writer");
    server.agentArchive.exported = () => ({ body: zip, fileName: "writer-20260902.zip" });
    const dir = dirIn("exports");

    expect(await cli(["agent", "export", "writer", "--out", dir])).toBe(0);

    expect(server.requests.map((r) => r.path)).toEqual([
      "/api/projects/default_project/agents/writer/archive",
    ]);
    expect(exportQuery()).toEqual({
      skills: "1",
      hooks: "1",
      memory: "1",
      workbenches: "1",
      workbenchData: "1",
      schedules: "0",
      traces: "none",
    });
    expect(fs.readdirSync(dir)).toEqual(["writer-20260902.zip"]);
    expect(new Uint8Array(fs.readFileSync(path.join(dir, "writer-20260902.zip")))).toEqual(zip);
    expect(out()).toContain(path.join(dir, "writer-20260902.zip"));
  });

  it.each([
    {
      argv: ["--traces", "last:20", "--no-skills", "--no-memory", "--schedules"],
      query: {
        skills: "0",
        hooks: "1",
        memory: "0",
        workbenches: "1",
        workbenchData: "1",
        schedules: "1",
        traces: "last:20",
      },
    },
    {
      argv: ["--no-hooks", "--no-workbench-data", "--traces", "2026-08-01..2026-08-31"],
      query: {
        skills: "1",
        hooks: "0",
        memory: "1",
        workbenches: "1",
        workbenchData: "0",
        schedules: "0",
        traces: "2026-08-01..2026-08-31",
      },
    },
    {
      argv: ["--no-workbenches", "--traces", "none"],
      query: {
        skills: "1",
        hooks: "1",
        memory: "1",
        workbenches: "0",
        workbenchData: "0",
        schedules: "0",
        traces: "none",
      },
    },
  ])("sends $argv as the parts the dialog would ask for", async ({ argv, query }) => {
    const dir = dirIn("exports");
    expect(
      await cli(["agent", "export", "writer", "--project-id", "proj-1", "--out", dir, ...argv]),
    ).toBe(0);
    expect(server.requests[0]?.path).toBe("/api/projects/proj-1/agents/writer/archive");
    expect(exportQuery()).toEqual(query);
  });

  it("writes to the file --out names, creating its parent, and --json names the file and its size", async () => {
    const zip = servedZip("writer");
    server.agentArchive.exported = () => ({ body: zip, fileName: "writer-20260902.zip" });
    const file = path.join(scratch, "backups", "nested", "writer.zip");

    expect(await cli(["agent", "export", "writer", "--out", file, "--json"])).toBe(0);

    expect(JSON.parse(out())).toEqual({
      agentId: "writer",
      projectId: "default_project",
      file,
      bytes: zip.byteLength,
    });
    expect(new Uint8Array(fs.readFileSync(file))).toEqual(zip);
  });

  it("keeps the zip inside --out whatever name the server gives it", async () => {
    server.agentArchive.exported = () => ({
      body: servedZip("writer"),
      fileName: "../../escape.zip",
    });
    const dir = dirIn("exports");

    expect(await cli(["agent", "export", "writer", "--out", dir, "--json"])).toBe(0);

    expect(JSON.parse(out()).file).toBe(path.join(dir, "escape.zip"));
    expect(fs.readdirSync(dir)).toEqual(["escape.zip"]);
  });

  it.each(["last:0", "recent", "2026-08-31..2026-08-01", "2026-02-30..2026-03-01"])(
    "refuses --traces %s before any request, writing nothing",
    async (traces) => {
      const dir = dirIn("exports");
      expect(await cli(["agent", "export", "writer", "--out", dir, "--traces", traces])).toBe(1);
      expect(server.requests).toEqual([]);
      expect(err()).toContain(traces);
      expect(fs.readdirSync(dir)).toEqual([]);
    },
  );

  it("leaves no file behind when the download breaks off", async () => {
    server.agentArchive.exported = () => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(strToU8("PK half a zip"));
          controller.error(new Error("connection reset"));
        },
      }),
      fileName: "writer-20260902.zip",
    });
    const dir = dirIn("exports");

    expect(await cli(["agent", "export", "writer", "--out", dir])).toBe(1);

    expect(err()).toContain("connection reset");
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe("penguin agent import", () => {
  it("uploads a folder as a raw zip, manifest at the root and without .git, under the manifest's id", async () => {
    const dir = portFolder();

    expect(await cli(["agent", "import", dir])).toBe(0);

    const post = upload();
    expect(post?.method).toBe("POST");
    expect(post?.path).toBe("/api/projects/default_project/agents/import");
    expect(post?.search).toBe("");
    expect(post?.raw?.contentType).toBe("application/octet-stream");
    const entries = unzipSync(post!.raw!.bytes);
    expect(Object.keys(entries).sort()).toEqual([
      "agent_state/AGENTS.md",
      "agent_state/skills/notes/SKILL.md",
      "manifest.json",
    ]);
    expect(strFromU8(entries["agent_state/AGENTS.md"]!)).toBe("# Writer\n");
    expect(server.agents.map((a) => a.agentId)).toContain("writer");
    expect(out()).toContain("writer");
  });

  it("a taken id fails with agent_exists and says how to import anyway; --agent-id imports it under another id", async () => {
    server.agents.push({ agentId: "writer", name: "Writer", sessionCount: 0 });
    const dir = portFolder();

    expect(await cli(["agent", "import", dir])).toBe(1);
    expect(err()).toContain("agent_exists");
    expect(err()).toContain(t.agent.importExistsHint());
    expect(server.agents.map((a) => a.agentId)).toEqual(["default_agent", "writer"]);

    expect(await cli(["agent", "import", dir, "--agent-id", "writer_2"])).toBe(0);
    expect(new URLSearchParams(server.requests.at(-1)?.search).get("agentId")).toBe("writer_2");
    expect(server.agents.map((a) => a.agentId)).toEqual(["default_agent", "writer", "writer_2"]);
  });

  it("refuses a folder without manifest.json at its root before any request", async () => {
    const dir = folder("loose", {
      "writer/manifest.json": JSON.stringify({ format: "penguin-agent-zip/1", agentId: "writer" }),
      "writer/agent_state/AGENTS.md": "# Writer\n",
    });

    expect(await cli(["agent", "import", dir])).toBe(1);

    expect(server.requests).toEqual([]);
    expect(err()).toContain(dir);
  });

  it("uploads a file's bytes as they are, and --overwrite asks for the existing agent to be replaced", async () => {
    server.agents.push({ agentId: "writer", name: "Writer", sessionCount: 0 });
    const file = path.join(scratch, "writer-v7.tar.gz");
    const bytes = zlib.gzipSync("an old Agent State package");
    fs.writeFileSync(file, bytes);

    expect(await cli(["agent", "import", file, "--agent-id", "writer", "--overwrite"])).toBe(0);

    const post = upload();
    expect(Object.fromEntries(new URLSearchParams(post?.search))).toEqual({
      agentId: "writer",
      overwrite: "1",
    });
    expect(post?.raw?.contentType).toBe("application/octet-stream");
    expect(Buffer.from(post!.raw!.bytes)).toEqual(bytes);
    expect(out()).toContain(t.agent.importOverwritten("writer", "default_project", 1, undefined));
  });

  it("refuses a file larger than an import accepts before anything is sent", async () => {
    const file = path.join(scratch, "huge.zip");
    fs.writeFileSync(file, "");
    // Sparse: the size is declared, nothing is written.
    fs.truncateSync(file, 200 * 1024 * 1024);

    expect(await cli(["agent", "import", file])).toBe(1);

    expect(server.requests).toEqual([]);
    expect(err()).toContain(file);
  });

  describe("the report", () => {
    const answer: AgentArchiveImportResponse = {
      agent: {
        agentId: "writer",
        name: "Writer",
        activeSessionCount: 0,
        sessionCount: 2,
        sessionActivity: [],
        toolCount: 7,
        version: 8,
        kernelOutdated: false,
        vaultKeyCount: 0,
        scheduleCount: 0,
        workbenchCount: 0,
        skillCount: 3,
        hookCount: 1,
        pluginUpdates: [],
        memoryCount: 4,
        apiEnabled: false,
      },
      mode: "overwritten",
      version: 8,
      previousVersion: 7,
      backup: "snapshots/import-backup-v7-20260902T100000-ab12.tar.gz",
      imported: {
        skills: 3,
        hooks: 1,
        memoryFiles: 4,
        workbenches: 0,
        schedules: 0,
        traces: { sessions: 2, files: 5 },
      },
      skippedTraces: [
        { sessionId: "session-2026-08-01-09-00-00-0000000a", reason: "exists" },
        { sessionId: "session-2026-08-02-09-00-00-0000000b", reason: "invalid" },
      ],
      toFill: ["DOCS_TOKEN", "mcp:docs:headers:Authorization"],
      notes: ["The definition names the built-in tool web_fetch, which this install lacks."],
    };

    beforeEach(() => {
      server.agentArchive.imported = () => ({ status: 201, body: answer });
    });

    it("names the mode and version, the backup, what came along, the Sessions left out, what to fill in and the notes", async () => {
      expect(await cli(["agent", "import", portFolder(), "--overwrite"])).toBe(0);

      const text = out();
      expect(text).toContain(t.agent.importOverwritten("writer", "default_project", 8, 7));
      expect(text).toContain(answer.backup!);
      expect(text).toContain(t.agent.importCounts(answer.imported));
      for (const { sessionId, reason } of answer.skippedTraces) {
        expect(text).toContain(`${sessionId} (${t.agent.importSkippedReason(reason)})`);
      }
      for (const line of [...answer.toFill, ...answer.notes]) expect(text).toContain(line);
    });

    it("--json prints the server's response as it is", async () => {
      expect(await cli(["agent", "import", portFolder(), "--json"])).toBe(0);
      expect(JSON.parse(out())).toEqual(answer);
    });
  });
});
