import { createRequire } from "node:module";
import path from "node:path";
import { Graph, checkpointFile, safetensors } from "./local-audio-onnx.mjs";

// AudioLDM v1, exactly the checkpoint used by Loom. This graph describes its
// published CLAP/UNet/VAE/HiFi-GAN architecture; no substitute checkpoint or
// Python service is involved. Reference: diffusers' AudioLDMPipeline (v0.27.2).
export const AUDIOLDM = {
  repository: "cvssp/audioldm-s-full-v2",
  revision: "feeb3d14203495a4b6ac0893cbdedb2159b4819c",
  files: {
    text_encoder: [
      "text_encoder/model.safetensors",
      "c92b5a2bee69ff5dd05820d9e0a5cddbc9c9b9dd19a6cb3214f0cf4f29a4d1b0",
    ],
    unet: [
      "unet/diffusion_pytorch_model.safetensors",
      "fc30d5b5a3bb8d08672736efb1fff10755ba7024dace39b2dcb579a105aa2a5a",
    ],
    vae: [
      "vae/diffusion_pytorch_model.safetensors",
      "42f64f7565b23eabde68c9694e39f18b8bba5f7a14f477e7ed4b51e0ea7de8a5",
    ],
    vocoder: [
      "vocoder/model.safetensors",
      "d9dc6513c30a5b86c2497712690c04fe74b4aa79fdab6d490b34fcb4e24c590c",
    ],
  },
};

export function clapGraph(weights) {
  const g = new Graph(weights, [
    ["input_ids", [2, "tokens"], 7],
    ["position_ids", [2, "tokens"], 7],
    ["mask", [2, 1, 1, "tokens"]],
  ]);
  const p = "text_model.embeddings";
  let x = g.add(
    g.op("Gather", [g.weight(`${p}.word_embeddings.weight`), "input_ids"]),
    g.op("Gather", [g.weight(`${p}.position_embeddings.weight`), "position_ids"]),
  );
  x = g.add(x, g.weight(`${p}.token_type_embeddings.weight`));
  x = g.layerNorm(x, `${p}.LayerNorm`, 1e-12);
  for (let i = 0; i < 12; i++) {
    const prefix = `text_model.encoder.layer.${i}`;
    const a = `${prefix}.attention`;
    const attention = g.attention(
      g.linear(x, `${a}.self.query`),
      g.linear(x, `${a}.self.key`),
      g.linear(x, `${a}.self.value`),
      12,
      768,
      "mask",
    );
    x = g.layerNorm(
      g.add(x, g.linear(attention, `${a}.output.dense`)),
      `${a}.output.LayerNorm`,
      1e-12,
    );
    x = g.layerNorm(
      g.add(
        x,
        g.linear(g.gelu(g.linear(x, `${prefix}.intermediate.dense`)), `${prefix}.output.dense`),
      ),
      `${prefix}.output.LayerNorm`,
      1e-12,
    );
  }
  x = g.op("Gather", [x, g.constant([0], [], 7)], { axis: 1 });
  x = g.op("Tanh", [g.linear(x, "text_model.pooler.dense")]);
  x = g.linear(g.op("Relu", [g.linear(x, "text_projection.linear1")]), "text_projection.linear2");
  const norm = g.op("Sqrt", [
    g.op("ReduceSum", [g.mul(x, x), g.constant([1], [1], 7)], { keepdims: 1 }),
  ]);
  return { g, output: g.op("Div", [x, g.op("Max", [norm, g.scalar(1e-12)])]), dims: [2, 512] };
}

