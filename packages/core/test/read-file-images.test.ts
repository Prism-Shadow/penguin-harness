/**
 * Behavior tests for read_file's image branch (no network): image detection (magic number /
 * extension / http(s) URL), the vision path (the image comes back via ToolResult.images with a
 * one-line mime/size note), the text-only path (a fake VisionDescriberService: single-shot
 * prompt + image request, streamed text, default prompt, no vision model configured, vision
 * request failure), failure cases shared by both (oversize, unsupported type, missing file,
 * empty file), the URL source (stubbed global fetch), and the Environment-side assembly with
 * and without an injected describer. Drives BuiltinTool.execute directly like
 * file-tools.test.ts; the text window itself is covered there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { READ_FILE_NAME, createReadFileTool } from "../src/environment/tools/read-file.js";
import { MAX_IMAGE_BYTES, parseImageDimensions } from "../src/environment/tools/image-source.js";
import { BUILTIN_TOOL_FACTORIES } from "../src/environment/tools/registry.js";
import { Environment } from "../src/environment/environment.js";
import { assistantText, partialText, toolCall } from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import type { ToolResult } from "../src/environment/tools/types.js";
import type {
  EnvironmentServices,
  GenerativeModelParameters,
  LLMInterface,
  LLMOutcome,
  ToolDefinitionConfig,
  VisionDescriberService,
} from "../src/interfaces/index.js";

/** 1x1 transparent PNG (full bytes: magic number for sniffing, and the data URL assertions). */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_DATA_URL = `data:image/png;base64,${PNG_1X1.toString("base64")}`;

/**
 * A structurally valid PNG carrying nothing but the header chunks (signature + IHDR + IEND):
 * the dimensions live in IHDR where every parser reads them, and no pixel data is needed —
 * the guards under test decide from the header alone. CRC fields are zeroed; nothing
 * downstream verifies them.
 */
function pngHeader(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // signature
    Buffer.from([0x00, 0x00, 0x00, 0x0d]), // IHDR chunk length
    Buffer.from("IHDR", "latin1"),
    ihdr,
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // CRC
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // IEND chunk length
    Buffer.from("IEND", "latin1"),
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // CRC
  ]);
}

/** JPEG header: SOI, a minimal SOF0 frame header carrying the dimensions, EOI. */
function jpegHeader(width: number, height: number): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08]), // SOF0, segment length 11, precision 8
    Buffer.from([(height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff]),
    Buffer.from([0x01, 0x01, 0x00, 0x00]), // one component
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

/** GIF header: signature plus the logical screen descriptor's little-endian dimensions. */
function gifHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(13);
  Buffer.from("GIF89a", "latin1").copy(b, 0);
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

/** WebP header of the given flavor (VP8 lossy / VP8L lossless / VP8X extended). */
function webpHeader(flavor: "VP8 " | "VP8L" | "VP8X", width: number, height: number): Buffer {
  const b = Buffer.alloc(34);
  Buffer.from("RIFF", "latin1").copy(b, 0);
  b.writeUInt32LE(26, 4); // RIFF size
  Buffer.from("WEBP", "latin1").copy(b, 8);
  Buffer.from(flavor, "latin1").copy(b, 12);
  b.writeUInt32LE(flavor === "VP8X" ? 10 : flavor === "VP8L" ? 5 : 16, 16); // chunk size
  if (flavor === "VP8 ") {
    b[23] = 0x9d; // start code
    b[24] = 0x01;
    b[25] = 0x2a;
    b.writeUInt16LE(width & 0x3fff, 26);
    b.writeUInt16LE(height & 0x3fff, 28);
  } else if (flavor === "VP8L") {
    b[20] = 0x2f; // signature
    const w1 = width - 1;
    const h1 = height - 1;
    b[21] = w1 & 0xff;
    b[22] = ((w1 >> 8) & 0x3f) | ((h1 & 0x03) << 6);
    b[23] = (h1 >> 2) & 0xff;
    b[24] = (h1 >> 10) & 0x0f;
  } else {
    b.writeUIntLE(width - 1, 24, 3); // canvas dimensions minus one, 24-bit little-endian
    b.writeUIntLE(height - 1, 27, 3);
  }
  return b;
}

const definition: ToolDefinitionConfig = {
  name: READ_FILE_NAME,
  description: "read file",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      offset: { type: "number" },
      limit: { type: "number" },
      prompt: { type: "string" },
    },
    required: ["file_path"],
  },
  permission: "r",
};

