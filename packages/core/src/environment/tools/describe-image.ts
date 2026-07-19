/**
 * describe_image —— image-proxy-read tool, the text-only-model variant of read_image
 * (`forModel: "text-only"`, see default-config.ts): the image itself is never fed back into
 * the session model (some providers flatly 400 on a tool_result carrying an image); instead it
 * is sent, together with the caller-supplied `prompt`, in a single one-off request to the
 * Project-configured vision model (`vision_model`), and the vision model's text answer is
 * returned as the tool's output.
 *
 * The tool definition (description/parameters, including `prompt`) comes entirely from the
 * config entry; this implementation does no runtime rewriting — which tool is used for which
 * model class is declared by the entry's `forModel` annotation, so the config file is what you get.
 *
 * Behavioral contract (shared with read_image): `source` supports http(s) URLs and local paths;
 * validation/size limits are reused from `loadImage`; on failure, outputs explanatory text and
 * finishes with `failed`, never throws; on interruption, only reports `aborted`. Messages from
 * the internal one-off request never enter the parent session stream (no origin, not leaked out).
 * Docs: /docs/tools § "Image tools".
 */
import { imageUrlMessage, partialToolCallOutput, userText } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { LLMOutcome, ToolDefinitionConfig, VisionDescriberService } from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";
import { formatSize, loadImage } from "./read-image.js";

/** Tool name constant (used only inside this tool module, not exposed to Environment). */
export const DESCRIBE_IMAGE_NAME = "describe_image";

/** Default question used when the caller doesn't supply a prompt. */
const DEFAULT_PROMPT =
  "Describe this image in detail, including any visible text, numbers, UI elements and layout.";

/** Constructs the describe_image tool: definition (description/parameters) is taken as-is from the config entry. */
export function createDescribeImageTool(
  definition: ToolDefinitionConfig,
  describer: VisionDescriberService,
): BuiltinTool {
  return {
    name: DESCRIBE_IMAGE_NAME,
    definition,
    async *execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): AsyncGenerator<OmniMessage, ToolResult | void> {
      const { toolCallId, signal } = ctx;
      const delta = (output: string): OmniMessage =>
        partialToolCallOutput({ eventType: "delta", output, toolCallId });

      const source = args["source"];
      if (typeof source !== "string" || source.length === 0) {
        yield delta('Missing required argument "source" for describe_image.');
        return { stopReason: "failed" };
      }
      if (describer.modelId === null || describer.createLLM === undefined) {
        yield delta(
          "No vision model is configured for this project. The current model does not accept " +
            "images; ask the user to pick a vision model in the model settings (vision_model) " +
            "to enable image reading.",
        );
        return { stopReason: "failed" };
      }

      const res = await loadImage(source, ctx.workspaceDir, signal);
      if (!res.ok) {
        if (res.reason === "aborted") return { stopReason: "aborted" };
        yield delta(res.message);
        return { stopReason: "failed" };
      }

      const prompt =
        typeof args["prompt"] === "string" && args["prompt"].trim().length > 0
          ? args["prompt"]
          : DEFAULT_PROMPT;
      const dataUrl = `data:${res.mime};base64,${res.bytes.toString("base64")}`;

      // One-off vision model request: prompt + image are merged into a single user message;
      // its text deltas (partial_text delta) are forwarded in real time as this tool's own
      // output delta — the description streams out piece by piece, not buffered as a whole.
      // Partial concatenation == the full message (see generative-model.ts), so the full text
      // is not forwarded again; other messages like thinking/token_usage are ignored, never
      // leaked into the parent session.
      const llm = describer.createLLM();
      const gen = llm.streamGenerate({
        newMessages: [userText(prompt), imageUrlMessage(dataUrl)],
        ...(signal ? { signal } : {}),
      });
      yield delta(
        `${res.mime}, ${formatSize(res.bytes.length)} — described by ${describer.modelId}:\n`,
      );
      let streamedAny = false;
      let outcome: LLMOutcome | undefined;
      for (;;) {
        const step = await gen.next();
        if (step.done) {
          outcome = step.value;
          break;
        }
        const p = step.value.payload as { type?: string; event_type?: string; text?: string };
        if (p.type === "partial_text" && p.event_type === "delta" && p.text) {
          streamedAny = true;
          yield delta(p.text);
        }
      }
      if (signal?.aborted) return { stopReason: "aborted" };
      if (!outcome || outcome.status !== "completed") {
        const detail =
          outcome && "message" in outcome && outcome.message ? `: ${outcome.message}` : "";
        yield delta(
          `${streamedAny ? "\n" : ""}Vision model (${describer.modelId}) request ${outcome?.status ?? "failed"}${detail}`,
        );
        return { stopReason: "failed" };
      }
      if (!streamedAny) yield delta("[vision model returned no text]");
    },
  };
}
