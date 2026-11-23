/**
 * - When a launcher stops reading stdout mid-run, server output and subsequent shell lines
 *   still reach the file, and a later file error can still be reported on stderr.
 * - When both pipes have lost their readers before the first write, the app keeps logging
 *   to disk and survives a file error with no stderr available.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const logModule = new URL("../src/desktop-log.ts", import.meta.url).href;
const program = `
  import { setImmediate } from "node:timers/promises";
  import { startDesktopLog, logLine, logServerOutput, stopDesktopLog } from ${JSON.stringify(logModule)};
  const [file, mode] = process.argv.slice(1);
  startDesktopLog(file);
  if (mode === "attached") logLine("launcher attached");
  process.stdin.once("data", async () => {
    logServerOutput("stdout", "server online\\n");
    await setImmediate();
    logServerOutput("stderr", "unfinished diagnostic");
    logLine("still running");
    stopDesktopLog();
    startDesktopLog(file + "/unwritable");
    logLine("log directory is blocked");
    stopDesktopLog();
  });
`;

describe.skipIf(process.platform === "win32")("desktop logging with closed POSIX pipes", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-desktop-pipes-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.each(["attached", "detached"] as const)(
    "keeps the desktop app and its log alive when launched %s",
    async (mode) => {
      const file = path.join(dir, "desktop.log");
      const child = spawn(process.execPath, ["--input-type=module", "--eval", program, file, mode]);
      const closed = once(child, "close");
      let stderr = "";
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      try {
        if (mode === "attached") {
          const [output] = await once(child.stdout, "data");
          expect(output.toString()).toBe("launcher attached\n");
        } else {
          child.stderr.destroy();
        }
        child.stdout.destroy();
        child.stdin.end("continue");
        expect(await closed, stderr).toEqual([0, null]);
        const log = fs.readFileSync(file, "utf8");
        expect(log).toContain("[server] server online\n");
        expect(log).toContain("still running\n");
        expect(log).toContain("[server] unfinished diagnostic\n");
        if (mode === "attached") expect(stderr).toContain("is off");
      } finally {
        child.kill();
      }
    },
  );
});
