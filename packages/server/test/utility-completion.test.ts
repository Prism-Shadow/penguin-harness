/**
 * The one-off utility completion behind semantic id proposals. It never throws and never
 * reaches for a network here: the config it would run with and the collector that drains the
 * stream are both pure, so the two things that decide whether an answer arrives — thinking
 * off, and a budget the answer fits in after the thinking — are asserted directly, and every
 * dead end is checked for carrying its reason rather than a bare "no answer".
 */
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  assistantText,
  partialText,
  partialThinking,
  projectConfigPath,
  projectDir,
  thinkingMessage,
  tokenUsage,
  emptyTokenCounts,
} from "@prismshadow/penguin-core";
import type { LLMOutcome, OmniMessage } from "@prismshadow/penguin-core";
import {
  ProjectConfigService,
  collectUtilityCompletion,
  utilityCompletionConfig,
} from "../src/services/project-config-service.js";
import { makeTempRoot } from "./helpers.js";

/** A stream shaped the way the real translator shapes one: partial fragments, then the complete backfill. */
async function* streamOf(
  messages: OmniMessage[],
  outcome: LLMOutcome,
): AsyncGenerator<OmniMessage, LLMOutcome> {
  for (const m of messages) yield m;
  return outcome;
}

describe("utilityCompletionConfig", () => {
  it("turns thinking off and asks for the shared meta budget, not a budget the size of an id", () => {
    const config = utilityCompletionConfig("m-bench", { api_key: "sk-1" });
    expect(config.thinkingLevel).toBe("none");
    expect(config.maxTokens).toBe(300);
    expect(config.apiKey).toBe("sk-1");
    expect(config.tools).toEqual([]);
  });

  it("still honours a per-model cap pinned below the budget, and the entry's protocol", () => {
    const config = utilityCompletionConfig("m-bench", {
      max_tokens: 128,
      base_url: "https://example.test/v1",
      // The pre-0.4.2 spelling is normalized like everywhere else.
      client_type: "openai",
    });
    expect(config.maxTokens).toBe(128);
    expect(config.baseUrl).toBe("https://example.test/v1");
    expect(config.clientType).toBe("openai-chat");
  });

  it("never tightens to an uncapped entry's -1", () => {
    expect(utilityCompletionConfig("m-bench", { max_tokens: -1 }).maxTokens).toBe(300);
  });
});

describe("collectUtilityCompletion", () => {
  it("returns the text of a model that thought first and answered second", async () => {
    const result = await collectUtilityCompletion(
      streamOf(
        [
          partialThinking("start"),
          partialThinking("delta", "the name is Chinese, translate it"),
          partialThinking("stop", "", "completed"),
          thinkingMessage("the name is Chinese, translate it", "completed"),
          partialText("start"),
          partialText("delta", "research_paper"),
          partialText("delta", "_lab"),
          partialText("stop", "", "completed"),
          assistantText("research_paper_lab", "completed"),
          tokenUsage(emptyTokenCounts(), emptyTokenCounts()),
        ],
        { status: "completed" },
      ),
    );
    // The complete backfill is counted once; the partial deltas that built it are not counted again.
    expect(result).toEqual({ ok: true, text: "research_paper_lab" });
  });

  it("reports the provider's reason when the whole budget went to thinking", async () => {
    const result = await collectUtilityCompletion(
      streamOf(
        [
          partialThinking("start"),
          partialThinking("delta", "let me consider every possible identifier"),
          partialThinking("stop", "", "retryable"),
          thinkingMessage("let me consider every possible identifier", "retryable"),
        ],
        {
          status: "retryable",
          errorCode: "malformed",
          errorMessage:
            'OpenaiClient returned no content other than thinking (finish_reason="length").',
        },
      ),
    );
    expect(result).toEqual({
      ok: false,
      cause: "failed",
      error: 'OpenaiClient returned no content other than thinking (finish_reason="length").',
    });
  });

  it("falls back to the bare status when the outcome carries no message", async () => {
    expect(await collectUtilityCompletion(streamOf([], { status: "aborted" }))).toEqual({
      ok: false,
      cause: "failed",
      error: "aborted",
    });
  });

  it("treats a whitespace-only answer as no answer", async () => {
    const result = await collectUtilityCompletion(
      streamOf([assistantText("  \n ", "completed")], { status: "completed" }),
    );
    expect(result).toEqual({ ok: false, cause: "failed", error: "completed" });
  });
});

describe("completeOnce", () => {
  it("says which way it fell through when the Project has nothing to run it on", async () => {
    const root = await makeTempRoot();
    const service = new ProjectConfigService(root);
    // No `.project_config.toml` at all.
    expect(await service.completeOnce("p1", "Name: Plugin Marketplace")).toEqual({
      ok: false,
      cause: "no_model",
      error: "the Project names no default model",
    });

    await fs.mkdir(projectDir(root, "p1"), { recursive: true });
    const file = projectConfigPath(root, "p1");
    // A config that names no default model.
    await fs.writeFile(file, '[[models]]\nprovider = "custom"\nmodel_id = "m-bench"\n', "utf8");
    expect(await service.completeOnce("p1", "Name: Plugin Marketplace")).toMatchObject({
      ok: false,
      cause: "no_model",
    });

    // A default model whose entry is gone: there is nothing to build a client from, and a
    // guess at the credential would be worse than no answer.
    await fs.writeFile(
      file,
      '[default_model]\nprovider = "custom"\nmodel_id = "m-bench"\n',
      "utf8",
    );
    expect(await service.completeOnce("p1", "Name: Plugin Marketplace")).toEqual({
      ok: false,
      cause: "no_model",
      error: "the default model custom/m-bench has no entry in the Project config",
    });
  });

  it("collapses a construction that throws into a reason instead of an exception", async () => {
    const root = await makeTempRoot();
    const service = new ProjectConfigService(root);
    await fs.mkdir(projectDir(root, "p1"), { recursive: true });
    // An entry whose model id no client can be routed from, and no protocol pinned: the SDK
    // throws while building the client, before any network I/O.
    await fs.writeFile(
      projectConfigPath(root, "p1"),
      '[default_model]\nprovider = "custom"\nmodel_id = "not-a-routable-model-xyz"\n\n' +
        '[[models]]\nprovider = "custom"\nmodel_id = "not-a-routable-model-xyz"\n',
      "utf8",
    );
    const result = await service.completeOnce("p1", "Name: Plugin Marketplace");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.cause).toBe("failed");
      expect(result.error).toContain("not-a-routable-model-xyz");
    }
  });
});
