/**
 * The one connection per machine, against a stub `ssh` on PATH that becomes a real `sh` when
 * asked for one (POSIX only).
 *
 * - Commands run with their exit code, and an `exit` cannot end the session.
 * - A command gets its stdin as a heredoc, bytes intact, and its lines are relayed as they
 *   arrive.
 * - There is one session however many ask: commands to one machine queue, two opens spawn
 *   once, and different machines run side by side.
 * - A session that dies says why — what ssh's diagnostic means and what to do, then its own
 *   words — and is not kept.
 * - On an open session, a command that outlasts its timeout answers with the timeout, and
 *   the next one gets a new live session; on a held session the corpse is dropped but the
 *   hold kept. A command whose work is cut answers the same way at once, and one cut before
 *   it is sent starts no ssh.
 * - A held session that dies comes back on its own after the shortest reconnect wait; a
 *   closed one stays closed; closing lets go, and the next ask opens a new session.
 * - A session a command opened is up but is not a connection until it is held.
 * - A machine with a stored password signs in through the askpass helper, the password in the
 *   child's environment and never its argv; a refused password is not offered again — not by the
 *   held session's own reopen, not by the next command — until it is saved anew.
 * - A held session outlives its generation in the resource registry: a successor judged to speak
 *   another contract opens its own, and one that adopts it is the one told when it drops — not
 *   the generation that opened it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Resources } from "@prismshadow/penguin-core/kernel";
import {
  SESSION_GROUP,
  attachSessionRegistry,
  closeAllConnections,
  closeConnectionTo,
  connectionTo,
  forgetRefusal,
  heldSessionOf,
  sessionOf,
} from "../src/machines/transport/index.js";
import { SshPasswords } from "../src/machines/ssh-passwords.js";

// The stub `ssh` below is a shell script, which execFile cannot run on Windows; what stays
// unmeasured on Windows is listed in ci.yml's test-windows note.
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
): Promise<typeof import("../src/machines/transport/ssh-session.js")> {
  const file = path.join(import.meta.dirname, "../src/machines/transport/ssh-session.ts");
  return import(/* @vite-ignore */ `${file}?generation=${n}`);
}

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
  const spawns = () => fs.readFileSync(logFile, "utf8").trim().split("\n");

  it("counts a session a command opened as up, and as a connection only once it is held", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    await conn.exec("true");
    expect(sessionOf("ssh:nas")).not.toBeNull();
    expect(heldSessionOf("ssh:nas")).toBeNull();
    expect((await conn.hold()).ok).toBe(true);
    expect(heldSessionOf("ssh:nas")).not.toBeNull();
    expect(heldSessionOf("ssh:nas")).toEqual(sessionOf("ssh:nas"));
  });

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

  it("a session that dies says what ssh's words mean, then the words, and is not kept", async () => {
    const conn = connectionTo({ alias: "refused", user: "deploy" });
    const opened = await conn.open();
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.detail).toMatch(/^refused did not accept any key this computer offered/);
      expect(opened.detail).toContain("Permission denied (publickey)");
    }
    expect(sessionOf("ssh:refused")).toBeNull();
  });

  it("answers a command that outlasts its timeout with the timeout, and hands the next one a live session", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
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
      const conn = connectionTo({ alias: "nas", user: "deploy" });
      const held = await conn.hold();
      expect(held.ok).toBe(true);
      expect(conn.held()).toBe(true);
      const first = sessionOf("ssh:nas")!.pid;

      // The link drops — the ssh child is gone, as after keepalives give up on a dead link.
      process.kill(first);
      await until(() => sessionOf("ssh:nas") === null, "the session to drop");
      // Held, so the transport brings it back after the shortest wait, a second.
      await vi.advanceTimersByTimeAsync(999);
      expect(sessionOf("ssh:nas")).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await until(() => sessionOf("ssh:nas") !== null, "the session to come back");
      const second = sessionOf("ssh:nas");
      expect(second!.pid).not.toBe(first);
      // And it is a working session, still held. The spawn count is read only after a command
      // has completed over it: the stub logs its own invocation from inside the child, after
      // spawn() has already returned a pid, so a session can exist before its line is there.
      expect(await conn.exec("echo back")).toMatchObject({ code: 0, stdout: "back\n" });
      expect(spawns()).toHaveLength(2);
      expect(conn.held()).toBe(true);

      // An explicit close lets go for good: past every reopen wait, nothing reopens it.
      closeConnectionTo("ssh:nas");
      expect(conn.held()).toBe(false);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(sessionOf("ssh:nas")).toBeNull();
      expect(spawns()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
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

  it("a command whose work is cut answers at once and the next one gets a live session; one cut before it is sent starts no ssh", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    const opened = await conn.open();
    expect(opened.ok).toBe(true);
    const work = new AbortController();
    const cutConn = connectionTo({ alias: "nas", user: "deploy", signal: work.signal });
    const started = Date.now();
    const running = cutConn.stream("sleep 5", { input: Buffer.alloc(0) });
    setTimeout(() => work.abort(), 100);
    expect(await running).toMatchObject({ code: 255, stdout: "stopped before it finished" });
    expect(Date.now() - started).toBeLessThan(4_000);

    // The session it was cut on is gone, and its close does not take the next one down.
    expect(await conn.exec("echo after")).toMatchObject({ code: 0, stdout: "after\n" });
    expect(conn.session()?.pid).not.toBe(opened.ok ? opened.session.pid : undefined);
    expect(spawns()).toHaveLength(2);

    closeConnectionTo("ssh:nas");
    expect((await cutConn.exec("echo never")).code).toBe(255);
    expect(spawns()).toHaveLength(2);
  });

  it("closing lets go of the session; the next ask opens a new one", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    await conn.exec("true");
    closeConnectionTo("ssh:nas");
    expect(sessionOf("ssh:nas")).toBeNull();
    await conn.exec("true");
    expect(spawns()).toHaveLength(2);
  });

  it("does not claim a delivered session the platform judged another contract — it opens its own", async () => {
    const { registry, entry } = fakeRegistry();
    attachSessionRegistry(registry);
    try {
      const held = await connectionTo({ alias: "nas", user: "deploy" }).hold();
      expect(held.ok).toBe(true);
      closeAllConnections(); // the generation leaves; its held session stays in the registry
      const delivered = entry(`${SESSION_GROUP}:ssh:nas`);
      // The next generation was told the contract differs: it opens a session of its own…
      attachSessionRegistry(registry, false);
      const again = await connectionTo({ alias: "nas", user: "deploy" }).hold();
      expect(again.ok && held.ok && again.session.pid !== held.session.pid).toBe(true);
      expect(spawns().filter((line) => line.endsWith(" nas sh"))).toHaveLength(2);
      // …and the platform's disposal of the doomed group ends the old one. Its entry is taken
      // before the successor's hold took the slot over, as the platform's commit disposes it.
      delivered?.dispose?.();
    } finally {
      closeConnectionTo("ssh:nas");
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
    const target = { alias: "nas", user: "deploy" };
    try {
      older.attachSessionRegistry(registry);
      const held = await older.holdShell("ssh:nas", target);
      if (!held.ok) throw new Error(held.detail);
      expect(heardByOlder).toEqual(["ssh:nas up"]);
      older.closeAllShells(); // the older generation leaves; its held session stays registered

      // The newer one holds the machine again and gets the live session, not a second ssh.
      newer.attachSessionRegistry(registry);
      const adopted = await newer.holdShell("ssh:nas", target);
      expect(adopted.ok && adopted.session.pid).toBe(held.session.pid);
      expect(spawns()).toHaveLength(1);

      // The link drops: the generation keeping the machine connected is the one told.
      process.kill(held.session.pid);
      await until(() => heardByNewer.includes("ssh:nas down"), "the drop to be told");
      expect(heardByOlder).toEqual(["ssh:nas up"]);
    } finally {
      unwatchOlder();
      unwatchNewer();
      newer.closeShell("ssh:nas");
      older.closeShell("ssh:nas");
      older.attachSessionRegistry(null);
      newer.attachSessionRegistry(null);
    }
  });
});

