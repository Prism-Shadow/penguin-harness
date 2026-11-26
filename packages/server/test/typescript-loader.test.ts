/**
 * Which TypeScript compiler the server takes (plugin/typescript.ts): the one a push carried
 * before the one an installation holds, and never one whose default library files are missing
 * — a desktop package built without them resolved `typescript` and then failed every workbench
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
  nodeTypesFrom,
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

describe("the Node declarations the server takes", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-node-types-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** A place holding `@types/node` and `undici-types`; `declarations` false keeps the manifests only. */
  const place = (name: string, declarations: boolean) => {
    const modules = path.join(root, name, "node_modules");
    for (const pkg of ["@types/node", "undici-types"]) {
      const dir = path.join(modules, pkg);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: pkg, types: "index.d.ts" }),
      );
      if (declarations) fs.writeFileSync(path.join(dir, "index.d.ts"), "export {};\n");
    }
    return {
      base: () => path.join(root, name, "index.mjs"),
      types: path.join(modules, "@types"),
    };
  };

  it("a complete copy is taken", () => {
    const whole = place("whole", true);
    expect(fs.realpathSync(nodeTypesFrom([whole.base])!)).toBe(fs.realpathSync(whole.types));
  });

  it("a copy whose declarations were stripped is passed over for the next place", () => {
    const stripped = place("stripped", false);
    const whole = place("whole", true);
    expect(fs.realpathSync(nodeTypesFrom([stripped.base, whole.base])!)).toBe(
      fs.realpathSync(whole.types),
    );
  });

  it("answers null when no place has a complete copy", () => {
    const stripped = place("stripped", false);
    expect(nodeTypesFrom([stripped.base])).toBeNull();
  });
});