/**
 * Fake vision LLM: records the received parameters, emits output following the real streaming
 * protocol (partial start -> two deltas -> stop -> complete text), and finishes with the given outcome.
 */
function fakeLLM(reply: string, outcome: LLMOutcome = { status: "completed" }) {
  const calls: GenerativeModelParameters[] = [];
  const llm: LLMInterface = {
    // eslint-disable-next-line @typescript-eslint/require-await
    async *streamGenerate(params: GenerativeModelParameters) {
      calls.push(params);
      if (reply) {
        yield partialText("start");
        const mid = Math.ceil(reply.length / 2);
        yield partialText("delta", reply.slice(0, mid));
        yield partialText("delta", reply.slice(mid));
        yield partialText("stop");
        yield assistantText(reply);
      }
      return outcome;
    },
  };
  return { llm, calls };
}

/** Runs one tool execution: collects streamed messages, concatenates text deltas, and captures the generator's return value. */
async function run(
  args: Record<string, unknown>,
  workspaceDir: string,
  services?: EnvironmentServices,
) {
  const tool = createReadFileTool(definition, services);
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
  const outputs = messages.map((m) => (m.payload as { output?: string }).output ?? "");
  return { messages, outputs, result, text: outputs.join("") };
}

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "penguin-readfile-img-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tmp, { recursive: true, force: true });
});

describe("read_file on an image — session model views images (no describer)", () => {
  it("returns the image via ToolResult.images with a one-line mime/size note", async () => {
    await writeFile(path.join(tmp, "img.png"), PNG_1X1);
    const { result, text } = await run({ file_path: "img.png" }, tmp);
    expect(result?.stopReason).toBeUndefined(); // defaults to completed
    expect(result?.images).toEqual([PNG_DATA_URL]);
    expect(text).toBe(`image/png, ${PNG_1X1.length} B`);
  });

  it("recognizes an image by its magic number whatever the extension says", async () => {
    await writeFile(path.join(tmp, "notes.txt"), PNG_1X1); // PNG bytes under a text extension
    const { result } = await run({ file_path: "notes.txt" }, tmp);
    expect(result?.images?.[0]).toMatch(/^data:image\/png;base64,/);
  });

  it("recognizes an image by extension when the bytes carry no known magic number", async () => {
    // The extension routes the file into the image branch, where it is handed over as its
    // extension says (the same fallback the URL branch applies to a content-type-less response).
    await writeFile(path.join(tmp, "plain.png"), Buffer.from("no magic here"));
    const { result } = await run({ file_path: "plain.png" }, tmp);
    expect(result?.images?.[0]).toMatch(/^data:image\/png;base64,/);
  });

  it("ignores offset and limit for an image", async () => {
    await writeFile(path.join(tmp, "img.png"), PNG_1X1);
    const { result } = await run({ file_path: "img.png", offset: 50, limit: 1 }, tmp);
    expect(result?.images).toEqual([PNG_DATA_URL]);
  });

  it("still reads a text file as a numbered window", async () => {
    await writeFile(path.join(tmp, "a.txt"), "alpha\nbeta\n");
    const { result, text } = await run({ file_path: "a.txt" }, tmp);
    expect(result).toBeUndefined();
    expect(text).toBe("     1\talpha\n     2\tbeta");
  });

  it("fails with a size note above the image limit", async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    PNG_1X1.copy(big); // Header carries the PNG magic number, so the failure is size, not type
    await writeFile(path.join(tmp, "big.png"), big);
    const { result, text } = await run({ file_path: "big.png" }, tmp);
    expect(result?.stopReason).toBe("fatal");
    expect(result?.images).toBeUndefined();
    expect(text).toContain("too large");
  });

  it("rejects a binary that is no supported image with advice, and a missing image path with the not-found note", async () => {
    await writeFile(path.join(tmp, "img.bmp"), Buffer.from([0x42, 0x4d, 0x00, 0x01, 0x02]));
    const bmp = await run({ file_path: "img.bmp" }, tmp);
    expect(bmp.result?.stopReason).toBe("fatal");
    expect(bmp.text).toContain("binary");
    expect(bmp.text).toContain("png/jpeg/gif/webp");

    const missing = await run({ file_path: "missing.png" }, tmp);
    expect(missing.result?.stopReason).toBe("fatal");
    expect(missing.text).toContain("File not found");
  });
});

