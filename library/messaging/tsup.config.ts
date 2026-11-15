import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/messaging.ts", "src/repos/messaging-bindings.ts", "src/repos/messaging-conversations.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
