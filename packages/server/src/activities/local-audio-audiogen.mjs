import { createRequire } from "node:module";
import { open } from "node:fs/promises";
import path from "node:path";
import { Graph, checkpointFile, safetensors } from "./local-audio-onnx.mjs";

// Tensor-only conversion of facebook/audiogen-medium, including its trained T5
// conditioner. Revision and checksums pin the conversion; no MLX runtime is used.
export const AUDIOGEN = {
  model: "facebook/audiogen-medium",
  repository: "mlx-community/audiogen-medium-mlx",
  revision: "9b56e002743fc20d2acc7b9796f6ce2542f24ec0",
  files: {
    model: [
      "model.safetensors",
      "b3d73edf9f74765df95239449aa6b6c9e6e7ff34b37c42e4c28ce8ef52db91a6",
    ],
    t5: [
      "t5/model.safetensors",
      "dcff5279f4fd44696b083d72c73c69a63dbc73914bdb0a9d68001bec45fc4222",
    ],
  },
};
const slice = (g, x, start, end, axis = -1) =>
  g.op("Slice", [
    x,
    g.constant([start], [1], 7),
    g.constant([end], [1], 7),
    g.constant([axis], [1], 7),
  ]);
function rms(g, x, prefix) {
  return g.mul(
    g.op("Div", [
      x,
      g.op("Sqrt", [
        g.add(g.op("ReduceMean", [g.mul(x, x)], { axes: [-1], keepdims: 1 }), g.scalar(1e-6)),
      ]),
    ]),
    g.weight(`${prefix}.weight`),
  );
}
export function t5Graph(weights) {
  const g = new Graph(weights, [
    ["ids", [1, "tokens"], 7],
    ["bias", [1, 16, "tokens", "tokens"]],
  ]);
  let x = g.op("Gather", [g.weight("shared.weight"), "ids"]);
  for (let i = 0; i < 24; i++) {
    const p = `encoder.block.${i}`;
    const normalized = rms(g, x, `${p}.layer_0.layer_norm`);
    const a = `${p}.layer_0.SelfAttention`;
    const split = (v) => g.transpose(g.reshape(v, [1, -1, 16, 64]), [0, 2, 1, 3]);
    const q = split(g.linear(normalized, `${a}.q`));
    const k = split(g.linear(normalized, `${a}.k`));
    const v = split(g.linear(normalized, `${a}.v`));
    // T5 intentionally does not scale attention logits by sqrt(head size).
    const attention = g.op(
      "Softmax",
      [g.add(g.op("MatMul", [q, g.transpose(k, [0, 1, 3, 2])]), "bias")],
      { axis: -1 },
    );
    const mixed = g.reshape(
      g.transpose(g.op("MatMul", [attention, v]), [0, 2, 1, 3]),
      [1, -1, 1024],
    );
    x = g.add(x, g.linear(mixed, `${a}.o`));
    x = g.add(
      x,
      g.linear(
        g.op("Relu", [
          g.linear(rms(g, x, `${p}.layer_1.layer_norm`), `${p}.layer_1.DenseReluDense.wi`),
        ]),
        `${p}.layer_1.DenseReluDense.wo`,
      ),
    );
  }
  return {
    g,
    output: g.linear(rms(g, x, "encoder.final_layer_norm"), "output_proj"),
    dims: [1, "tokens", 1536],
  };
}
export function relativeBuckets(tokens) {
  const buckets = new Int32Array(tokens * tokens);
  for (let q = 0; q < tokens; q++)
    for (let k = 0; k < tokens; k++) {
      const distance = Math.abs(k - q);
      buckets[q * tokens + k] =
        (k > q ? 16 : 0) +
        (distance < 8
          ? distance
          : Math.min(15, 8 + Math.floor((Math.log(distance / 8) / Math.log(16)) * 8)));
    }
  return buckets;
}
export function decoderGraph(weights) {
  const g = new Graph(weights, [
    ["codes", [4], 7],
    ["position", [1, 1, 1536]],
    ["condition", [2, "tokens", 1536]],
  ]);
  let x;
  for (let c = 0; c < 4; c++) {
    const code = g.op("Gather", ["codes", g.constant([c], [], 7)]);
    const embedding = g.op("Gather", [g.weight(`emb.${c}.weight`), code]);
    x = x ? g.add(x, embedding) : embedding;
  }
  x = g.op("Expand", [
    g.add(g.reshape(x, [1, 1, 1536]), "position"),
    g.constant([2, 1, 1536], [3], 7),
  ]);
  const caches = [];
  const split = (v) => g.transpose(g.reshape(v, [2, -1, 24, 64]), [0, 2, 1, 3]);
  function attend(q, k, v) {
    const scores = g.mul(g.op("MatMul", [q, g.transpose(k, [0, 1, 3, 2])]), g.scalar(1 / 8));
    return g.reshape(
      g.transpose(g.op("MatMul", [g.op("Softmax", [scores], { axis: -1 }), v]), [0, 2, 1, 3]),
      [2, 1, 1536],
    );
  }
  for (let i = 0; i < 48; i++) {
    const p = `transformer.layers.${i}`;
    const qkv = g.linear(g.layerNorm(x, `${p}.norm1`), `${p}.self_attn.in_proj`);
    const q = split(slice(g, qkv, 0, 1536));
    const currentK = split(slice(g, qkv, 1536, 3072));
    const currentV = split(slice(g, qkv, 3072, 4608));
    g.inputs.push([`key${i}`, [2, 24, "past", 64]], [`value${i}`, [2, 24, "past", 64]]);
    const k = g.op("Concat", [`key${i}`, currentK], { axis: 2 });
    const v = g.op("Concat", [`value${i}`, currentV], { axis: 2 });
    g.outputs.push([k, [2, 24, "present", 64]], [v, [2, 24, "present", 64]]);
    caches.push([k, v]);
    x = g.add(x, g.linear(attend(q, k, v), `${p}.self_attn.out_proj`));
    const cross = g.weight(`${p}.cross_attn.in_proj.weight`);
    const project = (input, start) =>
      g.op("MatMul", [input, g.transpose(slice(g, cross, start, start + 1536, 0), [1, 0])]);
    const crossQ = split(project(g.layerNorm(x, `${p}.norm_cross`), 0));
    const crossK = split(project("condition", 1536));
    const crossV = split(project("condition", 3072));
    x = g.add(x, g.linear(attend(crossQ, crossK, crossV), `${p}.cross_attn.out_proj`));
    x = g.add(
      x,
      g.linear(g.gelu(g.linear(g.layerNorm(x, `${p}.norm2`), `${p}.linear1`)), `${p}.linear2`),
    );
  }
  x = g.layerNorm(x, "out_norm");
  const logits = Array.from({ length: 4 }, (_, i) => g.linear(x, `linears.${i}`));
  return { g, output: g.op("Concat", logits, { axis: 1 }), dims: [2, 4, 2048], caches };
}

