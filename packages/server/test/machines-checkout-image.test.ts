/**
 * The pieces a source checkout's install image is made of, each at its own boundary: the
 * store a build is laid down as, the checkout the server finds itself in, and the packer
 * process it runs. How an install uses the image is machines-api.test.ts's.
 *
 * Scenarios:
 * - Given a build laid down as a store, the reader that hands builds over gets the same build
 *   back, the hmr layer's own reader finds its CLI, and its helper binaries stay executable.
 * - Given a build with no web entry page, or a path that would leave the store, it is refused
 *   before anything is written.
 * - Given a module anywhere inside a checkout, the checkout is found; outside one, nothing is.
 * - Given the packer, its own narration reaches the caller and its output file is the build;
 *   given a packer that fails, the failure is told in its last lines, as words.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { readPushedBuild, writePushedBuild } from "../src/hmr/pushed-build.js";
import type { PushedBuild } from "../src/hmr/pushed-build.js";
import { readPushedCli } from "../src/hmr/manifest.js";
import { deployPacker, findCheckout } from "../src/machines/checkout-image.js";

const b64 = (text: string) => Buffer.from(text).toString("base64");

const BUILD: PushedBuild = {
  platform: "export const hotPlatform = { id: 'checkout' };\n",
  cli: "export async function cli() { return 0; }\n",
  web: { files: { "index.html": b64("<!doctype html>"), "assets/app.js": b64("console.log(1)") } },
  assets: {
    files: {
      "install.sh": b64("#!/bin/sh\n"),
      "node_modules/node-pty/build/Release/spawn-helper": b64("helper"),
    },
    exec: ["node_modules/node-pty/build/Release/spawn-helper"],
  },
  source: {
    repo: "https://github.com/Prism-Shadow/penguin-harness.git",
    revision: "v0.2.13-1-gabc",
  },
};

const temps: string[] = [];
const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-checkout-image-"));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("a build laid down as a store", () => {
  it("comes back whole through the hand-over's reader, and the hmr layer finds its CLI", async () => {
    const root = temp();
    const harness = await writePushedBuild(path.join(root, "hmr"), BUILD, new Date(0));

    const body = readPushedBuild(root);
    if (body === null) throw new Error("the store did not read back");
    const back = JSON.parse(zlib.gunzipSync(body).toString("utf8")) as PushedBuild;
    expect(back.platform).toBe(BUILD.platform);
    expect(back.cli).toBe(BUILD.cli);
    expect(back.web).toEqual(BUILD.web);
    expect(back.source).toEqual(BUILD.source);
    expect(back.assets?.files).toEqual(BUILD.assets?.files);
    // The helper a terminal is spawned through has to arrive runnable.
    expect(back.assets?.exec).toEqual(BUILD.assets?.exec);

    // What `penguin-hmr` runs on the machine that receives this directory.
    const cli = await readPushedCli(root);
    expect(cli.kind).toBe("bundle");
    if (cli.kind === "bundle") expect(fs.readFileSync(cli.file, "utf8")).toBe(BUILD.cli);
    expect(JSON.parse(harness)).toMatchObject({
      source: BUILD.source,
      pushedAt: "1970-01-01T00:00:00.000Z",
    });
  });

  it.each([
    ["no web entry page", { ...BUILD, web: { files: { "app.js": b64("x") } } }],
    [
      "a path that leaves the store",
      { ...BUILD, assets: { files: { "../../outside": b64("x") }, exec: [] } },
    ],
  ])("with %s is refused before anything is written", async (_case, build) => {
    const root = temp();
    await expect(writePushedBuild(path.join(root, "hmr"), build, new Date(0))).rejects.toThrow();
    expect(fs.existsSync(path.join(root, "hmr"))).toBe(false);
  });
});

describe("finding the checkout", () => {
  it("is found from any depth inside it, and nothing is found outside one", () => {
    const repo = temp();
    fs.writeFileSync(path.join(repo, "pnpm-workspace.yaml"), "packages: []\n");
    fs.mkdirSync(path.join(repo, "scripts"));
    fs.writeFileSync(path.join(repo, "scripts", "deploy.mjs"), "");
    const deep = path.join(repo, "packages", "server", "src", "machines");
    fs.mkdirSync(deep, { recursive: true });

    expect(findCheckout(deep)).toBe(repo);
    expect(findCheckout(path.join(repo, "packages", "desktop", "dist"))).toBe(repo);
    expect(findCheckout(temp())).toBeNull();
  });
});

describe("the packer", () => {
  /** A checkout whose packer is a stand-in script, run the way the real one is. */
  const checkoutWith = (script: string) => {
    const repo = temp();
    fs.mkdirSync(path.join(repo, "scripts"));
    fs.writeFileSync(path.join(repo, "scripts", "deploy.mjs"), script);
    return repo;
  };

  it("passes its own narration on, and leaves the build in the file it was given", async () => {
    const repo = checkoutWith(
      [
        'import fs from "node:fs";',
        'const out = process.argv[process.argv.indexOf("--out") + 1];',
        'console.log("[deploy] building the web dist…");',
        'console.log("vite building for production...");',
        'fs.writeFileSync(out, "the build");',
        'console.log("[deploy] wrote 2 bundles");',
      ].join("\n"),
    );
    const out = path.join(temp(), "build.gz");
    const lines: string[] = [];

    const packed = await deployPacker(repo)(out, (line) => lines.push(line));

    expect(packed).toEqual({ ok: true });
    expect(lines).toEqual(["building the web dist…", "wrote 2 bundles"]);
    expect(fs.readFileSync(out, "utf8")).toBe("the build");
  });

  it("a failed build is told in its last lines, as words — no terminal codes, no stack frames", async () => {
    const repo = checkoutWith(
      [
        'console.log("[deploy] building the web dist…");',
        'console.error("\\u001b[31merror during build:\\u001b[39m");',
        "console.error('Could not resolve entry module \"index.html\".');",
        'console.error("    at getRollupError (file:///repo/rollup/parseAst.js:317:41)");',
        'console.error("    at async Promise.all (index 0)");',
        'console.error("[deploy] Command failed: pnpm --filter @prismshadow/penguin-web build");',
        "process.exit(1);",
      ].join("\n"),
    );

    const packed = await deployPacker(repo)(path.join(temp(), "build.gz"), () => {});

    // What a person reads in the job and on the page: the reason, then what gave up.
    expect(packed).toEqual({
      ok: false,
      detail: [
        "building the web dist…",
        "error during build:",
        'Could not resolve entry module "index.html".',
        "Command failed: pnpm --filter @prismshadow/penguin-web build",
      ].join("\n"),
    });
  });
});
