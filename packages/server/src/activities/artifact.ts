import fs from "node:fs/promises";
import { constants } from "node:fs";

/** Bound reads and inspect the same handle; no reopening a task-controlled file after validation. */
export async function readArtifactBytes(
  file: string,
  maxBytes: number,
  expected?: { dev: number; ino: number },
): Promise<Buffer> {
  const before = await fs.lstat(file);
  const invalid = () =>
    new Error(`The output must be an unchanged regular file no larger than ${maxBytes} bytes.`);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw invalid();
  const handle = await fs.open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = await handle.stat();
    const current = await fs.lstat(file);
    if (
      !opened.isFile() ||
      current.isSymbolicLink() ||
      !current.isFile() ||
      before.dev !== opened.dev ||
      before.ino !== opened.ino ||
      (expected !== undefined && (expected.dev !== opened.dev || expected.ino !== opened.ino)) ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      opened.size > maxBytes
    )
      throw invalid();
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw invalid();
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}
