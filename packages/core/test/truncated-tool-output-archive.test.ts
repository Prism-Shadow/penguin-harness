import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRUNCATED_TOOL_OUTPUT_FILE_LIMIT_BYTES,
  TruncatedToolOutputArchive,
} from "../src/environment/truncated-tool-output-archive.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "penguin-truncated-tool-output-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe("TruncatedToolOutputArchive", () => {
  it("pins the production per-call budget", () => {
    expect(TRUNCATED_TOOL_OUTPUT_FILE_LIMIT_BYTES).toBe(8 * 1024 * 1024 - 1);
  });

  it("writes an exact UTF-8 log with private permissions and leaves it Session-owned", async () => {
    const ordinaryDir = path.join(tmp, "ordinary-session-dir");
    const sessionDir = path.join(tmp, "archive-session-dir");
    await mkdir(ordinaryDir);
    const archive = new TruncatedToolOutputArchive({
      rootDir: path.join(sessionDir, "output"),
      fileLimitBytes: 128,
    });
    const capture = archive.startCapture();
    capture.append("hello ");
    capture.append("企鹅");
    // Split one surrogate pair across deltas: the recovery file must reconstruct the same text
    // instead of serializing two replacement characters.
    capture.append("\ud83d");
    capture.append("\udc27");
    // If another high surrogate arrives first, only the old one is known to be lone; the new one
    // must remain pending so it can still pair with the following low surrogate.
    capture.append("|");
    capture.append("\ud83d");
    capture.append("\ud83d");
    capture.append("\udc27");

    const retained = capture as unknown as { exactChunks: Buffer[] };
    expect(retained.exactChunks.length).toBeGreaterThan(0);
    expect(retained.exactChunks.every((chunk) => Buffer.isBuffer(chunk))).toBe(true);

    const saved = await capture.save("exec_command", "call/private");
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") throw new Error("expected saved output");
    expect(saved.archiveTruncated).toBe(false);
    expect(await readFile(saved.path, "utf8")).toBe("hello 企鹅🐧|�🐧");
    if (process.platform !== "win32") {
      expect((await stat(saved.path)).mode & 0o777).toBe(0o600);
      expect((await stat(path.dirname(saved.path))).mode & 0o777).toBe(0o700);
      expect((await stat(sessionDir)).mode & 0o777).toBe((await stat(ordinaryDir)).mode & 0o777);
    }

    // The archive owns no Task/runtime cleanup. The host removes this whole directory through
    // the existing Session scratchpad deletion path.
    expect(await readFile(saved.path, "utf8")).toContain("hello");
  });

  it("keeps UTF-8-safe head and tail windows when one archive exceeds its file budget", async () => {
    const fileLimitBytes = 96;
    const archive = new TruncatedToolOutputArchive({
      rootDir: path.join(tmp, "output"),
      fileLimitBytes,
    });
    const capture = archive.startCapture();
    const source = `HEAD-${"企鹅🐧".repeat(80)}-TAIL`;
    // Exercise incremental rolling-tail updates rather than one monolithic append.
    capture.append(source.slice(0, 70));
    capture.append(source.slice(70, 210));
    capture.append(source.slice(210));

    const saved = await capture.save("describe/image", "unicode-call");
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") throw new Error("expected saved output");
    const archived = await readFile(saved.path, "utf8");
    expect(saved.archiveTruncated).toBe(true);
    expect(Buffer.byteLength(archived, "utf8")).toBeLessThanOrEqual(fileLimitBytes);
    expect(archived).toContain("HEAD-");
    expect(archived).toContain("-TAIL");
    expect(archived).toContain("[archive middle truncated]");
    expect(archived).not.toContain("\uFFFD");
  });

  it("does not retain a huge delta's backing buffer after reducing it to bounded windows", async () => {
    const fileLimitBytes = 96;
    const archive = new TruncatedToolOutputArchive({
      rootDir: path.join(tmp, "output"),
      fileLimitBytes,
    });
    const capture = archive.startCapture();
    capture.append(`HEAD-${"x".repeat(16 * 1024 * 1024)}-TAIL`);

    const retained = capture as unknown as {
      exactChunks: Buffer[];
      head: Buffer;
      tail: Buffer;
      tailLength: number;
    };
    expect(retained.exactChunks).toEqual([]);
    expect(retained.head.length + retained.tailLength).toBeLessThanOrEqual(fileLimitBytes);
    // A short subarray of the original 16 MiB Buffer would pass the length assertion while
    // still pinning the entire ArrayBuffer. Node may use its fixed small-buffer pool for this
    // tiny test override, but neither result may retain the huge source.
    const largestBoundedBackingStore = Math.max(fileLimitBytes, Buffer.poolSize);
    expect(retained.head.buffer.byteLength).toBeLessThanOrEqual(largestBoundedBackingStore);
    expect(retained.tail.buffer.byteLength).toBeLessThanOrEqual(largestBoundedBackingStore);

    const saved = await capture.save("tool", "huge-single-delta");
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") throw new Error("expected saved output");
    const archived = await readFile(saved.path, "utf8");
    expect(Buffer.byteLength(archived, "utf8")).toBeLessThanOrEqual(fileLimitBytes);
    expect(archived).toContain("HEAD-");
    expect(archived).toContain("-TAIL");
  });

  it("reuses fixed tail storage across many small post-promotion deltas", async () => {
    const archive = new TruncatedToolOutputArchive({
      rootDir: path.join(tmp, "output"),
      fileLimitBytes: 128,
    });
    const capture = archive.startCapture();
    capture.append("H".repeat(256));
    const retained = capture as unknown as {
      tail: Buffer;
      tailLength: number;
    };
    const tailStorage = retained.tail;
    // Vary encoded widths and split emoji pairs across deltas so ring wrap-around must preserve
    // the same UTF-8 and surrogate semantics as the exact phase.
    const pattern = ["企", "鹅", "\ud83d", "\udc27", "|"];
    const chunks = Array.from({ length: 4096 }, (_, index) => pattern[index % pattern.length]!);
    for (const chunk of chunks) capture.append(chunk);

    expect(retained.tail).toBe(tailStorage);
    expect(retained.tailLength).toBeLessThanOrEqual(tailStorage.length);

    const saved = await capture.save("tool", "many-small-deltas");
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") throw new Error("expected saved output");
    const archived = await readFile(saved.path, "utf8");
    const archivedTail = archived.split("[archive middle truncated]\n")[1] ?? "";
    expect(chunks.join("").endsWith(archivedTail)).toBe(true);
    expect(archived).not.toContain("\uFFFD");
  });

  it("allows independent captures without imposing an aggregate Session budget", async () => {
    const archive = new TruncatedToolOutputArchive({
      rootDir: path.join(tmp, "output"),
      fileLimitBytes: 64,
    });
    const captures = [archive.startCapture(), archive.startCapture(), archive.startCapture()];
    captures.forEach((capture, index) => capture.append(`output-${index}`));

    const saved = await Promise.all(
      captures.map((capture, index) => capture.save("tool", `call-${index}`)),
    );
    expect(saved.every((result) => result.status === "saved")).toBe(true);
  });

  it("reports a write failure without throwing", async () => {
    const rootFile = path.join(tmp, "not-a-directory");
    await writeFile(rootFile, "occupied", "utf8");
    const archive = new TruncatedToolOutputArchive({
      rootDir: rootFile,
      fileLimitBytes: 64,
    });
    const capture = archive.startCapture();
    capture.append("output");
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    try {
      const result = await capture.save("tool", "call");
      expect(result.status).toBe("failed");
      if (result.status !== "failed") throw new Error("expected failed output");
      expect(typeof result.code).toBe("string");
      expect(stderr.join("")).toContain(
        `[penguin] tool "tool" truncated output archive write failed (${result.code}).`,
      );
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("distinguishes a repeated save from an archive write failure", async () => {
    const archive = new TruncatedToolOutputArchive({
      rootDir: path.join(tmp, "output"),
      fileLimitBytes: 64,
    });
    const capture = archive.startCapture();
    capture.append("output");
    expect((await capture.save("tool", "call")).status).toBe("saved");
    await expect(capture.save("tool", "call")).resolves.toEqual({
      status: "failed",
      code: "ALREADY_SAVED",
    });
  });
});
