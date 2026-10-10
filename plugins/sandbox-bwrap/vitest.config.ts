// The global setup puts the bubblewrap this plugin ships in place (see test/global-setup.ts).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
  },
});
