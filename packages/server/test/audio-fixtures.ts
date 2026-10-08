import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  MediaHelperResult,
  MediaHelperRun,
  MediaHelperPorts,
} from "../src/activities/media-helper-runner.js";

export function speechWave(samples = 48): Buffer {
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}

/**
 * A structurally valid MP3: an optional empty ID3v2 tag, then MPEG-1 Layer III frames at
 * 128 kbps and 44.1 kHz (417 bytes each, silent). Each frame lasts 1152 / 44100 s.
 */
export function soundMp3(frames = 20, id3 = true): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  const tag = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([...(id3 ? [tag] : []), ...Array.from({ length: frames }, () => frame)]);
}

/**
 * WAV to MP3 as a test's AudioEncodePorts does it, without ffmpeg: a valid MP3 (see
 * soundMp3) whose ID3 tag carries the WAV's digest, so different speech gives different MP3s
 * and the same speech the same one.
 */
export function mp3OfWave(wav: Uint8Array, frames = 5): Buffer {
  const digest = createHash("sha256").update(wav).digest();
  const tag = Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, digest.length]),
    digest,
  ]);
  return Buffer.concat([tag, soundMp3(frames, false)]);
}

/**
 * Options for createTestApp that convert speech with mp3OfWave instead of ffmpeg, refusing
 * bytes that are not a WAV as ffmpeg would.
 */
export const fakeMp3Encoding = {
  audioEncodePorts: {
    wavToMp3: async (wav: Uint8Array) => {
      const bytes = Buffer.from(wav);
      if (bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WAVE")
        throw new Error("Converting the speech to MP3 failed: not a WAV file.");
      return mp3OfWave(bytes);
    },
  },
};

/**
 * Stands in for the speech or sound helper the server runs: records each call, holds it until the test
 * says what the helper wrote, and never starts a process or reaches a provider.
 */
export function fakeMediaHelper() {
  const calls: MediaHelperRun[] = [];
  let pending: { run: MediaHelperRun; resolve: (result: MediaHelperResult) => void } | null = null;
  const ports: MediaHelperPorts = {
    runHelper: (run) => {
      calls.push(run);
      return new Promise((resolve) => {
        pending = { run, resolve };
        run.signal.addEventListener(
          "abort",
          () => resolve({ ok: false, error: "Generation cancelled." }),
          { once: true },
        );
      });
    },
  };
  return {
    ports,
    calls,
    /** The workspace of the call waiting to be finished, if it belongs to `runId`. */
    waiting: (runId: string) =>
      pending && path.basename(pending.run.workspace) === runId ? pending.run.workspace : null,
    /** Writes `files` as the helper would, then ends the waiting call with `result`. */
    async finish(files: Record<string, Buffer | string>, result: MediaHelperResult = { ok: true }) {
      const current = pending;
      if (!current) throw new Error("No speech helper call is waiting.");
      pending = null;
      for (const [name, bytes] of Object.entries(files))
        await fs.writeFile(path.join(current.run.workspace, name), bytes);
      current.resolve(result);
    },
  };
}
