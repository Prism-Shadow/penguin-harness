import fs from "node:fs/promises";

// Invoked as an ordinary approved exec_command in the activity's Session workspace.
// Speaks one narration from speech-input.json: Gemini through agenthub writes speech.wav;
// ElevenLabs, called with Node's own fetch, writes speech.mp3 and the words' timings in
// speech-timings.json.
// Never print upstream responses or error objects: they can contain request headers or
// credentials.

const MAX_BYTES = 20 * 1024 * 1024;

// Gemini voices only; ElevenLabs voices are ids.
const GEMINI_VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Aoede"];
const ELEVENLABS_MODELS = ["eleven_v3", "eleven_multilingual_v2"];
// Stands for the agent's Vault ELEVENLABS_VOICE_ID, read here from the environment.
const ELEVENLABS_DEFAULT_VOICE = "elevenlabs-default";
const VOICE_ID = /^[A-Za-z0-9]{10,40}$/;

class Refused extends Error {}

function validScript(input) {
  return (
    typeof input.script === "string" &&
    input.script.trim().length > 0 &&
    input.script.length <= 5000 &&
    /^[a-z]{2}-[A-Z]{2}$/.test(input.language)
  );
}

async function speakWithGemini(input) {
  if (
    input.model !== "gemini-3.1-flash-tts-preview" ||
    !GEMINI_VOICES.includes(input.voice) ||
    !validScript(input)
  )
    throw new Error("invalid input");
  if (!process.env.GEMINI_API_KEY) throw new Error("missing credential");
  const { AutoLLMClient } = await import("@prismshadow/agenthub");
  const client = new AutoLLMClient({ model: input.model });
  const chunks = [];
  let size = 0;
  let completed = false;
  for await (const event of client.streamingResponse({
    messages: [
      {
        role: "user",
        content_items: [
          {
            type: "text",
            text: `Read this script aloud in ${input.language}, without adding words:\n${input.script}`,
          },
        ],
      },
    ],
    config: { tts_config: [{ voice: input.voice }] },
  })) {
    completed = event.finish_reason === "stop" && event.usage_metadata != null;
    for (const item of event.content_items ?? []) {
      if (item.type !== "inline_data") continue;
      if (!/^audio\/(pcm|L16)(;|$)/i.test(item.mime_type))
        throw new Error("unexpected audio format");
      const chunk = Buffer.from(item.data);
      size += chunk.length;
      if (size > MAX_BYTES - 44) throw new Error("audio too large");
      chunks.push(chunk);
    }
  }
  if (!completed || !size || size % 2) throw new Error("incomplete speech output");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(size + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(size, 40);
  await fs.writeFile("speech.wav", Buffer.concat([header, ...chunks]), { flag: "wx" });
  return "speech.wav";
}

const WORD_CHARACTER = /[\p{L}\p{N}'-]/u;

/**
 * Per-character times into one timing per spoken word, as the server counts words: bracketed
 * audio tags ([pause], [very slowly]) are never said and are skipped, tokens split at
 * whitespace, and a token's word is its letters, digits, apostrophes and hyphens. A word runs
 * from its first such character's start to its last one's end, in whole milliseconds, never
 * before the previous word ended.
 */
function wordTimings(alignment) {
  const characters = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (
    !Array.isArray(characters) ||
    !Array.isArray(starts) ||
    !Array.isArray(ends) ||
    starts.length !== characters.length ||
    ends.length !== characters.length ||
    characters.some((value) => typeof value !== "string") ||
    [...starts, ...ends].some((value) => typeof value !== "number" || !Number.isFinite(value))
  )
    throw new Error("invalid alignment");
  // A tag's characters count as whitespace; a "[" with no "]" before the line ends is text.
  const spoken = [...characters];
  for (let index = 0; index < spoken.length; index += 1) {
    if (spoken[index] !== "[") continue;
    let end = index + 1;
    while (end < spoken.length && spoken[end] !== "]" && spoken[end] !== "\n") end += 1;
    if (spoken[end] !== "]") continue;
    for (let at = index; at <= end; at += 1) spoken[at] = " ";
    index = end;
  }
  const words = [];
  let previousEnd = 0;
  let token = [];
  const close = () => {
    const kept = token.filter((index) => WORD_CHARACTER.test(spoken[index]));
    token = [];
    if (!kept.length) return;
    const word = kept.map((index) => spoken[index]).join("");
    const startMs = Math.max(Math.round(starts[kept[0]] * 1000), previousEnd);
    const endMs = Math.max(Math.round(ends[kept[kept.length - 1]] * 1000), startMs + 1);
    words.push({ word, startMs, endMs });
    previousEnd = endMs;
  };
  spoken.forEach((character, index) => {
    if (/^\s*$/u.test(character)) close();
    else token.push(index);
  });
  close();
  return words;
}

async function speakWithElevenlabs(input) {
  if (!ELEVENLABS_MODELS.includes(input.model) || !validScript(input))
    throw new Error("invalid input");
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("missing credential");
  const voice =
    input.voice === ELEVENLABS_DEFAULT_VOICE ? process.env.ELEVENLABS_VOICE_ID : input.voice;
  if (!VOICE_ID.test(voice ?? "")) throw new Error("invalid voice");
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text: input.script, model_id: input.model }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (response.status === 401 || response.status === 403) throw new Refused();
  if (!response.ok) throw new Error("provider failed");
  const body = await response.json();
  if (typeof body?.audio_base64 !== "string") throw new Error("no audio");
  const bytes = Buffer.from(body.audio_base64, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("unexpected audio size");
  const timings = wordTimings(body.alignment);
  await fs.writeFile("speech.mp3", bytes, { flag: "wx" });
  await fs.writeFile("speech-timings.json", JSON.stringify(timings), { flag: "wx" });
  return "speech.mp3";
}

// The keys a failure names: Gemini's unless the input asks for ElevenLabs.
let credential = "GEMINI_API_KEY";
try {
  const input = JSON.parse(await fs.readFile("speech-input.json", "utf8"));
  if (!input || typeof input !== "object") throw new Error("invalid input");
  if (input.provider === "elevenlabs") credential = "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID";
  else if (input.provider !== undefined && input.provider !== "gemini")
    throw new Error("invalid input");
  const file =
    input.provider === "elevenlabs"
      ? await speakWithElevenlabs(input)
      : await speakWithGemini(input);
  process.stdout.write(`Speech candidate written to ${file}. Listen before accepting.\n`);
} catch (error) {
  process.stderr.write(
    error instanceof Refused
      ? "provider refused: plan or key\n"
      : `Speech generation failed. Check the Agent Vault ${credential}, provider access, and saved speech settings. No candidate was accepted.\n`,
  );
  process.exitCode = 1;
}
