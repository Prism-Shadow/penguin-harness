/**
 * The one connection per machine — the host's half, which knows no kind. Driven by a TEST kind
 * whose shell is a stub on PATH (`machine-shell`, which becomes a real `sh`; POSIX only). The
 * assertions are the ones the ssh-bound version of this file made; ssh's own half (its argv,
 * its forwards) is tested in plugins/machine-ssh.
 *
 * - Commands run with their exit code, and an `exit` cannot end the session.
 * - A command gets its stdin as a heredoc, bytes intact, and its lines are relayed as they
 *   arrive.
 * - There is one session however many ask: commands to one machine queue, two opens spawn
 *   once, and different machines run side by side.
 * - A session that dies says why in its own words and is not kept.
 * - A command that outlasts its timeout answers with the timeout, and the next one gets a
 *   live session; on a held session the corpse is dropped but the hold kept.
 * - A held session that dies comes back on its own after the shortest reconnect wait; a
 *   closed one stays closed; closing lets go, and the next ask opens a new session.
 * - A session a command opened is up but is not a connection until it is held.
 * - A held session outlives its generation in the resource registry: a successor judged to speak
 *   another contract opens its own, and one that adopts it is the one told when it drops — not
 *   the generation that opened it.
 * - With a telemetry sink set, every command is a sample: its exit code, a timeout as such,
 *   never its text.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Resources } from "@prismshadow/penguin-core/kernel";
import {
  attachSessionRegistry,
  closeAllConnections,
  closeConnectionTo,
  connectionTo,
  heldSessionOf,
  sessionOf,
} from "../src/machines/transport/index.js";
import type { RemoteTarget } from "../src/machines/transport/index.js";
import type { Machine } from "../src/mechanisms/machines.js";

// The stub `machine-shell` below is a shell script, which execFile cannot run on Windows;
// what stays unmeasured there is listed in ci.yml's test-windows note.
/** The test kind: its shell is `machine-shell <name>`, found on PATH; it has nothing else. */
function testMachine(name: string, calls: { ups: number } = { ups: 0 }): Machine {
  return {
    launch: async () => ({ program: "machine-shell", args: [name] }),
    up: async () => {
      calls.ups += 1;
    },
    ready: async () => ({ ok: true }),
    dial: async () => {
      throw new Error("no dial in this kind");
    },
    oneShot: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
    copyTo: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
    diagnose: () => null,
    forwards: () => null,
  };
}

const target = (name: string, machine: Machine = testMachine(name)): RemoteTarget => ({
  address: `test:${name}`,
  kind: "test",
  name,
  machine,
  node: "node",
});
  setTimingsSink,
  useControlSockets,
} from "../src/machines/transport/index.js";
import { SshPasswords } from "../src/machines/ssh-passwords.js";
import type { MachineSample } from "../src/machines/transport/index.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

/**
 * The runtime's resource registry as the transport uses it: one entry per id, a later
 * registration takes the slot over, and a release whose registration lost the slot does nothing.
 */
function fakeRegistry(): {
  registry: Resources;
  entry: (id: string) => { resource: unknown; dispose?: () => void } | undefined;
} {
  const store = new Map<string, { resource: unknown; dispose?: () => void }>();
  const registry: Resources = {
    register(id, resource, dispose) {
      const entry = { resource, dispose };
      store.delete(id);
      store.set(id, entry);
      return () => {
        if (store.get(id) !== entry) return;
        store.delete(id);
        entry.dispose?.();
      };
    },
    claim: <T>(id: string) => store.get(id)?.resource as T | undefined,
  };
  return { registry, entry: (id) => store.get(id) };
}

/**
 * The transport's session module imported afresh, as a hot push re-imports the platform bundle
 * (hmr/host.ts): a generation with its own map of sessions and its own listeners.
 */
