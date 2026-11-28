import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Headful Electron E2E files each launch a real desktop window + GPU context; run
    // sequentially so parallel Electron instances never fight for focus, ports, or GPU.
    fileParallelism: false,
  },
});
