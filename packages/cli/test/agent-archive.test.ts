/**
 * `penguin agent export|import`, driven through `cli()` in-process against the fake server:
 *
 * - `export` asks for the dialog's defaults (every part but schedules, no Traces) and saves the
 *   zip under the server's name for it; its flags leave parts out, take schedules and Traces, and
 *   `--out` names the file.
 * - `import <directory>` zips the directory under its own name, without node_modules or .git,
 *   and uploads it raw; it reports what landed and the Sessions skipped. A file goes up as it is,
 *   with `--agent-id` and `--overwrite` in the query.
 * - A taken id answers with the way to overwrite it, and a failing exit code.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");

let server: FakeServer;
let uninstall: () => void;
let dir: string;
const stdout: string[] = [];
const stderr: string[] = [];

beforeEach(async () => {
  server = new FakeServer();
  uninstall = server.install();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-zip-"));
  stdout.length = 0;
  stderr.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation((c) => stdout.push(String(c)) > 0);
  vi.spyOn(process.stderr, "write").mockImplementation((c) => stderr.push(String(c)) > 0);
});
afterEach(async () => {
  vi.restoreAllMocks();
  uninstall();
  await fs.rm(dir, { recursive: true, force: true });
});

const query = () => Object.fromEntries(new URLSearchParams(server.requests.at(-1)!.search));

describe("penguin agent export", () => {
  it("asks for the dialog's defaults and saves the zip under the server's name", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    expect(await cli(["agent", "export", "source"])).toBe(0);
    expect(query()).toEqual({
      skills: "1",
      hooks: "1",
      memory: "1",
      workbenches: "1",
      workbenchData: "1",
      schedules: "0",
      traces: "none",
    });
    const file = path.join(dir, "source-20261109.zip");
    expect(new Uint8Array(await fs.readFile(file))).toEqual(server.agentArchive.exported);
  });

  it("leaves parts out, takes schedules and Traces, and writes where --out says", async () => {
    const out = path.join(dir, "copy.zip");
    const args = ["--no-memory", "--no-workbench-data", "--schedules", "--traces", "last:5"];
    expect(await cli(["agent", "export", "source", ...args, "--out", out])).toBe(0);
    expect(query()).toMatchObject({ memory: "0", workbenchData: "0", schedules: "1" });
    expect(query().traces).toBe("last:5");
    await expect(fs.access(out)).resolves.toBeUndefined();
  });
});

describe("penguin agent import", () => {
  it("zips a directory under its name without node_modules or .git, and reports what landed", async () => {
    const agentDir = path.join(dir, "ported");
    for (const rel of [
      "agent_state/system_config.yaml",
      "agent_state/node_modules/x.js",
      ".git/HEAD",
    ]) {
      await fs.mkdir(path.dirname(path.join(agentDir, rel)), { recursive: true });
      await fs.writeFile(path.join(agentDir, rel), "name: Ported\n");
    }
    server.agentArchive.answer = () => ({
      body: {
        agent: { agentId: "ported", name: "Ported" },
        mode: "created",
        version: 1,
        sessions: { imported: 2, skipped: ["session-a"] },
      },
    });

    expect(await cli(["agent", "import", agentDir])).toBe(0);

    expect(Object.keys(unzipSync(server.agentArchive.uploads[0]!))).toEqual([
      "ported/agent_state/system_config.yaml",
    ]);
    expect(stdout.join("")).toContain(
      t.agent.imported("created", "ported", "default_project", 1, 2),
    );
    expect(stdout.join("")).toContain(t.agent.importSkipped(["session-a"]));
  });

  it("uploads a file as it is, naming the id and the overwrite in the query", async () => {
    const file = path.join(dir, "old.tar.gz");
    await fs.writeFile(file, Buffer.from([0x1f, 0x8b, 1, 2]));

    expect(await cli(["agent", "import", file, "--agent-id", "legacy", "--overwrite"])).toBe(0);

    expect(new Uint8Array(server.agentArchive.uploads[0]!)).toEqual(
      new Uint8Array([0x1f, 0x8b, 1, 2]),
    );
    expect(query()).toEqual({ agentId: "legacy", overwrite: "1" });
  });

  it("answers a taken id with the way to overwrite it", async () => {
    const file = path.join(dir, "copy.zip");
    await fs.writeFile(file, server.agentArchive.exported);
    server.agentArchive.answer = () => ({
      status: 409,
      body: { error: { code: "agent_exists", message: "Agent id is already taken: copy." } },
    });

    expect(await cli(["agent", "import", file])).not.toBe(0);

    expect(stderr.join("")).toContain("already taken: copy");
    expect(stderr.join("")).toContain(t.agent.importOverwriteHint());
  });
});
