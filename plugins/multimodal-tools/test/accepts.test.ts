/**
 * Which configured models each tool's picker offers, given what MMSP says about them: the client a
 * request goes to and the modalities its registry lists there.
 *
 * - A chat model is offered for text generation only; a model returning media or web pages never is.
 * - An image, video or speech model is offered for its own kind of output, whether MMSP knows it
 *   by its client (openai-image, deepseek-speech …) or by what its registry entry returns.
 * - A web model is offered for search or for fetching a page by what its id says it does.
 * - A recognizer is offered for speech recognition; a model taking text as well is not one.
 * - A model MMSP does not list is offered for text generation unless its client does one media job.
 */
import { describe, expect, it } from "vitest";
import { bindingCode, type Candidate } from "../src/accepts.js";

const KEYS = ["t2t", "search", "fetch", "t2i", "t2v", "t2s", "s2t"] as const;

/** The tools a model is offered for. */
function offeredFor(model: Candidate): string[] {
  return KEYS.filter((key) => bindingCode(key).accepts(model));
}

const m = (modelId: string, facts: Omit<Candidate, "provider" | "modelId">): Candidate => ({
  provider: "p",
  modelId,
  ...facts,
});

describe("which tools a model is offered for", () => {
  it("offers a chat model for text generation only", () => {
    expect(
      offeredFor(
        m("chat", { client: "openai-official", input: ["Text", "Image"], output: ["Text"] }),
      ),
    ).toEqual(["t2t"]);
  });

  it("offers media models for their own output, by client or by registry entry", () => {
    expect(offeredFor(m("gpt-image-2.5-flare", { client: "openai-image" }))).toEqual(["t2i"]);
    expect(
      offeredFor(
        m("gemini-3.1-flash-image", {
          client: "google-official",
          input: ["Text", "Image"],
          output: ["Image"],
        }),
      ),
    ).toEqual(["t2i"]);
    expect(
      offeredFor(
        m("gemini-omni-1.2-flash", {
          client: "google-official",
          input: ["Text", "Image"],
          output: ["Video"],
        }),
      ),
    ).toEqual(["t2v"]);
    expect(offeredFor(m("deepseek-tts", { client: "deepseek-speech" }))).toEqual(["t2s"]);
    expect(
      offeredFor(
        m("gemini-3.8-flash-tts", {
          client: "google-official",
          input: ["Text"],
          output: ["Audio"],
        }),
      ),
    ).toEqual(["t2s"]);
  });

  it("offers a web model for search or fetch by what its id says", () => {
    expect(
      offeredFor(
        m("deepseek-search", { client: "deepseek-webtool", input: ["Text"], output: ["Web"] }),
      ),
    ).toEqual(["search"]);
    expect(
      offeredFor(m("jina-fetch", { client: "jina-webtool", input: ["Text"], output: ["Web"] })),
    ).toEqual(["fetch"]);
  });

  it("offers a recognizer for speech recognition, and not a model that also takes text", () => {
    expect(
      offeredFor(
        m("deepseek-asr", { client: "deepseek-transcription", input: ["Audio"], output: ["Text"] }),
      ),
    ).toEqual(["s2t"]);
    expect(
      offeredFor(
        m("whisper-like", { client: "openai-official", input: ["Audio"], output: ["Text"] }),
      ),
    ).toEqual(["s2t"]);
    expect(
      offeredFor(
        m("omni-chat", { client: "openai-official", input: ["Text", "Audio"], output: ["Text"] }),
      ),
    ).toEqual(["t2t"]);
  });

  it.each(["google-official", "google-genai"])(
    "offers only verified %s audio inputs for dictation",
    (client) => {
      const facts = { client, input: ["Text", "Audio"], output: ["Text"] };
      expect(offeredFor(m("gemini", { ...facts, audioTranscription: true }))).toEqual([
        "t2t",
        "s2t",
      ]);
      expect(offeredFor(m("gemini", { ...facts, audioTranscription: false }))).toEqual(["t2t"]);
      expect(offeredFor(m("gemini", facts))).toEqual(["t2t"]);
    },
  );

  it("offers a model MMSP does not list for text generation, unless its client does one media job", () => {
    expect(offeredFor(m("house-model", { client: "openai-chat" }))).toEqual(["t2t"]);
    expect(offeredFor(m("house-model", {}))).toEqual(["t2t"]);
    expect(offeredFor(m("house-voice", { client: "openai-speech" }))).toEqual(["t2s"]);
    expect(offeredFor(m("house-embedder", { client: "openai-embedding" }))).toEqual([]);
  });
});
