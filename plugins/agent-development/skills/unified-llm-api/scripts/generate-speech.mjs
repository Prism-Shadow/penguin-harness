import fs from "node:fs/promises";
import { AutoLLMClient } from "@prismshadow/agenthub";

// Invoked as an ordinary approved exec_command in the activity's Session workspace.
// Never print upstream error objects: they can contain request headers or credentials.
try {
  const input = JSON.parse(await fs.readFile("speech-input.json", "utf8"));
  if (
    input.model !== "gemini-3.1-flash-tts-preview" ||
    !["Kore", "Puck", "Charon", "Fenrir", "Aoede"].includes(input.voice) ||
    typeof input.script !== "string" ||
    !input.script.trim() ||
    input.script.length > 5000 ||
    !/^[a-z]{2}-[A-Z]{2}$/.test(input.language)
  )
    throw new Error("invalid input");
  if (!process.env.GEMINI_API_KEY) throw new Error("missing credential");
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
      if (size > 20 * 1024 * 1024 - 44) throw new Error("audio too large");
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
  process.stdout.write("Speech candidate written to speech.wav. Listen before accepting.\n");
} catch {
  process.stderr.write(
    "Speech generation failed. Check the Agent Vault GEMINI_API_KEY, provider access, and saved speech settings. No candidate was accepted.\n",
  );
  process.exitCode = 1;
}
