/**
 * The connection test of a tool model sends what its binding names, and that is a request the
 * model takes.
 *
 * - The speech recognition test sends a recording DeepSeek's recognizer accepts (16-bit PCM WAV),
 *   generated in code rather than shipped.
 */
import { describe, expect, it } from "vitest";
import { bindingCode } from "../src/accepts.js";
import { requireDeepSeekAudio } from "../src/deepseek-audio.js";

describe("the connection test of a tool model", () => {
  it("sends a speech recognizer a recording DeepSeek's recognizer accepts", () => {
    const request = bindingCode("s2t").testRequest!();
    const [item] = request.messages[0]!.content_items;
    expect(item?.type).toBe("inline_data.done");
    const audio = item as { data: Buffer; mime_type: string };
    expect(() =>
      requireDeepSeekAudio({ data: audio.data, mimeType: audio.mime_type }),
    ).not.toThrow();
  });
});
