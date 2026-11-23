/**
 * The connection test of a tool model sends what its binding names, and that is a request the
 * model takes.
 *
 * - The speech recognition test sends spoken words in a recording DeepSeek's recognizer accepts
 *   (16-bit PCM WAV), so it measures a real transcription.
 */
import { describe, expect, it } from "vitest";
import { bindingCode } from "../src/accepts.js";
import { requireDeepSeekAudio } from "../src/deepseek-audio.js";

describe("the connection test of a tool model", () => {
  it("sends a speech recognizer a recording DeepSeek's recognizer accepts", () => {
    const request = bindingCode("s2t").testRequest!();
    expect(request.messages[0]!.content_items).toHaveLength(1);
    const [item] = request.messages[0]!.content_items;
    expect(item?.type).toBe("inline_data.done");
    const audio = item as { data: Buffer; mime_type: string };
    expect(() =>
      requireDeepSeekAudio({ data: audio.data, mimeType: audio.mime_type }),
    ).not.toThrow();
    // More than a second of 16 kHz mono 16-bit samples: a sentence, not a beep.
    expect(audio.data.length).toBeGreaterThan(16_000 * 2);
  });
  it("sends verified Google content clients the sample and a verbatim transcription instruction", () => {
    const request = bindingCode("s2t").testRequest!({
      provider: "google",
      modelId: "gemini",
      client: "google-official",
    });
    expect(request.messages[0]!.content_items).toEqual([
      expect.objectContaining({ type: "inline_data.done", mime_type: "audio/wav" }),
      expect.objectContaining({
        type: "text.done",
        text: expect.stringContaining("original language"),
      }),
    ]);
  });
});
