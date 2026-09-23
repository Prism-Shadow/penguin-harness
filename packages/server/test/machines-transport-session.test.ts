/**
 * The one connection per machine, against a stub `ssh` on PATH that becomes a real `sh` when
 * asked for one: the framing, the heredoc input, progress relayed as it arrives, one session
 * however many ask, and what a session that dies says.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  attachSessionRegistry,
  closeAllConnections,
  useControlSockets,
  closeConnectionTo,
  connectionTo,
  forwardKey,
  sessionOf,
} from "../src/machines/transport/index.js";
import type { Resources } from "@prismshadow/penguin-core/kernel";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

posixOnly("the session", () => {
  let stubBin: string;
  let logFile: string;
  let originalPath: string | undefined;
  beforeEach(() => {
    stubBin = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-session-"));
    logFile = path.join(stubBin, "calls.log");
    // Every invocation is logged; an alias containing "refused" dies the way a wrong key
    // does; anything else asked for `sh` becomes one — commands run locally, harmlessly.
    fs.writeFileSync(
      path.join(stubBin, "ssh"),
      `#!/bin/sh
echo "$*" >> ${JSON.stringify(logFile)}
case "$*" in *refused*) echo "deploy@refused: Permission denied (publickey)." >&2; exit 255 ;; esac
# The master answering a control request: port 65001 will not bind, every other one does.
case "$*" in *" -O "*:65001:*) echo "Port forwarding failed: bind: Address already in use" >&2; exit 255 ;; *" -O "*) exit 0 ;; esac
# A session started WITH forwards (the Windows path): ssh warns about the one it could not bind and goes on.
case "$*" in *" -R 127.0.0.1:65001:"*) echo "Warning: remote port forwarding failed for listen port 65001" >&2 ;; esac
for a in "$@"; do last=$a; done
[ "$last" = sh ] && exec /bin/sh
exit 1
`,
    );
    fs.chmodSync(path.join(stubBin, "ssh"), 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${stubBin}:${process.env.PATH ?? ""}`;
  });
  afterEach(() => {
    for (const address of ["ssh:nas", "ssh:build-box", "ssh:refused"]) closeConnectionTo(address);
    process.env.PATH = originalPath;
    fs.rmSync(stubBin, { recursive: true, force: true });
  });
  const spawns = () =>
    fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n") : [];

  it("runs commands with their exit code, and an `exit` cannot end the session", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    // The command's own trailing newline is kept, as execFile would keep it.
    expect(await conn.exec("echo hi")).toMatchObject({ code: 0, stdout: "hi\n" });
    expect((await conn.exec("exit 3")).code).toBe(3);
    expect(await conn.exec("echo still here")).toMatchObject({ code: 0, stdout: "still here\n" });
    expect(spawns()).toHaveLength(1);
  });

  it("hands a command its stdin as a heredoc, bytes intact, and relays lines as they arrive", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
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
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    const [a, b] = await Promise.all([conn.open(), conn.open()]);
    expect(a.ok && b.ok && a.session.pid === b.session.pid).toBe(true);
    expect(spawns()).toHaveLength(1);
    expect(sessionOf("ssh:nas")?.pid).toBe(a.ok ? a.session.pid : -1);

    let started = Date.now();
    await Promise.all([conn.exec("sleep 0.2"), conn.exec("sleep 0.2")]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(380);
    // A different machine is a different session: those run side by side.
    const other = connectionTo({ alias: "build-box", user: "deploy" });
    started = Date.now();
    await Promise.all([conn.exec("sleep 0.2"), other.exec("sleep 0.2")]);
    expect(Date.now() - started).toBeLessThan(380);
    expect(spawns()).toHaveLength(2);
  });

  it("a session that dies says why, in ssh's own words, and is not kept", async () => {
    const conn = connectionTo({ alias: "refused", user: "deploy" });
    const opened = await conn.open();
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.detail).toContain("Permission denied");
    expect(sessionOf("ssh:refused")).toBeNull();
  });

  it("answers a command that outlasts its timeout with the timeout, and hands the next one a live session", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    // The timeout is this command's own answer. Dropping the session also answers whatever is
    // pending — with the connection's last words — so the two race for the one resolution a
    // promise has, and the precise diagnosis has to win.
    const timedOut = await conn.stream("sleep 5", { input: Buffer.alloc(0), timeoutMs: 150 });
    expect(timedOut).toMatchObject({ code: 255, stdout: "the machine did not answer in time" });

    // The killed session's close event lands while its replacement is already coming up. It
    // belongs to a child nobody holds any more, and must not take the replacement — or the
    // command riding it — down with it.
    expect(await conn.exec("echo after")).toMatchObject({ code: 0, stdout: "after\n" });
    expect(spawns()).toHaveLength(2);
  });

  it("a held session that dies comes back on its own; a closed one stays closed", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    const held = await conn.hold();
    expect(held.ok).toBe(true);
    expect(conn.held()).toBe(true);
    const first = sessionOf("ssh:nas")!.pid;

    // The link drops — the ssh child is gone, as after keepalives give up on a dead link.
    process.kill(first);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sessionOf("ssh:nas")).toBeNull();
    // Held, so the transport brings it back: the shortest wait is a second.
    const deadline = Date.now() + 5_000;
    while (sessionOf("ssh:nas") === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const second = sessionOf("ssh:nas");
    expect(second).not.toBeNull();
    expect(second!.pid).not.toBe(first);
    // And it is a working session, still held. The spawn count is read only after a command
    // has completed over it: the stub logs its own invocation from inside the child, after
    // spawn() has already returned a pid, so a session can exist before its line is there.
    expect(await conn.exec("echo back")).toMatchObject({ code: 0, stdout: "back\n" });
    expect(spawns()).toHaveLength(2);
    expect(conn.held()).toBe(true);

    // An explicit close lets go for good: nothing reopens it.
    closeConnectionTo("ssh:nas");
    expect(conn.held()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(sessionOf("ssh:nas")).toBeNull();
    expect(spawns()).toHaveLength(2);
  });

  it("a command that times out on a held session drops the corpse but keeps the hold", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    await conn.hold();
    const timedOut = await conn.stream("sleep 5", { input: Buffer.alloc(0), timeoutMs: 150 });
    expect(timedOut).toMatchObject({ code: 255, stdout: "the machine did not answer in time" });
    expect(conn.held()).toBe(true);
    // The next command finds a session — reopened by the command itself or by the hold.
    expect(await conn.exec("echo after")).toMatchObject({ code: 0, stdout: "after\n" });
    expect(conn.held()).toBe(true);
  });

  it("closing lets go of the session; the next ask opens a new one", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    await conn.exec("true");
    closeConnectionTo("ssh:nas");
    expect(sessionOf("ssh:nas")).toBeNull();
    await conn.exec("true");
    expect(spawns()).toHaveLength(2);
  });

  it("masters a control socket, and asks it for each wanted forward once the session is up", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    const good = { direction: "in" as const, localPort: 3000, remotePort: 3001 };
    const bad = { direction: "out" as const, localPort: 5432, remotePort: 65001 };
    // Wanted before the session exists: recorded, nothing asked yet.
    await conn.setForwards([good]);
    expect(spawns()).toHaveLength(0);
    await conn.hold();
    expect(spawns()[0]).toMatch(/ -M -S \S+penguin-ssh-\S+\.sock /);
    await new Promise((r) => setTimeout(r, 200));
    expect(spawns().filter((line) => line.includes("-O forward"))).toEqual([
      expect.stringContaining("-O forward -L 127.0.0.1:3000:127.0.0.1:3001 nas"),
    ]);
    expect(conn.forwardFacts().get(forwardKey(good))).toEqual({ ok: true });

    // Added live: asked at once; ssh's refusal is the fact, in its words.
    await conn.setForwards([good, bad]);
    expect(spawns().filter((line) => line.includes("-O forward"))).toHaveLength(2);
    expect(conn.forwardFacts().get(forwardKey(bad))).toEqual({
      ok: false,
      detail: "Port forwarding failed: bind: Address already in use",
    });
    // Dropped live: cancelled, and its fact goes with it.
    await conn.setForwards([bad]);
    expect(spawns().filter((line) => line.includes("-O cancel"))).toEqual([
      expect.stringContaining("-O cancel -L 127.0.0.1:3000:127.0.0.1:3001 nas"),
    ]);
    expect(conn.forwardFacts().has(forwardKey(good))).toBe(false);
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
      const held = await connectionTo({ alias: "nas", user: "deploy" }).hold();
      const transient = await connectionTo({ alias: "build-box", user: "deploy" }).open();
      expect(held.ok && transient.ok).toBe(true);
      expect(store.has("machineSession.v2:ssh:nas")).toBe(true);
      expect(store.has("machineSession.v2:ssh:build-box")).toBe(false);

      // The generation goes: its transient session ends, its held one stays up.
      closeAllConnections();
      expect(sessionOf("ssh:nas")).toBeNull(); // this generation's map is empty…
      // …and the next generation's first ask claims the same child back, no spawn.
      const again = await connectionTo({ alias: "nas", user: "deploy" }).hold();
      expect(again.ok && held.ok && again.session.pid === held.session.pid).toBe(true);
      expect(spawns().filter((line) => line.endsWith(" nas sh"))).toHaveLength(1);
      expect(spawns().filter((line) => line.endsWith(" build-box sh"))).toHaveLength(1);
      // A disconnect closes it for good, registry entry included.
      closeConnectionTo("ssh:nas");
      expect(store.has("machineSession.v2:ssh:nas")).toBe(false);
    } finally {
      attachSessionRegistry(null);
    }
  });

  it("without a control socket carries the forwards in its arguments, reopening on a change, and reads ssh's warnings", async () => {
    useControlSockets(false);
    try {
      const conn = connectionTo({ alias: "nas", user: "deploy" });
      const good = { direction: "in" as const, localPort: 3000, remotePort: 3001 };
      const bad = { direction: "out" as const, localPort: 5432, remotePort: 65001 };
      await conn.setForwards([good]);
      const held = await conn.hold();
      expect(held.ok).toBe(true);
      const first = spawns();
      expect(first).toHaveLength(1);
      expect(first[0]).toContain("-o ExitOnForwardFailure=no");
      expect(first[0]).toContain("-L 127.0.0.1:3000:127.0.0.1:3001 -D");
      expect(first[0]).not.toContain(" -M ");
      expect(conn.forwardFacts().get(forwardKey(good))).toEqual({ ok: true });

      // A changed set: the live session is reopened with the new arguments, at once.
      await conn.setForwards([good, bad]);
      const second = spawns();
      expect(second).toHaveLength(2);
      expect(second[1]).toContain("-R 127.0.0.1:65001:127.0.0.1:5432");
      const again = conn.session();
      expect(again !== null && held.ok && again.pid !== held.session.pid).toBe(true);
      await new Promise((r) => setTimeout(r, 200));
      expect(conn.forwardFacts().get(forwardKey(good))).toEqual({ ok: true });
      expect(conn.forwardFacts().get(forwardKey(bad))).toEqual({
        ok: false,
        detail: "Warning: remote port forwarding failed for listen port 65001",
      });
      // The same set again is no reopen.
      await conn.setForwards([bad, good]);
      expect(spawns()).toHaveLength(2);
    } finally {
      useControlSockets(true);
    }
  });
});
