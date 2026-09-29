/** Plain worker source survives both bundling and hot loading without transpiler closures. */
export const LOCAL_AUDIO_WORKER = String.raw`(async () => {
  const { parentPort, workerData } = await import("node:worker_threads");
  const { provider, model, moduleUrl, cacheDir, text, voice, seconds } = workerData;
  // Native inference can await work without a referenced libuv handle. Keep this
  // worker alive until it publishes a result or the parent explicitly terminates it.
  const keepAlive = setInterval(() => {}, 60_000);
  try {
    let audio;
    let rate;
    if (provider === "kokoro") {
      // Kokoro's Node entry uses the CommonJS Transformers instance and ignores
      // cache_dir. Configure that same instance before loading the model.
      const { createRequire } = await import("node:module");
      const { env } = createRequire(moduleUrl)("@huggingface/transformers");
      env.cacheDir = cacheDir;
      const { KokoroTTS, TextSplitterStream } = await import(moduleUrl);
      const tts = await KokoroTTS.from_pretrained(model, { dtype: "q8", device: "cpu" });
      try {
        const chunks = [];
        let length = 0;
        rate = 24000;
        const splitter = new TextSplitterStream();
        splitter.push(text);
        splitter.close();
        for await (const { audio: output, phonemes } of tts.stream(splitter, { voice })) {
          // Refuse a sentence the model would truncate; never publish incomplete speech.
          if (tts.tokenizer(phonemes, { truncation: false }).input_ids.dims[1] > 512)
            throw new Error("A sentence exceeds the speech model's token limit.");
          if (output.sampling_rate !== rate || !(output.audio instanceof Float32Array))
            throw new Error("Invalid speech chunk.");
          length += output.audio.length;
          if (length > (20 * 1024 * 1024 - 44) / 2)
            throw new Error("Local speech exceeds the candidate size limit.");
          chunks.push(output.audio);
        }
        audio = new Float32Array(length);
        let offset = 0;
        for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.length; }
      } finally {
        await tts.model.dispose();
      }
    } else {
      const runtime = await import(moduleUrl);
      const { AutoTokenizer, MusicgenForConditionalGeneration } = runtime.default ?? runtime;
      const tokenizer = await AutoTokenizer.from_pretrained(model, { cache_dir: cacheDir });
      const generator = await MusicgenForConditionalGeneration.from_pretrained(model, {
        cache_dir: cacheDir, device: "cpu",
        dtype: { text_encoder: "q8", decoder_model_merged: "q8", encodec_decode: "fp32" },
      });
      try {
        rate = generator.config.audio_encoder.sampling_rate;
        const inputs = tokenizer(text);
        const output = await generator.generate({ ...inputs, max_new_tokens: Math.round(seconds * 50), do_sample: true, guidance_scale: 3 });
        audio = new Float32Array(output.data);
      } finally {
        await generator.dispose();
      }
    }
    if (!(audio instanceof Float32Array) || !audio.length || !Number.isFinite(rate) || rate <= 0)
      throw new Error("The local model returned invalid audio.");
    // All activity audio uses mono PCM at 24 kHz. Linear resampling also bounds the result
    // before the server receives it; the existing WAV validator checks it again on storage.
    const size = Math.round(audio.length * 24000 / rate);
    if (size < 1 || size > (20 * 1024 * 1024 - 44) / 2) throw new Error("Local audio exceeds the candidate size limit.");
    const bytes = new Uint8Array(44 + size * 2);
    const view = new DataView(bytes.buffer);
    for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]])
      for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
    view.setUint32(4, bytes.length - 8, true); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, size * 2, true);
    for (let i = 0; i < size; i++) {
      const source = i * rate / 24000;
      const left = Math.min(Math.floor(source), audio.length - 1);
      const a = audio[left];
      const b = audio[Math.min(left + 1, audio.length - 1)];
      const sample = a + (b - a) * (source - left);
      if (!Number.isFinite(sample)) throw new Error("The local model returned invalid samples.");
      view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
    }
    parentPort.postMessage({ bytes }, [bytes.buffer]);
  } catch {
    parentPort.postMessage({ error: "Local audio generation failed. Check the installed runtime, model download access, disk space and available memory." });
  } finally {
    clearInterval(keepAlive);
  }
})();`;
