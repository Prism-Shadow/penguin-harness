/**
 * Unit tests (offline) for the read_image "vision-model describe" variant, driven by a fake LLM:
 * definition overrides (new prompt parameter, description mentioning the vision model id), a
 * single image + prompt sent to the vision model, text output and failure paths (no vision model
 * configured / vision model request fails), results carrying no images; and swapping on the
 * Environment side (injecting visionDescriber switches to the describe variant).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DESCRIBE_IMAGE_NAME,
  createDescribeImageTool,
} from "../src/environment/tools/describe-image.js";
import { BUILTIN_TOOL_FACTORIES } from "../src/environment/tools/registry.js";
import { Environment } from "../src/environment/environment.js";
import { assistantText, partialText, toolCall } from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import type { ToolResult } from "../src/environment/tools/types.js";
import type {
  GenerativeModelParameters,
  LLMInterface,
  LLMOutcome,
  ToolDefinitionConfig,
  VisionDescriberService,
} from "../src/interfaces.js";

/** 1x1 transparent PNG (includes magic bytes, enough for mime sniffing). */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Config entry for describe_image (forModel: "text-only"; the definition comes entirely from config, the implementation never rewrites it at runtime). */
const definition: ToolDefinitionConfig = {
  name: DESCRIBE_IMAGE_NAME,
  forModel: "text-only",
  description: "describe image via vision model",
  parameters: {
    type: "object",
    properties: { source: { type: "string" }, prompt: { type: "string" } },
    required: ["source"],
  },
  permission: "r",
};

/**
 * Fake vision LLM: records the received newMessages, emits output following the real streaming
 * protocol (partial start -> word-by-word delta -> stop -> complete text), and finishes with the given outcome.
 */
