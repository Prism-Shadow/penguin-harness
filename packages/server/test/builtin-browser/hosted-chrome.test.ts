/**
 * Finding and launching the hosted backend's Chrome:
 *
 * - The path an admin set comes first, then the known names on PATH, then the platform's
 *   standard install locations; with none of them there is no Chrome.
 * - The command line has the debugging pipe, the new headless mode and the profile under the
 *   data root — and neither `--no-sandbox` nor a debugging port.
 * - The pipe carries one JSON message per NUL, in both directions, whatever the chunking.
 * - A failed launch is told in Chrome's own error line.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chromeArgs,
  findChrome,
  hostedProfileDir,
  launchChrome,
  launchFailureLine,
} from "../../src/builtin-browser/hosted-chrome.js";

describe("findChrome", () => {
  const find = (
    files: string[],
    opts: { configured?: string | null; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
  ) =>
    findChrome({
      platform: "linux",
      env: { PATH: "/usr/local/bin:/usr/bin" },
      home: "/home/ann",
      ...opts,
      isExecutable: (file) => files.includes(file),
    });

  it("prefers the path an admin set over everything the machine has", () => {
    const files = ["/opt/custom/chrome", "/usr/bin/google-chrome", "/opt/google/chrome/chrome"];
    expect(find(files, { configured: "/opt/custom/chrome" })).toBe("/opt/custom/chrome");
    // A path that is not there is passed over, not launched.
    expect(find(files, { configured: "/opt/gone/chrome" })).toBe("/usr/bin/google-chrome");
  });

  it("takes the known names on PATH, in their order, before the standard locations", () => {
    expect(find(["/usr/bin/chromium", "/opt/google/chrome/chrome"])).toBe("/usr/bin/chromium");
    expect(find(["/usr/bin/chromium", "/usr/bin/google-chrome"])).toBe("/usr/bin/google-chrome");
    expect(find(["/usr/bin/chromium", "/usr/local/bin/chromium"])).toBe("/usr/local/bin/chromium");
    expect(find(["/opt/google/chrome/chrome"])).toBe("/opt/google/chrome/chrome");
  });

  it("knows where macOS and Windows keep it", () => {
    const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    expect(find([mac], { platform: "darwin" })).toBe(mac);
    const own = "/home/ann/Applications/Chromium.app/Contents/MacOS/Chromium";
    expect(find([own], { platform: "darwin" })).toBe(own);

    const env = {
      Path: "C:\\Windows;C:\\Tools",
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\ann\\AppData\\Local",
    };
    const perUser = "C:\\Users\\ann\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
    expect(find([perUser], { platform: "win32", env })).toBe(perUser);
    const system = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    expect(find([perUser, system], { platform: "win32", env })).toBe(system);
    expect(find(["C:\\Tools\\chrome.exe", system], { platform: "win32", env })).toBe(
      "C:\\Tools\\chrome.exe",
    );
  });

  it("answers null when the machine has no Chrome", () => {
    expect(find([])).toBeNull();
    expect(find([], { platform: "darwin" })).toBeNull();
    expect(find([], { platform: "win32", env: {} })).toBeNull();
  });
});

describe("chromeArgs", () => {
  it("launches headless on the debugging pipe with the profile under the data root", () => {
    const profile = hostedProfileDir("/data");
    expect(profile).toBe(path.join("/data", "builtin-browser", "hosted-profile"));
    const args = chromeArgs(profile);
    expect(args).toContain("--remote-debugging-pipe");
    expect(args).toContain("--headless=new");
    expect(args).toContain(`--user-data-dir=${profile}`);
  });

  it("keeps Chrome off the desktop's keyring on Linux, where a server has none to answer", () => {
    expect(chromeArgs("/p", "linux")).toContain("--password-store=basic");
    expect(chromeArgs("/p", "darwin")).not.toContain("--password-store=basic");
    expect(chromeArgs("/p", "win32")).not.toContain("--password-store=basic");
  });

  it("never turns the sandbox off, and opens no debugging port", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      const args = chromeArgs("/data/builtin-browser/hosted-profile", platform);
      expect(args.some((arg) => arg.startsWith("--no-sandbox"))).toBe(false);
      expect(args.some((arg) => arg.startsWith("--disable-setuid-sandbox"))).toBe(false);
      expect(args.some((arg) => arg.startsWith("--remote-debugging-port"))).toBe(false);
      expect(args.some((arg) => arg.startsWith("--remote-debugging-address"))).toBe(false);
    }
  });
});

describe("launchChrome", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-hosted-chrome-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A child process as launchChrome uses one: stderr, and the pipe on fd 3 and fd 4. */
  function fakeChild() {
    const child = new EventEmitter() as EventEmitter & {
      stdio: unknown[];
      stderr: PassThrough;
      signals: string[];
      kill(signal: string): boolean;
    };
    const stderr = new PassThrough();
    const toChrome = new PassThrough();
    const fromChrome = new PassThrough();
    child.stdio = [null, null, stderr, toChrome, fromChrome];
    child.stderr = stderr;
    child.signals = [];
    child.kill = (signal) => {
      child.signals.push(signal);
      return true;
    };
    return { child, stderr, toChrome, fromChrome };
  }

  function launch() {
    const fake = fakeChild();
    const spawned: { command: string; args: string[]; stdio: unknown }[] = [];
    const profile = path.join(dir, "builtin-browser", "hosted-profile");
    const pipe = launchChrome("/usr/bin/google-chrome", profile, (command, args, options) => {
      spawned.push({ command, args, stdio: options.stdio });
      return fake.child as unknown as ChildProcess;
    });
    const received: string[] = [];
    pipe.onMessage((text) => received.push(text));
    return { ...fake, pipe, spawned, profile, received };
  }

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it("spawns Chrome with the pipe on fd 3 and 4, on a profile directory it created", () => {
    const { spawned, profile } = launch();
    expect(spawned).toEqual([
      {
        command: "/usr/bin/google-chrome",
        args: chromeArgs(profile),
        stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
      },
    ]);
    expect(fs.statSync(profile).isDirectory()).toBe(true);
  });

  it("writes each message NUL-terminated, and reads messages across any chunking", async () => {
    const { pipe, toChrome, fromChrome, received } = launch();
    pipe.send('{"id":1,"method":"Browser.getVersion"}');
    expect(toChrome.read().toString("utf8")).toBe('{"id":1,"method":"Browser.getVersion"}\0');

    // Two messages in one chunk, then one split inside a multi-byte character.
    fromChrome.write(Buffer.from('{"id":1}\0{"id":2}\0'));
    const wide = Buffer.from('{"title":"标签页"}\0{"id":3', "utf8");
    fromChrome.write(wide.subarray(0, 12));
    fromChrome.write(wide.subarray(12));
    fromChrome.write(Buffer.from("}\0"));
    await settle();
    expect(received).toEqual(['{"id":1}', '{"id":2}', '{"title":"标签页"}', '{"id":3}']);
  });

  it("keeps what Chrome printed, tells of its exit once, and refuses messages after it", async () => {
    const { pipe, child, stderr } = launch();
    const exits: unknown[] = [];
    pipe.onClose((exit) => exits.push(exit));
    stderr.write("[1:1:ERROR:x.cc(1)] No usable sandbox!\n");
    await settle();
    expect(pipe.stderr()).toContain("No usable sandbox!");
    child.emit("exit", 1, null);
    child.emit("exit", 1, null);
    expect(exits).toEqual([{ code: 1, signal: null }]);
    expect(() => pipe.send("{}")).toThrow(/exited/);
  });

  it("reports a program that cannot be started as a closed pipe with the system's error", () => {
    const { pipe, child } = launch();
    const exits: unknown[] = [];
    pipe.onClose((exit) => exits.push(exit));
    child.emit("error", new Error("spawn /usr/bin/google-chrome ENOENT"));
    expect(exits).toEqual([{ code: null, signal: null }]);
    expect(pipe.stderr()).toContain("ENOENT");
  });

  it("ends Chrome by closing the pipe and signalling it", async () => {
    const { pipe, child, toChrome } = launch();
    pipe.kill();
    await settle();
    expect(toChrome.writableEnded).toBe(true);
    expect(child.signals).toEqual(["SIGTERM"]);
    child.emit("exit", 0, null);
  });
});

describe("launchFailureLine", () => {
  it("takes Chrome's last error line without its log prefix", () => {
    const stderr =
      "[9:9:1004/101010.1:WARNING:a.cc(1)] nothing to see\n" +
      "[9:9:1004/101010.2:ERROR:zygote_host_impl_linux.cc(101)] Running as root without --no-sandbox is not supported.\n" +
      "[9:9:1004/101010.3:WARNING:b.cc(2)] shutting down\n";
    expect(launchFailureLine(stderr, "fallback")).toBe(
      "Running as root without --no-sandbox is not supported.",
    );
  });

  it("falls back to the last line, then to what the caller knows", () => {
    expect(
      launchFailureLine("chrome: error while loading shared libraries: libnss3.so\n", "x"),
    ).toBe("chrome: error while loading shared libraries: libnss3.so");
    expect(launchFailureLine("  \n", "Chrome has exited.")).toBe("Chrome has exited.");
  });
});
