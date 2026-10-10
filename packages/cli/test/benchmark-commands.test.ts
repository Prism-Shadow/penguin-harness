/**
 * `penguin benchmark import`, driven through `cli()` in-process against the fake server and
 * asserted on the request it sends — the one the Evaluation Center's zip upload makes.
 *
 * - A package folder goes to the import route of the current Project (the Session's, inside one)
 *   zipped whole, every entry at the zip's root as the folder holds it: a dot-entry included, a
 *   link as a link, never followed. The imported Benchmark is reported.
 * - `--overwrite` and the three `--origin-*` options ride along, into the Project `--project-id`
 *   names; `--json` prints the server's answer.
 * - A zip goes up as it is.
 * - A taken id is answered with the Benchmark it belongs to and how to replace it; any other
 *   refusal is passed on as the server put it. Either way the command fails.
 * - Half an origin, a path with nothing at it and a folder past the package's file cap are refused
 *   before anything is sent.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");

const SHA = "c12d65bc20beb5130ed57b3b7983c62d497b7d2f";
const LINK =
  "https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/packages/report-writing-v1";

/** The package folder the scenarios import, by path inside it. */
const PACKAGE: Record<string, string> = {
  "benchmark.json": `${JSON.stringify({ id: "report-writing-v1", title: "Report writing" })}\n`,
  "CASE-001-contradictions/statement/README.md": "# Two briefs\n\nWrite the report.\n",
  "CASE-001-contradictions/rubric/README.md": "- 100 pts: names the conflict.\n",
  ".DS_Store": "x",
};

/** A zip's entries, read back with node:zlib: each one's text and the file type its Unix mode records (0 for none). */
function readZip(zip: Buffer): Map<string, { text: string; type: number }> {
  const entries = new Map<string, { text: string; type: number }>();
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = zip.readUInt32LE(end + 16);
  for (let n = zip.readUInt16LE(end + 10); n > 0; n--) {
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    const mode = zip.readUInt8(at + 5) === 3 ? zip.readUInt32LE(at + 38) >>> 16 : 0;
    const local = zip.readUInt32LE(at + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + zip.readUInt32LE(at + 20));
    const data = zip.readUInt16LE(at + 10) === 8 ? inflateRawSync(raw) : raw;
    entries.set(name, { text: data.toString("utf8"), type: mode & 0o170000 });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return entries;
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

let server: FakeServer;
let uninstall: () => void;
let stdout: string[];
let stderr: string[];
let spies: Array<{ mockRestore(): void }>;
let dir: string;

beforeEach(() => {
  server = new FakeServer();
  uninstall = server.install();
  stdout = [];
  stderr = [];
  spies = [
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    }),
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    }),
  ];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-benchmark-import-"));
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  uninstall();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The import requests sent so far. */
const imports = () =>
  server.requests.filter((r) => r.method === "POST" && r.path.endsWith("/benchmarks/archive"));

