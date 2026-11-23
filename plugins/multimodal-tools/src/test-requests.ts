/**
 * What the models page's connection test sends a model a binding accepts: the cheapest request
 * that model takes, built by the same code an operation's request is (operations.ts). A tool
 * model refuses the chat probe the host sends otherwise — a speech recognizer takes no text, and
 * a page reader takes a sentence as the URL to read — so each binding names its own.
 *
 * Text generation declares none: a model it accepts is a chat model, and the chat probe is its
 * test.
 */
import { readFileSync } from "node:fs";
import type { UniConfig, UniMessage } from "@prismshadow/mmsp";
import type { Candidate } from "./accepts.js";
import { operationRequest, type Operation } from "./operations.js";

/** One test request: the request's messages and config, and how long the host waits on it. */
export interface TestRequest {
  messages: UniMessage[];
  config: UniConfig;
  idleTimeoutMs?: number;
}

/** The project's own site: the page a reader is asked to fetch. */
const TEST_PAGE = "https://penguin.ooo/";

/** How long a video test may wait for its one answer: a short clip takes a minute or two. */
const VIDEO_TEST_TIMEOUT_MS = 180_000;

/**
 * A spoken sentence for a speech recognizer's test, shipped beside the code (assets/): NASA's
 * Apollo 11 landing call, "Houston, Tranquility Base here", public domain (NASA, via Wikimedia
 * Commons), cut to its 1.9 seconds and stored as 16 kHz mono 16-bit PCM WAV, the recording every
 * speech recognizer reads (DeepSeek's takes only PCM WAV and Ogg Opus). It holds words, so the
 * recognizer transcribes something and the time the test takes is a real transcription's.
 */
export function testSpeech(): Uint8Array {
  return readFileSync(new URL("../assets/test-speech.wav", import.meta.url));
}

const BUILDERS: Partial<Record<Operation, (model?: Candidate) => TestRequest>> = {
  s2t: (model) =>
    operationRequest(
      "s2t",
      { audio: { data: testSpeech(), mimeType: "audio/wav" } },
      model?.client,
    ),
  search: () => operationRequest("search", { text: "PenguinHarness", count: 1 }),
  fetch: () => operationRequest("fetch", { url: TEST_PAGE }),
  t2s: () => operationRequest("t2s", { text: "OK." }),
  t2i: () =>
    operationRequest("t2i", {
      text: "A small blue circle on a white background.",
      aspectRatio: "1:1",
      resolution: "1K",
    }),
  t2v: () => ({
    ...operationRequest("t2v", {
      text: "A small blue circle on a white background.",
      resolution: "360p",
      duration: 4,
    }),
    idleTimeoutMs: VIDEO_TEST_TIMEOUT_MS,
  }),
};

/** The test request of the binding `key`, or undefined when the chat probe is its test. */
export function testRequestOf(key: string): ((model?: Candidate) => TestRequest) | undefined {
  return BUILDERS[key as Operation];
}
