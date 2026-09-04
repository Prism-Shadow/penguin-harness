/**
 * `penguin server stop` (commands/server-stop.ts): what "stopped" means, and what a signal
 * that did not land means. Driven with injected effects — the signal, the clock, the
 * platform — against a real lock file, so no server has to exist to be stopped.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stop } from "../src/commands/server-stop.js";
import type { StopEffects } from "../src/commands/server-stop.js";

/** A lock the liveness probe accepts: this process's pid, and a port that answers. */
async function liveRoot(): Promise<{ root: string; port: number; close: () => void }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-stop-"));
  const server = net.createServer();
  const port = await new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
  fs.writeFileSync(
    path.join(root, "server.lock"),
    JSON.stringify({ pid: process.pid, port, startedAt: "2026-09-01T00:00:00.000Z" }),
  );
  return { root, port, close: () => server.close() };
}

/** An error the way process.kill raises one. */
const signalError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(code), { code });

/** Effects with a clock that jumps on every sleep, so a wait of 15s costs nothing. */
function effects(over: Partial<StopEffects>): StopEffects {
  let now = 0;
  return {
    kill: () => {},
    platform: "linux",
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    ...over,
  };
}

describe("penguin server stop", () => {
  let live: Awaited<ReturnType<typeof liveRoot>>;
  beforeEach(async () => {
    live = await liveRoot();
  });
  afterEach(() => {
    live.close();
    fs.rmSync(live.root, { recursive: true, force: true });
  });

  it("a root nothing is serving is already the outcome asked for", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-stop-empty-"));
    try {
      expect(await stop(empty, effects({}))).toEqual({ ok: true });
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("refuses on Windows: a signal there ends the process outright, which is the destruction it exists not to do", async () => {
    const sent: unknown[] = [];
    const result = await stop(
      live.root,
      effects({ platform: "win32", kill: (...a) => sent.push(a) }),
    );
    expect(result).toMatchObject({ ok: false, pid: process.pid });
    expect(result.detail).toContain("Windows");
    expect(sent).toEqual([]);
  });

  it("a server that could not be signalled is still serving — only ESRCH is 'already gone'", async () => {
    const denied = await stop(
      live.root,
      effects({
        kill: () => {
          throw signalError("EPERM");
        },
      }),
    );
    expect(denied).toMatchObject({ ok: false, pid: process.pid });
    expect(denied.detail).toContain("EPERM");

    const gone = await stop(
      live.root,
      effects({
        kill: () => {
          throw signalError("ESRCH");
        },
      }),
    );
    expect(gone).toEqual({ ok: true });
  });

  it("stopped means the process is gone or the lock is no longer its; a closed listener is not yet that", async () => {
    // On the signal the listener closes at once — as a draining server's does — while the
    // process lives on and the lock still names it. That is not stopped, and the command
    // keeps waiting until its deadline.
    const result = await stop(
      live.root,
      effects({
        kill: (_pid, signal) => {
          if (signal === "SIGTERM") live.close();
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, pid: process.pid });
    expect(result.detail).toContain("still holds");
  });

  it("the process exiting is the stop", async () => {
    let signalled = false;
    const result = await stop(
      live.root,
      effects({
        kill: (_pid, signal) => {
          if (signal === "SIGTERM") {
            signalled = true;
            return;
          }
          // Liveness checks after the signal: the process is gone.
          if (signalled) throw signalError("ESRCH");
        },
      }),
    );
    expect(result).toEqual({ ok: true, pid: process.pid });
  });

  it("the lock changing hands is the stop too", async () => {
    const result = await stop(
      live.root,
      effects({
        kill: (_pid, signal) => {
          if (signal === "SIGTERM") fs.rmSync(path.join(live.root, "server.lock"));
        },
      }),
    );
    expect(result).toEqual({ ok: true, pid: process.pid });
  });
});
