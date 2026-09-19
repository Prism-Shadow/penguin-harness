import { createHash } from "node:crypto";
import { contentRevision, type ActivityDetail } from "./domain.js";
import { HttpError } from "../http/errors.js";

export interface AudioTarget {
  language: string;
  assetKey: string;
  script: string;
  voice: string;
  model: string;
}
export interface AudioResult {
  runId: string;
  sha256: string;
  bytes: number;
  durationMs: number;
  mimeType: "audio/wav";
}
export const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
export const SPEECH_MODEL = "gemini-3.1-flash-tts-preview";
export const SPEECH_VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Aoede"] as const;

export function audioTarget(
  activity: ActivityDetail,
  input: { language: string; assetKey: string; voice: string },
): AudioTarget {
  const plan = activity.draft.mediaPlan;
  if (
    activity.draft.status !== "valid" ||
    !plan ||
    plan.specRevision !== contentRevision(activity.draft.spec)
  )
    throw new HttpError(409, "media_stale", "Rebuild the media plan before generating speech.");
  const asset = plan.manifest.assets[input.language]?.find((item) => item.key === input.assetKey);
  if (!asset || asset.type !== "audio" || !asset.script?.trim() || asset.script.length > 5000)
    throw new HttpError(
      422,
      "audio_invalid",
      "Select an audio asset with a saved script of 1–5000 characters.",
    );
  if (!(SPEECH_VOICES as readonly string[]).includes(input.voice))
    throw new HttpError(422, "audio_invalid", "Select a supported speech voice.");
  return {
    language: input.language,
    assetKey: input.assetKey,
    script: asset.script,
    voice: input.voice,
    model: SPEECH_MODEL,
  };
}

/** Accept one uncompressed mono speech format; never trust a model's filename or MIME label. */
export function inspectWave(bytes: Uint8Array, runId: string): AudioResult {
  const data = Buffer.from(bytes);
  if (
    data.length < 46 ||
    data.length > AUDIO_MAX_BYTES ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WAVE" ||
    data.readUInt32LE(4) !== data.length - 8
  )
    throw new Error("Audio output must be a bounded PCM WAV file.");
  let format = false;
  let samples = 0;
  let offset = 12;
  for (; offset + 8 <= data.length;) {
    const size = data.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > data.length) throw new Error("Truncated WAV output.");
    const kind = data.toString("ascii", offset, offset + 4);
    if (kind === "fmt ") {
      if (
        format ||
        size < 16 ||
        data.readUInt16LE(offset + 8) !== 1 ||
        data.readUInt16LE(offset + 10) !== 1 ||
        data.readUInt32LE(offset + 12) !== 24000 ||
        data.readUInt32LE(offset + 16) !== 48000 ||
        data.readUInt16LE(offset + 20) !== 2 ||
        data.readUInt16LE(offset + 22) !== 16
      )
        throw new Error("Speech WAV must be mono 24 kHz, 16-bit PCM.");
      format = true;
    }
    if (kind === "data") {
      if (samples || size < 2 || size % 2) throw new Error("Invalid WAV samples.");
      samples = size;
    }
    offset = end + (size % 2);
    if (offset > data.length) throw new Error("Truncated WAV padding.");
  }
  if (offset !== data.length || !format || !samples)
    throw new Error("Speech WAV is missing its format or samples.");
  return {
    runId,
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.length,
    durationMs: samples / 48,
    mimeType: "audio/wav",
  };
}

export const audioPrompt = `Generate the single speech candidate specified in speech-input.json.
The supplied generate-speech.mjs helper calls the configured speech provider through AgentHub and reads GEMINI_API_KEY only from the Agent Vault-injected process environment.
Use normal Harness exec_command approval for npm install --ignore-scripts and node generate-speech.mjs. Do not print credentials or read them into your context. Do not edit the supplied helper, package.json or input files. Do not delegate or write outside this workspace.
Run the helper once. It writes speech.wav. Never synthesize fake tones or substitute another provider, model, voice or script. If credentials, installation or the provider fail, report the failure and stop; do not retry a billable provider request automatically.
Finish only after the helper succeeds. The user will listen and explicitly accept the candidate; do not edit activity drafts or replace accepted media.`;
