import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

await build({
  entryPoints: ["src/archives.js"],
  outfile: "workbenches/first-workbench-guide/archives.mjs",
  bundle: true,
  format: "esm",
  minify: true,
  banner: { js: "/*!\n" + (await readFile("node_modules/fflate/LICENSE", "utf8")) + "\n*/" },
  plugins: [
    {
      name: "workbench-source",
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: "workbench-source",
        }));
        build.onLoad({ filter: /.*/, namespace: "workbench-source" }, async (args) => ({
          contents: await readFile(args.path, "utf8"),
          loader: "text",
        }));
      },
    },
  ],
});
