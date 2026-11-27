/**
 * The shipped-native-module guard (scripts/check-native-glibc.mjs):
 * - Given a node-pty whose build/Release binding binds cfsetispeed and cfsetospeed at
 *   GLIBC_2.42, as the one compiled on an Ubuntu 26.04 runner does, the check fails naming the
 *   file and every version above the floor with the symbols bound at it.
 * - Given bindings that need at most glibc 2.28 (C++ runtime versions aside), it passes and
 *   reports each one with the newest glibc it needs; darwin and win32 bindings are skipped.
 * - Given that 2.42 binding inside node-pty's archive, inside a carried store, inside a payload
 *   tarball, it is found there and the check fails, naming the path through each archive.
 * - Given an install image (the gzipped JSON deploy.mjs writes) whose node-pty archive carries
 *   it, the check fails the same way.
 * - Given a Linux binding the run expected and did not find, or one under linux-arm64 built for
 *   x64, the check fails saying so.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { packArchive } from "../asset-archives.mjs";
import { checkNativeGlibc } from "../check-native-glibc.mjs";
import { elfObject, MACH_O } from "./elf-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tar = createRequire(path.join(ROOT, "packages", "server", "package.json"))("tar");

/** The binding an Ubuntu 26.04 runner compiled for 0.2.20. */
const RUNNER_BUILT = elfObject({
  needs: {
    "libc.so.6": {
      "GLIBC_2.2.5": ["memcpy"],
      "GLIBC_2.34": ["forkpty", "openpty"],
      "GLIBC_2.42": ["cfsetispeed", "cfsetospeed"],
    },
  },
});
/** A binding built against glibc 2.28. */
const portable = (machine) =>
  elfObject({
    machine,
    needs: {
      "libutil.so.1": { "GLIBC_2.2.5": ["forkpty"] },
      "libc.so.6": { "GLIBC_2.17": ["clock_gettime"], "GLIBC_2.2.5": ["memcpy"] },
      "libstdc++.so.6": { "GLIBCXX_3.4.22": ["_ZSt9terminatev"] },
    },
  });

async function nodePty(root, files) {
  for (const [rel, bytes] of Object.entries(files)) {
    const file = path.join(root, "node_modules", "node-pty", ...rel.split("/"));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  }
}

async function scratch(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "check-native-glibc-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

it("fails a binding compiled against a newer glibc, naming its version and symbols", () =>
  scratch(async (root) => {
    await nodePty(root, { "build/Release/pty.node": RUNNER_BUILT });
    const { problems } = await checkNativeGlibc([root]);
    assert.equal(problems.length, 1);
    assert.match(
      problems[0],
      /node_modules\/node-pty\/build\/Release\/pty\.node needs glibc 2\.42/,
    );
    assert.match(
      problems[0],
      /GLIBC_2\.42 \(cfsetispeed, cfsetospeed\), GLIBC_2\.34 \(forkpty, openpty\)\./,
    );
    assert.doesNotMatch(problems[0], /memcpy/);
  }));

it("passes bindings built against glibc 2.28, and skips the darwin and win32 ones", () =>
  scratch(async (root) => {
    await nodePty(root, {
      "build/Release/pty.node": portable("x64"),
      "prebuilds/linux-x64/pty.node": portable("x64"),
      "prebuilds/linux-arm64/pty.node": portable("arm64"),
      "prebuilds/darwin-arm64/pty.node": MACH_O,
      "prebuilds/win32-x64/pty.node": Buffer.from("MZ\x90\0"),
    });
    const { checked, problems } = await checkNativeGlibc([root], {
      expect: ["node-pty/prebuilds/linux-x64/pty.node", "node-pty/prebuilds/linux-arm64/pty.node"],
    });
    assert.deepEqual(problems, []);
    assert.deepEqual(
      checked.map(({ where, machine, glibc }) => [path.relative(root, where), machine, glibc]),
      [
        ["node_modules/node-pty/build/Release/pty.node", "x64", "2.17"],
        ["node_modules/node-pty/prebuilds/linux-arm64/pty.node", "arm64", "2.17"],
        ["node_modules/node-pty/prebuilds/linux-x64/pty.node", "x64", "2.17"],
      ],
    );
  }));

it("finds a binding inside node-pty's archive in a carried store inside a payload tarball", () =>
  scratch(async (root) => {
    const store = path.join(root, "out", "penguin", "lib", "dist", "hmr", "store", "assets", "a1");
    await fs.mkdir(path.join(store, "archives"), { recursive: true });
    const pty = path.join(root, "pty.node");
    await fs.writeFile(pty, RUNNER_BUILT);
    await fs.writeFile(
      path.join(store, "archives", "node-pty.tgz"),
      await packArchive([
        { rel: "node_modules/node-pty/build/Release/pty.node", abs: pty, exec: false },
      ]),
    );
    const payload = path.join(root, "linux-x64.tar.gz");
    await tar.c({ gzip: true, file: payload, cwd: path.join(root, "out") }, ["penguin"]);
    const { problems } = await checkNativeGlibc([payload]);
    assert.equal(problems.length, 1);
    assert.match(
      problems[0],
      /linux-x64\.tar\.gz!penguin\/lib\/dist\/hmr\/store\/assets\/a1\/archives\/node-pty\.tgz!node_modules\/node-pty\/build\/Release\/pty\.node needs glibc 2\.42/,
    );
  }));

it("reads the node-pty an install image carries", () =>
  scratch(async (root) => {
    const pty = path.join(root, "pty.node");
    await fs.writeFile(pty, RUNNER_BUILT);
    const archive = await packArchive([
      { rel: "node_modules/node-pty/build/Release/pty.node", abs: pty, exec: false },
    ]);
    const image = path.join(root, "dist", "install-image.gz");
    await fs.mkdir(path.dirname(image), { recursive: true });
    await fs.writeFile(
      image,
      zlib.gzipSync(
        JSON.stringify({
          platform: "export {};",
          cli: "export {};",
          web: { files: { "index.html": "" } },
          assets: { files: { "archives/node-pty.tgz": archive.toString("base64") } },
        }),
      ),
    );
    const { problems } = await checkNativeGlibc([path.join(root, "dist")]);
    assert.equal(problems.length, 1);
    assert.match(
      problems[0],
      /install-image\.gz!archives\/node-pty\.tgz!node_modules\/node-pty\/build\/Release\/pty\.node needs glibc 2\.42/,
    );
  }));

it("fails on an expected Linux binding that is missing and on one built for another architecture", () =>
  scratch(async (root) => {
    await nodePty(root, {
      "prebuilds/linux-arm64/pty.node": portable("x64"),
      "prebuilds/darwin-arm64/pty.node": MACH_O,
    });
    const { problems } = await checkNativeGlibc([root], {
      expect: ["node-pty/prebuilds/linux-x64/pty.node"],
    });
    assert.deepEqual(
      problems.map((p) => p.replace(root, "<root>")),
      [
        "<root>/node_modules/node-pty/prebuilds/linux-arm64/pty.node sits under linux-arm64 but is built for x64.",
        "no Linux binding at node-pty/prebuilds/linux-x64/pty.node among what was checked.",
      ],
    );
  }));
