import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
  // The DSH chain is compiled in, so the package ships its own few files rather than an npm
  // dependency tree a push carries one file at a time. The two native pieces stay
  // dependencies — koffi, and the landlock launcher that resolves its per-platform binary
  // package at run time — since neither can live inside a bundle.
  noExternal: [/^@deepseek-ai\/(?!node-addon-landlock-run)/],
  external: ["koffi", /^@deepseek-ai\/node-addon-landlock-run/],
  // Bundled CommonJS calls require(); an ESM bundle has none of its own.
  banner: {
    js: 'import { createRequire as __penguinCreateRequire } from "node:module"; const require = __penguinCreateRequire(import.meta.url);',
  },
});