describe("read_file on an image — dimension guard", () => {
  it("refuses to attach an image past the model's longest-side pixel cap, with the real reason", async () => {
    // The reported failure: a 750×8618 px full-page screenshot (984 KB, well under the byte
    // cap) that DeepSeek answers with a misleading "unsupported image format" 400 — and a
    // fatal tool result is replayed on every later run, so the Session can never recover.
    await writeFile(path.join(tmp, "tall.png"), pngHeader(750, 8618));
    const { result, text } = await run({ file_path: "tall.png" }, tmp);
    expect(result?.stopReason).toBe("fatal");
    expect(result?.images).toBeUndefined();
    expect(text).toContain("750×8618");
    expect(text).toContain("8192");
    expect(text).toContain("not attached");
  });

  it("attaches an image whose longest side sits exactly at the cap", async () => {
    await writeFile(path.join(tmp, "edge.png"), pngHeader(750, 8192));
    const { result, text } = await run({ file_path: "edge.png" }, tmp);
    expect(result?.stopReason).toBeUndefined();
    expect(result?.images).toHaveLength(1);
    expect(result?.images?.[0]).toMatch(/^data:image\/png;base64,/);
    expect(text).toContain("image/png");
  });

  it("honors a per-model cap from services — a wider cap attaches what the default refuses", async () => {
    await writeFile(path.join(tmp, "tall.png"), pngHeader(750, 8618));
    const strict = await run({ file_path: "tall.png" }, tmp, { maxImageSide: 100 });
    expect(strict.result?.stopReason).toBe("fatal");
    expect(strict.result?.images).toBeUndefined();
    expect(strict.text).toContain("100 px");

    const wide = await run({ file_path: "tall.png" }, tmp, { maxImageSide: 10000 });
    expect(wide.result?.stopReason).toBeUndefined();
    expect(wide.result?.images).toHaveLength(1);
  });

  it("applies the guard to a downloaded image too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(pngHeader(750, 8618), {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      ),
    );
    const { result, text } = await run({ file_path: "https://example.com/tall.png" }, tmp);
    expect(result?.stopReason).toBe("fatal");
    expect(result?.images).toBeUndefined();
    expect(text).toContain("750×8618");
  });

  it("an over-dimension image fails before any vision request on a text-only session", async () => {
    await writeFile(path.join(tmp, "tall.png"), pngHeader(750, 8618));
    const { llm, calls } = fakeLLM("desc");
    const { result, text } = await run({ file_path: "tall.png" }, tmp, {
      visionDescriber: { modelId: "vis-1", createLLM: () => llm },
    });
    expect(result?.stopReason).toBe("fatal");
    expect(text).toContain("8192");
    expect(calls).toHaveLength(0);
  });
});

