import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { inspectWave } from "../src/activities/audio.js";
import { speechWave } from "./audio-fixtures.js";

describe("speech artifacts", () => {
  it("checks WAV bounds and actual PCM format rather than trusting its extension", () => {
    expect(inspectWave(speechWave(), "run_test")).toMatchObject({
      bytes: 140,
      durationMs: 2,
      mimeType: "audio/wav",
    });
    for (const offset of [0, 8, 20, 22, 24, 28, 32, 34, 40]) {
      const bytes = speechWave();
      bytes[offset] = 255;
      expect(() => inspectWave(bytes, "run_test")).toThrow();
    }
    expect(() => inspectWave(speechWave().subarray(0, 48), "run_test")).toThrow();
    const trailing = Buffer.concat([speechWave(), Buffer.from([0])]);
    trailing.writeUInt32LE(trailing.length - 8, 4);
    expect(() => inspectWave(trailing, "run_test")).toThrow();
  });

  it.each(["stop", "length", "missing", "throw"])(
    "publishes only complete AgentHub speech streams (%s)",
    async (finish) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-speech-test-"));
      try {
        await fs.copyFile(
          new URL(
            "../../../plugins/agent-development/skills/unified-llm-api/scripts/generate-speech.mjs",
            import.meta.url,
          ),
          path.join(root, "generate-speech.mjs"),
        );
        await fs.writeFile(
          path.join(root, "speech-input.json"),
          JSON.stringify({
            model: "gemini-3.1-flash-tts-preview",
            voice: "Kore",
            language: "en-US",
            script: "Hello",
          }),
        );
        const module = path.join(root, "node_modules/@prismshadow/agenthub");
        await fs.mkdir(module, { recursive: true });
        await fs.writeFile(
          path.join(module, "package.json"),
          JSON.stringify({ type: "module", exports: "./index.js" }),
        );
        await fs.writeFile(
          path.join(module, "index.js"),
          `
        export class AutoLLMClient {
          async *streamingResponse() {
            yield { content_items: [{type:"inline_data", mime_type:"audio/pcm;rate=24000", data:Buffer.from([1,2])}] };
            yield { content_items: [{type:"inline_data", mime_type:"audio/pcm;rate=24000", data:Buffer.from([3,4])}] };
            if (${JSON.stringify(finish)} === "throw") throw new Error("secret-test-provider-header");
            if (${JSON.stringify(finish)} !== "missing") yield {content_items:[], finish_reason:${JSON.stringify(finish)}, usage_metadata:{}};
          }
        }`,
        );
        const processResult = spawnSync(process.execPath, ["generate-speech.mjs"], {
          cwd: root,
          env: { ...process.env, GEMINI_API_KEY: "fake-test-only" },
          encoding: "utf8",
          timeout: 10000,
        });
        expect(processResult.stderr).not.toContain("secret-test-provider-header");
        if (finish === "stop") {
          expect(processResult.status, processResult.stderr).toBe(0);
          const bytes = await fs.readFile(path.join(root, "speech.wav"));
          expect(bytes.subarray(44)).toEqual(Buffer.from([1, 2, 3, 4]));
          expect(inspectWave(bytes, "test").bytes).toBe(48);
        } else {
          expect(processResult.status).toBe(1);
          await expect(fs.stat(path.join(root, "speech.wav"))).rejects.toMatchObject({
            code: "ENOENT",
          });
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );
});
