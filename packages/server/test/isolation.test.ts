/**
 * Guards the one precondition vitest.config.ts's `isolate: false` rests on. Workers here
 * reuse their module registry across the files they run, so a module mock registered by one
 * file would still be in place for every file that follows it in the same worker — a failure
 * that shows up in an unrelated file and does not reproduce alone. Nothing in this suite
 * needs module mocking today; a file that starts to needs its own isolated project instead.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const testDir = import.meta.dirname;

describe("suite-wide isolation preconditions", () => {
  it("no test file registers a module mock", async () => {
    const files = (await fs.readdir(testDir)).filter((name) => name.endsWith(".test.ts"));
    // A sanity floor: an empty listing would make this test pass without checking anything.
    expect(files.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const name of files) {
      const source = await fs.readFile(path.join(testDir, name), "utf8");
      if (/\bvi\s*\.\s*(mock|doMock|unmock|doUnmock|resetModules)\s*\(/.test(source)) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });
});