describe("parseImageDimensions", () => {
  it("reads PNG IHDR, JPEG SOF, GIF logical screen, and every WebP flavor", () => {
    expect(parseImageDimensions(pngHeader(750, 8618))).toEqual({ width: 750, height: 8618 });
    expect(parseImageDimensions(PNG_1X1)).toEqual({ width: 1, height: 1 });
    expect(parseImageDimensions(jpegHeader(3, 9000))).toEqual({ width: 3, height: 9000 });
    expect(parseImageDimensions(gifHeader(750, 8618))).toEqual({ width: 750, height: 8618 });
    expect(parseImageDimensions(webpHeader("VP8 ", 750, 8618))).toEqual({
      width: 750,
      height: 8618,
    });
    expect(parseImageDimensions(webpHeader("VP8L", 750, 8618))).toEqual({
      width: 750,
      height: 8618,
    });
    expect(parseImageDimensions(webpHeader("VP8X", 750, 8618))).toEqual({
      width: 750,
      height: 8618,
    });
  });

  it("returns null when the bytes carry no recognizable header", () => {
    expect(parseImageDimensions(Buffer.from("no magic here"))).toBeNull();
    expect(parseImageDimensions(Buffer.alloc(0))).toBeNull();
    expect(parseImageDimensions(Buffer.alloc(60, 0x00))).toBeNull();
  });
});

describe("read_file on an image — text-only session model (describer injected)", () => {
  it("sends the image plus the caller's prompt to the vision model in one shot and streams its text back, with no images in the result", async () => {
    await writeFile(path.join(tmp, "a.png"), PNG_1X1);
    const { llm, calls } = fakeLLM("The image shows a penguin.");
    const visionDescriber: VisionDescriberService = { modelId: "vis-1", createLLM: () => llm };
    const { outputs, result, text } = await run(
      { file_path: "a.png", prompt: "What animal is in the image?" },
      tmp,
      { visionDescriber },
    );

    expect(calls).toHaveLength(1);
    const payloads = calls[0]!.newMessages.map(
      (m) => m.payload as { type: string; text?: string; image_url?: string },
    );
    expect(payloads[0]!.type).toBe("text");
    expect(payloads[0]!.text).toBe("What animal is in the image?");
    expect(payloads[1]!.type).toBe("image_url");
    expect(payloads[1]!.image_url).toBe(PNG_DATA_URL);

    expect(text).toContain("described by vis-1");
    expect(text).toContain("The image shows a penguin.");
    // Streamed piecewise: the header line, then the description deltas as they arrive; the
    // complete text is not forwarded a second time.
    expect(outputs.length).toBeGreaterThanOrEqual(3);
    expect(outputs[0]).toContain("described by vis-1");
    expect(outputs.slice(1).join("")).toBe("The image shows a penguin.");
    expect(result?.images).toBeUndefined();
    expect(result?.stopReason).toBeUndefined();
  });

  it("asks the default question when no prompt is given", async () => {
    await writeFile(path.join(tmp, "a.png"), PNG_1X1);
    const { llm, calls } = fakeLLM("desc");
    await run({ file_path: "a.png" }, tmp, {
      visionDescriber: { modelId: "vis-1", createLLM: () => llm },
    });
    const first = calls[0]!.newMessages[0]!.payload as { text?: string };
    expect(first.text).toContain("Describe this image");
  });

  it("no vision model configured: fatal, explaining how to configure one, without fetching the image", async () => {
    await writeFile(path.join(tmp, "a.png"), PNG_1X1);
    const local = await run({ file_path: "a.png" }, tmp, { visionDescriber: { modelId: null } });
    expect(local.result?.stopReason).toBe("fatal");
    expect(local.text).toContain("No vision model");
    expect(local.text).toContain("vision_model");
    // A URL source is not even downloaded: the missing vision model is what stands between
    // this session and image reading, not the image.
    const fetchMock = vi.fn(async () => new Response(PNG_1X1, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const remote = await run({ file_path: "https://example.com/a.png" }, tmp, {
      visionDescriber: { modelId: null },
    });
    expect(remote.result?.stopReason).toBe("fatal");
    expect(remote.text).toContain("No vision model");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("vision request failure: fatal with the status and message", async () => {
    await writeFile(path.join(tmp, "a.png"), PNG_1X1);
    const { llm } = fakeLLM("", { status: "fatal", errorMessage: "401 unauthorized" });
    const { result, text } = await run({ file_path: "a.png" }, tmp, {
      visionDescriber: { modelId: "vis-1", createLLM: () => llm },
    });
    expect(result?.stopReason).toBe("fatal");
    expect(text).toContain("fatal");
    expect(text).toContain("401 unauthorized");
  });

  it("an oversized image fails before any vision request", async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    PNG_1X1.copy(big);
    await writeFile(path.join(tmp, "big.png"), big);
    const { llm, calls } = fakeLLM("desc");
    const { result } = await run({ file_path: "big.png" }, tmp, {
      visionDescriber: { modelId: "vis-1", createLLM: () => llm },
    });
    expect(result?.stopReason).toBe("fatal");
    expect(calls).toHaveLength(0);
  });

  it("text files never involve the vision model", async () => {
    await writeFile(path.join(tmp, "a.txt"), "hello\n");
    const { llm, calls } = fakeLLM("desc");
    const { text } = await run({ file_path: "a.txt", prompt: "ignored" }, tmp, {
      visionDescriber: { modelId: "vis-1", createLLM: () => llm },
    });
    expect(text).toBe("     1\thello");
    expect(calls).toHaveLength(0);
  });
});

describe("read_file on an http(s) URL", () => {
  it("downloads via the global fetch, taking the content-type header as the mime", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown) =>
        new Response(PNG_1X1, { status: 200, headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result, text } = await run({ file_path: "https://example.com/a" }, tmp);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://example.com/a");
    expect(result?.images).toEqual([PNG_DATA_URL]);
    expect(text).toContain("image/png");
  });

  it("fails with the status code on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const { result, text } = await run({ file_path: "https://example.com/missing.png" }, tmp);
    expect(result?.stopReason).toBe("fatal");
    expect(text).toContain("404");
  });

  it("rejects a URL that is not an image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
      ),
    );
    const { result, text } = await run({ file_path: "https://example.com/page" }, tmp);
    expect(result?.stopReason).toBe("fatal");
    expect(text).toContain("Unsupported image type");
  });
});

