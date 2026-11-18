import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(
  import.meta.dirname,
  "../skills/infrarsi-rsi-toolkit/scripts/print-request.mjs",
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { requestLines, page }: any = await import(SCRIPT);

let root: string;
let req: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "print-request-"));
  req = path.join(root, "requests", "0003-code_review");
  mkdirSync(req, { recursive: true });
  const prompt = {
    task: { knobs: { DEVICE_BATCH_SIZE: { enum: [32, 128] } }, mutable_files: ["train.py"] },
    files: { "train.py": "import torch\n\ndef step(x):\n    return x * 2\n" },
    empty: {},
  };
  writeFileSync(path.join(req, "prompt.txt"), JSON.stringify(prompt));
  writeFileSync(path.join(req, "system.txt"), "line one\nline two\n");
  writeFileSync(path.join(root, "secret.txt"), "project file");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the request viewer", () => {
  it("prints JSON as indented lines and embedded files as real lines", () => {
    expect(requestLines(req)).toEqual([
      "task:",
      "  knobs:",
      "    DEVICE_BATCH_SIZE:",
      "      enum:",
      "        - [0]: 32",
      "        - [1]: 128",
      "  mutable_files:",
      '    - [0]: "train.py"',
      "files:",
      "  ----- begin train.py (4 lines, verbatim) -----",
      "import torch",
      "",
      "def step(x):",
      "    return x * 2",
      "  ----- end train.py -----",
      "empty: {}",
    ]);
  });

  it("prints embedded files so an edit's old string can be copied from them", () => {
    const lines = requestLines(req);
    const begin = lines.findIndex((l: string) => l.includes("begin train.py"));
    const end = lines.findIndex((l: string) => l.includes("end train.py"));
    expect(lines.slice(begin + 1, end).join("\n") + "\n").toBe(
      "import torch\n\ndef step(x):\n    return x * 2\n",
    );
  });

  it("prints a text file as it is", () => {
    expect(requestLines(req, "system.txt")).toEqual(["line one", "line two"]);
  });

  it("pages with a header carrying the total", () => {
    expect(page(["a", "b", "c", "d"], 2, 2)).toEqual(["# lines 2-3 of 4", "b", "c"]);
    expect(page(["a", "b"], 1, 400)).toEqual(["# lines 1-2 of 2", "a", "b"]);
  });

  it("refuses a file outside the request directory, by path or by symlink", () => {
    expect(() => requestLines(req, "../../secret.txt")).toThrow(/not a file inside/);
    symlinkSync(path.join(root, "secret.txt"), path.join(req, "link.txt"));
    expect(() => requestLines(req, "link.txt")).toThrow(/not a file inside/);
    expect(() => requestLines(req, ".")).toThrow(/not a file inside/);
  });

  it("works from the command line", () => {
    const ok = spawnSync(
      process.execPath,
      [SCRIPT, req, "prompt.txt", "--start", "10", "--lines", "3"],
      {
        encoding: "utf8",
      },
    );
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe(
      "# lines 10-12 of 16\n  ----- begin train.py (4 lines, verbatim) -----\nimport torch\n\n",
    );
    const bad = spawnSync(process.execPath, [SCRIPT, req, "../../secret.txt"], {
      encoding: "utf8",
    });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toBe("");
  });
});
