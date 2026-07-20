/**
 * Unit tests for the read_image tool (no network): local file reading (relative-path
 * resolution / magic-number sniffing / missing file / over the size limit / unsupported type /
 * missing argument) and http(s) URL download (stubbing global fetch: success and non-2xx).
 * Directly drives BuiltinTool.execute and captures the generator's return value -- see
 * environment.test.ts for the Environment-side images assembly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MAX_IMAGE_BYTES,
  READ_IMAGE_NAME,
  createReadImageTool,
} from "../src/environment/tools/read-image.js";
import type { ToolResult } from "../src/environment/tools/types.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import type { ToolDefinitionConfig } from "../src/interfaces.js";

/** Full bytes of a 1x1 transparent PNG (including the magic number, enough for mime sniffing
 *  and data URL assertions). */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const definition: ToolDefinitionConfig = {
  name: READ_IMAGE_NAME,
  description: "read image",
  permission: "r",
};

/** Runs one tool execution: collects streamed messages, concatenates text deltas, and captures
 *  the generator's return value. */
async function run(args: Record<string, unknown>, workspaceDir: string) {
  const tool = createReadImageTool(definition);
  const gen = tool.execute(args, { workspaceDir, toolCallId: "c1" });
  const messages: OmniMessage[] = [];
  let result: ToolResult | void;
  for (;;) {
    const res = await gen.next();
    if (res.done) {
      result = res.value;
      break;
    }
    messages.push(res.value);
  }
  const text = messages.map((m) => (m.payload as { output?: string }).output ?? "").join("");
  return { messages, result, text };
}

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "penguin-readimg-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tmp, { recursive: true, force: true });
});

describe("read_image — local files", () => {
  it("reads a png by relative path, outputs a data URL plus a one-line mime/size note", async () => {
    await writeFile(path.join(tmp, "img.png"), PNG_1X1);
    const { result, text } = await run({ source: "img.png" }, tmp);
    expect(result?.stopReason).toBeUndefined(); // Defaults to completed
    expect(result?.images).toEqual([`data:image/png;base64,${PNG_1X1.toString("base64")}`]);
    expect(text).toBe(`image/png, ${PNG_1X1.length} B`);
  });

  it("magic-number sniffing wins when the extension disagrees with the content", async () => {
    await writeFile(path.join(tmp, "photo.jpg"), PNG_1X1); // Content is actually PNG
    const { result } = await run({ source: "photo.jpg" }, tmp);
    expect(result?.images?.[0]).toMatch(/^data:image\/png;base64,/);
  });

  it("finishes as failed with an explanation when the file does not exist", async () => {
    const { result, text } = await run({ source: "missing.png" }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(result?.images).toBeUndefined();
    expect(text).toContain("missing.png");
  });

  it("finishes as failed when the size limit is exceeded", async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    PNG_1X1.copy(big); // Header carries the PNG magic number, ensuring the failure is due to size, not type
    await writeFile(path.join(tmp, "big.png"), big);
    const { result, text } = await run({ source: "big.png" }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("too large");
  });

  it("finishes as failed for an unsupported image type", async () => {
    await writeFile(path.join(tmp, "img.bmp"), Buffer.from("BM not really an image"));
    const { result, text } = await run({ source: "img.bmp" }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("Unsupported image type");
  });

  it("finishes as failed with a clear note when source points to a directory (no raw EISDIR passthrough)", async () => {
    await mkdir(path.join(tmp, "subdir"));
    const { result, text } = await run({ source: "subdir" }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("not a file");
    expect(text).not.toContain("EISDIR");
  });

  it("finishes as failed for an empty file (the extension fallback must not let empty base64 through)", async () => {
    await writeFile(path.join(tmp, "empty.png"), Buffer.alloc(0));
    const { result, text } = await run({ source: "empty.png" }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("empty");
  });

  it("finishes as failed when the source argument is missing", async () => {
    const { result, text } = await run({}, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain('"source"');
  });
});

describe("read_image — http(s) URL", () => {
  it("downloads via global fetch and takes the content-type response header as the mime", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown) =>
        new Response(PNG_1X1, { status: 200, headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result, text } = await run({ source: "https://example.com/a" }, tmp);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://example.com/a");
    expect(result?.images).toEqual([`data:image/png;base64,${PNG_1X1.toString("base64")}`]);
    expect(text).toContain("image/png");
  });

  it("finishes as failed with the status code on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const { result, text } = await run({ source: "https://example.com/missing.png" }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("404");
  });
});
