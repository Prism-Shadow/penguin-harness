/**
 * The one connection per machine, against a stub `ssh` on PATH that becomes a real `sh` when
 * asked for one: the framing, the heredoc input, progress relayed as it arrives, one session
 * however many ask, and what a session that dies says.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeConnectionTo, connectionTo, sessionOf } from "../src/machines/transport/index.js";

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

  it("closing lets go of the session; the next ask opens a new one", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    await conn.exec("true");
    closeConnectionTo("ssh:nas");
    expect(sessionOf("ssh:nas")).toBeNull();
    await conn.exec("true");
    expect(spawns()).toHaveLength(2);
  });
});
