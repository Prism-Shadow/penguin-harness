/**
 * The payload containers a push assembles. What matters is not that they round-trip through
 * our own code but that FOREIGN tools open them: the far side's tar and Expand-Archive are
 * the real readers, so the POSIX assertions extract with the system tar, and the zip is
 * checked against Python's zipfile where one is available.
 */
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  filesFromDirectory,
  tarGzBytes,
  tarGzEntries,
  zipBytes,
  zipExtract,
} from "../src/machines/archive.js";

const FILES = [
  { path: "penguin/bin/penguin", data: Buffer.from("#!/bin/sh\necho ok\n"), mode: 0o755 },
  { path: "penguin/lib/dist/penguin.js", data: Buffer.from("// cli\n") },
  { path: "penguin/web/index.html", data: Buffer.from("<html>") },
  // Deep enough to need the ustar prefix field, the way a node runtime's include/ tree does.
  {
    path: `penguin/lib/node_modules/${"a".repeat(60)}/${"b".repeat(60)}/deep.js`,
    data: Buffer.from("x"),
  },
];

let work: string;
beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penguin-archive-")));
});
afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe("tarGzBytes", () => {
  const posixIt = process.platform === "win32" ? it.skip : it;

  posixIt("produces an archive the system tar extracts, executable bit intact", () => {
    const archive = path.join(work, "payload.tar.gz");
    fs.writeFileSync(archive, tarGzBytes(FILES));
    cp.execFileSync("tar", ["-xzf", archive, "-C", work]);
    expect(fs.readFileSync(path.join(work, "penguin", "web", "index.html"), "utf8")).toBe("<html>");
    expect(fs.statSync(path.join(work, "penguin", "bin", "penguin")).mode & 0o111).not.toBe(0);
    expect(fs.statSync(path.join(work, "penguin", "lib", "dist", "penguin.js")).mode & 0o111).toBe(
      0,
    );
    expect(
      fs.existsSync(
        path.join(
          work,
          "penguin",
          "lib",
          "node_modules",
          "a".repeat(60),
          "b".repeat(60),
          "deep.js",
        ),
      ),
    ).toBe(true);
  });

  it("its own reader agrees (paths, sizes, modes)", () => {
    const entries = tarGzEntries(tarGzBytes(FILES));
    expect(entries.map((e) => e.path)).toEqual(FILES.map((f) => f.path));
    expect(entries[0]!.mode & 0o111).not.toBe(0);
    expect(entries[2]!.size).toBe(6);
  });

  it("is deterministic: the same files pack to the same bytes", () => {
    expect(tarGzBytes(FILES).equals(tarGzBytes(FILES))).toBe(true);
  });

  it("refuses a path no ustar header can carry", () => {
    expect(() => tarGzBytes([{ path: `${"x".repeat(200)}/y`, data: Buffer.alloc(0) }])).toThrow(
      /too long/,
    );
  });
});

describe("zipBytes", () => {
  it("round-trips through its own entry reader", () => {
    const zip = zipBytes(FILES);
    for (const file of FILES) {
      expect(zipExtract(zip, file.path)?.equals(file.data)).toBe(true);
    }
    expect(zipExtract(zip, "not/there")).toBeNull();
  });

  const python = (() => {
    try {
      cp.execFileSync(process.platform === "win32" ? "python" : "python3", ["--version"]);
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!python)("opens under an independent implementation (Python zipfile)", () => {
    const zip = path.join(work, "payload.zip");
    fs.writeFileSync(zip, zipBytes(FILES));
    const out = cp.execFileSync(
      process.platform === "win32" ? "python" : "python3",
      [
        "-c",
        "import sys,zipfile\n" +
          "z=zipfile.ZipFile(sys.argv[1])\n" +
          "assert z.testzip() is None\n" +
          "print(z.read('penguin/web/index.html').decode())",
        zip,
      ],
      { encoding: "utf8" },
    );
    expect(out.trim()).toBe("<html>");
  });
});

describe("filesFromDirectory", () => {
  it("prefixes, excludes subtrees, and records modes", () => {
    const root = path.join(work, "tree");
    fs.mkdirSync(path.join(root, "bin"), { recursive: true });
    fs.mkdirSync(path.join(root, "lib"), { recursive: true });
    fs.writeFileSync(path.join(root, "bin", "penguin"), "#!/bin/sh\n", { mode: 0o755 });
    fs.writeFileSync(path.join(root, "lib", "a.js"), "//\n");
    fs.writeFileSync(path.join(root, "package-manifest.json"), "{}\n");
    const files = filesFromDirectory(root, {
      prefix: "penguin",
      exclude: ["bin", "package-manifest.json"],
    });
    expect(files.map((f) => f.path)).toEqual(["penguin/lib/a.js"]);
  });
});
