/** Build a carried store with the server's own compiled push writer. */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { writePushedBuild } from "../packages/server/dist/pushed-build.js";

const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/pack-carried-store.mjs <hmr-dir>");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-carried-pack-"));
try {
  const body = path.join(temp, "image.gz");
  const result = spawnSync(
    process.execPath,
    ["scripts/deploy.mjs", "--out", body, "--skip-web-build"],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`image pack failed: ${result.status}`);
  const build = JSON.parse(zlib.gunzipSync(await fs.readFile(body)).toString("utf8"));
  await writePushedBuild(path.resolve(out), build, new Date(0));
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
