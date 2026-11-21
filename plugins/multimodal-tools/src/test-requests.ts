/**
 * What the models page's connection test sends a model a binding accepts: the cheapest request
 * that model takes, built by the same code an operation's request is (operations.ts). A tool
 * model refuses the chat probe the host sends otherwise — a speech recognizer takes no text, and
 * a page reader takes a sentence as the URL to read — so each binding names its own.
 *
 * Text generation declares none: a model it accepts is a chat model, and the chat probe is its
 * test.
 */
import type { UniConfig, UniMessage } from "@prismshadow/mmsp";
import { playable } from "./media.js";
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
 * Half a second of a quiet 440 Hz tone, 16 kHz mono 16-bit PCM in a WAV file: a recording every
 * speech recognizer reads (DeepSeek's takes only PCM WAV and Ogg Opus), generated rather than
 * shipped. It holds no words, so the transcript may be empty.
 */
export function testTone(): Uint8Array {
  const rate = 16_000;
  const samples = rate / 2;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), i * 2);
  }
  return playable({ data: pcm, mimeType: `audio/L16; rate=${rate}; channels=1` })!.data;
}

const BUILDERS: Partial<Record<Operation, () => TestRequest>> = {
  s2t: () => operationRequest("s2t", { audio: { data: testTone(), mimeType: "audio/wav" } }),
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
export function testRequestOf(key: string): (() => TestRequest) | undefined {
  return BUILDERS[key as Operation];
}
