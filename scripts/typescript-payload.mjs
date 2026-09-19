/**
 * The TypeScript compiler as something a build carries.
 *
 * The server type-checks and transpiles workflows, and lets the compiler decide whether a
 * package's interfaces still fit the platform (packages/server/src/plugin/typescript.ts). It
 * is a dependency of the server package, which covers an npm install and a checkout — but a
 * hot push lands on machines whose program was installed before that, and the desktop build
 * bundles the server into one file with no `node_modules` of its own. Both therefore carry
 * the compiler themselves, the way they carry node-pty: the push as one archive in its
 * assets, the desktop build staged beside the server bundle.
 *
 * Only what the compiler reads at run time: its entry and the default library files a
 * program is checked against. The language service, the tsc CLI, the locale catalogues and
 * the type declarations of the API itself are most of the package and none of it is loaded.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/** `[{ rel, abs }]` for the compiler resolved from `serverDir`, `rel` relative to the package. */
export function typescriptPayload(serverDir) {
  const dir = path.dirname(
    createRequire(path.resolve(serverDir, "package.json")).resolve("typescript/package.json"),
  );
  const lib = fs
    .readdirSync(path.join(dir, "lib"))
    .filter((name) => name === "typescript.js" || /^lib\..*\.d\.ts$/.test(name))
    .sort();
  if (!lib.includes("typescript.js")) throw new Error(`${dir}: no lib/typescript.js`);
  return ["package.json", ...lib.map((name) => `lib/${name}`)].map((rel) => ({
    rel,
    abs: path.join(dir, rel),
  }));
}
