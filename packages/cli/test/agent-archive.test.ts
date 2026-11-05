/**
 * `penguin agent export` and `penguin agent import`, driven through `cli()` in-process against the
 * fake server's Agent archive routes, with real temp directories for the files on either end.
 *
 * - By default `export` asks for the export dialog's parts (everything but schedules and Traces),
 *   the preview first and then the zip with the same query, and writes the server's zip into
 *   `--out` under the name the server gives it.
 * - Every export option reaches the query, the agent-porting Skill's own command line among them.
 * - `--out` naming a file writes there, its parent created; `--json` names the file, its size and
 *   the preview's notes.
 * - A name the server gives cannot take the zip out of `--out`.
 * - A malformed `--traces` fails before any request, and nothing is written.
 * - A download that breaks off leaves no file behind.
 * - What the preview says the export leaves out reaches stderr: a part whose folder is a link,
 *   worded by the CLI, and the Sessions with a file too large for an import; `--json` carries the
 *   notes as the server gave them.
 * - A selection the server would refuse stops at the preview: exit 1, why on stderr, no download
 *   and nothing written.
 * - An Agent whose own config does not parse (the server's 422 `invalid_config`) is refused in one
 *   line in the CLI's words, before any download.
 * - `import <folder>` uploads the folder as a raw zip (`application/octet-stream`) with its
 *   manifest at the root and without `.git`; the Agent id comes from the manifest.
 * - A taken id fails with the server's `agent_exists` and says how to import anyway; `--agent-id`
 *   then imports it under another id.
 * - Links and special files in a folder stay out of its zip: a link to a file or a directory
 *   outside the folder is never read, and a FIFO never blocks the zip.
 * - A folder without `manifest.json` at its root is refused before any request.
 * - A folder whose zip grows past the upload cap is refused before anything is sent (the cap is
 *   lowered through the commands' limits, so the test writes kilobytes, not 100 MiB).
 * - `import <file>` uploads the file's bytes as they are, and `--overwrite` asks for the existing
 *   agent to be replaced.
 * - A file larger than an import accepts is refused before anything is sent.
 * - An upload the server refuses for a token it has replaced is sent again with the new token, its
 *   whole body included.
 * - The text report names the mode and version, the backup, what came along, the Sessions left
 *   out (with the server's detail when it gives one), what is left to fill in and the server's
 *   notes; `--json` prints the response as it is.
 * - A note whose code the CLI knows is worded in the CLI's language, so a zh CLI does not show the
 *   server's English sentence for it; a note with any other code prints the server's sentence.
 * - An overwrite that could not refill credentials from the Agent's unparsable config says so in
 *   the CLI's language.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { Command } from "commander";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type {
  AgentArchiveImportResponse,
  AgentArchiveNoteCode,
} from "@prismshadow/penguin-server/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerArchiveCommands } from "../src/commands/agent-archive.js";
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
/** The query of the preview the export asked first, as a plain object. */
const previewQuery = () => {
  const get = server.requests.find((r) => r.path.endsWith("/archive/preview"));
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
      "/api/projects/default_project/agents/writer/archive/preview",
      "/api/projects/default_project/agents/writer/archive",
    ]);
    expect(previewQuery()).toEqual(exportQuery());
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
    expect(server.requests.map((r) => r.path)).toEqual([
      "/api/projects/proj-1/agents/writer/archive/preview",
      "/api/projects/proj-1/agents/writer/archive",
    ]);
    expect(exportQuery()).toEqual(query);
    expect(previewQuery()).toEqual(query);
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
      notes: [],
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

  it("says on stderr what the export leaves out, and --json carries the notes", async () => {
    const notes = [
      {
        code: "link_skipped",
        subject: "skills",
        message: "agent_state/skills is a link, so the export leaves it out.",
      },
    ];
    const tooLarge = "session-2026-08-01-09-00-00-0000000c";
    const preview = server.agentArchive.previewed;
    server.agentArchive.previewed = (agentId, query) => ({
      ...(preview(agentId, query) as Record<string, unknown>),
      notes,
      traces: {
        sessions: 1,
        files: 1,
        bytes: 10,
        skipped: [{ sessionId: tooLarge, reason: "too_large" }],
        newest: null,
        oldest: null,
      },
    });
    const dir = dirIn("exports");

    expect(await cli(["agent", "export", "writer", "--out", dir, "--json"])).toBe(0);

    expect(err()).toContain("agent_state/skills");
    expect(err()).toContain(tooLarge);
    expect(JSON.parse(out()).notes).toEqual(notes);
    expect(fs.readdirSync(dir)).toEqual(["writer-20260902.zip"]);
  });

  it("refuses, in one line in its own words, an agent whose config does not parse", async () => {
    server.agentArchive.previewed = () =>
      new Response(
        JSON.stringify({
          error: {
            code: "invalid_config",
            message:
              "The Agent's system_config.yaml does not parse; fix it before exporting the Agent.",
          },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      );
    const dir = dirIn("exports");

    expect(await cli(["agent", "export", "writer", "--out", dir])).toBe(1);

    expect(err()).toBe(`${t.agent.exportInvalidConfig("writer")}\n`);
    expect(server.requests.map((r) => r.path)).toEqual([
      "/api/projects/default_project/agents/writer/archive/preview",
    ]);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("stops at the preview when the server would refuse the selection, downloading nothing", async () => {
    const file = "traces/2026-08-01/session-2026-08-01-09-00-00-0000000c_001.jsonl";
    const preview = server.agentArchive.previewed;
    server.agentArchive.previewed = (agentId, query) => ({
      ...(preview(agentId, query) as Record<string, unknown>),
      refusal: { reason: "entry", limit: 256 * 1024 * 1024, subject: file },
    });
    const dir = dirIn("exports");

    expect(await cli(["agent", "export", "writer", "--out", dir])).toBe(1);

    expect(err()).toContain(file);
    expect(server.requests.map((r) => r.path)).toEqual([
      "/api/projects/default_project/agents/writer/archive/preview",
    ]);
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

  it("leaves links and special files out of a folder's zip, never reading what they point at", async () => {
    const outside = dirIn("outside");
    fs.writeFileSync(path.join(outside, "id_rsa"), "not for upload");
    const dir = portFolder();
    fs.symlinkSync(path.join(outside, "id_rsa"), path.join(dir, "agent_state", "key.md"));
    // A junction on Windows, which needs no privilege; elsewhere the type is ignored.
    fs.symlinkSync(outside, path.join(dir, "agent_state", "linked"), "junction");
    // Reading a FIFO nobody writes would block for ever.
    if (process.platform !== "win32")
      execFileSync("mkfifo", [path.join(dir, "agent_state", "pipe")]);

    expect(await cli(["agent", "import", dir])).toBe(0);

    expect(Object.keys(unzipSync(upload()!.raw!.bytes)).sort()).toEqual([
      "agent_state/AGENTS.md",
      "agent_state/skills/notes/SKILL.md",
      "manifest.json",
    ]);
  });

  it("refuses a folder whose zip grows past the upload cap before anything is sent", async () => {
    const dir = portFolder();
    // Random bytes do not compress: two of these zip to more than the cap below.
    for (const name of ["a.bin", "b.bin"]) {
      fs.writeFileSync(path.join(dir, "agent_state", name), randomBytes(48 * 1024));
    }
    const program = new Command().exitOverride();
    registerArchiveCommands(program.command("agent"), t, { maxUploadBytes: 64 * 1024 });

    await expect(program.parseAsync(["agent", "import", dir], { from: "user" })).rejects.toThrow(
      dir,
    );

    expect(server.requests).toEqual([]);
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

  it("sends an upload again, its whole body included, when the server has replaced its token", async () => {
    const tokenFile = path.join(process.env.PENGUIN_HOME!, "api-token");
    fs.writeFileSync(tokenFile, "old-token\n");
    server.staleTokens.add("old-token");
    server.onStaleToken = () => fs.writeFileSync(tokenFile, "new-token\n");
    // Larger than one read of the file stream, so a body sent twice is read twice from disk.
    const bytes = randomBytes(200 * 1024);
    const file = path.join(scratch, "writer.zip");
    fs.writeFileSync(file, bytes);

    expect(await cli(["agent", "import", file, "--agent-id", "writer"])).toBe(0);

    const posts = server.requests.filter((r) => r.path.endsWith("/agents/import"));
    expect(posts.map((r) => r.credential?.authorization)).toEqual([
      "Bearer old-token",
      "Bearer new-token",
    ]);
    expect(Buffer.from(posts[1]!.raw!.bytes)).toEqual(bytes);
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
        {
          sessionId: "session-2026-08-02-09-00-00-0000000b",
          reason: "invalid",
          detail: "session-2026-08-02-09-00-00-0000000b_002.jsonl is missing",
        },
      ],
      toFill: ["DOCS_TOKEN", "mcp:docs:headers:Authorization"],
      notes: [
        {
          code: "unknown_tool",
          subject: "web_fetch",
          message: 'Built-in tool "web_fetch" does not exist in this install; it was not enabled.',
        },
        // A code from a newer server, which this CLI does not know.
        { code: "future_note" as AgentArchiveNoteCode, message: "Something a newer server says." },
      ],
    };
    const [exists, invalid] = answer.skippedTraces;
    const [knownNote, unknownNote] = answer.notes;

    beforeEach(() => {
      server.agentArchive.imported = () => ({ status: 201, body: answer });
    });

    it("names the mode and version, the backup, what came along, the Sessions left out, what to fill in and the notes", async () => {
      expect(await cli(["agent", "import", portFolder(), "--overwrite"])).toBe(0);

      const text = out();
      expect(text).toContain(t.agent.importOverwritten("writer", "default_project", 8, 7));
      expect(text).toContain(answer.backup!);
      expect(text).toContain(t.agent.importCounts(answer.imported));
      expect(text).toContain(`${exists!.sessionId} (${t.agent.importSkippedReason("exists")})`);
      expect(text).toContain(invalid!.sessionId);
      expect(text).toContain(invalid!.detail!);
      for (const line of answer.toFill) expect(text).toContain(line);
      expect(text).toContain(knownNote!.subject!);
      expect(text).toContain(unknownNote!.message);
    });

    it("words a note it knows in the CLI's language, and prints any other as the server's sentence", async () => {
      const saved = process.env.PENGUIN_LANG;
      process.env.PENGUIN_LANG = "zh";
      try {
        expect(await cli(["agent", "import", portFolder(), "--overwrite"])).toBe(0);
      } finally {
        if (saved === undefined) delete process.env.PENGUIN_LANG;
        else process.env.PENGUIN_LANG = saved;
      }

      const text = out();
      expect(text).toContain(knownNote!.subject!);
      expect(text).not.toContain(knownNote!.message);
      expect(text).toContain(unknownNote!.message);
    });

    it("says in the CLI's language that an overwrite could not refill credentials from an unparsable config", async () => {
      const note = {
        code: "current_config_invalid" as const,
        message:
          "The Agent's own system_config.yaml did not parse, so no blanked credential was filled from it.",
      };
      server.agentArchive.imported = () => ({ status: 201, body: { ...answer, notes: [note] } });
      const saved = process.env.PENGUIN_LANG;
      process.env.PENGUIN_LANG = "zh";
      try {
        expect(await cli(["agent", "import", portFolder(), "--overwrite"])).toBe(0);
      } finally {
        if (saved === undefined) delete process.env.PENGUIN_LANG;
        else process.env.PENGUIN_LANG = saved;
      }

      expect(out()).toContain(getMessages("zh").agent.archiveNote(note));
      expect(out()).not.toContain(note.message);
    });

    it("--json prints the server's response as it is", async () => {
      expect(await cli(["agent", "import", portFolder(), "--json"])).toBe(0);
      expect(JSON.parse(out())).toEqual(answer);
    });
  });
});
