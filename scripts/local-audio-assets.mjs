/** Worker modules must travel with npm, desktop and hot-update bundles. */
export const LOCAL_AUDIO_ASSETS = ["onnx", "audioldm", "audiogen"].map((adapter) => ({
  name: `local-audio-${adapter}.mjs`,
  from: `packages/server/src/activities/local-audio-${adapter}.mjs`,
}));
