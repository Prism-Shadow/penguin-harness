import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Only immutable public checkpoint files are downloaded. A terminated worker may leave
// a .part file, but it can never make a partial model visible to the next inference.
export async function checkpointFile(root, repository, revision, file, sha256, downloadDir) {
  if (!/^[a-f0-9]{40}$/.test(revision) || file.split("/").includes(".."))
    throw new Error("Invalid checkpoint identity.");
  const target = path.join(root, repository, revision, file);
  async function valid() {
    try {
      if (!sha256) return (await stat(target)).size > 0;
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(target)) hash.update(chunk);
      return hash.digest("hex") === sha256;
    } catch {
      return false;
    }
  }
  if (await valid()) return target;
  await mkdir(path.dirname(target), { recursive: true });
  if (downloadDir) await mkdir(downloadDir, { recursive: true });
  const temporary = downloadDir
    ? path.join(downloadDir, `${randomUUID()}.part`)
    : `${target}.${randomUUID()}.part`;
  try {
    const url = `https://huggingface.co/${repository}/resolve/${revision}/${file}`;
    const hash = createHash("sha256");
    let bytes = 0;
    async function* checked(source) {
      for await (const chunk of source) {
        bytes += chunk.length;
        if (bytes > 8 * 1024 ** 3) throw new Error("Checkpoint is too large.");
        hash.update(chunk);
        yield chunk;
      }
    }
    // Bounded HTTP ranges also work through proxies that buffer full responses.
    // A multi-gigabyte checkpoint must not require a multi-gigabyte response buffer.
    const chunkSize = 64 * 1024 * 1024;
    let total;
    do {
      const start = bytes;
      const response = await fetch(url, {
        headers: { Range: `bytes=${start}-${start + chunkSize - 1}` },
        signal: AbortSignal.timeout(5 * 60_000),
      });
      if (!response.ok || !response.body) throw new Error("Checkpoint download failed.");
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
      if (response.status === 206) {
        if (
          !range ||
          Number(range[1]) !== start ||
          (total !== undefined && Number(range[3]) !== total)
        )
          throw new Error("Invalid checkpoint download range.");
        total = Number(range[3]);
        if (total > 8 * 1024 ** 3) throw new Error("Checkpoint is too large.");
      } else if (start !== 0) {
        throw new Error("Checkpoint download did not resume.");
      }
      await pipeline(
        Readable.fromWeb(response.body),
        checked,
        createWriteStream(temporary, { flags: start ? "a" : "wx" }),
      );
      if (range && bytes !== Number(range[2]) + 1)
        throw new Error("Truncated checkpoint download.");
      if (!range) break;
    } while (bytes < total);
    if (!bytes || (sha256 && hash.digest("hex") !== sha256))
      throw new Error("Checkpoint checksum mismatch.");
    await rename(temporary, target);
    return target;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function safetensors(file) {
  const handle = await open(file, "r");
  try {
    const prefix = Buffer.alloc(8);
    await handle.read(prefix, 0, 8, 0);
    const size = Number(prefix.readBigUInt64LE());
    if (!Number.isSafeInteger(size) || size < 2 || size > 16 * 1024 * 1024)
      throw new Error("Invalid tensor header.");
    const header = Buffer.alloc(size);
    await handle.read(header, 0, size, 8);
    const tensors = JSON.parse(header.toString("utf8"));
    const length = (await handle.stat()).size;
    for (const [name, tensor] of Object.entries(tensors)) {
      if (name === "__metadata__") continue;
      const [start, end] = tensor.data_offsets;
      if (
        !["F32", "F16", "I64"].includes(tensor.dtype) ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        end + size + 8 > length ||
        tensor.shape.reduce((a, b) => a * b, 1) * { F32: 4, F16: 2, I64: 8 }[tensor.dtype] !==
          end - start
      )
        throw new Error("Invalid checkpoint tensor.");
    }
    return { file, offset: size + 8, tensors };
  } finally {
    await handle.close();
  }
}

// Small protobuf writer for the ONNX messages used by these fixed graphs. Weights
// remain in the original safetensors file; ONNX references their byte ranges.
const cat = (parts) => Buffer.concat(parts);
function integer(value) {
  let n = BigInt.asUintN(64, BigInt(value));
  const bytes = [];
  do {
    bytes.push(Number(n & 127n) | (n > 127n ? 128 : 0));
    n >>= 7n;
  } while (n);
  return Buffer.from(bytes);
}
const vi = (field, value) => cat([integer(field * 8), integer(value)]);
const blob = (field, value) => {
  const bytes = typeof value === "string" ? Buffer.from(value) : value;
  return cat([integer(field * 8 + 2), integer(bytes.length), bytes]);
};
const float = (field, value) => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(value);
  return cat([integer(field * 8 + 5), b]);
};
function attribute(name, value) {
  let body;
  if (Array.isArray(value)) body = cat([vi(20, 7), ...value.map((n) => vi(8, n))]);
  else if (typeof value === "string") body = cat([vi(20, 3), blob(4, value)]);
  else if (Number.isInteger(value) && !["epsilon", "alpha", "beta", "value"].includes(name))
    body = cat([vi(20, 2), vi(3, value)]);
  else body = cat([vi(20, 1), float(2, value)]);
  return cat([blob(1, name), body]);
}
function valueInfo(name, shape, type = 1) {
  const dimensions = shape.map((n) => blob(1, typeof n === "string" ? blob(2, n) : vi(1, n)));
  return cat([blob(1, name), blob(2, blob(1, cat([vi(1, type), blob(2, cat(dimensions))])))]);
}
export class Graph {
  constructor(weights, inputs) {
    this.weights = weights;
    this.inputs = inputs;
    this.nodes = [];
    this.initializers = new Map();
    this.casts = new Map();
    this.outputs = [];
    this.next = 0;
  }
  op(type, inputs, attrs = {}) {
    const name = `n${this.next++}`;
    this.nodes.push(
      cat([
        ...inputs.map((s) => blob(1, s)),
        blob(2, name),
        blob(3, name),
        blob(4, type),
        ...Object.entries(attrs).map(([k, v]) => blob(5, attribute(k, v))),
      ]),
    );
    return name;
  }
  constant(values, shape = [values.length], type = 1) {
    const name = `c${this.next++}`;
    const data = type === 7 ? new BigInt64Array(values.map(BigInt)) : new Float32Array(values);
    this.initializers.set(
      name,
      cat([
        ...shape.map((d) => vi(1, d)),
        vi(2, type),
        blob(8, name),
        blob(9, Buffer.from(data.buffer)),
      ]),
    );
    return name;
  }
  scalar(n) {
    return this.constant([n], []);
  }
  weight(name) {
    if (!this.initializers.has(name)) {
      const tensor = this.weights.tensors[name];
      if (!tensor) throw new Error(`Checkpoint tensor missing: ${name}`);
      const entries = {
        location: path.basename(this.weights.file),
        offset: String(this.weights.offset + tensor.data_offsets[0]),
        length: String(tensor.data_offsets[1] - tensor.data_offsets[0]),
      };
      this.initializers.set(
        name,
        cat([
          ...tensor.shape.map((d) => vi(1, d)),
          vi(2, { F32: 1, F16: 10, I64: 7 }[tensor.dtype]),
          blob(8, name),
          ...Object.entries(entries).map(([k, v]) => blob(13, cat([blob(1, k), blob(2, v)]))),
          vi(14, 1),
        ]),
      );
      if (tensor.dtype === "F16") this.casts.set(name, this.op("Cast", [name], { to: 1 }));
    }
    return this.casts.get(name) ?? name;
  }
  shape(name) {
    return this.weights.tensors[name].shape;
  }
  reshape(x, shape) {
    return this.op("Reshape", [x, this.constant(shape, [shape.length], 7)]);
  }
  transpose(x, perm) {
    return this.op("Transpose", [x], { perm });
  }
  add(a, b) {
    return this.op("Add", [a, b]);
  }
  mul(a, b) {
    return this.op("Mul", [a, b]);
  }
  silu(x) {
    return this.mul(x, this.op("Sigmoid", [x]));
  }
  gelu(x) {
    return this.mul(
      this.mul(x, this.scalar(0.5)),
      this.add(this.scalar(1), this.op("Erf", [this.op("Div", [x, this.scalar(Math.SQRT2)])])),
    );
  }
  linear(x, prefix) {
    let y = this.op("MatMul", [x, this.transpose(this.weight(`${prefix}.weight`), [1, 0])]);
    if (this.weights.tensors[`${prefix}.bias`]) y = this.add(y, this.weight(`${prefix}.bias`));
    return y;
  }
  conv(x, prefix, { stride = 1, dilation = 1, transpose = false } = {}) {
    const shape = this.shape(`${prefix}.weight`);
    const rank = shape.length - 2;
    const kernel = shape.slice(2);
    const pad = kernel.map((k) =>
      transpose ? Math.floor((k - stride) / 2) : Math.floor(((k - 1) * dilation) / 2),
    );
    const inputs = [x, this.weight(`${prefix}.weight`)];
    if (this.weights.tensors[`${prefix}.bias`]) inputs.push(this.weight(`${prefix}.bias`));
    return this.op(transpose ? "ConvTranspose" : "Conv", inputs, {
      strides: Array(rank).fill(stride),
      dilations: Array(rank).fill(dilation),
      pads: [...pad, ...pad],
    });
  }
  layerNorm(x, prefix, epsilon = 1e-5) {
    return this.op(
      "LayerNormalization",
      [x, this.weight(`${prefix}.weight`), this.weight(`${prefix}.bias`)],
      { axis: -1, epsilon },
    );
  }
  groupNorm(x, prefix, epsilon = 1e-5) {
    const c = this.shape(`${prefix}.weight`)[0];
    const shape = this.op("Shape", [x]);
    let y = this.reshape(x, [0, 32, -1]);
    y = this.op(
      "InstanceNormalization",
      [y, this.constant(Array(32).fill(1)), this.constant(Array(32).fill(0))],
      { epsilon },
    );
    y = this.op("Reshape", [y, shape]);
    return this.add(
      this.mul(y, this.reshape(this.weight(`${prefix}.weight`), [1, c, 1, 1])),
      this.reshape(this.weight(`${prefix}.bias`), [1, c, 1, 1]),
    );
  }
  attention(q, k, v, heads, width, mask) {
    const split = (x) =>
      this.transpose(this.reshape(x, [0, 0, heads, width / heads]), [0, 2, 1, 3]);
    q = split(q);
    k = split(k);
    v = split(v);
    let scores = this.mul(
      this.op("MatMul", [q, this.transpose(k, [0, 1, 3, 2])]),
      this.scalar(1 / Math.sqrt(width / heads)),
    );
    if (mask) scores = this.add(scores, mask);
    const mixed = this.op("MatMul", [this.op("Softmax", [scores], { axis: -1 }), v]);
    return this.reshape(this.transpose(mixed, [0, 2, 1, 3]), [0, 0, width]);
  }
  resize(x) {
    return this.op("Resize", [x, "", this.constant([1, 1, 2, 2])], {
      mode: "nearest",
      coordinate_transformation_mode: "asymmetric",
      nearest_mode: "floor",
    });
  }
  async save(output, dimensions, filename) {
    this.nodes.push(cat([blob(1, output), blob(2, "output"), blob(4, "Identity")]));
    const graph = cat([
      ...this.nodes.map((n) => blob(1, n)),
      blob(2, "penguin-local-audio"),
      ...[...this.initializers.values()].map((t) => blob(5, t)),
      ...this.inputs.map(([n, s, t]) => blob(11, valueInfo(n, s, t))),
      blob(12, valueInfo("output", dimensions)),
      ...this.outputs.map(([n, s]) => blob(12, valueInfo(n, s))),
    ]);
    const model = cat([vi(1, 8), blob(2, "penguin-harness"), blob(7, graph), blob(8, vi(2, 17))]);
    await writeFile(filename, model);
    return filename;
  }
}
