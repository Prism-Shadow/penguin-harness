/**
 * Given a tool that bills in physical units, the API keeps the original MMSP buckets alongside
 * the billable quantity. An HTTP success with no results is not a billable search, and missing
 * duration remains unknown.
 */
import type { ProjectConfig } from "@prismshadow/penguin-core";
import type { ContentItem } from "@prismshadow/mmsp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runProjectModel, type ModelRunContext } from "../src/services/capability-model.js";
import { stubFetch } from "./fixtures/fetch.js";

afterEach(() => vi.unstubAllGlobals());
function run(
  modelId: string,
  clientType: string,
  item: ContentItem,
  context: Partial<ModelRunContext> = {},
) {
  const config = {
    models: [{ provider: "fixture", model_id: modelId }],
    providers: {
      fixture: { client_type: clientType, base_url: "https://meter.test", api_key: "fixture" },
    },
  } as ProjectConfig;
  return runProjectModel(
    config,
    { provider: "fixture", modelId },
    [{ role: "user", content_items: [item] }],
    {},
    { signal: new AbortController().signal, ...context },
  );
}

describe("tool input meters", () => {
  it("reports one nonempty DeepSeek search and zero empty searches while preserving the protocol usage", async () => {
    const results = [{ title: "A", url: "https://example.test", summary: "A." }];
    const wire = stubFetch((_, i) => Response.json({ results: i === 0 ? [] : results }));
    const empty = await run("deepseek-search", "deepseek-webtool", {
      type: "text.done",
      text: "empty",
    });
    const full = await run("deepseek-search", "deepseek-webtool", {
      type: "text.done",
      text: "full",
    });
    expect(empty.inputMeter).toEqual({ unit: "billable_request", quantity: 0 });
    expect(full.inputMeter).toEqual({ unit: "billable_request", quantity: 1 });
    expect(full.usage?.prompt_tokens).toBe(1000);
    expect(wire.calls).toHaveLength(2);
  });
  it("labels DeepSeek duration as billed seconds and keeps missing duration unmeasured", async () => {
    stubFetch((_, i) =>
      Response.json(i === 0 ? { text: "text", duration_ms: 3200 } : { text: "text" }),
    );
    const audio = {
      type: "inline_data.done",
      data: Buffer.from([0, 0]),
      mime_type: "audio/l16;rate=16000;channels=1",
    } as const;
    const measured = await run("deepseek-asr", "deepseek-transcription", audio);
    expect(measured.inputMeter).toEqual({ unit: "billed_audio_second", quantity: 4 });
    expect((await run("deepseek-asr", "deepseek-transcription", audio)).inputMeter).toBeUndefined();
  });
  it.each(["EmptyResponseError", "IncompleteStreamError"] as const)(
    "retains billed usage in a native %s once",
    async (type) => {
      const wire = stubFetch(() => {
        const chunk = {
          id: "meter",
          object: "chat.completion.chunk",
          created: 0,
          model: "model",
          choices: [
            { index: 0, delta: {}, finish_reason: type === "EmptyResponseError" ? "stop" : null },
          ],
          usage: {
            prompt_tokens: 9,
            prompt_tokens_details: { cached_tokens: 2 },
            completion_tokens: 8,
            completion_tokens_details: { reasoning_tokens: 5 },
          },
        };
        return new Response("data: " + JSON.stringify(chunk) + "\n\ndata: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      });
      const onUsage = vi.fn();
      await expect(
        run("model", "openai-chat", { type: "text.done", text: "hello" }, { onUsage }),
      ).rejects.toMatchObject({ name: type });
      expect(onUsage).toHaveBeenCalledExactlyOnceWith(
        { cached_tokens: 2, prompt_tokens: 7, thoughts_tokens: 5, response_tokens: 3 },
        { unit: "token", quantity: 7 },
      );
      expect(wire.calls).toHaveLength(1);
    },
  );
  it("keeps Fish speech bytes and DeepSeek speech characters distinct for the same non-ASCII input", async () => {
    stubFetch(
      () => new Response(new Uint8Array([0, 0]), { headers: { "content-type": "audio/pcm" } }),
    );
    const item = { type: "text.done", text: "你!" } as const;
    expect((await run("deepseek-tts", "deepseek-speech", item)).inputMeter).toEqual({
      unit: "billed_character",
      quantity: 3,
    });
    expect((await run("fish-audio/drama-3", "openai-speech", item)).inputMeter).toEqual({
      unit: "utf8_byte",
      quantity: 4,
    });
  });
});
