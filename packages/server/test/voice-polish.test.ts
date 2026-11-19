/**
 * Dictation gets a single request at the model's lowest reasoning level. A model without
 * an off switch uses its supported minimum. A custom alias keeps its existing defaults.
 */
import type { ProjectConfig } from "@prismshadow/penguin-core";
import { afterEach, expect, it, vi } from "vitest";
import { polishTranscript } from "../src/services/voice-polish.js";
import { stubFetch } from "./fixtures/fetch.js";

afterEach(() => vi.unstubAllGlobals());

it.each([
  ["deepseek-official", "deepseek-v4-pro", "none"],
  ["openai-responses", "gpt-6.2-sol", "low"],
  ["openai-responses", "private-model-alias", undefined],
] as const)("edits a transcript in one request with %s/%s", async (clientType, modelId, effort) => {
  const text = "Tuesday at five.";
  const events = [
    { type: "response.output_text.delta", item_id: "reply", delta: text },
    {
      type: "response.completed",
      response: {
        status: "completed",
        usage: {
          input_tokens: 10,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 4,
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    },
  ];
  const upstream = stubFetch(
    () =>
      new Response(
        events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join("") +
          "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const config = {
    models: [{ provider: "custom", model_id: modelId }],
    providers: {
      custom: { client_type: clientType, base_url: "http://localhost/v1", api_key: "test" },
    },
  } as ProjectConfig;

  const result = await polishTranscript({
    config,
    model: { provider: "custom", modelId },
    text: "um Tuesday at five",
    signal: new AbortController().signal,
  });
  expect(result.text).toBe(text);
  expect(upstream.calls).toHaveLength(1);
  const body = JSON.parse(upstream.calls[0]!.body);
  expect(body.reasoning?.effort).toBe(effort);
  expect(body).not.toHaveProperty("service_tier");
});