async function generation(
  n: number,
): Promise<typeof import("../src/machines/transport/shell-session.js")> {
  const file = path.join(import.meta.dirname, "../src/machines/transport/shell-session.ts");
  return import(/* @vite-ignore */ `${file}?generation=${n}`);
}

posixOnly("the session", () => {
  let stubBin: string;
  let logFile: string;
  let originalPath: string | undefined;
  beforeEach(() => {
    stubBin = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-session-"));
    logFile = path.join(stubBin, "calls.log");
    // Every invocation is logged; a machine named "refused" dies the way a refused login
    // does; any other becomes a real `sh` — commands run locally, harmlessly.
    fs.writeFileSync(
      path.join(stubBin, "machine-shell"),
      `#!/bin/sh
echo "$*" >> ${JSON.stringify(logFile)}
case "$*" in *refused*) echo "deploy@refused: Permission denied (publickey)." >&2; exit 255 ;; esac
exec /bin/sh
`,
    );
    fs.chmodSync(path.join(stubBin, "machine-shell"), 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${stubBin}:${process.env.PATH ?? ""}`;
  });
  afterEach(() => {
    for (const address of ["test:nas", "test:build-box", "test:refused"])
      closeConnectionTo(address);
    process.env.PATH = originalPath;
    fs.rmSync(stubBin, { recursive: true, force: true });
  });
  const spawns = () =>
    fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n") : [];

  it("counts a session a command opened as up, and as a connection only once it is held", async () => {
    const conn = connectionTo(target("nas"));
    await conn.exec("true");
    expect(sessionOf("test:nas")).not.toBeNull();
    expect(heldSessionOf("test:nas")).toBeNull();
    expect((await conn.hold()).ok).toBe(true);
    expect(heldSessionOf("test:nas")).not.toBeNull();
    expect(heldSessionOf("test:nas")).toEqual(sessionOf("test:nas"));
  });

  it("runs commands with their exit code, and an `exit` cannot end the session", async () => {
    const conn = connectionTo(target("nas"));
    // The command's own trailing newline is kept, as execFile would keep it.
    expect(await conn.exec("echo hi")).toMatchObject({ code: 0, stdout: "hi\n" });
    expect((await conn.exec("exit 3")).code).toBe(3);
    expect(await conn.exec("echo still here")).toMatchObject({ code: 0, stdout: "still here\n" });
    expect(spawns()).toHaveLength(1);
  });

  it("with a sink set, every command is a sample — exit code, a timeout as such, never its text", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    const samples: MachineSample[] = [];
    setTimingsSink((sample) => samples.push(sample));
    try {
      expect((await conn.exec("echo top-secret-words")).code).toBe(0);
      expect((await conn.exec("exit 3")).code).toBe(3);
      await conn.stream("sleep 5", { input: Buffer.alloc(0), timeoutMs: 150 });
    } finally {
      setTimingsSink(null);
    }
    expect(samples.map((s) => [s.probe, s.status, s.attrs?.code])).toEqual([
      ["machine.ssh.command", "ok", 0],
      ["machine.ssh.command", "exit", 3],
      ["machine.ssh.command", "timeout", 255],
    ]);
    expect(JSON.stringify(samples)).not.toContain("top-secret-words");
  });

  it("hands a command its stdin as a heredoc, bytes intact, and relays lines as they arrive", async () => {
    const conn = connectionTo(target("nas"));
    const input = Buffer.from("héllo\nEOF\nworld\n", "utf8");
    const lines: string[] = [];
    const result = await conn.stream("cat", { input, onLine: (line) => lines.push(line) });
    expect(result).toMatchObject({ code: 0, stdout: "héllo\nEOF\nworld\n" });
    expect(lines).toEqual(["héllo", "EOF", "world"]);
    // Binary survives too: the tarball case.
    const bytes = Buffer.from([0x1f, 0x8b, 0x00, 0xff, 0x0a, 0x0d, 0x00]);
    const echoed = await conn.stream("od -An -tx1 | tr -d ' \\n'", { input: bytes });
    expect(echoed.stdout).toBe("1f8b00ff0a0d00");
  });

  it("is one session however many ask: commands queue, and two opens spawn once", async () => {
    const conn = connectionTo(target("nas"));
    const [a, b] = await Promise.all([conn.open(), conn.open()]);
    expect(a.ok && b.ok && a.session.pid === b.session.pid).toBe(true);
    expect(spawns()).toHaveLength(1);
    expect(sessionOf("test:nas")?.pid).toBe(a.ok ? a.session.pid : -1);

    let started = Date.now();
    await Promise.all([conn.exec("sleep 0.2"), conn.exec("sleep 0.2")]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(380);
    // A different machine is a different session: those run side by side.
    const other = connectionTo(target("build-box"));
    started = Date.now();
    await Promise.all([conn.exec("sleep 0.2"), other.exec("sleep 0.2")]);
    expect(Date.now() - started).toBeLessThan(380);
    expect(spawns()).toHaveLength(2);
  });

  it("a session that dies says why, in its own words, and is not kept", async () => {
    const conn = connectionTo(target("refused"));
    const opened = await conn.open();
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.detail).toContain("Permission denied");
    expect(sessionOf("test:refused")).toBeNull();
  });

  it("answers a command that outlasts its timeout with the timeout, and hands the next one a live session", async () => {
    const conn = connectionTo(target("nas"));
    // Establish the session before timing the command. A cold shell can take longer than
    // 150 ms to reach the stub's log; killing it sooner tests startup, not a running command.
    const opened = await conn.open();
    expect(opened.ok).toBe(true);
    expect(spawns()).toHaveLength(1);
    // The timeout is this command's own answer. Dropping the session also answers whatever is
    // pending — with the connection's last words — so the two race for the one resolution a
    // promise has, and the precise diagnosis has to win.
    const timedOut = await conn.stream("sleep 5", { input: Buffer.alloc(0), timeoutMs: 150 });
    expect(timedOut).toMatchObject({ code: 255, stdout: "the machine did not answer in time" });

    // The killed session's close event lands while its replacement is already coming up. It
    // belongs to a child nobody holds any more, and must not take the replacement — or the
    // command riding it — down with it.
    expect(await conn.exec("echo after")).toMatchObject({ code: 0, stdout: "after\n" });
    expect(conn.session()?.pid).not.toBe(opened.ok ? opened.session.pid : undefined);
    expect(spawns()).toHaveLength(2);
  });

  it("a held session that dies comes back on its own; a closed one stays closed", async () => {
    // The reopen wait is a timer and the clock is the test's: the reconnect and the silence
    // after a close are advanced to, not waited out. The child processes stay real, so what
    // they do is waited for by turning the event loop, never by a timer.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const until = async (condition: () => boolean, what: string): Promise<void> => {
      const deadline = Date.now() + 5_000;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setImmediate(resolve));
      }
    };
    try {
      const conn = connectionTo(target("nas"));
      const held = await conn.hold();
      expect(held.ok).toBe(true);
      expect(conn.held()).toBe(true);
      const first = sessionOf("test:nas")!.pid;

      // The link drops — the child is gone, as after keepalives give up on a dead link.
      process.kill(first);
      await until(() => sessionOf("test:nas") === null, "the session to drop");
      // Held, so the transport brings it back after the shortest wait, a second.
      await vi.advanceTimersByTimeAsync(999);
      expect(sessionOf("test:nas")).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await until(() => sessionOf("test:nas") !== null, "the session to come back");
      const second = sessionOf("test:nas");
      expect(second!.pid).not.toBe(first);
      // And it is a working session, still held. The spawn count is read only after a command
      // has completed over it: the stub logs its own invocation from inside the child, after
      // spawn() has already returned a pid, so a session can exist before its line is there.
      expect(await conn.exec("echo back")).toMatchObject({ code: 0, stdout: "back\n" });
      expect(spawns()).toHaveLength(2);
      expect(conn.held()).toBe(true);

      // An explicit close lets go for good: past every reopen wait, nothing reopens it.
      closeConnectionTo("test:nas");
      expect(conn.held()).toBe(false);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(sessionOf("test:nas")).toBeNull();
      expect(spawns()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a command that times out on a held session drops the corpse but keeps the hold", async () => {
    const conn = connectionTo(target("nas"));
    await conn.hold();
    const timedOut = await conn.stream("sleep 5", { input: Buffer.alloc(0), timeoutMs: 150 });
    expect(timedOut).toMatchObject({ code: 255, stdout: "the machine did not answer in time" });
    expect(conn.held()).toBe(true);
    // The next command finds a session — reopened by the command itself or by the hold.
    expect(await conn.exec("echo after")).toMatchObject({ code: 0, stdout: "after\n" });
    expect(conn.held()).toBe(true);
  });

  it("closing lets go of the session; the next ask opens a new one", async () => {
    const conn = connectionTo(target("nas"));
    await conn.exec("true");
    closeConnectionTo("test:nas");
    expect(sessionOf("test:nas")).toBeNull();
    await conn.exec("true");
    expect(spawns()).toHaveLength(2);
  });

  it("a held session is delivered through the registry and claimed back, a transient one is not", async () => {
    const store = new Map<string, { resource: unknown; dispose?: () => void }>();
    const registry: Resources = {
      register(id, resource, dispose) {
        const entry = { resource, dispose };
        store.delete(id);
        store.set(id, entry);
        return () => {
          if (store.get(id) !== entry) return;
          store.delete(id);
          entry.dispose?.();
        };
      },
      claim: <T>(id: string) => store.get(id)?.resource as T | undefined,
    } as Resources;
    attachSessionRegistry(registry);
    try {
      const held = await connectionTo(target("nas")).hold();
      const transient = await connectionTo(target("build-box")).open();
      expect(held.ok && transient.ok).toBe(true);
      expect(store.has("machineSession.v3:test:nas")).toBe(true);
      expect(store.has("machineSession.v3:test:build-box")).toBe(false);

      // The generation goes: its transient session ends, its held one stays up.
      closeAllConnections();
      expect(sessionOf("test:nas")).toBeNull(); // this generation's map is empty…
      // …and the next generation's first ask claims the same child back, no spawn.
      const again = await connectionTo(target("nas")).hold();
      expect(again.ok && held.ok && again.session.pid === held.session.pid).toBe(true);
      expect(spawns().filter((line) => line === "nas")).toHaveLength(1);
      expect(spawns().filter((line) => line === "build-box")).toHaveLength(1);
      // A disconnect closes it for good, registry entry included.
      closeConnectionTo("test:nas");
      expect(store.has("machineSession.v3:test:nas")).toBe(false);
    } finally {
      attachSessionRegistry(null);
    }
  });

  it("does not claim a delivered session the platform judged another contract — it opens its own", async () => {
    const store = new Map<string, { resource: unknown; dispose?: () => void }>();
    const registry: Resources = {
      register(id, resource, dispose) {
        const entry = { resource, dispose };
        store.delete(id);
        store.set(id, entry);
        return () => {
          if (store.get(id) !== entry) return;
          store.delete(id);
          entry.dispose?.();
        };
      },
      claim: <T>(id: string) => store.get(id)?.resource as T | undefined,
    } as Resources;
    attachSessionRegistry(registry);
    try {
      const held = await connectionTo(target("nas")).hold();
      expect(held.ok).toBe(true);
      closeAllConnections(); // the generation leaves; its held session stays in the registry
      // The next generation was told the contract differs: it opens a session of its own…
      attachSessionRegistry(registry, false);
      const again = await connectionTo(target("nas")).hold();
      expect(again.ok && held.ok && again.session.pid !== held.session.pid).toBe(true);
      expect(spawns().filter((line) => line === "nas")).toHaveLength(2);
      // …and the platform's disposal of the doomed group ends the old one.
      store.get("machineSession.v3:test:nas")?.dispose?.();
    } finally {
      closeConnectionTo("test:nas");
      attachSessionRegistry(null);
    }
  });

  it("a held session the next generation adopts tells that generation when it drops, not the one that opened it", async () => {
    // Inside the test's own deadline, so a drop told to the wrong generation fails by name.
    const until = async (condition: () => boolean, what: string): Promise<void> => {
      const deadline = Date.now() + 2_000;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setImmediate(resolve));
      }
    };
    const { registry } = fakeRegistry();
    const older = await generation(1);
    const newer = await generation(2);
    const heardByOlder: string[] = [];
    const heardByNewer: string[] = [];
    const hear = (heard: string[]) => (address: string, up: boolean) =>
      heard.push(`${address} ${up ? "up" : "down"}`);
    const unwatchOlder = older.onSessionChange(hear(heardByOlder));
    const unwatchNewer = newer.onSessionChange(hear(heardByNewer));
    try {
      older.attachSessionRegistry(registry);
      const held = await older.holdShell("test:nas", target("nas").machine);
      if (!held.ok) throw new Error(held.detail);
      expect(heardByOlder).toEqual(["test:nas up"]);
      older.closeAllShells(); // the older generation leaves; its held session stays registered

      // The newer one holds the machine again and gets the live session, not a second ssh.
      newer.attachSessionRegistry(registry);
      const adopted = await newer.holdShell("test:nas", target("nas").machine);
      expect(adopted.ok && adopted.session.pid).toBe(held.session.pid);
      expect(spawns()).toHaveLength(1);

      // The link drops: the generation keeping the machine connected is the one told.
      process.kill(held.session.pid);
      await until(() => heardByNewer.includes("test:nas down"), "the drop to be told");
      expect(heardByOlder).toEqual(["test:nas up"]);
    } finally {
      unwatchOlder();
      unwatchNewer();
      newer.closeShell("test:nas");
      older.closeShell("test:nas");
      older.attachSessionRegistry(null);
      newer.attachSessionRegistry(null);
    }
  });

  it("spawns once for one address however many callers ask at the same moment; the second waits for the first", async () => {
    // Four handles, as four callers would each make one: the session is the address's, not
    // the handle's, so they share one child and their commands take turns on it.
    const conns = [1, 2, 3, 4].map(() => connectionTo(target("nas")));
    const started = Date.now();
    const results = await Promise.all(conns.map((conn) => conn.exec("sleep 0.15; echo done")));
    expect(results.every((r) => r.code === 0 && r.stdout === "done\n")).toBe(true);
    // Queued, not side by side: four 150 ms commands on one shell take at least 600 ms.
    expect(Date.now() - started).toBeGreaterThanOrEqual(580);
    expect(spawns()).toEqual(["nas"]);
  });

  it("launches what the kind says, tells it once per child that the child is up, and binds a claiming generation's handle", async () => {
    const calls = { ups: 0 };
    const conn = connectionTo(target("nas", testMachine("nas", calls)));
    await conn.exec("true");
    await conn.exec("true");
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.ups).toBe(1);
    // The kind's memo is the session's, not the handle's: a new handle sees what an old one left.
    conn.shell().memo().set("k", 1);
    const later = { ups: 0 };
    const again = connectionTo(target("nas", testMachine("nas", later)));
    expect(again.shell().memo().get("k")).toBe(1);
    // A reopen is a new child — and the handle bound now is the one told.
    await again.shell().reopen();
    await again.exec("true");
    await new Promise((r) => setTimeout(r, 20));
    expect(later.ups).toBe(1);
    expect(spawns()).toEqual(["nas", "nas"]);
  });
});