function fakeLLM(reply: string, outcome: LLMOutcome = { status: "completed" }) {
  const calls: GenerativeModelParameters[] = [];
  const llm: LLMInterface = {
    // eslint-disable-next-line @typescript-eslint/require-await
    async *streamGenerate(params: GenerativeModelParameters) {
      calls.push(params);
      if (reply) {
        yield partialText("start");
        // Split into two delta chunks to verify piecewise forwarding (rather than buffering the whole thing).
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

async function run(
  args: Record<string, unknown>,
  workspaceDir: string,
  describer: VisionDescriberService,
) {
  const tool = createDescribeImageTool(definition, describer);
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
  tmp = await mkdtemp(path.join(tmpdir(), "penguin-descimg-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("describe_image（read_image 的纯文本模型版）", () => {
  it("定义原样取自配置条目（不做运行期改写）", () => {
    const tool = createDescribeImageTool(definition, { modelId: "vis-1" });
    expect(tool.name).toBe(DESCRIBE_IMAGE_NAME);
    expect(tool.definition).toBe(definition);
  });

  it("registry 按工具名装配；未注入 visionDescriber 时以 failed 说明收尾（而非回图片）", async () => {
    const factory = BUILTIN_TOOL_FACTORIES[DESCRIBE_IMAGE_NAME]!;
    await writeFile(path.join(tmp, "a.png"), PNG_1X1);
    const describeTool = factory(definition, undefined);
    const gen = describeTool.execute({ source: "a.png" }, { workspaceDir: tmp, toolCallId: "c1" });
    let result: ToolResult | void;
    let text = "";
    for (;;) {
      const res = await gen.next();
      if (res.done) {
        result = res.value;
        break;
      }
      text += (res.value.payload as { output?: string }).output ?? "";
    }
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("No vision model");
  });

  it("图片 + 自定义 prompt 单发视觉模型，回其文本，结果不携带 images", async () => {
    await writeFile(path.join(tmp, "a.png"), PNG_1X1);
    const { llm, calls } = fakeLLM("图里是一只企鹅。");
    const describer: VisionDescriberService = { modelId: "vis-1", createLLM: () => llm };
    const { messages, result, text } = await run(
      { source: "a.png", prompt: "图里是什么动物？" },
      tmp,
      describer,
    );

    // Single message = prompt text + data URL image (same role user, merged into one request).
    expect(calls).toHaveLength(1);
    const payloads = calls[0]!.newMessages.map(
      (m) => m.payload as { type: string; text?: string; image_url?: string },
    );
    expect(payloads[0]!.type).toBe("text");
    expect(payloads[0]!.text).toBe("图里是什么动物？");
    expect(payloads[1]!.type).toBe("image_url");
    expect(payloads[1]!.image_url).toBe(`data:image/png;base64,${PNG_1X1.toString("base64")}`);

    expect(text).toContain("described by vis-1");
    expect(text).toContain("图里是一只企鹅。");
    // Streaming forward: the header line and description deltas are emitted as separate chunks (not buffered as a whole), and the complete text is not forwarded again.
    const outputs = messages.map((m) => (m.payload as { output?: string }).output ?? "");
    expect(outputs.length).toBeGreaterThanOrEqual(3); // header + >=2 description delta chunks
    expect(outputs[0]).toContain("described by vis-1");
    expect(outputs.slice(1).join("")).toBe("图里是一只企鹅。");
    // Text-based description: the result carries no images (images never enter session history).
    expect(result?.images).toBeUndefined();
    expect(result?.stopReason).toBeUndefined(); // defaults to completed
  });

  it("未给 prompt 时用默认问题", async () => {
    await writeFile(path.join(tmp, "a.png"), PNG_1X1);
    const { llm, calls } = fakeLLM("desc");
    await run({ source: "a.png" }, tmp, { modelId: "vis-1", createLLM: () => llm });
    const first = calls[0]!.newMessages[0]!.payload as { text?: string };
    expect(first.text).toContain("Describe this image");
  });

  it("未配置视觉模型：failed 并解释如何配置", async () => {
    await writeFile(path.join(tmp, "a.png"), PNG_1X1);
    const { result, text } = await run({ source: "a.png" }, tmp, { modelId: null });
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("No vision model");
    expect(text).toContain("vision_model");
  });

  it("视觉模型请求失败：failed 并带状态与消息", async () => {
    await writeFile(path.join(tmp, "a.png"), PNG_1X1);
    const { llm } = fakeLLM("", { status: "failed", message: "401 unauthorized" });
    const { result, text } = await run({ source: "a.png" }, tmp, {
      modelId: "vis-1",
      createLLM: () => llm,
    });
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("failed");
    expect(text).toContain("401 unauthorized");
  });

  it("图片校验复用 read_image：不支持的类型直接 failed，不请求视觉模型", async () => {
    await writeFile(path.join(tmp, "a.txt"), "not an image");
    const { llm, calls } = fakeLLM("desc");
    const { result } = await run({ source: "a.txt" }, tmp, {
      modelId: "vis-1",
      createLLM: () => llm,
    });
    expect(result?.stopReason).toBe("failed");
    expect(calls).toHaveLength(0);
  });

  it("Environment 装配 describe_image 条目走代读实现，定义与配置一致", async () => {
    await writeFile(path.join(tmp, "a.png"), PNG_1X1);
    const { llm } = fakeLLM("代读结果");
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        // Already filtered by selectBuiltinToolsForModel per session model before assembly; only the describe entry remains here.
        customTools: [definition],
        mcpServers: [],
      },
      services: { visionDescriber: { modelId: "vis-1", createLLM: () => llm } },
    });
    // Tool listing matches config: describe_image carries the prompt parameter.
    const tools = await env.listTools();
    const describeImage = tools.find((t) => t.name === DESCRIBE_IMAGE_NAME)!;
    const props = (describeImage.parameters as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toContain("prompt");

    // Execution goes through description: outputs text, the complete message carries no images.
    const out: OmniMessage[] = [];
    for await (const m of env.executeTool({
      toolCall: toolCall({
        name: DESCRIBE_IMAGE_NAME,
        arguments: '{"source":"a.png"}',
        toolCallId: "t1",
      }),
    })) {
      out.push(m);
    }
    const complete = out[out.length - 1]!.payload as {
      type?: string;
      output?: string;
      images?: string[];
      stop_reason?: string;
    };
    expect(complete.type).toBe("tool_call_output");
    expect(complete.stop_reason).toBe("completed");
    expect(complete.output).toContain("代读结果");
    expect(complete.images).toBeUndefined();
  });
});
