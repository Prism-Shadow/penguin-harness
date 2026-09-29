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
import { uploadHome, type UploadHome } from "../src/activities/ref-media.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A ref's uploads folder in a fresh WAF root: `media/loom/words/words-1/uploads/`. */
async function workspace(): Promise<UploadHome> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-upload-test-"));
  cleanups.push(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10 });
  });
  return uploadHome(root, "words", 1);
}

const home = uploadHome(path.join(os.tmpdir(), "waf"), "words", 1);

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
    const first = uploadReference(home, "cat.png", png, format);
    expect(first).toMatch(/^media\/loom\/words\/words-1\/uploads\/cat-[a-f0-9]{16}\.png$/);
    expect(uploadReference(home, "cat.png", png, format)).toBe(first);
    const other = Buffer.concat([png, Buffer.from([1])]);
    expect(uploadReference(home, "cat.png", other, sniffUpload(other))).not.toBe(first);
    // The full digest is what a prefix collision falls back to.
    expect(uploadReference(home, "cat.png", png, format, 64)).toMatch(
      /^media\/loom\/words\/words-1\/uploads\/cat-[a-f0-9]{64}\.png$/,
    );
  });

  it("recognises which bindings are uploads, of whichever ref", () => {
    expect(isUploadReference("media/loom/words/words-1/uploads/cat-1234abcd.png")).toBe(true);
    expect(isUploadReference("media/loom/words/words-7/uploads/cat-1234abcd.png")).toBe(true);
    expect(isUploadReference("media/loom/words/words-1/uploads/nested/cat.png")).toBe(false);
    expect(isUploadReference("media/uploads/cat-1234abcd.png")).toBe(false);
    expect(isUploadReference("media/images/cat.png")).toBe(false);
    expect(isUploadReference("media/loom/words/words-1/images/english/cat.png")).toBe(false);
    expect(isUploadReference(undefined)).toBe(false);
  });

  it("refuses to resolve a reference that would leave the uploads directory", async () => {
    const dir = await workspace();
    const uploads = "media/loom/words/words-1/uploads/";
    expect(() => uploadFile(dir, `${uploads}../../escape.png`)).toThrow(/invalid/);
    expect(() => uploadFile(dir, `${uploads}nested/file.png`)).toThrow(/invalid/);
    expect(() => uploadFile(dir, "media/images/cat.png")).toThrow(/invalid/);
    // Another ref's upload is not this ref's to read.
    expect(() => uploadFile(dir, "media/loom/words/words-2/uploads/cat-1234abcd.png")).toThrow(
      /invalid/,
    );
    expect(uploadFile(dir, `${uploads}cat-1234abcd.png`)).toBe(
      path.join(dir.dir, "cat-1234abcd.png"),
    );
  });
});

describe("upload storage", () => {
  it("writes into the ref's uploads folder and reads back the same bytes", async () => {
    const dir = await workspace();
    const stored = await storeUpload(dir, "Cat.png", png);
    expect(stored).toMatchObject({ kind: "image", mimeType: "image/png", byteLength: png.length });
    expect(stored.path.startsWith("media/loom/words/words-1/uploads/")).toBe(true);
    const file = path.join(dir.dir, stored.name);
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
    await fs.writeFile(path.join(dir.dir, first.name), other);
    const second = await storeUpload(dir, "cat.png", png);
    expect(second.path).not.toBe(first.path);
    expect(await readUpload(dir, second.path)).toMatchObject({ bytes: png });
    // The colliding name still holds the bytes that were actually written there.
    expect(await fs.readFile(path.join(dir.dir, first.name))).toEqual(other);
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
    await fs.writeFile(path.join(dir.dir, "notes.txt"), "hello", "utf8");
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
    await fs.rm(path.join(dir.dir, stored.name));
    await expect(readUpload(dir, stored.path)).rejects.toThrow(/no longer in the media repository/);
  });

  it("returns an empty list when nothing was ever uploaded", async () => {
    expect(await listUploads(await workspace())).toEqual([]);
  });
});
