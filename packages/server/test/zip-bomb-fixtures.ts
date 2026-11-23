/**
 * A zip bomb whose payload is a directory entry, and the probe that tells whether a request
 * inflated it. Shared by the archive routes' tests (Skills, plugins).
 */
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import zlib from "node:zlib";
import { Zip, ZipPassThrough } from "fflate";
import type { ZipInputFile } from "fflate";

/**
 * A zip of `files` (stored) plus the directory entry `dir` holding `mib` MiB of zeros, deflated
 * and declared at their real size as any zipper writes them; 256 MiB fit in about 262 KB. The
 * zeros are never deflated here: zlib's output for one MiB of them, flushed so that it stands
 * alone, is repeated `mib` times, which keeps the fixture cheap however much it inflates to.
 */
export function zeroDirectoryZip(
  files: Record<string, Uint8Array>,
  dir: string,
  mib: number,
): Uint8Array {
  const parts: Uint8Array[] = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    parts.push(data);
  });
  for (const [name, data] of Object.entries(files)) {
    const file = new ZipPassThrough(name);
    zip.add(file);
    file.push(data, true);
  }
  const zeros = new Uint8Array(1024 * 1024);
  const run = new Uint8Array(
    zlib.deflateRawSync(zeros, { finishFlush: zlib.constants.Z_FULL_FLUSH }),
  );
  let crc = 0;
  for (let i = 0; i < mib; i++) crc = zlib.crc32(zeros, crc);
  const entry: ZipInputFile = { filename: dir, compression: 8, size: mib * zeros.length, crc };
  zip.add(entry);
  for (let i = 0; i < mib; i++) entry.ondata!(null, run, false);
  entry.ondata!(null, new Uint8Array(zlib.deflateRawSync(new Uint8Array(0))), true);
  zip.end();
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * How far this process's resident memory rose above where it stood while `run` ran, in bytes.
 * A worker thread samples it every millisecond: what it has to catch is a buffer that one
 * synchronous call on this thread fills and drops, which no reading taken here before or after
 * would see.
 */
export async function peakRssGrowth(run: () => Promise<void>): Promise<number> {
  const stop = new Int32Array(new SharedArrayBuffer(4));
  const peak = new Float64Array(new SharedArrayBuffer(8));
  const sampler = new Worker(
    `const { parentPort, workerData: [stop, peak] } = require("node:worker_threads");
    parentPort.postMessage("sampling");
    while (Atomics.load(stop, 0) === 0) {
      peak[0] = Math.max(peak[0], process.memoryUsage.rss());
      Atomics.wait(stop, 0, 0, 1);
    }`,
    { eval: true, workerData: [stop, peak] },
  );
  await once(sampler, "message");
  const before = process.memoryUsage.rss();
  try {
    await run();
  } finally {
    Atomics.store(stop, 0, 1);
    Atomics.notify(stop, 0);
    await once(sampler, "exit");
  }
  return Math.max(0, peak[0]! - before);
}
