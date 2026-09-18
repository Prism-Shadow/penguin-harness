import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
  // The five grammars are compiled in: the package ships its own few files rather than the
  // whole grammar collection, which a push would carry one file at a time.
  noExternal: [/^@shikijs\/langs/],
});
