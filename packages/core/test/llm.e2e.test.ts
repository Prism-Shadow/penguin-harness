/**
 * GenerativeModel live e2e. The whole suite is it.skip by default and stays offline;
 * requires an explicit opt-in to run against a real endpoint (this avoids ordinary unit
 * test runs firing real network requests just because an API key happens to be present):
 *   PENGUIN_E2E=1 pnpm test          # or pnpm test:e2e
 * The key comes from .env (gitignored) or an environment variable; the provider is picked
 * by whichever key is available (CI uses DeepSeek).
 */
import "dotenv/config";
import { describe, expect, it } from "vitest";

import { GenerativeModel } from "../src/llm/index.js";
import { toolCallOutput, userText } from "../src/omnimessage/index.js";
import type { OmniMessage, ToolCallPayload } from "../src/omnimessage/index.js";

/** Picks a provider in order by available key; AgentHub routes by modelId and auto-reads the matching env var. */
const PROVIDERS = [
  { key: "ANTHROPIC_API_KEY", modelId: "claude-sonnet-4-6" },
  { key: "DEEPSEEK_API_KEY", modelId: "deepseek-v4-flash" },
] as const;
const provider = PROVIDERS.find((p) => process.env[p.key]);
const runLive = process.env.PENGUIN_E2E === "1" && provider !== undefined;
const maybe = runLive ? it : it.skip;

describe(`GenerativeModel live e2e (${provider?.modelId ?? "skipped"})`, () => {
  maybe(
    "streams a short reply with partial text, a complete text, and token usage",
    async () => {
      const model = new GenerativeModel({
        modelId: provider!.modelId,
        tools: [],
        systemPrompt: "You are concise.",
        // Generous budget: a reasoning model's thinking may take up a lot of space, leave room for the reply to land reliably.
        maxTokens: 2048,
      });

      const out: OmniMessage[] = [];
      for await (const msg of model.streamGenerate({
        newMessages: [userText("Say hello in exactly three words.")],
      })) {
        out.push(msg);
      }

      const payloadType = (m: OmniMessage): string => (m.payload as { type: string }).type;

      // At least 1 partial_text.
      const partialTexts = out.filter((m) => payloadType(m) === "partial_text");
      expect(partialTexts.length).toBeGreaterThanOrEqual(1);

      // At least 1 non-empty complete text.
      const completeTexts = out.filter((m) => payloadType(m) === "text");
      expect(completeTexts.length).toBeGreaterThanOrEqual(1);
      const text = (completeTexts[0]!.payload as { text: string }).text;
      expect(text.trim().length).toBeGreaterThan(0);

      // Trailing token_usage, with request.total > 0.
      const last = out.at(-1)!;
      expect(payloadType(last)).toBe("token_usage");
      const usage = last.payload as { request: { total: number } };
      expect(usage.request.total).toBeGreaterThan(0);

      // Session-cumulative tokens are also recorded on the instance.
      expect(model.sessionTokens.total).toBeGreaterThan(0);
    },
    // Live calls have inherent network/server jitter: allow a generous timeout and retries so
    // one slow API call doesn't fail CI (assertions stay strict; only transient timeouts are tolerated).
    { timeout: 90_000, retry: 2 },
  );
});

// --- Gemini tool_call_id uniqueness live regression (consecutive same-name tool calls made the
// frontend tool cards overwrite each other) ---
// Gemini's functionCall has no call id, so AgentHub uses the function name as tool_call_id; this group
// verifies EventTranslator's in-Session uniqueness (#n suffix) and outbound restoration
// (functionResponse paired by function name) round-trip on the real API. Runs only when explicitly
// opted in with GEMINI_API_KEY set.
const runGemini = process.env.PENGUIN_E2E === "1" && process.env.GEMINI_API_KEY !== undefined;
const maybeGemini = runGemini ? it : it.skip;

describe(`GenerativeModel live e2e (gemini-3.5-flash: tool_call_id uniquification${runGemini ? "" : ", skipped"})`, () => {
  maybeGemini(
    "same-name tool calls in two consecutive rounds get distinct tool_call_ids; a tool_result sent back with a suffixed id is paired correctly",
    async () => {
      const model = new GenerativeModel({
        modelId: "gemini-3.5-flash",
        tools: [
          {
            name: "get_time",
            description: "Get the current local time of a city.",
            parameters: {
              type: "object",
              properties: { city: { type: "string", description: "City name" } },
              required: ["city"],
            },
          },
        ],
        systemPrompt:
          "You are a tool-driven assistant. Always use the get_time tool to answer time questions, one call per turn. Never guess.",
        maxTokens: 1024,
        thinkingLevel: "none",
      });

      const round = async (
        input: OmniMessage[],
      ): Promise<{ calls: ToolCallPayload[]; text: string }> => {
        const calls: ToolCallPayload[] = [];
        let text = "";
        const gen = model.streamGenerate({ newMessages: input });
        let res = await gen.next();
        while (!res.done) {
          const p = res.value.payload as { type: string };
          if (p.type === "tool_call") calls.push(res.value.payload as ToolCallPayload);
          if (p.type === "text") text += (res.value.payload as { text: string }).text;
          res = await gen.next();
        }
        expect((res.value as { status: string }).status).toBe("completed");
        return { calls, text };
      };

      // Round 1: call get_time(Tokyo); the id keeps the function name.
      const r1 = await round([
        userText(
          "What time is it in Tokyo? After you get that result, also check Paris (one tool call at a time).",
        ),
      ]);
      expect(r1.calls.length).toBeGreaterThanOrEqual(1);
      expect(r1.calls[0]!.tool_call_id).toBe("get_time");

      // Round 2: after returning the result the model checks Paris next — the same-name call must get a new suffixed id.
      const r2 = await round(
        r1.calls.map((c) =>
          toolCallOutput({ output: "10:00 AM (mock)", toolCallId: c.tool_call_id }),
        ),
      );
      expect(r2.calls.length).toBeGreaterThanOrEqual(1);
      expect(r2.calls[0]!.tool_call_id).toBe("get_time#2");

      // Round 3: after returning the tool_result carrying the #2 suffix (outbound strips it back to the
      // function name), the provider finishes normally. Reaching completed means the functionResponse
      // pairing was accepted; some models may keep appending calls, so don't hard-assert the body.
      const r3 = await round(
        r2.calls.map((c) =>
          toolCallOutput({ output: "3:00 AM (mock)", toolCallId: c.tool_call_id }),
        ),
      );
      expect(r3.calls.length + r3.text.length).toBeGreaterThan(0);
    },
    { timeout: 120_000, retry: 2 },
  );
});
