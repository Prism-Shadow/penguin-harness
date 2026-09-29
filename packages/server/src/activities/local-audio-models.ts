/** Model identities stay separate from the hosted provider catalogue. */
export const LOCAL_AUDIO_MODELS = {
  kokoro: { model: "onnx-community/Kokoro-82M-v1.0-ONNX", package: "kokoro-js" },
  musicgen: { model: "Xenova/musicgen-small", package: "@huggingface/transformers" },
} as const;
export type LocalAudioProvider = keyof typeof LOCAL_AUDIO_MODELS;
export function isLocalAudioProvider(value: string): value is LocalAudioProvider {
  return Object.hasOwn(LOCAL_AUDIO_MODELS, value);
}

// kokoro-js currently phonemizes English. Do not offer the Python runtime's other languages.
export const KOKORO_VOICES = [
  { id: "af_heart", label: "Heart", languages: ["en-US"] },
  { id: "am_michael", label: "Michael", languages: ["en-US"] },
  { id: "bf_emma", label: "Emma", languages: ["en-GB"] },
  { id: "bm_george", label: "George", languages: ["en-GB"] },
];

export type LocalAudioAvailability = Partial<Record<LocalAudioProvider, boolean>>;
