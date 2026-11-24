/**
 * `/proc` read as figures: a process's CPU ticks and resident memory out of the two text files
 * the kernel publishes, and the share of one core between two readings.
 *
 * The parsers take text, so every case is a fixture: `/proc/<pid>/stat`'s second field is a
 * parenthesised command name that may itself hold spaces and parentheses, and the fields after it
 * are counted from the LAST `)`. `measureProcesses` is driven through an injected reader, never the
 * host's own `/proc`.
 */
import { describe, expect, it } from "vitest";
import {
  CLOCK_TICKS_PER_SECOND,
  cpuPercentBetween,
  measureProcesses,
  parseStatCpuTicks,
  parseStatusMemoryBytes,
  procAvailable,
  type ProcReader,
} from "../src/server/proc.js";

/** A `/proc/<pid>/stat` line with the fields the parser reads, the rest filled as a run of 0s. */
function statLine(name: string, utime: number, stime: number): string {
  // Fields 1..: pid, (name), state, ppid, … where 14 is utime and 15 stime.
  const before = ["1234", `(${name})`, "S", "1", "1234", "1234", "0", "-1", "4194560"];
  const middle = before.concat(["0", "0", "0", "0", String(utime), String(stime)]);
  return `${middle.join(" ")} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`;
}

const STATUS = `Name:\tnode
State:\tS (sleeping)
Tgid:\t1234
VmPeak:\t 2097152 kB
VmRSS:\t  179200 kB
Threads:\t7
`;

describe("parseStatCpuTicks", () => {
  it("reads utime and stime as one number of ticks", () => {
    expect(parseStatCpuTicks(statLine("node", 120, 30))).toBe(150);
  });

  it("counts the fields from the last ')' when the command name holds one", () => {
    expect(parseStatCpuTicks(statLine("a b (c) d", 7, 3))).toBe(10);
  });

  it("answers null for text that is not a stat line", () => {
    expect(parseStatCpuTicks("")).toBeNull();
    expect(parseStatCpuTicks("no parentheses here")).toBeNull();
    expect(parseStatCpuTicks("1234 (x) S 1 2 3")).toBeNull();
    expect(parseStatCpuTicks(statLine("x", Number.NaN, 1))).toBeNull();
  });
});

describe("parseStatusMemoryBytes", () => {
  it("reads VmRSS in kB as bytes", () => {
    expect(parseStatusMemoryBytes(STATUS)).toBe(179200 * 1024);
  });

  it("answers null when the file names no resident set", () => {
    expect(parseStatusMemoryBytes("Name:\tnode\n")).toBeNull();
    expect(parseStatusMemoryBytes("")).toBeNull();
  });
});

describe("cpuPercentBetween", () => {
  it("gives the share of one core, one decimal", () => {
    // 10 ticks over 200 ms: 20 ticks elapsed, so half a core.
    expect(
      cpuPercentBetween({ cpuTicks: 100, memoryBytes: 0 }, { cpuTicks: 110, memoryBytes: 0 }, 200),
    ).toBe(50);
    // 1 tick over 200 ms of a 100 Hz clock: 5% of a core.
    expect(
      cpuPercentBetween({ cpuTicks: 0, memoryBytes: 0 }, { cpuTicks: 1, memoryBytes: 0 }, 200),
    ).toBe(5);
  });

  it("caps at one core and answers null where there is nothing to divide by", () => {
    expect(
      cpuPercentBetween({ cpuTicks: 0, memoryBytes: 0 }, { cpuTicks: 500, memoryBytes: 0 }, 200),
    ).toBe(100);
    expect(
      cpuPercentBetween({ cpuTicks: 10, memoryBytes: 0 }, { cpuTicks: 10, memoryBytes: 0 }, 0),
    ).toBeNull();
    // The pid was reused: its counter started again.
    expect(
      cpuPercentBetween({ cpuTicks: 100, memoryBytes: 0 }, { cpuTicks: 3, memoryBytes: 0 }, 200),
    ).toBeNull();
  });
});

describe("measureProcesses", () => {
  /** A reader over a fixture: the two files of each pid, and how each pid's counter moves. */
  function readerOf(files: Record<string, string[]>): ProcReader {
    const seen = new Map<string, number>();
    return async (file) => {
      const versions = files[file];
      if (versions === undefined) throw new Error(`ENOENT: ${file}`);
      const i = seen.get(file) ?? 0;
      seen.set(file, i + 1);
      return versions[Math.min(i, versions.length - 1)]!;
    };
  }

  it("samples a pid twice and answers its CPU share and its memory", async () => {
    const measured = await measureProcesses([4821], {
      intervalMs: 200,
      readFile: readerOf({
        "/proc/4821/stat": [statLine("node", 100, 0), statLine("node", 110, 0)],
        "/proc/4821/status": [STATUS],
      }),
    });
    expect(measured.get(4821)).toEqual({ cpu: 50, memory: 179200 * 1024 });
  });

  it("includes live child processes listed in /proc/<pid>/task/<pid>/children", async () => {
    const childStatus = `Name:\tvitest\nVmRSS:\t   50000 kB\n`;
    const measured = await measureProcesses([4821], {
      intervalMs: 200,
      readFile: readerOf({
        "/proc/4821/stat": [statLine("bash", 10, 0), statLine("bash", 10, 0)],
        "/proc/4821/status": [STATUS],
        "/proc/4821/task/4821/children": ["4822\n", "4822\n"],
        "/proc/4822/stat": [statLine("vitest", 100, 0), statLine("vitest", 115, 0)],
        "/proc/4822/status": [childStatus],
      }),
    });
    expect(measured.get(4821)).toEqual({
      cpu: 75,
      memory: (179200 + 50000) * 1024,
    });
  });

  it("answers nulls for a pid that is gone, or one the harness never spawned", async () => {
    const measured = await measureProcesses([9999, 0, -1], {
      intervalMs: 1,
      readFile: readerOf({}),
    });
    for (const pid of [9999, 0, -1]) expect(measured.get(pid)).toEqual({ cpu: null, memory: null });
  });

  it("answers nothing at all for no pids, without waiting", async () => {
    const measured = await measureProcesses([], { readFile: readerOf({}) });
    expect(measured.size).toBe(0);
  });

  it("reads the kernel's 100 Hz clock", () => {
    expect(CLOCK_TICKS_PER_SECOND).toBe(100);
    // Away from Linux there is no /proc at all: the tree still lists processes, without figures.
    expect(typeof procAvailable()).toBe("boolean");
  });
});
