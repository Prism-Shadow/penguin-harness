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
import {
  attachedImageLine,
  hasAttachedImageLine,
  imageUrlMessage,
  parseAttachedImageLine,
  userText,
} from "../src/omnimessage/index.js";
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
  it("data URL images are saved to disk, paths appended to the user text, image messages removed", async () => {
    const dir = path.join(tmp, "scratch", "session-1"); // auto-created if the directory doesn't exist
    const out = await imagesToScratchpadPaths(
      [userText("Look at these two images"), imageUrlMessage(DATA_URL), imageUrlMessage(DATA_URL)],
      dir,
    );

    expect(out).toHaveLength(1);
    const p = out[0]!.payload as TextPayload;
    expect(p.type).toBe("text");
    expect(p.role).toBe("user");
    expect(p.text.startsWith("Look at these two images\n\n")).toBe(true);
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

  it("http(s) URLs are not saved but referenced as-is; image-only input gets a paths-only text message", async () => {
    const out = await imagesToScratchpadPaths([imageUrlMessage("https://example.com/a.png")], tmp);
    expect(out).toHaveLength(1);
    const p = out[0]!.payload as TextPayload;
    expect(p.type).toBe("text");
    expect(p.text).toBe("[attached image: https://example.com/a.png]");
    expect(await readdir(tmp)).toHaveLength(0);
  });

  it("input without images is returned as-is (never touches the filesystem)", async () => {
    const input = [userText("plain text")];
    const out = await imagesToScratchpadPaths(input, path.join(tmp, "untouched"));
    expect(out).toBe(input);
  });

  it("an unparsable image is replaced with an explanatory line, never silently dropped", async () => {
    const out = await imagesToScratchpadPaths(
      [userText("hi"), imageUrlMessage("data:text/plain,oops")],
      tmp,
    );
    const p = out[0]!.payload as TextPayload;
    expect(p.text).toContain("could not be saved");
  });
});

/**
 * The line's spelling crosses a package boundary — core writes it here, the Web reads it back
 * to restore the thumbnail (`splitImageAttachments` in web/src/lib/attachments.ts, which now
 * calls the parser below). Both sides go through these two functions, so this round trip is
 * what keeps them honest; a reworded line would otherwise just stop rendering, silently.
 */
describe("attachedImageLine / parseAttachedImageLine", () => {
  it("round-trips a scratchpad path and an http(s) URL, in both directions", () => {
    for (const address of [
      "/home/u/.penguin/data/p1/agents/a1/scratchpad/session-1/upload-ab12cd34.png",
      "C:\\Users\\u\\penguin\\scratchpad\\session-1\\upload-ab12cd34.png",
      "https://example.com/shot.png?v=2",
    ]) {
      expect(parseAttachedImageLine(attachedImageLine(address))).toBe(address);
      expect(hasAttachedImageLine(`caption\n\n${attachedImageLine(address)}`)).toBe(true);
    }
  });

  it("is what the fold actually emits, not a parallel spelling of it", async () => {
    const out = await imagesToScratchpadPaths(
      [userText("look"), imageUrlMessage("https://example.com/shot.png")],
      tmp,
    );
    const line = (out[0]!.payload as TextPayload).text.split("\n").at(-1)!;
    expect(parseAttachedImageLine(line)).toBe("https://example.com/shot.png");
  });

  it("leaves every other line alone — the dropped-image note included", () => {
    for (const line of [
      "[an attached image could not be saved and was dropped]",
      "[attached image: ]",
      "attached image: /x.png",
      "look at [attached image: /x.png] inline",
      "plain text",
    ]) {
      expect(parseAttachedImageLine(line)).toBeNull();
    }
  });
});
