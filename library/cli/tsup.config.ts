import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/client.ts",
    "src/connection.ts",
    "src/console-input.ts",
    "src/cut-text.ts",
    "src/index.ts",
    "src/messages.ts",
    "src/server-lock.ts",
    "src/stored-sign-in.ts",
    "src/table.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
