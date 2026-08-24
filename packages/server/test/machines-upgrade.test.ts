/**
 * Handing this server's pushed build to a machine: what gets sent, and what "nothing to
 * send" means.
 *
 * The credential half is the part worth stating and cannot be tested from here: the applier
 * runs ON the far machine and reads that machine's own seeded password off its own disk, so
 * the password never crosses the network. What this file pins is the payload — that it is
 * exactly the three artifacts this server was pushed, and that a server with no pushed build
 * of its own refuses to invent one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPushedBuild } from "../src/machines/upgrade.js";

let root: string;

/** An hmr store shaped exactly as a real push leaves one. */
function seedStore(files: { platform?: string; cli?: string; web?: Record<string, string> }) {
  const hmr = path.join(root, "hmr");
  fs.mkdirSync(hmr, { recursive: true });
  const manifest: Record<string, unknown> = {};
  if (files.platform !== undefined) {
    fs.writeFileSync(path.join(hmr, "p.mjs"), files.platform);
    manifest.platform = { bundle: "p.mjs" };
  }
  if (files.cli !== undefined) {
    fs.writeFileSync(path.join(hmr, "c.mjs"), files.cli);
    manifest.cli = { bundle: "c.mjs" };
  }
  if (files.web !== undefined) {
    fs.writeFileSync(
      path.join(hmr, "w.gz"),
      zlib.gzipSync(Buffer.from(JSON.stringify({ files: files.web }))),
    );
    manifest.web = { manifest: "w.gz" };
  }
  fs.writeFileSync(path.join(hmr, "harness.json"), JSON.stringify(manifest));
}

const decode = (payload: Buffer) =>
  JSON.parse(zlib.gunzipSync(payload).toString("utf8")) as {
    platform: string;
    cli: string;
    web: { files: Record<string, string> };
  };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-upgrade-test-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("readPushedBuild", () => {
  it("forwards exactly the three artifacts this server was pushed", () => {
    seedStore({
      platform: "export const platform = 1;",
      cli: "export const cli = 2;",
      web: { "index.html": Buffer.from("<html>").toString("base64") },
    });
    const payload = readPushedBuild(root);
    expect(payload).not.toBeNull();
    const body = decode(payload!);
    expect(body.platform).toBe("export const platform = 1;");
    expect(body.cli).toBe("export const cli = 2;");
    expect(body.web.files["index.html"]).toBe(Buffer.from("<html>").toString("base64"));
  });

  it("is the shape /api/hmr/upgrade takes, so the far side needs no translation", () => {
    seedStore({ platform: "p", cli: "c", web: { "a.js": "eA==" } });
    const body = decode(readPushedBuild(root)!);
    expect(Object.keys(body).sort()).toEqual(["cli", "platform", "web"]);
  });

  it("refuses to invent a build when nothing has been pushed here", () => {
    // A server running its packaged build has no bundle to hand on; sending one would give
    // a machine a version that never existed.
    expect(readPushedBuild(root)).toBeNull();
  });

  it("refuses a PARTIAL record rather than sending half a version", () => {
    // The three artifacts are committed together; any missing one means the store is not a
    // version, and forwarding the rest would break the machine it reached.
    seedStore({ platform: "p", cli: "c" });
    expect(readPushedBuild(root)).toBeNull();
    seedStore({ platform: "p", web: { "a.js": "eA==" } });
    expect(readPushedBuild(root)).toBeNull();
  });

  it("treats a damaged store as nothing to send", () => {
    fs.mkdirSync(path.join(root, "hmr"), { recursive: true });
    fs.writeFileSync(path.join(root, "hmr", "harness.json"), "{ not json");
    expect(readPushedBuild(root)).toBeNull();
  });

  it("treats a manifest naming a file that is gone as nothing to send", () => {
    seedStore({ platform: "p", cli: "c", web: { "a.js": "eA==" } });
    fs.rmSync(path.join(root, "hmr", "c.mjs"));
    expect(readPushedBuild(root)).toBeNull();
  });
});