function resnet(g, x, prefix, temb, epsilon) {
  const channels = g.shape(`${prefix}.conv2.weight`)[0];
  const skip = g.weights.tensors[`${prefix}.conv_shortcut.weight`]
    ? g.conv(x, `${prefix}.conv_shortcut`)
    : x;
  x = g.conv(g.silu(g.groupNorm(x, `${prefix}.norm1`, epsilon)), `${prefix}.conv1`);
  if (temb)
    x = g.add(x, g.reshape(g.linear(g.silu(temb), `${prefix}.time_emb_proj`), [0, channels, 1, 1]));
  x = g.conv(g.silu(g.groupNorm(x, `${prefix}.norm2`, epsilon)), `${prefix}.conv2`);
  return g.add(x, skip);
}
function transformer(g, x, prefix) {
  const skip = x;
  const channels = g.shape(`${prefix}.proj_in.weight`)[0];
  const shape = g.op("Shape", [x]);
  x = g.conv(g.groupNorm(x, `${prefix}.norm`, 1e-6), `${prefix}.proj_in`);
  x = g.transpose(g.reshape(x, [0, channels, -1]), [0, 2, 1]);
  const block = `${prefix}.transformer_blocks.0`;
  for (let i = 1; i <= 2; i++) {
    const norm = g.layerNorm(x, `${block}.norm${i}`);
    const a = `${block}.attn${i}`;
    const mixed = g.attention(
      g.linear(norm, `${a}.to_q`),
      g.linear(norm, `${a}.to_k`),
      g.linear(norm, `${a}.to_v`),
      8,
      channels,
    );
    x = g.add(x, g.linear(mixed, `${a}.to_out.0`));
  }
  const ff = g.linear(g.layerNorm(x, `${block}.norm3`), `${block}.ff.net.0.proj`);
  const width = g.shape(`${block}.ff.net.0.proj.weight`)[0] / 2;
  const slice = (start, end) =>
    g.op("Slice", [
      ff,
      g.constant([start], [1], 7),
      g.constant([end], [1], 7),
      g.constant([-1], [1], 7),
    ]);
  x = g.add(
    x,
    g.linear(g.mul(slice(0, width), g.gelu(slice(width, width * 2))), `${block}.ff.net.2`),
  );
  x = g.op("Reshape", [g.transpose(x, [0, 2, 1]), shape]);
  return g.add(skip, g.conv(x, `${prefix}.proj_out`));
}

export function unetGraph(weights) {
  const g = new Graph(weights, [
    ["sample", [2, 8, "height", 16]],
    ["time", [2, 128]],
    ["classes", [2, 512]],
  ]);
  const time = g.linear(
    g.silu(g.linear("time", "time_embedding.linear_1")),
    "time_embedding.linear_2",
  );
  const temb = g.op("Concat", [time, g.linear("classes", "class_embedding")], { axis: 1 });
  let x = g.conv("sample", "conv_in");
  const skips = [x];
  for (let b = 0; b < 4; b++) {
    for (let r = 0; r < 2; r++) {
      x = resnet(g, x, `down_blocks.${b}.resnets.${r}`, temb, 1e-5);
      if (b) x = transformer(g, x, `down_blocks.${b}.attentions.${r}`);
      skips.push(x);
    }
    if (b < 3) {
      x = g.conv(x, `down_blocks.${b}.downsamplers.0.conv`, { stride: 2 });
      skips.push(x);
    }
  }
  x = resnet(g, x, "mid_block.resnets.0", temb, 1e-5);
  x = transformer(g, x, "mid_block.attentions.0");
  x = resnet(g, x, "mid_block.resnets.1", temb, 1e-5);
  for (let b = 0; b < 4; b++) {
    for (let r = 0; r < 3; r++) {
      x = resnet(
        g,
        g.op("Concat", [x, skips.pop()], { axis: 1 }),
        `up_blocks.${b}.resnets.${r}`,
        temb,
        1e-5,
      );
      if (b < 3) x = transformer(g, x, `up_blocks.${b}.attentions.${r}`);
    }
    if (b < 3) x = g.conv(g.resize(x), `up_blocks.${b}.upsamplers.0.conv`);
  }
  return {
    g,
    output: g.conv(g.silu(g.groupNorm(x, "conv_norm_out")), "conv_out"),
    dims: [2, 8, "height", 16],
  };
}

