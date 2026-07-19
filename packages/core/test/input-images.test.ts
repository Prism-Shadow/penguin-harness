/**
 * imagesToScratchpadPaths unit tests: input conversion when the session model does not support
 * images -- data URL images are written to the session scratchpad and their paths appended to the
 * user text; http(s) URLs are referenced as-is; image messages are removed from the input;
 * image-free input is returned unchanged; images that fail to parse are replaced with an explanatory line.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { imagesToScratchpadPaths } from "../src/internal/session-support.js";
import { imageUrlMessage, userText } from "../src/omnimessage/index.js";
import type { TextPayload } from "../src/omnimessage/index.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const DATA_URL = `data:image/png;base64,${PNG_1X1.toString("base64")}`;

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "penguin-inputimg-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("imagesToScratchpadPaths", () => {
  it("data URL 图片落盘、路径拼接进用户文本，图片消息移除", async () => {
    const dir = path.join(tmp, "scratch", "session-1"); // auto-created if the directory doesn't exist
    const out = await imagesToScratchpadPaths(
      [userText("看看这两张图"), imageUrlMessage(DATA_URL), imageUrlMessage(DATA_URL)],
      dir,
    );

    expect(out).toHaveLength(1);
    const p = out[0]!.payload as TextPayload;
    expect(p.type).toBe("text");
    expect(p.role).toBe("user");
    expect(p.text.startsWith("看看这两张图\n\n")).toBe(true);
    const paths = [...p.text.matchAll(/\[attached image: ([^\]]+)\]/g)].map((m) => m[1]!);
    expect(paths).toHaveLength(2);

    // The saved content matches the original image; filename = upload-<8-char random hex>.<extension by mime type>.
    const files = await readdir(dir);
    expect(files).toHaveLength(2);
    for (const f of paths) {
      expect(path.dirname(f)).toBe(dir);
      expect(path.basename(f)).toMatch(/^upload-[0-9a-f]{8}\.png$/);
      expect(await readFile(f)).toEqual(PNG_1X1);
    }
    // The two images' random names differ from each other.
    expect(new Set(paths).size).toBe(2);
  });

  it("http(s) URL 不落盘，原样引用；仅图片输入时补一条纯路径文本", async () => {
    const out = await imagesToScratchpadPaths([imageUrlMessage("https://example.com/a.png")], tmp);
    expect(out).toHaveLength(1);
    const p = out[0]!.payload as TextPayload;
    expect(p.type).toBe("text");
    expect(p.text).toBe("[attached image: https://example.com/a.png]");
    expect(await readdir(tmp)).toHaveLength(0);
  });

  it("无图片输入原样返回（不触碰文件系统）", async () => {
    const input = [userText("纯文本")];
    const out = await imagesToScratchpadPaths(input, path.join(tmp, "untouched"));
    expect(out).toBe(input);
  });

  it("无法解析的图片以说明行代替，不静默丢失", async () => {
    const out = await imagesToScratchpadPaths(
      [userText("hi"), imageUrlMessage("data:text/plain,oops")],
      tmp,
    );
    const p = out[0]!.payload as TextPayload;
    expect(p.text).toContain("could not be saved");
  });
});