describe("penguin benchmark import", () => {
  it("sends a folder zipped whole, as it holds its entries, to the current Project's import route, and reports the import", async () => {
    writeFiles(dir, PACKAGE);
    const linkAt = "CASE-001-contradictions/statement/rubric.md";
    const target = path.join(dir, "CASE-001-contradictions", "rubric", "README.md");
    let linked = true;
    try {
      fs.symlinkSync(target, path.join(dir, ...linkAt.split("/")));
    } catch {
      linked = false; // Windows without the symlink privilege
    }
    // Inside a Session the Project is the Session's own.
    process.env.PENGUIN_PROJECT_ID = "proj_session";

    const code = await cli(["benchmark", "import", dir]);

    expect(code).toBe(0);
    const [request] = imports();
    expect(request!.path).toBe("/api/projects/proj_session/benchmarks/archive");
    expect(request!.body).not.toHaveProperty("overwrite");
    expect(request!.body).not.toHaveProperty("origin");
    const entries = readZip(Buffer.from(String(request!.body!.dataBase64), "base64"));
    expect([...entries.keys()].sort()).toEqual(
      [...Object.keys(PACKAGE), ...(linked ? [linkAt] : [])].sort(),
    );
    for (const [rel, text] of Object.entries(PACKAGE)) {
      expect(entries.get(rel), rel).toEqual({ text, type: 0 });
    }
    if (linked) expect(entries.get(linkAt)).toEqual({ text: target, type: 0o120000 });
    expect(stdout.join("")).toBe(
      `${t.benchmark.imported("report-writing-v1", "2026.10.08.3", 2, "proj_session")}\n`,
    );
  });

  it("carries --overwrite and the repository folder of --origin-* into the Project --project-id names, and prints the answer with --json", async () => {
    writeFiles(dir, PACKAGE);

    const code = await cli([
      "benchmark",
      "import",
      dir,
      "--overwrite",
      "--origin-url",
      LINK,
      "--origin-ref",
      SHA,
      "--origin-path",
      "packages/report-writing-v1",
      "--project-id",
      "proj_1",
      "--json",
    ]);

    expect(code).toBe(0);
    const [request] = imports();
    expect(request!.path).toBe("/api/projects/proj_1/benchmarks/archive");
    expect(request!.body).toMatchObject({
      overwrite: true,
      origin: { kind: "git", url: LINK, ref: SHA, path: "packages/report-writing-v1" },
    });
    expect(JSON.parse(stdout.join(""))).toMatchObject({ benchmark: { id: "report-writing-v1" } });
  });

  it("sends a zip as it is", async () => {
    const zip = path.join(dir, "report-writing-v1-v2026.10.08.3.zip");
    fs.writeFileSync(zip, "PK\u0003\u0004 the zip's own bytes");

    expect(await cli(["benchmark", "import", zip])).toBe(0);

    const sent = Buffer.from(String(imports()[0]!.body!.dataBase64), "base64");
    expect(sent.toString("utf8")).toBe("PK\u0003\u0004 the zip's own bytes");
  });

  it("answers a taken id with the Benchmark it belongs to and how to replace it, and fails", async () => {
    writeFiles(dir, PACKAGE);
    server.benchmarkImport = () => ({
      status: 409,
      body: {
        error: {
          code: "benchmark_exists",
          message: "Benchmark already exists: report-writing-v1",
          details: { benchmarkId: "report-writing-v1" },
        },
      },
    });

    expect(await cli(["benchmark", "import", dir])).toBe(1);

    expect(stderr.join("")).toContain(t.benchmark.exists("report-writing-v1", "default_project"));
    expect(stdout.join("")).toBe("");
  });

  it("passes on any other refusal as the server put it, and fails", async () => {
    writeFiles(dir, PACKAGE);
    server.benchmarkImport = () => ({
      status: 409,
      body: {
        error: {
          code: "benchmark_busy",
          message: "Benchmark report-writing-v1 is being evaluated.",
        },
      },
    });

    expect(await cli(["benchmark", "import", dir, "--overwrite"])).toBe(1);

    expect(stderr.join("")).toContain("benchmark_busy");
    expect(stderr.join("")).toContain("Benchmark report-writing-v1 is being evaluated.");
  });

  /** What is refused before a request goes out: the arguments for a scratch folder, and the line that says why. */
  const refusedLocally: Array<[string, (root: string) => string[], (root: string) => string]> = [
    [
      "half an origin",
      (root) => ["benchmark", "import", root, "--origin-url", LINK],
      () => t.benchmark.originIncomplete(),
    ],
    [
      "a path with nothing at it",
      (root) => ["benchmark", "import", path.join(root, "missing")],
      (root) => t.benchmark.missing(path.join(root, "missing")),
    ],
    [
      "a folder of more than 1000 files",
      (root) => {
        const many = Array.from({ length: 1001 }, (_, i) => [`CASE-001/statement/${i}.md`, "x"]);
        writeFiles(root, Object.fromEntries(many));
        return ["benchmark", "import", root];
      },
      (root) => t.benchmark.tooManyFiles(root, 1000),
    ],
  ];

  it.each(refusedLocally)("refuses %s before anything is sent", async (_what, argv, message) => {
    expect(await cli(argv(dir))).toBe(1);

    expect(stderr.join("")).toContain(message(dir));
    expect(imports()).toEqual([]);
  });
});