// Codec convolutions use MLX's [out, kernel, in] tensor layout. The original
// AudioGen codec uses non-causal convolutions with symmetric constant padding.
export function codecGraph(weights) {
  const g = new Graph(weights, [["codes", [4, "frames"], 7]]);
  let x;
  for (let c = 0; c < 4; c++) {
    const ids = g.op("Gather", ["codes", g.constant([c], [], 7)]);
    const values = g.op("Gather", [g.weight(`quantizer.layers.${c}.codebook.embed`), ids]);
    x = x ? g.add(x, values) : values;
  }
  x = g.transpose(g.reshape(x, [1, -1, 128]), [0, 2, 1]);
  function conv(input, prefix, stride = 1, transpose = false) {
    const kernel = g.shape(`${prefix}.weight`)[1];
    const pad = transpose ? kernel - stride : kernel - 1;
    const weight = g.transpose(g.weight(`${prefix}.weight`), transpose ? [2, 0, 1] : [0, 2, 1]);
    return g.op(transpose ? "ConvTranspose" : "Conv", [input, weight, g.weight(`${prefix}.bias`)], {
      strides: [stride],
      pads: [Math.ceil(pad / 2), Math.floor(pad / 2)],
    });
  }
  x = conv(x, "decoder.layers.0.conv");
  const skip = x;
  x = g.transpose(x, [2, 0, 1]);
  // PyTorch/MLX gate order i,f,g,o -> ONNX i,o,f,c.
  const reorder = (input) =>
    g.op(
      "Concat",
      [slice(g, input, 0, 1024, 0), slice(g, input, 3072, 4096, 0), slice(g, input, 1024, 3072, 0)],
      { axis: 0 },
    );
  for (let i = 0; i < 2; i++) {
    const p = `decoder.layers.1.lstm.${i}`;
    const w = g.reshape(reorder(g.weight(`${p}.Wx`)), [1, 4096, 1024]);
    const r = g.reshape(reorder(g.weight(`${p}.Wh`)), [1, 4096, 1024]);
    const b = g.reshape(
      g.op("Concat", [reorder(g.weight(`${p}.bias`)), g.constant(Array(4096).fill(0))], {
        axis: 0,
      }),
      [1, 8192],
    );
    x = g.reshape(g.op("LSTM", [x, w, r, b], { hidden_size: 1024 }), [-1, 1, 1024]);
  }
  x = g.add(skip, g.transpose(x, [1, 2, 0]));
  for (let i = 0; i < 4; i++) {
    x = conv(
      g.op("Elu", [x], { alpha: 1 }),
      `decoder.layers.${3 + i * 3}.conv`,
      [8, 5, 4, 2][i],
      true,
    );
    const p = `decoder.layers.${4 + i * 3}.block`;
    const residual = conv(
      g.op("Elu", [conv(g.op("Elu", [x], { alpha: 1 }), `${p}.1.conv`)], { alpha: 1 }),
      `${p}.3.conv`,
    );
    x = g.add(x, residual);
  }
  return {
    g,
    output: conv(g.op("Elu", [x], { alpha: 1 }), "decoder.layers.15.conv"),
    dims: [1, 1, "samples"],
  };
}
export function positionEmbedding(step) {
  const values = new Float32Array(1536);
  for (let i = 0; i < 768; i++) {
    const phase = step / 10000 ** (i / 767);
    values[i] = Math.cos(phase);
    values[i + 768] = Math.sin(phase);
  }
  return values;
}
export function sampleCode(logits, codebook, random = Math.random) {
  const values = Array.from({ length: 2048 }, (_, i) => ({
    id: i,
    value:
      logits[codebook * 2048 + i] +
      3 * (logits[(codebook + 4) * 2048 + i] - logits[codebook * 2048 + i]),
  }));
  if (values.some(({ value }) => !Number.isFinite(value)))
    throw new Error("AudioGen returned invalid logits.");
  values.sort((a, b) => b.value - a.value);
  const top = values.slice(0, 250);
  const probabilities = top.map(({ value }) => Math.exp(value - top[0].value));
  let draw = random() * probabilities.reduce((a, b) => a + b, 0);
  for (let i = 0; i < top.length; i++) {
    draw -= probabilities[i];
    if (draw <= 0) return top[i].id;
  }
  return top.at(-1).id;
}
export async function generate({ moduleUrl, cacheDir, downloadDir, text, seconds }) {
  const ort = createRequire(moduleUrl)("onnxruntime-node");
  const imported = await import(moduleUrl);
  const { AutoTokenizer } = imported.default ?? imported;
  const files = {};
  for (const [name, [file, hash]] of Object.entries(AUDIOGEN.files))
    files[name] = await checkpointFile(
      cacheDir,
      AUDIOGEN.repository,
      AUDIOGEN.revision,
      file,
      hash,
      downloadDir,
    );
  for (const [file, checksum] of [
    ["tokenizer.json", "d2acde0d8d71dd30a711834b07781b9c89feaac33fd332f60507699282740066"],
    ["tokenizer_config.json", "5a7964567220b3080795971539f6c1b1ba79819ca63f1c79b8445211476615c8"],
  ])
    await checkpointFile(
      cacheDir,
      AUDIOGEN.repository,
      AUDIOGEN.revision,
      `t5/${file}`,
      checksum,
      downloadDir,
    );
  const tokenizer = await AutoTokenizer.from_pretrained(path.dirname(files.t5), {
    local_files_only: true,
  });
  const ids = tokenizer(text, { truncation: false }).input_ids;
  const tokens = ids.dims[1];
  if (tokens > 512) throw new Error("Prompt exceeds AudioGen's token limit.");
  const tensor = (data, dims, type = "float32") => new ort.Tensor(type, data, dims);
  const t5Weights = await safetensors(files.t5);
  const modelWeights = await safetensors(files.model);
  const handle = await open(files.t5, "r");
  let relative;
  try {
    const item =
      t5Weights.tensors["encoder.block.0.layer_0.SelfAttention.relative_attention_bias.weight"];
    const bytes = Buffer.alloc(item.data_offsets[1] - item.data_offsets[0]);
    await handle.read(bytes, 0, bytes.length, t5Weights.offset + item.data_offsets[0]);
    relative = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  } finally {
    await handle.close();
  }
  const buckets = relativeBuckets(tokens);
  const bias = new Float32Array(16 * tokens * tokens);
  for (let h = 0; h < 16; h++)
    for (let i = 0; i < buckets.length; i++)
      bias[h * buckets.length + i] = relative[buckets[i] * 16 + h];
  async function session(build, weights, name) {
    const graph = build(weights);
    const file = await graph.g.save(
      graph.output,
      graph.dims,
      path.join(path.dirname(weights.file), `penguin-${name}-v1.onnx`),
    );
    return {
      session: await ort.InferenceSession.create(file, {
        executionProviders: ["cpu"],
        intraOpNumThreads: 4,
        interOpNumThreads: 1,
        graphOptimizationLevel: "all",
      }),
      graph,
    };
  }
  let current;
  try {
    ({ session: current } = await session(t5Graph, t5Weights, "t5"));
    const encoded = (
      await current.run({
        ids: tensor(ids.data, [1, tokens], "int64"),
        bias: tensor(bias, [1, 16, tokens, tokens]),
      })
    ).output;
    const condition = new Float32Array(encoded.data.length * 2);
    condition.set(encoded.data, encoded.data.length); // AudioCraft's unconditional half is zero.
    await current.release();
    current = null;
    const decoder = await session(decoderGraph, modelWeights, "decoder");
    current = decoder.session;
    const frames = Math.round(seconds * 50);
    const codes = new BigInt64Array(frames * 4);
    let next = new BigInt64Array(4).fill(2048n);
    const feeds = { condition: tensor(condition, [2, tokens, 1536]) };
    for (let i = 0; i < 48; i++) {
      feeds[`key${i}`] = tensor(new Float32Array(0), [2, 24, 0, 64]);
      feeds[`value${i}`] = tensor(new Float32Array(0), [2, 24, 0, 64]);
    }
    for (let step = 0; step < frames + 3; step++) {
      const result = await current.run({
        ...feeds,
        codes: tensor(next, [4], "int64"),
        position: tensor(positionEmbedding(step), [1, 1, 1536]),
      });
      next = new BigInt64Array(4).fill(2048n);
      for (let c = 0; c < 4; c++) {
        const frame = step - c;
        if (frame >= 0 && frame < frames) {
          next[c] = BigInt(sampleCode(result.output.data, c));
          codes[c * frames + frame] = next[c];
        }
      }
      for (let i = 0; i < 48; i++) {
        feeds[`key${i}`] = result[decoder.graph.caches[i][0]];
        feeds[`value${i}`] = result[decoder.graph.caches[i][1]];
      }
    }
    await current.release();
    current = null;
    ({ session: current } = await session(codecGraph, modelWeights, "codec"));
    const { output } = await current.run({ codes: tensor(codes, [4, frames], "int64") });
    const length = Math.round(seconds * 16000);
    if (output.data.length < length) throw new Error("AudioGen returned a short waveform.");
    return { audio: new Float32Array(output.data.slice(0, length)), rate: 16000 };
  } finally {
    if (current) await current.release();
  }
}