export function vaeGraph(weights) {
  const g = new Graph(weights, [["latent", [1, 8, "height", 16]]]);
  let x = g.conv(
    g.conv(g.op("Div", ["latent", g.scalar(0.9392935633659363)]), "post_quant_conv"),
    "decoder.conv_in",
  );
  x = resnet(g, x, "decoder.mid_block.resnets.0", null, 1e-6);
  const skip = x;
  const shape = g.op("Shape", [x]);
  const p = "decoder.mid_block.attentions.0";
  x = g.transpose(g.reshape(g.groupNorm(x, `${p}.group_norm`, 1e-6), [1, 512, -1]), [0, 2, 1]);
  x = g.linear(
    g.attention(
      g.linear(x, `${p}.query`),
      g.linear(x, `${p}.key`),
      g.linear(x, `${p}.value`),
      1,
      512,
    ),
    `${p}.proj_attn`,
  );
  x = g.add(skip, g.op("Reshape", [g.transpose(x, [0, 2, 1]), shape]));
  x = resnet(g, x, "decoder.mid_block.resnets.1", null, 1e-6);
  for (let b = 0; b < 3; b++) {
    for (let r = 0; r < 3; r++) x = resnet(g, x, `decoder.up_blocks.${b}.resnets.${r}`, null, 1e-6);
    if (b < 2) x = g.conv(g.resize(x), `decoder.up_blocks.${b}.upsamplers.0.conv`);
  }
  return {
    g,
    output: g.conv(g.silu(g.groupNorm(x, "decoder.conv_norm_out", 1e-6)), "decoder.conv_out"),
    dims: [1, 1, "frames", 64],
  };
}

export function vocoderGraph(weights) {
  const g = new Graph(weights, [["mel", [1, 1, "frames", 64]]]);
  let x = g.conv(g.transpose(g.reshape("mel", [1, -1, 64]), [0, 2, 1]), "conv_pre");
  const leaky = (v) => g.op("LeakyRelu", [v], { alpha: 0.1 });
  for (let i = 0; i < 5; i++) {
    x = g.conv(leaky(x), `upsampler.${i}`, { stride: [5, 4, 2, 2, 2][i], transpose: true });
    const blocks = [];
    for (let j = 0; j < 3; j++) {
      let y = x;
      for (let k = 0; k < 3; k++) {
        const p = `resblocks.${i * 3 + j}`;
        y = g.add(
          y,
          g.conv(
            leaky(g.conv(leaky(y), `${p}.convs1.${k}`, { dilation: [1, 3, 5][k] })),
            `${p}.convs2.${k}`,
          ),
        );
      }
      blocks.push(y);
    }
    x = g.mul(g.add(g.add(blocks[0], blocks[1]), blocks[2]), g.scalar(1 / 3));
  }
  // The original HiFi-GAN uses 0.01 for its final leaky ReLU.
  x = g.op("Tanh", [g.conv(g.op("LeakyRelu", [x], { alpha: 0.01 }), "conv_post")]);
  return { g, output: x, dims: [1, 1, "samples"] };
}

export function ddimSchedule(steps = 25) {
  const alphas = [];
  let product = 1;
  for (let i = 0; i < 1000; i++) {
    const beta = Math.sqrt(0.0015) + ((Math.sqrt(0.0195) - Math.sqrt(0.0015)) * i) / 999;
    product *= 1 - beta * beta;
    alphas.push(product);
  }
  const stride = Math.floor(1000 / steps);
  return Array.from({ length: steps }, (_, i) => {
    const timestep = (steps - i - 1) * stride + 1;
    return { timestep, alpha: alphas[timestep], previous: alphas[Math.max(0, timestep - stride)] };
  });
}
export function ddimStep(sample, prediction, { alpha, previous }, guidance = 2.5) {
  for (let i = 0; i < sample.length; i++) {
    const noise = prediction[i] + guidance * (prediction[i + sample.length] - prediction[i]);
    const original = (sample[i] - Math.sqrt(1 - alpha) * noise) / Math.sqrt(alpha);
    sample[i] = Math.sqrt(previous) * original + Math.sqrt(1 - previous) * noise;
  }
}
export function timeEmbedding(timestep) {
  const values = new Float32Array(256);
  for (let batch = 0; batch < 2; batch++)
    for (let i = 0; i < 64; i++) {
      const angle = timestep * Math.exp((-Math.log(10000) * i) / 64);
      values[batch * 128 + i] = Math.cos(angle);
      values[batch * 128 + 64 + i] = Math.sin(angle);
    }
  return values;
}

