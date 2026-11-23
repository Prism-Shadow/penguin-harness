import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/organization.ts", "src/organizations.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
