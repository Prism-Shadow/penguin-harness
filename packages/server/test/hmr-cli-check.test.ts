/**
 * A push whose CLI bundle cannot be started is refused before it lands (src/hmr/cli-check.ts):
 * server start paths run the pushed CLI after the next restart, so a broken one would keep the
 * server down long after the push. The bundle is started the way a start path starts it — the
 * installation's `penguin-hmr` loader on a data root that records it — in a process of its own.
 *
 * The installation here is a scratch directory: a CLI entry and, beside it, a loader that does
 * what packages/cli's penguin-hmr does (read the record, import the bundle, call its `cli`).
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHarnessInfo } from "../src/hmr/manifest.js";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const WEB = { "index.html": Buffer.from("<html>cli-check</html>").toString("base64") };
/** Never booted: every push below is refused, or left to the endpoint, before the platform is read. */
const PLATFORM = "export const platform = 1;\n";

const LOADER = `
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PENGUIN_HOME;
const record = JSON.parse(fs.readFileSync(path.join(root, "hmr", "harness.json"), "utf8"));
const file = path.join(root, "hmr", record.cli.bundle);
const mod = await import(pathToFileURL(file).href);
if (typeof mod.cli !== "function") {
  process.stderr.write(file + " does not export 'cli'\\n");
  process.exit(1);
}
process.exitCode = await mod.cli(process.argv.slice(2));
`;

let t: TestApp | undefined;
let install: string;

beforeEach(async () => {
  install = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cli-check-install-"));
  await fs.writeFile(path.join(install, "penguin.js"), "");
  await fs.writeFile(path.join(install, "penguin-hmr.js"), LOADER);
});

afterEach(async () => {
  if (t) await t.cleanup();
  t = undefined;
  await fs.rm(install, { recursive: true, force: true });
});

const sha256 = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");

function push(t: TestApp, cookie: string, cli: unknown) {
  return t.app.request("/api/hmr/upgrade", {
    method: "POST",
    headers: { cookie, "content-type": "application/gzip" },
    body: zlib.gzipSync(
      Buffer.from(JSON.stringify({ platform: PLATFORM, cli, web: { files: WEB } })),
    ),
  });
}

/** A server whose CLI is the scratch installation's. */
async function installedApp(): Promise<{ t: TestApp; cookie: string }> {
  const app = await createTestApp({ config: { cliEntry: path.join(install, "penguin.js") } });
  return { t: app, cookie: (await loginAdmin(app.app)).cookie };
}

describe("POST /api/hmr/upgrade: the pushed CLI must start", () => {
  it("refuses a CLI bundle that does not parse, naming the error, and lands nothing", async () => {
    let cookie: string;
    ({ t, cookie } = await installedApp());
    const res = await push(t, cookie, "export async function cli( {\n");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).toMatch(/^the CLI bundle cannot be started: SyntaxError/);
    expect(await readHarnessInfo(t.root)).toBeNull();
  });

  it("refuses a CLI bundle that loads but exports no cli", async () => {
    let cookie: string;
    ({ t, cookie } = await installedApp());
    const res = await push(t, cookie, "export const notCli = 1;\n");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("does not export 'cli'");
  });

  it("refuses a CLI whose cli() fails", async () => {
    let cookie: string;
    ({ t, cookie } = await installedApp());
    const res = await push(
      t,
      cookie,
      "export async function cli() { throw new Error('no start'); }\n",
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("no start");
  });

  it("starts a CLI named by sha from the store, and refuses it when it cannot start", async () => {
    let cookie: string;
    ({ t, cookie } = await installedApp());
    const broken = Buffer.from("throw new Error('cli exploded at import');\n");
    const put = await t.app.request(`/api/hmr/blobs/${sha256(broken)}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/octet-stream" },
      body: broken,
    });
    expect(put.status).toBe(200);
    const res = await push(t, cookie, { sha: sha256(broken) });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("cli exploded at import");
  });

  it("leaves a push it cannot read to the endpoint: a CLI named by a sha the store lacks", async () => {
    let cookie: string;
    ({ t, cookie } = await installedApp());
    const res = await push(t, cookie, { sha: "a".repeat(64) });
    expect(res.status).toBe(400);
    // The mechanism's own answer, not this check's.
    expect(await res.text()).toContain("put it first");
  });

  it("checks nothing on a server that knows no loader to start a CLI with", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    const res = await push(t, cookie, "export async function cli( {\n");
    // Not this check's refusal: the push reaches the mechanism, which boots the platform.
    expect(await res.text()).not.toContain("the CLI bundle cannot be started");
  });
});
