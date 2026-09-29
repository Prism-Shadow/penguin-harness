import { createRequire } from "node:module";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Graph, safetensors, checkpointFile } from "../src/activities/local-audio-onnx.mjs";
import { ddimSchedule, ddimStep, timeEmbedding } from "../src/activities/local-audio-audioldm.mjs";
import {
  positionEmbedding,
  relativeBuckets,
  sampleCode,
} from "../src/activities/local-audio-audiogen.mjs";

const require = createRequire(import.meta.url);
let ort;
try {
  ort = createRequire(require.resolve("@huggingface/transformers"))("onnxruntime-node");
} catch {
  /* Optional runtime. */
}
const roots = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("checkpoint cache", () => {
  it("checks ranged downloads before publication, reuses valid files and repairs corruption", async () => {
    const root = path.dirname((await weights({})).file);
    const data = Buffer.from("checkpoint tensor bytes");
    const digest = createHash("sha256").update(data).digest("hex");
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
      expect(options.headers.Range).toMatch(/^bytes=0-/);
      return new Response(data, {
        status: 206,
        headers: { "content-range": `bytes 0-${data.length - 1}/${data.length}` },
      });
    });
    const args = [
      root,
      "test/model",
      "a".repeat(40),
      "weights.bin",
      digest,
      path.join(root, "scratch"),
    ];
    const file = await checkpointFile(...args);
    expect(await readFile(file)).toEqual(data);
    await checkpointFile(...args);
    expect(fetch).toHaveBeenCalledTimes(1);
    await writeFile(file, "broken");
    await checkpointFile(...args);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await readFile(file)).toEqual(data);
    expect(await readdir(path.join(root, "scratch"))).toEqual([]);
  });
  it("never publishes a truncated or checksum-mismatched download", async () => {
    const root = path.dirname((await weights({})).file);
    const scratch = path.join(root, "scratch");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("short", { status: 206, headers: { "content-range": "bytes 0-9/10" } }),
      );
    const args = [root, "test/model", "b".repeat(40), "weights.bin", "c".repeat(64), scratch];
    await expect(checkpointFile(...args)).rejects.toThrow("Truncated");
    fetch.mockResolvedValue(new Response("wrong"));
    await expect(checkpointFile(...args)).rejects.toThrow("checksum");
    expect(await readdir(scratch)).toEqual([]);
    await expect(
      readFile(path.join(root, "test/model", "b".repeat(40), "weights.bin")),
    ).rejects.toThrow();
  });
});
async function weights(tensors) {
  const root = await mkdtemp(path.join(os.tmpdir(), "penguin-audio-graph-"));
  roots.push(root);
  const header = {};
  const parts = [];
  let offset = 0;
  for (const [name, { shape, data, dtype = "F32" }] of Object.entries(tensors)) {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    header[name] = { dtype, shape, data_offsets: [offset, offset + bytes.length] };
    parts.push(bytes);
    offset += bytes.length;
  }
  const json = Buffer.from(JSON.stringify(header));
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(json.length));
  const file = path.join(root, "weights.safetensors");
  await writeFile(file, Buffer.concat([size, json, ...parts]));
  return safetensors(file);
}
async function run(g, output, dims, feeds) {
  const file = await g.save(output, dims, path.join(path.dirname(g.weights.file), "test.onnx"));
  const session = await ort.InferenceSession.create(file, { executionProviders: ["cpu"] });
  try {
    return (await session.run(feeds)).output;
  } finally {
    await session.release();
  }
}

describe.skipIf(!ort)("native ONNX graph compiler", () => {
  it("reads exact external tensor offsets and promotes half-precision weights on CPU", async () => {
    const checkpoint = await weights({
      "linear.weight": {
        shape: [2, 2],
        dtype: "F16",
        data: new Uint16Array([0x3c00, 0x4000, 0x4200, 0x4400]),
      },
      "linear.bias": { shape: [2], data: new Float32Array([1, -1]) },
    });
    const g = new Graph(checkpoint, [["x", [1, 2]]]);
    const output = await run(g, g.linear("x", "linear"), [1, 2], {
      x: new ort.Tensor("float32", new Float32Array([2, 3]), [1, 2]),
    });
    expect([...output.data]).toEqual([9, 17]);
  });
  it("normalizes each spatial group independently before the learned affine transform", async () => {
    const checkpoint = await weights({
      "norm.weight": { shape: [32], data: new Float32Array(32).fill(2) },
      "norm.bias": { shape: [32], data: new Float32Array(32).fill(3) },
    });
    const data = Float32Array.from({ length: 64 }, (_, i) => i);
    const g = new Graph(checkpoint, [["x", [1, 32, 1, 2]]]);
    const output = await run(g, g.groupNorm("x", "norm"), [1, 32, 1, 2], {
      x: new ort.Tensor("float32", data, [1, 32, 1, 2]),
    });
    for (let i = 0; i < 64; i++) expect(output.data[i]).toBeCloseTo(i % 2 ? 5 : 1, 3);
  });
  it("computes attention with the requested head scaling and value ordering", async () => {
    const g = new Graph(await weights({}), []);
    const output = await run(
      g,
      g.attention(
        g.constant([1], [1, 1, 1]),
        g.constant([0, Math.log(3)], [1, 2, 1]),
        g.constant([0, 4], [1, 2, 1]),
        1,
        1,
      ),
      [1, 1, 1],
      {},
    );
    expect(output.data[0]).toBeCloseTo(3, 5);
  });
});

describe("exact-model sampling", () => {
  it("uses AudioLDM v1's offset DDIM schedule and classifier-free guidance", () => {
    const schedule = ddimSchedule();
    expect(schedule.map((s) => s.timestep)).toEqual(
      Array.from({ length: 25 }, (_, i) => 961 - i * 40),
    );
    const sample = new Float32Array([2]);
    ddimStep(sample, new Float32Array([1, 3]), { alpha: 0.25, previous: 1 }, 2.5);
    expect(sample[0]).toBeCloseTo((2 - Math.sqrt(0.75) * 6) / 0.5, 5);
    expect([...timeEmbedding(0).slice(0, 64)]).toEqual(Array(64).fill(1));
    expect([...timeEmbedding(0).slice(64, 128)]).toEqual(Array(64).fill(0));
  });
  it("preserves AudioGen's sinusoidal positions and bidirectional T5 buckets", () => {
    const position = positionEmbedding(1);
    expect(position[0]).toBeCloseTo(Math.cos(1));
    expect(position[767]).toBeCloseTo(Math.cos(0.0001));
    expect(position[768]).toBeCloseTo(Math.sin(1));
    expect([...relativeBuckets(3)]).toEqual([0, 17, 18, 1, 0, 17, 2, 1, 0]);
    expect(relativeBuckets(130)[129]).toBe(31);
  });
  it("applies guidance before sampling and samples only the top 250 codebook entries", () => {
    const logits = new Float32Array(8 * 2048);
    logits[5] = 10; // Unconditional preference must be subtracted by CFG.
    logits[4 * 2048 + 9] = 10;
    expect(sampleCode(logits, 0, () => 0)).toBe(9);
    const equal = new Float32Array(8 * 2048);
    expect(sampleCode(equal, 0, () => 0.999999)).toBe(249);
  });
  it("rejects a truncated checkpoint before constructing a native graph", async () => {
    const checkpoint = await weights({ x: { shape: [2], data: new Float32Array([1, 2]) } });
    await writeFile(checkpoint.file, Buffer.alloc(8, 255));
    await expect(safetensors(checkpoint.file)).rejects.toThrow("Invalid tensor header");
  });
});