describe("read_file image branch — Environment assembly", () => {
  it("the registry factory reads services.visionDescriber: with it the output is text, without it the image is carried", async () => {
    await writeFile(path.join(tmp, "a.png"), PNG_1X1);
    const factory = BUILTIN_TOOL_FACTORIES[READ_FILE_NAME]!;
    const { llm } = fakeLLM("delegated description result");
    const complete = async (env: Environment) => {
      const out: OmniMessage[] = [];
      for await (const m of env.executeTool({
        toolCall: toolCall({
          name: READ_FILE_NAME,
          arguments: '{"file_path":"a.png"}',
          toolCallId: "t1",
        }),
      })) {
        out.push(m);
      }
      return out[out.length - 1]!.payload as {
        type?: string;
        output?: string;
        images?: string[];
        stop_reason?: string;
      };
    };

    const textOnly = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [definition], mcpServers: [] },
      services: { visionDescriber: { modelId: "vis-1", createLLM: () => llm } },
    });
    const described = await complete(textOnly);
    expect(described.type).toBe("tool_call_output");
    expect(described.stop_reason).toBe("completed");
    expect(described.output).toContain("delegated description result");
    expect(described.images).toBeUndefined();

    const vision = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [definition], mcpServers: [] },
    });
    const carried = await complete(vision);
    expect(carried.stop_reason).toBe("completed");
    expect(carried.images).toEqual([PNG_DATA_URL]);
    // The same factory serves both: no per-model entry, the describer alone decides.
    expect(factory(definition, undefined).name).toBe(READ_FILE_NAME);
  });
});