export async function generate({ moduleUrl, cacheDir, downloadDir, text, seconds }) {
  const ort = createRequire(moduleUrl)("onnxruntime-node");
  const imported = await import(moduleUrl);
  const { AutoTokenizer } = imported.default ?? imported;
  const files = {};
  for (const [name, [file, checksum]] of Object.entries(AUDIOLDM.files))
    files[name] = await checkpointFile(
      cacheDir,
      AUDIOLDM.repository,
      AUDIOLDM.revision,
      file,
      checksum,
      downloadDir,
    );
  for (const [file, checksum] of [
    ["tokenizer.json", "77ef92283d67f0d97e1454909a964afcbfa2019f0fb9f18f8e88d5c25c3ba729"],
    ["tokenizer_config.json", "09b4ccdfb7bbbd10cbdb995d3f56a8bccc333643d145a9cd5af408c0d33e3631"],
  ])
    await checkpointFile(
      cacheDir,
      AUDIOLDM.repository,
      AUDIOLDM.revision,
      `tokenizer/${file}`,
      checksum,
      downloadDir,
    );
  const tokenizer = await AutoTokenizer.from_pretrained(
    path.join(cacheDir, AUDIOLDM.repository, AUDIOLDM.revision, "tokenizer"),
    { local_files_only: true },
  );
  const encoded = tokenizer(["", text], { padding: true, truncation: false });
  const tokens = encoded.input_ids.dims[1];
  if (tokens > 512) throw new Error("Prompt exceeds AudioLDM's token limit.");
  const positions = new BigInt64Array(tokens * 2);
  const mask = new Float32Array(tokens * 2);
  for (let b = 0; b < 2; b++) {
    let position = 1n;
    for (let t = 0; t < tokens; t++) {
      const i = b * tokens + t;
      positions[i] = encoded.input_ids.data[i] === 1n ? 1n : ++position;
      mask[i] = encoded.attention_mask.data[i] === 0n ? -10000 : 0;
    }
  }
  const tensor = (data, dims, type = "float32") => new ort.Tensor(type, data, dims);
  async function session(name, build) {
    const { g, output, dims } = build(await safetensors(files[name]));
    const graph = await g.save(
      output,
      dims,
      path.join(path.dirname(files[name]), "penguin-v1.onnx"),
    );
    return ort.InferenceSession.create(graph, {
      executionProviders: ["cpu"],
      intraOpNumThreads: 4,
      interOpNumThreads: 1,
      graphOptimizationLevel: "all",
    });
  }
  let current;
  try {
    current = await session("text_encoder", clapGraph);
    const { output: classes } = await current.run({
      input_ids: tensor(encoded.input_ids.data, [2, tokens], "int64"),
      position_ids: tensor(positions, [2, tokens], "int64"),
      mask: tensor(mask, [2, 1, 1, tokens]),
    });
    await current.release();
    current = null;
    // Pad the time axis to the UNet's three downsampling stages, then trim PCM.
    const height = Math.ceil((seconds * 100) / 32) * 8;
    const samples = new Float32Array(8 * height * 16);
    for (let i = 0; i < samples.length; i += 2) {
      const radius = Math.sqrt(-2 * Math.log(1 - Math.random()));
      const angle = 2 * Math.PI * Math.random();
      samples[i] = radius * Math.cos(angle);
      samples[i + 1] = radius * Math.sin(angle);
    }
    current = await session("unet", unetGraph);
    const batch = new Float32Array(samples.length * 2);
    for (const step of ddimSchedule()) {
      batch.set(samples);
      batch.set(samples, samples.length);
      const { output } = await current.run({
        sample: tensor(batch, [2, 8, height, 16]),
        time: tensor(timeEmbedding(step.timestep), [2, 128]),
        classes,
      });
      ddimStep(samples, output.data, step);
    }
    await current.release();
    current = null;
    current = await session("vae", vaeGraph);
    const { output: mel } = await current.run({ latent: tensor(samples, [1, 8, height, 16]) });
    await current.release();
    current = null;
    current = await session("vocoder", vocoderGraph);
    const { output } = await current.run({ mel });
    const length = Math.round(seconds * 16000);
    if (output.data.length < length) throw new Error("AudioLDM returned a short waveform.");
    return { audio: new Float32Array(output.data.slice(0, length)), rate: 16000 };
  } finally {
    if (current) await current.release();
  }
}
