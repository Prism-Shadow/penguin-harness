/**
 * Whether a process is PenguinHarness's own.
 *
 * - Given the server process, or (in the desktop app) the app's main process, those are the roots:
 *   they and everything below them are PenguinHarness's own; anything else is not.
 * - Given a parent id that names a process started after its child, the id was reused (Windows
 *   hands a dead process's id to the next one): the child is not adopted into that process's tree.
 * - Given a process table read a moment ago, it is used again — unless it does not know a process
 *   asked about, which reads it again.
 * - Given the real table of this machine, this very process belongs to its own tree.
 */
import { describe, expect, it } from "vitest";
import {
  belongsToTree,
  ownRoots,
  parseRows,
  readProcessTable,
  SelfTree,
} from "../src/self-target.js";

describe("PenguinHarness's own process tree", () => {
  const rows = (pairs: Array<[number, number]>) =>
    new Map(pairs.map(([pid, ppid]) => [pid, { ppid }]));
  const table = rows([
    [10, 1], // the desktop app's main process
    [11, 10], // its renderer
    [12, 10], // the server
    [13, 12], // an Agent's shell
    [14, 13], // an app that shell started
    [20, 1], // an app the user started
  ]);

  it("is the roots and everything below them, and nothing else", () => {
    const roots = [12, 10];
    for (const pid of [10, 11, 12, 13, 14])
      expect(belongsToTree(pid, roots, table), String(pid)).toBe(true);
    expect(belongsToTree(20, roots, table)).toBe(false);
    expect(belongsToTree(99, roots, table)).toBe(false);
  });

  it("has the app's main process as a root when the server runs in the desktop app", () => {
    expect(
      ownRoots({ pid: 12, ppid: 10, versions: { ...process.versions, electron: "43.0.0" } }),
    ).toEqual([12, 10]);
    const { electron: _none, ...node } = process.versions as Record<string, string>;
    expect(ownRoots({ pid: 12, ppid: 7, versions: node as NodeJS.ProcessVersions })).toEqual([12]);
  });

  it("does not adopt a child into a process that took its dead parent's id", () => {
    // The app (30) was launched by a process since gone, whose id the server's next child (31)
    // now holds: 31 started after 30, so it is not 30's parent.
    const reused = new Map([
      [12, { ppid: 1, start: 100 }],
      [31, { ppid: 12, start: 300 }],
      [30, { ppid: 31, start: 200 }],
    ]);
    expect(belongsToTree(30, [12], reused)).toBe(false);
    expect(belongsToTree(31, [12], reused)).toBe(true);
  });

  it("reads `<pid> <ppid> [<start>]` lines as a table, from Windows and from ps", () => {
    expect(parseRows("  1     0\n 10 1 133456789\r\nnot a row\n")).toEqual(
      new Map([
        [1, { ppid: 0 }],
        [10, { ppid: 1, start: 133456789 }],
      ]),
    );
    const ps = parseRows("  42     1 Thu Nov 20 10:00:00 2026\n");
    expect(ps.get(42)).toEqual({ ppid: 1, start: Date.parse("Thu Nov 20 10:00:00 2026") });
  });
});

describe("the kept table", () => {
  it("is used again for a moment, and read again for a process it does not know", async () => {
    let reads = 0;
    let now = 0;
    const tree = new SelfTree(
      async () => {
        reads++;
        return reads === 1
          ? new Map([[11, { ppid: 10 }]])
          : new Map([
              [11, { ppid: 10 }],
              [15, { ppid: 10 }],
            ]);
      },
      [10],
      5_000,
      () => now,
    );
    expect(await tree.own([11])).toEqual([11]);
    expect(await tree.own([11])).toEqual([11]);
    expect(reads).toBe(1);
    expect(await tree.own([15])).toEqual([15]);
    expect(reads).toBe(2);
    now = 6_000;
    await tree.own([11]);
    expect(reads).toBe(3);
  });
});

describe("this machine's table", () => {
  it("holds this process below itself", async () => {
    const rows = await readProcessTable();
    expect(belongsToTree(process.pid, [process.pid], rows)).toBe(true);
    expect(rows.get(process.pid)?.ppid).toBe(process.ppid);
    // On Windows the table is CIM read through PowerShell, which takes seconds on a CI runner.
  }, 30_000);
});
