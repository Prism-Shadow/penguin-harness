import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isUploadReference,
  listUploads,
  readUpload,
  sniffUpload,
  storedFormat,
  storeUpload,
  uploadFile,
  uploadReference,
  uploadStem,
} from "../src/activities/upload.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function workspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-upload-test-"));
  cleanups.push(async () => {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10 });
  });
  return dir;
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.alloc(4),
  Buffer.from("IHDR", "ascii"),
  Buffer.alloc(16),
]);
const wav = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.alloc(4),
  Buffer.from("WAVE", "ascii"),
  Buffer.alloc(16),
]);
const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom", "ascii"), Buffer.alloc(8)]);

describe("upload format sniffing", () => {
  it("reads the format from the bytes, not from the name", () => {
    expect(sniffUpload(png)).toMatchObject({ kind: "image", mimeType: "image/png" });
    expect(sniffUpload(wav)).toMatchObject({ kind: "audio", mimeType: "audio/wav" });
    expect(sniffUpload(mp4)).toMatchObject({ kind: "video", mimeType: "video/mp4" });
    expect(
      sniffUpload(Buffer.concat([Buffer.from("ID3", "ascii"), Buffer.alloc(16)])),
    ).toMatchObject({ kind: "audio", mimeType: "audio/mpeg" });
    expect(
      sniffUpload(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(8)])),
    ).toMatchObject({ kind: "video", mimeType: "video/webm" });
  });

  it("refuses a format it cannot serve safely", () => {
    expect(() => sniffUpload(Buffer.from("<svg xmlns='x'></svg>", "utf8"))).toThrow(
      /Uploads support/,
    );
    expect(() => sniffUpload(Buffer.from("<!doctype html>", "utf8"))).toThrow(/Uploads support/);
    expect(() => sniffUpload(Buffer.alloc(0))).toThrow(/Uploads support/);
  });
});

describe("upload naming", () => {
  it("treats the author's filename as a hint and never as a path", () => {
    expect(uploadStem("Cat Picture.PNG", "image")).toBe("cat-picture");
    expect(uploadStem("../../etc/passwd", "image")).toBe("passwd");
    expect(uploadStem("....", "image")).toBe("image");
    expect(uploadStem("", "audio")).toBe("audio");
    expect(uploadStem("a".repeat(80), "image")).toHaveLength(48);
  });

  it("puts the content hash in the name so the same file lands on one path", () => {
    const format = sniffUpload(png);
    const first = uploadReference("cat.png", png, format);
    expect(first).toMatch(/^media\/uploads\/cat-[a-f0-9]{16}\.png$/);
    expect(uploadReference("cat.png", png, format)).toBe(first);
    const other = Buffer.concat([png, Buffer.from([1])]);
    expect(uploadReference("cat.png", other, sniffUpload(other))).not.toBe(first);
    // The full digest is what a prefix collision falls back to.
    expect(uploadReference("cat.png", png, format, 64)).toMatch(
      /^media\/uploads\/cat-[a-f0-9]{64}\.png$/,
    );
  });

  it("recognises which bindings live in the workspace", () => {
    expect(isUploadReference("media/uploads/cat-1234abcd.png")).toBe(true);
    expect(isUploadReference("media/images/cat.png")).toBe(false);
    expect(isUploadReference("media/generated/run_x.png")).toBe(false);
    expect(isUploadReference(undefined)).toBe(false);
  });

  it("refuses to resolve a reference that would leave the uploads directory", async () => {
    const dir = await workspace();
    expect(() => uploadFile(dir, "media/uploads/../../escape.png")).toThrow(/invalid/);
    expect(() => uploadFile(dir, "media/uploads/nested/file.png")).toThrow(/invalid/);
    expect(() => uploadFile(dir, "media/images/cat.png")).toThrow(/invalid/);
    expect(uploadFile(dir, "media/uploads/cat-1234abcd.png")).toBe(
      path.join(dir, "media", "uploads", "cat-1234abcd.png"),
    );
  });
});

