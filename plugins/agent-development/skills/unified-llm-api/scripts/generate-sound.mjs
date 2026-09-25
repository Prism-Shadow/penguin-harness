import fs from "node:fs/promises";

// Invoked as an ordinary approved exec_command in the activity's Session workspace.
// Makes one music or sound-effect clip from sound-input.json and writes sound.mp3, or
// sound.wav when a model reached through agenthub returns WAV or raw PCM.
// Never print upstream responses or error objects: they can contain request headers or
// credentials.

const ELEVENLABS = "https://api.elevenlabs.io/v1";
const MAX_BYTES = 20 * 1024 * 1024;

// The stored length may be 1 to 60 s for either kind; each ElevenLabs endpoint accepts a
// narrower range, so the request asks for the nearest length that endpoint can make.
const SFX_MAX_MS = 30_000;
const MUSIC_MIN_MS = 3_000;

// A WAV this helper writes from raw PCM is what the server accepts: mono 16-bit at 24 kHz.
const PCM_RATE = 24000;

class Refused extends Error {}
class Rejected extends Error {}

function validModel(input) {
  if (input.provider === "elevenlabs")
    return (
      (input.kind === "music" && input.model === "music_v1") ||
      (input.kind === "sfx" && input.model === "sound-generation")
    );
  return (
    input.provider === "agenthub" &&
    (input.kind === "music" || input.kind === "sfx") &&
    typeof input.model === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(input.model) &&
    typeof input.credential === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(input.credential) &&
    (input.format === "wav" || input.format === "mp3")
  );
}

function validInput(input) {
  return (
    input &&
    validModel(input) &&
    typeof input.prompt === "string" &&
    input.prompt.trim().length > 0 &&
    input.prompt.length <= 2000 &&
    (input.targetDurationMs === undefined ||
      (Number.isSafeInteger(input.targetDurationMs) &&
        input.targetDurationMs >= 1000 &&
        input.targetDurationMs <= 60000))
  );
}

function request(input) {
  if (input.kind === "music")
    return {
      url: `${ELEVENLABS}/music?output_format=mp3_44100_128`,
      body: {
        prompt: input.prompt.trim(),
        model_id: "music_v1",
        ...(input.targetDurationMs !== undefined
          ? { music_length_ms: Math.max(input.targetDurationMs, MUSIC_MIN_MS) }
          : {}),
      },
    };
  return {
    url: `${ELEVENLABS}/sound-generation?output_format=mp3_44100_128`,
    body: {
      text: input.prompt.trim(),
      ...(input.targetDurationMs !== undefined
        ? { duration_seconds: Math.min(input.targetDurationMs, SFX_MAX_MS) / 1000 }
        : {}),
    },
  };
}

async function fromElevenlabs(input) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("missing credential");
  const { url, body } = request(input);
  const response = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status === 401 || response.status === 403) throw new Refused();
  if (response.status >= 400 && response.status < 500) throw new Rejected(String(response.status));
  if (!response.ok) throw new Error("provider failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("unexpected audio size");
  return { file: "sound.mp3", bytes };
}

/** What one inline audio item is, by its declared type; anything else is refused. */
function audioClass(mime) {
  if (/^audio\/(mpeg|mp3)(;|$)/i.test(mime)) return "mp3";
  if (/^audio\/(wav|wave|x-wav|vnd\.wave)(;|$)/i.test(mime)) return "wav";
  if (/^audio\/(pcm|L16)(;|$)/i.test(mime)) {
    const rate = /;\s*rate=(\d+)/i.exec(mime);
    const channels = /;\s*channels=(\d+)/i.exec(mime);
    if ((rate && Number(rate[1]) !== PCM_RATE) || (channels && Number(channels[1]) !== 1))
      throw new Error("unexpected audio format");
    return "pcm";
  }
  throw new Error("unexpected audio format");
}

function waveHeader(size) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(size + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(PCM_RATE, 24);
  header.writeUInt32LE(PCM_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(size, 40);
  return header;
}

// One streamed request to a model reached through agenthub. Its inline audio items are
// joined: MP3 frames as they came, raw PCM behind a WAV header, and a WAV only when it is the
// one item. agenthub is loaded only here, so the ElevenLabs branch needs nothing installed.
async function fromAgenthub(input) {
  if (!process.env[input.credential]) throw new Error("missing credential");
  const { AutoLLMClient } = await import("@prismshadow/agenthub");
  const client = new AutoLLMClient({ model: input.model });
  const what = input.kind === "music" ? "a piece of music" : "a sound effect";
  const length =
    input.targetDurationMs !== undefined
      ? ` about ${input.targetDurationMs / 1000} seconds long`
      : "";
  const chunks = [];
  let kind = null;
  let size = 0;
  let completed = false;
  for await (const event of client.streamingResponse({
    messages: [
      {
        role: "user",
        content_items: [
          {
            type: "text",
            text: `Make ${what}${length}, and nothing else:\n${input.prompt.trim()}`,
          },
        ],
      },
    ],
  })) {
    completed = event.finish_reason === "stop" && event.usage_metadata != null;
    for (const item of event.content_items ?? []) {
      if (item.type !== "inline_data") continue;
      const found = audioClass(String(item.mime_type ?? ""));
      if (kind && kind !== found) throw new Error("mixed audio formats");
      if (kind === "wav") throw new Error("more than one WAV");
      kind = found;
      const chunk = Buffer.from(item.data);
      size += chunk.length;
      if (size > MAX_BYTES - 44) throw new Error("audio too large");
      chunks.push(chunk);
    }
  }
  if (!completed || !size || !kind || (kind === "pcm" && size % 2))
    throw new Error("incomplete sound output");
  // The model's catalogued format is the one the server collects; any other is refused.
  if ((kind === "mp3" ? "mp3" : "wav") !== input.format) throw new Error("unexpected audio format");
  if (kind === "pcm")
    return { file: "sound.wav", bytes: Buffer.concat([waveHeader(size), ...chunks]) };
  return { file: kind === "mp3" ? "sound.mp3" : "sound.wav", bytes: Buffer.concat(chunks) };
}

// The key a failure names: ElevenLabs' unless the input asks for a model hub provider's.
let credential = "ELEVENLABS_API_KEY";
try {
  const input = JSON.parse(await fs.readFile("sound-input.json", "utf8"));
  if (!validInput(input)) throw new Error("invalid input");
  if (input.provider === "agenthub") credential = input.credential;
  const { file, bytes } =
    input.provider === "agenthub" ? await fromAgenthub(input) : await fromElevenlabs(input);
  await fs.writeFile(file, bytes, { flag: "wx" });
  process.stdout.write(`Sound candidate written to ${file}. Listen before accepting.\n`);
} catch (error) {
  process.stderr.write(
    error instanceof Refused
      ? "provider refused: plan or key\n"
      : error instanceof Rejected
        ? `Sound generation failed: the provider rejected the request (HTTP ${error.message}). Check the prompt and the length. No candidate was accepted.\n`
        : `Sound generation failed. Check the Agent Vault ${credential}, provider access, and the saved prompt. No candidate was accepted.\n`,
  );
  process.exitCode = 1;
}
