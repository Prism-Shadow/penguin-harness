/**
 * A build handed over to a machine (machines/upgrade.ts) is sent as one already accepted:
 * whether to run it was decided on this server, so the machine is not left on another build
 * for a plugin of its own that this one cannot run (hmr/push-plugins.ts).
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEAVE_OUT, UNSATISFIED_PLUGINS_HEADER } from "../src/hmr/push-plugins.js";
import { upgradeRemote } from "../src/machines/upgrade.js";

describe("handing a build over to a machine", () => {
  let root: string;
  let server: http.Server;
  let seen: { url: string; headers: http.IncomingHttpHeaders }[];
  let answer: { status: number; body: unknown };

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-handover-"));
    const hmr = path.join(root, "hmr");
    fs.mkdirSync(hmr, { recursive: true });
    fs.writeFileSync(path.join(hmr, "platform.mjs"), "export const hotPlatform = {};\n");
    fs.writeFileSync(path.join(hmr, "cli.mjs"), "export async function cli() { return 0; }\n");
    fs.writeFileSync(path.join(hmr, "web.json.gz"), zlib.gzipSync(JSON.stringify({ files: {} })));
    fs.writeFileSync(
      path.join(hmr, "harness.json"),
      JSON.stringify({
        platform: { bundle: "platform.mjs" },
        cli: { bundle: "cli.mjs" },
        web: { manifest: "web.json.gz" },
      }),
    );
    seen = [];
    answer = { status: 200, body: { status: "ok", persisted: true } };
    server = http.createServer((req, res) => {
      seen.push({ url: req.url ?? "", headers: req.headers });
      req.resume();
      req.on("end", () => {
        res.writeHead(answer.status, { "content-type": "application/json" });
        res.end(JSON.stringify(answer.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  const handOver = () =>
    upgradeRemote({
      agent: new http.Agent(),
      port: (server.address() as AddressInfo).port,
      cookie: "penguin_session=x",
      dataRoot: root,
    });

  it("sends the push with the acceptance on it", async () => {
    const outcome = await handOver();
    expect(outcome.kind).toBe("upgraded");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/hmr/upgrade");
    expect(seen[0]!.headers[UNSATISFIED_PLUGINS_HEADER]).toBe(LEAVE_OUT);
    expect(seen[0]!.headers.cookie).toBe("penguin_session=x");
  });

  it("still reads a machine's refusal in its own words", async () => {
    answer = {
      status: 409,
      body: { error: { code: "plugins_unsatisfied", message: "This build cannot fully run …" } },
    };
    expect(await handOver()).toEqual({
      kind: "refused",
      detail: "This build cannot fully run …",
    });
  });
});
