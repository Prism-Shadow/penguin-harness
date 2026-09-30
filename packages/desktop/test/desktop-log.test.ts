/**
 * The desktop log file: stamped lines, a child's output split into lines per stream, and the
 * one rotation that keeps it within twice its cap.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLogFile } from "../src/desktop-log.js";

const NOW = new Date("2026-09-29T08:00:00.000Z");
const at = () => NOW;

describe("openLogFile", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-desktop-log-"));
    file = path.join(dir, "logs", "desktop.log");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const read = (name = file) => fs.readFileSync(name, "utf8");

  it("creates its directory and stamps every line", () => {
    const log = openLogFile({ file, now: at });
    log.line("[shell] dev instance 'PenguinHarness Dev' on data root /tmp/x");
    log.line("[shell] a renderer is gone: window 1 (crashed, exit code 11)");
    log.close();
    expect(read()).toBe(
      "2026-09-29T08:00:00.000Z [shell] dev instance 'PenguinHarness Dev' on data root /tmp/x\n" +
        "2026-09-29T08:00:00.000Z [shell] a renderer is gone: window 1 (crashed, exit code 11)\n",
    );
  });

  it("appends to what an earlier launch wrote", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "earlier\n");
    const log = openLogFile({ file, now: at });
    log.line("later");
    log.close();
    expect(read()).toBe("earlier\n2026-09-29T08:00:00.000Z later\n");
  });

  it("splits a child's output into lines, holding a line until it ends, per stream", () => {
    const log = openLogFile({ file, now: at });
    log.output("stdout", "[server] ", "penguin-server started: http://localhost:5\nData ro");
    log.output("stderr", "[server] ", "[server] Uncaught exception: Error: boom\r\n    at x");
    expect(read()).toBe(
      "2026-09-29T08:00:00.000Z [server] penguin-server started: http://localhost:5\n" +
        "2026-09-29T08:00:00.000Z [server] [server] Uncaught exception: Error: boom\n",
    );
    log.output("stdout", "[server] ", "ot: /data\n");
    log.close();
    expect(read().split("\n").slice(2)).toEqual([
      "2026-09-29T08:00:00.000Z [server] Data root: /data",
      "2026-09-29T08:00:00.000Z [server]     at x",
      "",
    ]);
  });

  it("rotates into one previous file when a write would pass the cap", () => {
    const log = openLogFile({ file, now: at, maxBytes: 100 });
    // 25 bytes of stamp and space plus the text and its newline: two of these fit in 100.
    log.line("a".repeat(20));
    log.line("b".repeat(20));
    log.line("c".repeat(20));
    log.line("d".repeat(20));
    log.line("e".repeat(20));
    log.close();
    expect(read()).toBe(`2026-09-29T08:00:00.000Z ${"e".repeat(20)}\n`);
    expect(read(`${file}.1`)).toBe(
      `2026-09-29T08:00:00.000Z ${"c".repeat(20)}\n2026-09-29T08:00:00.000Z ${"d".repeat(20)}\n`,
    );
    expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(["desktop.log", "desktop.log.1"]);
  });

  it("cuts a runaway line rather than letting it rotate everything away", () => {
    const log = openLogFile({ file, now: at });
    log.line("x".repeat(40_000));
    log.close();
    const line = read().trimEnd();
    expect(line.length).toBeLessThan(17_000);
    expect(line.endsWith("…")).toBe(true);
  });

  it("turns itself off on the first error instead of throwing", () => {
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "a file where the directory should be");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const log = openLogFile({ file: path.join(blocker, "logs", "desktop.log"), now: at });
      expect(() => log.line("one")).not.toThrow();
      expect(() => log.line("two")).not.toThrow();
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(String(stderr.mock.calls[0]?.[0])).toContain("is off");
    } finally {
      stderr.mockRestore();
    }
  });
});
