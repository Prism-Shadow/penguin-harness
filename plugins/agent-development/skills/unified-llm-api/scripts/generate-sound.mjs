import fs from "node:fs/promises";

// Invoked as an ordinary approved exec_command in the activity's Session workspace.
// Makes one music or sound-effect clip from sound-input.json and writes sound.mp3.
// Never print upstream responses or error objects: they can contain request headers or
// credentials.

const ELEVENLABS = "https://api.elevenlabs.io/v1";
const MAX_BYTES = 20 * 1024 * 1024;

// The stored length may be 1 to 60 s for either kind; each ElevenLabs endpoint accepts a
// narrower range, so the request asks for the nearest length that endpoint can make.
const SFX_MAX_MS = 30_000;
const MUSIC_MIN_MS = 3_000;

class Refused extends Error {}
class Rejected extends Error {}

function validInput(input) {
  return (
    input &&
    input.provider === "elevenlabs" &&
    ((input.kind === "music" && input.model === "music_v1") ||
      (input.kind === "sfx" && input.model === "sound-generation")) &&
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

try {
  const input = JSON.parse(await fs.readFile("sound-input.json", "utf8"));
  if (!validInput(input)) throw new Error("invalid input");
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
  await fs.writeFile("sound.mp3", bytes, { flag: "wx" });
  process.stdout.write("Sound candidate written to sound.mp3. Listen before accepting.\n");
} catch (error) {
  process.stderr.write(
    error instanceof Refused
      ? "provider refused: plan or key\n"
      : error instanceof Rejected
        ? `Sound generation failed: the provider rejected the request (HTTP ${error.message}). Check the prompt and the length. No candidate was accepted.\n`
        : "Sound generation failed. Check the Agent Vault ELEVENLABS_API_KEY, provider access, and the saved prompt. No candidate was accepted.\n",
  );
  process.exitCode = 1;
}
