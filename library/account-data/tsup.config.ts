import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/account-data.ts", "src/repos/user-drafts.ts", "src/repos/background-images.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
