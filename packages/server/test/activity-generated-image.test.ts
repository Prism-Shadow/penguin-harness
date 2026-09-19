import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { GENERATED_IMAGE_MAX_BYTES, inspectPng } from "../src/activities/generated-image.js";
import { imagePng } from "./image-fixtures.js";

const runId = "run_0123456789abcdef0123456789abcdef";

function chunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return result;
}

describe("generated image PNG validator", () => {
  it("returns bounded dimensions and provenance for a complete PNG", () => {
    const result = inspectPng(imagePng(2, 3), runId);
    expect(result).toMatchObject({
      runId,
      bytes: imagePng(2, 3).length,
      width: 2,
      height: 3,
      mimeType: "image/png",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it.each([
    ["truncated", () => imagePng().subarray(0, -1)],
    [
      "bad CRC",
      () => {
        const bytes = imagePng();
        bytes[bytes.length - 1]! ^= 0xff;
        return bytes;
      },
    ],
    ["oversized", () => Buffer.concat([imagePng(), Buffer.alloc(GENERATED_IMAGE_MAX_BYTES)])],
    ["missing IEND", () => imagePng().subarray(0, -12)],
    [
      "APNG animation chunk",
      () => {
        const bytes = imagePng();
        return Buffer.concat([
          bytes.subarray(0, 33),
          chunk("acTL", Buffer.alloc(8)),
          bytes.subarray(33),
        ]);
      },
    ],
  ])("rejects %s output", (_label, makeBytes) => {
    expect(() => inspectPng(makeBytes(), runId)).toThrow();
  });
});