describe("upload storage", () => {
  it("writes inside the activity workspace and reads back the same bytes", async () => {
    const dir = await workspace();
    const stored = await storeUpload(dir, "Cat.png", png);
    expect(stored).toMatchObject({ kind: "image", mimeType: "image/png", byteLength: png.length });
    expect(stored.path.startsWith("media/uploads/")).toBe(true);
    const file = path.join(dir, "media", "uploads", stored.name);
    expect(await fs.readFile(file)).toEqual(png);
    const read = await readUpload(dir, stored.path);
    expect(read.bytes).toEqual(png);
    expect(read.mimeType).toBe("image/png");
  });

  it("is idempotent, because the name carries the hash", async () => {
    const dir = await workspace();
    const first = await storeUpload(dir, "cat.png", png);
    const second = await storeUpload(dir, "cat.png", png);
    expect(second.path).toBe(first.path);
    expect(await listUploads(dir)).toHaveLength(1);
  });

  it("never reuses a file whose bytes turn out to be different", async () => {
    const dir = await workspace();
    const first = await storeUpload(dir, "cat.png", png);
    // Stand in for a digest-prefix collision: different bytes already under that name.
    const other = Buffer.concat([png, Buffer.from([7, 7, 7])]);
    await fs.writeFile(path.join(dir, "media", "uploads", first.name), other);
    const second = await storeUpload(dir, "cat.png", png);
    expect(second.path).not.toBe(first.path);
    expect(await readUpload(dir, second.path)).toMatchObject({ bytes: png });
    // The colliding name still holds the bytes that were actually written there.
    expect(await fs.readFile(path.join(dir, "media", "uploads", first.name))).toEqual(other);
  });

  it("refuses an empty file and an unsupported format", async () => {
    const dir = await workspace();
    await expect(storeUpload(dir, "empty.png", Buffer.alloc(0))).rejects.toThrow(/empty/);
    await expect(storeUpload(dir, "note.txt", Buffer.from("hello", "utf8"))).rejects.toThrow(
      /Uploads support/,
    );
  });

  it("lists what was uploaded and skips anything it could not serve", async () => {
    const dir = await workspace();
    await storeUpload(dir, "cat.png", png);
    await storeUpload(dir, "bell.wav", wav);
    await fs.writeFile(path.join(dir, "media", "uploads", "notes.txt"), "hello", "utf8");
    const listed = await listUploads(dir);
    expect(listed.map((entry) => entry.kind).sort()).toEqual(["audio", "image"]);
    expect(listed.some((entry) => entry.name === "notes.txt")).toBe(false);
  });

  it("lists from metadata alone, without reading a single file", async () => {
    const dir = await workspace();
    await storeUpload(dir, "cat.png", png);
    await storeUpload(dir, "clip.mp4", mp4);
    const reads: string[] = [];
    const readFile = fs.readFile;
    // Any read here would be per-file work a member could ask for repeatedly.
    (fs as { readFile: typeof fs.readFile }).readFile = (async (...args: unknown[]) => {
      reads.push(String(args[0]));
      return (readFile as (...a: unknown[]) => Promise<Buffer>)(...args);
    }) as typeof fs.readFile;
    try {
      const listed = await listUploads(dir);
      expect(listed).toHaveLength(2);
      expect(listed.every((entry) => entry.sha256 === undefined)).toBe(true);
    } finally {
      (fs as { readFile: typeof fs.readFile }).readFile = readFile;
    }
    expect(reads).toEqual([]);
  });

  it("reads a stored file's kind from the extension it was given", () => {
    expect(storedFormat("cat-1234abcd.png")).toMatchObject({ kind: "image" });
    expect(storedFormat("bell-1234abcd.wav")).toMatchObject({ kind: "audio" });
    expect(storedFormat("clip-1234abcd.mp4")).toMatchObject({ kind: "video" });
    expect(storedFormat("notes.txt")).toBeUndefined();
    expect(storedFormat("nodots")).toBeUndefined();
  });

  it("reports a binding whose file is gone instead of serving nothing", async () => {
    const dir = await workspace();
    const stored = await storeUpload(dir, "cat.png", png);
    await fs.rm(path.join(dir, "media", "uploads", stored.name));
    await expect(readUpload(dir, stored.path)).rejects.toThrow(/no longer in the workspace/);
  });

  it("returns an empty list when nothing was ever uploaded", async () => {
    expect(await listUploads(await workspace())).toEqual([]);
  });
});
