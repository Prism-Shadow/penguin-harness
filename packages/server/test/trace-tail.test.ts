/**
 * Bounded Trace-TAIL reads.
 *
 * The property under test throughout: a truncated read must report where it actually
 * starts. A window that renumbers its units from 0 makes every tracePosition in the
 * page point at the wrong record, and makes a window that stopped mid-shard
 * indistinguishable from one that reached the beginning of the transcript.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readTraceTailLines } from "../src/internal/trace-tail.js";

const line = (text: string): string =>
  JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z", type: "model_msg", payload: { text } }) +
  "\n";

describe("trace tail", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "penguin-tail-"));
    file = path.join(dir, "s_001.jsonl");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports skippedUnits so a window's ordinals match the shard's", async () => {
    // Big enough that the bounded read cannot take the whole file in its first window.
    const lines = Array.from({ length: 20_000 }, (_, i) => line("m" + i));
    await writeFile(file, lines.join(""));

    const read = await readTraceTailLines(file, 50);
    expect(read.messages).toHaveLength(50);
    expect(read.messages.at(-1)).toMatchObject({ payload: { text: "m19999" } });
    // Unit 19_999 is the last of 20_000; a window of 50 starts 50 units before it.
    expect(read.skippedUnits).toBe(20_000 - 50);
  });

  it("reports skippedUnits=0 when the read reaches the first unit", async () => {
    await writeFile(file, Array.from({ length: 40 }, (_, i) => line("m" + i)).join(""));

    const read = await readTraceTailLines(file, null);
    expect(read.messages).toHaveLength(40);
    expect(read.skippedUnits).toBe(0);
  });

  it("keeps skippedUnits consistent with the returned slice, not the window read", async () => {
    // A window that reads far more lines than it returns is exactly the case where a
    // skippedUnits that counted only the bytes ahead of the window under-reports.
    const lines = Array.from({ length: 30_000 }, (_, i) => line("m" + i));
    await writeFile(file, lines.join(""));

    const read = await readTraceTailLines(file, 10);
    expect(read.messages).toHaveLength(10);
    expect(read.messages.at(-1)).toMatchObject({ payload: { text: "m29999" } });
    expect(read.skippedUnits).toBe(29_990);
    // The reported offset must land the last message on the shard's actual last unit.
    expect(read.skippedUnits + read.messages.length - 1).toBe(30_000 - 1);
  });

  it("follows an append: a later tail read reports the grown shard's offset", async () => {
    await writeFile(file, Array.from({ length: 20_000 }, (_, i) => line("m" + i)).join(""));
    const first = await readTraceTailLines(file, 50);
    expect(first.skippedUnits).toBe(19_950);

    await appendFile(file, Array.from({ length: 100 }, (_, i) => line("n" + i)).join(""));
    const second = await readTraceTailLines(file, 50);
    expect(second.messages.at(-1)).toMatchObject({ payload: { text: "n99" } });
    expect(second.skippedUnits).toBe(20_100 - 50);
  });
});
