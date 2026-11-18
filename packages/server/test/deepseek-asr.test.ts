/**
 * - DeepSeek receives multipart PCM WAV, while compatible providers can still receive WebM.
 * - Mislabeled containers and unsupported PCM encodings are refused before a provider is called.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { runProjectModel } from "../src/services/capability-model.js";
import { requireDeepSeekAudio } from "../src/services/transcription-audio.js";
import type { ProjectConfig } from "@prismshadow/penguin-core";

const wav = Buffer.from(
  "524946462c00000057415645666d74201000000001000100803e0000007d000002001000646174610800000000000100ffff0000",
  "hex",
);
const item = (data: Buffer, mime_type: string) => ({
  type: "inline_data.done" as const,
  data,
  mime_type,
});

describe("DeepSeek ASR uploads", () => {
  let server: Server;
  let url: string;
  const uploads: { path: string; file: File }[] = [];
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const form = await new Response(Buffer.concat(chunks), {
        headers: { "content-type": req.headers["content-type"] ?? "" },
      }).formData();
      const file = form.get("file") as File;
      const bytes = Buffer.from(await file.arrayBuffer());
      const deepseek = req.url === "/v1/tools/asr";
      const valid = deepseek
        ? file.type === "audio/wav" && bytes.equals(wav)
        : file.type === "audio/webm";
      uploads.push({ path: req.url!, file });
      res.writeHead(valid ? 200 : 400, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          valid ? { text: "speech received" } : { error: { message: "unsupported audio format" } },
        ),
      );
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    url = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  it("sends a PCM WAVE file to DeepSeek and preserves a WebM file for an OpenAI-compatible route", async () => {
    for (const [clientType, modelId, audio, route, ext] of [
      ["deepseek-official", "deepseek-asr", item(wav, "audio/wav"), "/v1/tools/asr", ".wav"],
      [
        "openai-transcription",
        "whisper-1",
        item(Buffer.from("1a45dfa3", "hex"), "audio/webm"),
        "/audio/transcriptions",
        ".webm",
      ],
    ] as const) {
      const config = {
        models: [{ provider: "fixture", model_id: modelId }],
        providers: {
          fixture: { client_type: clientType, base_url: url, api_key: "local-fixture" },
        },
      } as ProjectConfig;
      const result = await runProjectModel(
        config,
        { provider: "fixture", modelId },
        [{ role: "user", content_items: [audio] }],
        {},
        { signal: new AbortController().signal },
      );
      expect(result.text).toBe("speech received");
      expect(uploads.at(-1)?.path).toBe(route);
      expect(uploads.at(-1)?.file.name.endsWith(ext)).toBe(true);
      expect(Buffer.from(await uploads.at(-1)!.file.arrayBuffer())).toEqual(audio.data);
    }
  });
  it("checks the actual container, including the Ogg codec and declared PCM alignment", () => {
    expect(() => requireDeepSeekAudio(item(wav, "audio/wav"))).not.toThrow();
    expect(() => requireDeepSeekAudio(item(wav.subarray(0, 43), "audio/wav"))).toThrow();
    const float = Buffer.from(wav);
    float.writeUInt16LE(3, 20);
    expect(() => requireDeepSeekAudio(item(float, "audio/wav"))).toThrow();
    expect(() => requireDeepSeekAudio(item(Buffer.from("webm"), "audio/webm"))).toThrow();
    const ogg = Buffer.alloc(47);
    ogg.write("OggS");
    ogg[26] = 1;
    ogg[27] = 19;
    ogg.write("OpusHead", 28);
    expect(() => requireDeepSeekAudio(item(ogg, "audio/ogg; codecs=opus"))).not.toThrow();
    ogg.write("vorbis", 28);
    expect(() => requireDeepSeekAudio(item(ogg, "audio/ogg"))).toThrow();
    expect(() =>
      requireDeepSeekAudio(item(Buffer.from([1, 2]), "audio/pcm;rate=16000;channels=1")),
    ).not.toThrow();
    expect(() =>
      requireDeepSeekAudio(item(Buffer.from([1]), "audio/pcm;rate=16000;channels=1")),
    ).toThrow();
  });
});
