import fs from "node:fs/promises";
import { Buffer } from "node:buffer";
import { crc32 } from "node:zlib";
import { AutoLLMClient } from "@prismshadow/agenthub";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MODEL = "gemini-3.1-flash-image";

function decodeInlineData(data) {
  if (Buffer.isBuffer(data)) return Buffer.from(data);
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === "string") return Buffer.from(data, "base64");
  throw new Error("invalid image data");
}

function validatePng(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(signature)) throw new Error("invalid png");
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR")
    throw new Error("invalid png");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION)
    throw new Error("invalid dimensions");
  const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!depths[bytes[25]]?.includes(bytes[24]) || bytes[26] || bytes[27] || bytes[28] > 1)
    throw new Error("invalid png header");
  let offset = 8;
  let data = false;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const end = offset + size + 12;
    if (
      end > bytes.length ||
      crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
    )
      throw new Error("invalid png chunk");
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    if ((kind === "IHDR" && offset !== 8) || kind === "acTL") throw new Error("invalid png chunk");
    if (kind === "IDAT" && size) data = true;
    if (kind === "IEND") {
      if (size || !data || end !== bytes.length) throw new Error("invalid png end");
      ended = true;
    }
    offset = end;
  }
  if (!ended || offset !== bytes.length) throw new Error("incomplete png");
  return { width, height };
}

try {
  const input = JSON.parse(await fs.readFile("image-input.json", "utf8"));
  if (
    input.model !== MODEL ||
    typeof input.prompt !== "string" ||
    !input.prompt.trim() ||
    input.prompt.length > 5000 ||
    !/^[a-z]{2}-[A-Z]{2}$/.test(input.language) ||
    typeof input.assetKey !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(input.assetKey)
  )
    throw new Error("invalid input");
  if (!process.env.GEMINI_API_KEY) throw new Error("missing credential");
  // Do not spend another provider request on a workspace that already has output.
  const existing = await fs.lstat("image.png").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (existing) throw new Error("output exists");

  const client = new AutoLLMClient({ model: MODEL });
  const images = [];
  let completed = false;
  for await (const event of client.streamingResponse({
    messages: [
      {
        role: "user",
        content_items: [
          {
            type: "text",
            text: `Create the image for ${input.assetKey} in ${input.language}:
${input.prompt}`,
          },
        ],
      },
    ],
    config: { image_config: { aspect_ratio: "1:1", image_size: "1K" } },
  })) {
    completed = event.finish_reason === "stop" && event.usage_metadata != null;
    for (const item of event.content_items ?? []) {
      if (item.type !== "inline_data") continue;
      if (!/^image\/png(?:;|$)/i.test(item.mime_type ?? ""))
        throw new Error("unexpected image format");
      images.push(decodeInlineData(item.data));
      if (images.length > 1) throw new Error("multiple images");
      if (images[0].length > MAX_BYTES) throw new Error("image too large");
    }
  }
  if (!completed || images.length !== 1) throw new Error("incomplete image output");
  validatePng(images[0]);
  await fs.writeFile("image.png", images[0], { flag: "wx" });
  process.stdout.write("Image candidate written to image.png. Inspect before accepting.\n");
} catch {
  process.stderr.write(
    "Image generation failed. Check the Agent Vault GEMINI_API_KEY, provider access, and saved image settings. No candidate was accepted.\n",
  );
  process.exitCode = 1;
}
