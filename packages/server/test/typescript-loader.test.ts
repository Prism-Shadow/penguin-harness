/**
 * Which TypeScript compiler the server takes (plugin/typescript.ts): the one a push carried
 * before the one an installation holds, and never one whose default library files are missing
 * — a desktop package built without them resolved `typescript` and then failed every workflow
 * for want of `lib.es2022.full.d.ts`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARIES,
  TypeScriptUnavailable,
  compilerFile,
} from "../src/plugin/typescript.js";

describe("the compiler the server takes", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-compiler-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** A place holding a compiler package, whole or with only its entry; answers what resolves from it. */
  const place = (name: string, libraries: readonly string[]) => {
    const lib = path.join(root, name, "node_modules", "typescript", "lib");
    fs.mkdirSync(lib, { recursive: true });
    fs.writeFileSync(
      path.join(lib, "..", "package.json"),
      JSON.stringify({ name: "typescript", main: "./lib/typescript.js" }),
    );
    fs.writeFileSync(path.join(lib, "typescript.js"), "module.exports = {};\n");
    for (const file of libraries) fs.writeFileSync(path.join(lib, file), "");
    return {
      base: () => path.join(root, name, "index.mjs"),
      entry: path.join(lib, "typescript.js"),
    };
  };
  const empty = (name: string) => {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    return () => path.join(root, name, "index.mjs");
  };

  it("the pushed compiler comes first", () => {
    const pushed = place("pushed", DEFAULT_LIBRARIES);
    const installed = place("installed", DEFAULT_LIBRARIES);
    expect(fs.realpathSync(compilerFile([pushed.base, installed.base]))).toBe(
      fs.realpathSync(pushed.entry),
    );
  });

  it("a compiler without its default library is passed over", () => {
    const installed = place("installed", ["lib.es2022.d.ts"]);
    const pushed = place("pushed", DEFAULT_LIBRARIES);
    expect(fs.realpathSync(compilerFile([installed.base, pushed.base]))).toBe(
      fs.realpathSync(pushed.entry),
    );
  });

  it("names what each place lacked", () => {
    const installed = place("installed", []);
    const nowhere = empty("nowhere");
    const failing = () => {
      throw new Error("the archive could not be unpacked");
    };
    let thrown: unknown;
    try {
      compilerFile([failing, installed.base, nowhere]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TypeScriptUnavailable);
    const message = (thrown as Error).message;
    expect(message).toContain("the archive could not be unpacked");
    expect(message).toContain(`has no ${DEFAULT_LIBRARIES[0]} beside it`);
    expect(message).toMatch(/nowhere.*Cannot find module 'typescript'/);
  });
});