posixOnly("a password sign-in", () => {
  const PASSWORD = `it's $HOME & "quoted"`;
  let stubBin: string;
  let originalPath: string | undefined;
  /** What the stub's sshd takes as the right password: changed to make it refuse. */
  const accept = (password: string) => fs.writeFileSync(path.join(stubBin, "expected"), password);
  beforeEach(() => {
    stubBin = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-password-"));
    const log = (name: string) => JSON.stringify(path.join(stubBin, name));
    // The stub plays ssh and sshd: it asks the helper what ssh would ask — a new host key, then
    // the password — and lets in only the expected password.
    fs.writeFileSync(
      path.join(stubBin, "ssh"),
      `#!/bin/sh
[ "$1" = -V ] && { echo "OpenSSH_9.6p1 stub" >&2; exit 0; }
echo "$*" >> ${log("calls.log")}
hostkey=$("$SSH_ASKPASS" "Are you sure you want to continue connecting (yes/no/[fingerprint])?")
echo "$? [$hostkey] $SSH_ASKPASS_REQUIRE" >> ${log("asked.log")}
answer=$("$SSH_ASKPASS" "deploy@nas's password: ")
[ "$answer" = "$(cat ${log("expected")})" ] || { echo "deploy@nas: Permission denied (publickey,password)." >&2; exit 255; }
exec /bin/sh
`,
    );
    fs.chmodSync(path.join(stubBin, "ssh"), 0o755);
    accept(PASSWORD);
    originalPath = process.env.PATH;
    process.env.PATH = `${stubBin}:${process.env.PATH ?? ""}`;
  });
  afterEach(() => {
    closeConnectionTo("ssh:nas");
    forgetRefusal("nas");
    process.env.PATH = originalPath;
    fs.rmSync(stubBin, { recursive: true, force: true });
  });
  const spawns = () => fs.readFileSync(path.join(stubBin, "calls.log"), "utf8").trim().split("\n");

  it("signs in through the helper, and a refused password waits for a new save, held or not", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const until = async (condition: () => boolean, what: string): Promise<void> => {
      const deadline = Date.now() + 5_000;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setImmediate(resolve));
      }
    };
    const store = new SshPasswords(path.join(stubBin, "root"));
    store.save("nas", PASSWORD);
    const target = {
      alias: "nas",
      user: "deploy",
      password: { askpass: store.askpass(), read: () => store.read("nas") },
    };
    try {
      const conn = connectionTo(target);
      expect((await conn.hold()).ok).toBe(true);
      expect(await conn.exec("echo in")).toMatchObject({ code: 0, stdout: "in\n" });
      // The password reached the helper through the environment alone; the host key question
      // was declined, as ssh reads an empty answer; and nothing of it is on the command line.
      expect(fs.readFileSync(path.join(stubBin, "asked.log"), "utf8")).toBe("1 [] force\n");
      expect(spawns()).toHaveLength(1);
      expect(spawns()[0]).not.toContain("quoted");
      expect(spawns()[0]).toContain("PubkeyAuthentication=no");

      // The machine's password changes under a held session, and the link drops.
      accept("changed on the machine");
      process.kill(sessionOf("ssh:nas")!.pid);
      await until(() => sessionOf("ssh:nas") === null, "the session to drop");
      await vi.advanceTimersByTimeAsync(1_000);
      await until(() => spawns().length === 2, "the reopen");
      await until(() => sessionOf("ssh:nas") === null, "the refusal");
      // Refused once: no reopen however long it waits, and no command dials with it either.
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      const again = await conn.exec("echo in");
      expect(again.code).toBe(255);
      expect(again.stdout).toMatch(/^nas rejected the password saved for it\./);
      expect(spawns()).toHaveLength(2);

      // Saved anew (the same password, the machine put right): it dials again.
      accept(PASSWORD);
      store.save("nas", PASSWORD);
      forgetRefusal("nas");
      expect(await conn.exec("echo back")).toMatchObject({ code: 0, stdout: "back\n" });
      expect(spawns()).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
