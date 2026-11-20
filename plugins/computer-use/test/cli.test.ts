/**
 * `penguin computer …` as the server's host runs it: the command line through commander, the
 * caller's Session, the files the terminal sends and gets back — with the fake agent-desktop at
 * the program boundary and a fake process table for PenguinHarness's own processes.
 *
 * - Given an allowed command, agent-desktop runs it as typed and its envelope is printed as one
 *   line with its exit code, an error envelope included.
 * - Given a refused command, nothing runs and the refusal is one `error: policy_refused:` line.
 * - Given an app whose process is PenguinHarness's own, the command never runs.
 * - Given a name no running app has exactly as list-apps prints it — an alias agent-desktop would
 *   still resolve, a part of a name — or a window list-windows does not show, nothing runs and the
 *   refusal says which names to use; given a lookup that fails, nothing runs.
 * - Given a member, nothing runs unless an administrator allowed members; an administrator (and an
 *   Agent working for one) runs it.
 * - Given --text-file text that would take past the limit to type, nothing runs.
 * - Given launch, it runs with a state directory of its own, never a Session's; given a path or a
 *   script instead of an app's name, or on Linux a name no system desktop entry has, nothing runs,
 *   and on Linux agent-desktop is handed the entry's own file and a PATH of system directories.
 * - Given a reply that names a window of PenguinHarness's own (agent-desktop resolved the app
 *   again after the check), or a launch that reached PenguinHarness, the reply is discarded.
 * - Given `status`, agent-desktop's status comes back with the plugin's own state, and exit code 1
 *   when Computer Use cannot run.
 * - Given the plugin switched off, every command but status is refused.
 * - Given a screenshot, the PNG is handed back under the name asked for and the envelope names it;
 *   the server keeps no copy.
 * - Given --text-file, the file the terminal sent is the text, on stdin.
 * - Given two Sessions, each gets its own private state directory, so neither sees the other's refs;
 *   agent-desktop runs in the user's home, so an app it launches never holds that directory open.
 * - Given no arguments, the help prints in the caller's language.
 * - Given the person at this computer used the keyboard or mouse under 3 s ago, a command that
 *   changes the desktop is refused with user_active and nothing runs — observation still runs,
 *   input the plugin itself just sent does not count, an unknown idle time pauses nothing, and an
 *   administrator can turn the pause off.
 * - Given a press aimed at a window that is not the focused one, it is refused with
 *   window_not_focused naming the focus-window to run, and no key is sent; focused, it runs.
 * - Given status, it reports the install apart from the checks, and the desktop now: the focused
 *   window, the displays and the user's idle seconds.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDirOf } from "../src/state.js";
import {
  desktopEntries,
  err,
  fakeAgentDesktop,
  ok,
  PNG,
  runComputer,
  testService,
} from "./helpers.js";

const posix = process.platform !== "win32";

describe("penguin computer", () => {
  it("runs an allowed command as typed and prints its envelope as one line", async () => {
    const fake = await fakeAgentDesktop({
      "list-apps": { stdout: ok("list-apps", { apps: [{ name: "gedit", pid: 4242 }] }) },
      snapshot: { stdout: ok("snapshot", { app: "gedit", snapshot_id: "s9", ref_count: 3 }) },
    });
    const t = await testService({ program: fake.program });
    const run = await runComputer(t, ["snapshot", "--app", "gedit", "-i", "--compact"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout.trim().split("\n")).toHaveLength(1);
    expect(run.json).toMatchObject({ ok: true, command: "snapshot", data: { snapshot_id: "s9" } });
    expect(fake.calls().map((c) => c.argv)).toEqual([
      ["list-apps"],
      ["snapshot", "--app", "gedit", "-i", "--compact"],
    ]);
  });

  it("prints agent-desktop's error envelope with its exit code", async () => {
    const fake = await fakeAgentDesktop({
      click: { stdout: err("click", "STALE_REF", "the element changed"), exit: 1 },
    });
    const run = await runComputer(await testService({ program: fake.program }), [
      "click",
      "@s9:e1",
    ]);
    expect(run.exitCode).toBe(1);
    expect(run.json).toMatchObject({ ok: false, error: { code: "STALE_REF" } });
  });

  it("runs nothing it refuses, and says why in one line", async () => {
    const fake = await fakeAgentDesktop();
    const run = await runComputer(await testService({ program: fake.program }), [
      "mouse-click",
      "--xy",
      "1,1",
    ]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toMatch(/^error: policy_refused: .*Allow physical input.*\n$/);
    expect(fake.calls()).toEqual([]);
  });

  it("never runs a command aimed at PenguinHarness's own processes", async () => {
    const fake = await fakeAgentDesktop({
      "list-apps": { stdout: ok("list-apps", { apps: [{ name: "PenguinHarness", pid: 700 }] }) },
    });
    // 700 is a window of the app whose main process (500) is a root of PenguinHarness's tree.
    const t = await testService({
      program: fake.program,
      ownPids: [500],
      parents: { 700: 500, 500: 1 },
    });
    const run = await runComputer(t, ["press", "return", "--app", "PenguinHarness"]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toMatch(
      /^error: policy_refused: PenguinHarness is PenguinHarness itself \(process 700\)/,
    );
    expect(fake.calls().map((c) => c.argv[0])).toEqual(["list-apps"]);
  });

  it("checks a window id by the process that owns the window", async () => {
    const fake = await fakeAgentDesktop({
      "list-windows": {
        stdout: ok("list-windows", [
          { id: "w-1", pid: 700 },
          { id: "w-2", pid: 800 },
        ]),
      },
    });
    const t = await testService({
      program: fake.program,
      ownPids: [500],
      parents: { 700: 500, 800: 1 },
    });
    expect((await runComputer(t, ["minimize", "--window-id", "w-1"])).stderr).toContain(
      "policy_refused",
    );
    expect((await runComputer(t, ["minimize", "--window-id", "w-2"])).exitCode).toBe(0);
    const unlisted = await runComputer(t, ["minimize", "--window-id", "w-9"]);
    expect(unlisted.stderr).toMatch(/^error: policy_refused: no window has the id 'w-9'/);
    expect(fake.calls().filter((c) => c.argv[0] === "minimize")).toHaveLength(1);
  });

  it("runs only for a name list-apps prints exactly, so no alias reaches PenguinHarness", async () => {
    // agent-desktop's own matching: a command's --app also takes a bundle ID, and list-apps --app
    // matches a part of a name that the command itself would not.
    const fake = await fakeAgentDesktop({}, [
      { name: "PenguinHarness", pid: 700, aliases: ["com.prismshadow.penguinharness"] },
      { name: "python3.13", pid: 900 },
    ]);
    const t = await testService({ program: fake.program, ownPids: [500], parents: { 700: 500 } });
    const alias = await runComputer(t, ["snapshot", "--app", "com.prismshadow.penguinharness"]);
    expect(alias.stderr).toMatch(
      /^error: policy_refused: no running app is named 'com\.prismshadow\.penguinharness': name the app exactly as penguin computer list-apps prints it \(now: PenguinHarness, python3\.13\)/,
    );
    const part = await runComputer(t, ["snapshot", "--app", "python3"]);
    expect(part.stderr).toMatch(/^error: policy_refused: no running app is named 'python3'/);
    const own = await runComputer(t, ["snapshot", "--app", "penguinharness"]);
    expect(own.stderr).toMatch(/is PenguinHarness itself \(process 700\)/);
    expect(fake.calls().filter((c) => c.argv[0] === "snapshot")).toEqual([]);
    const exact = await runComputer(t, ["snapshot", "--app", "python3.13"]);
    expect(exact.json).toMatchObject({ ok: true, data: { app: "python3.13", pid: 900 } });
  });

  it("runs nothing when neither list-apps nor list-windows answers", async () => {
    const fake = await fakeAgentDesktop({
      "list-apps": { stdout: err("list-apps", "TIMEOUT", "took too long"), exit: 1 },
      "list-windows": { stdout: err("list-windows", "TIMEOUT", "took too long"), exit: 1 },
    });
    const t = await testService({ program: fake.program });
    const unverified = await runComputer(t, ["snapshot", "--app", "gedit"]);
    expect(unverified.stderr).toMatch(
      /^error: target_unverified: could not list the running apps to tell which process 'gedit' is/,
    );
    expect(fake.calls().map((c) => c.argv[0])).toEqual(["list-apps", "list-windows"]);
  });

  it("refuses a member unless an administrator allowed members, and says where", async () => {
    const fake = await fakeAgentDesktop();
    const t = await testService({ program: fake.program });
    const member = { caller: { userId: "bob", isAdmin: false } };
    const refused = await runComputer(t, ["get", "@s1:e1"], member);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toMatch(/^error: admin_only: .*"Allow members"/);
    const status = await runComputer(t, ["status"], member);
    expect(status.json).toMatchObject({
      data: { penguin: { ready: false, reason: "admin_only" } },
    });
    expect(fake.calls()).toEqual([]);
    t.reader.docs["computer-use"] = { allowMembers: true };
    expect((await runComputer(t, ["get", "@s1:e1"], member)).exitCode).toBe(0);
  });

  it("refuses --text-file text that would take past the limit to type, before anything runs", async () => {
    const fake = await fakeAgentDesktop();
    const t = await testService({ program: fake.program });
    const long = await runComputer(t, ["type", "@s1:e1", "--text-file", "long.txt"], {
      sent: { "long.txt": Buffer.from("x".repeat(9_000)) },
    });
    expect(long.exitCode).toBe(2);
    expect(long.stderr).toMatch(/^error: too_long: /);
    expect(fake.calls()).toEqual([]);
  });

  it("launches with a state directory of its own, never the Session's", async () => {
    const fake = await fakeAgentDesktop();
    const t = await testService({ program: fake.program, platform: "win32" });
    await runComputer(t, ["launch", "notepad"]);
    expect(fake.calls()[0]!.env.AGENT_DESKTOP_HOME).toBe(
      path.join(t.root, "computer-use", "state", "launch"),
    );
  });

  it("launches only a plain app name: a path or a script never reaches agent-desktop", async () => {
    const fake = await fakeAgentDesktop();
    for (const platform of ["linux", "win32", "darwin"] as const) {
      const t = await testService({ program: fake.program, platform });
      for (const app of [
        "/tmp/payload.sh",
        "payload.sh",
        "~/bin/x",
        "./x",
        "C:\\x\\y.exe",
        "Evil.app",
      ]) {
        const run = await runComputer(t, ["launch", app]);
        expect(run.exitCode, `${platform} ${app}`).toBe(1);
        expect(run.stderr).toMatch(/^error: policy_refused: launch takes a plain app name: /);
      }
    }
    expect(fake.calls()).toEqual([]);
  });

  it("on Linux, launches an installed app by its desktop entry, with a PATH of system directories only", async () => {
    const fake = await fakeAgentDesktop();
    const apps = await desktopEntries([
      { id: "org.gnome.Calculator", name: "Calculator", exec: "gnome-calculator" },
    ]);
    const t = await testService({ program: fake.program, platform: "linux", launch: apps });
    const entry = path.join(apps.dir, "applications", "org.gnome.Calculator.desktop");
    for (const name of ["gnome-calculator", "Calculator", "org.gnome.Calculator"]) {
      expect((await runComputer(t, ["launch", name, "--activate"])).exitCode).toBe(0);
    }
    expect(fake.calls().map((c) => c.argv)).toEqual([
      ["launch", "--activate", entry],
      ["launch", "--activate", entry],
      ["launch", "--activate", entry],
    ]);
    // The entry's Exec is looked up on this PATH only: no directory the user can write.
    expect(fake.calls()[0]!.env.PATH).toBe(apps.bin);
    const unknown = await runComputer(t, ["launch", "payload"]);
    expect(unknown.stderr).toMatch(
      /^error: policy_refused: launch takes a plain app name: no installed app is named "payload": on Linux/,
    );
    expect(fake.calls()).toHaveLength(3);
  });

  it("discards a reply that came from PenguinHarness's own window, or a launch that reached it", async () => {
    // agent-desktop resolved Gedit to a window of PenguinHarness after the check passed.
    const fake = await fakeAgentDesktop({
      "list-apps": { stdout: ok("list-apps", { apps: [{ name: "Gedit", pid: 800 }] }) },
      snapshot: { stdout: ok("snapshot", { app: "Gedit", window: { id: "w-own" }, tree: {} }) },
      "list-windows": { stdout: ok("list-windows", [{ id: "w-own", pid: 700 }]) },
      launch: { stdout: ok("launch", { app: "notepad.exe", pid: 700 }) },
    });
    const t = await testService({
      program: fake.program,
      ownPids: [500],
      parents: { 700: 500, 800: 1 },
      platform: "win32",
    });
    const snap = await runComputer(t, ["snapshot", "--app", "Gedit"]);
    expect(snap.exitCode).toBe(1);
    expect(snap.stdout).toBe("");
    expect(snap.stderr).toMatch(
      /^error: policy_refused: window w-own turned out to be PenguinHarness itself \(process 700\).*the result was discarded/,
    );
    const launched = await runComputer(t, ["launch", "notepad"]);
    expect(launched.stdout).toBe("");
    expect(launched.stderr).toMatch(/turned out to be PenguinHarness itself \(process 700\)/);
  });

  it("answers status with agent-desktop's status and the plugin's own state", async () => {
    const fake = await fakeAgentDesktop({
      status: {
        stdout: ok("status", {
          platform: "linux",
          version: "1.3.1",
          permissions: { accessibility: { state: "granted" } },
        }),
      },
      "list-windows": { stdout: ok("list-windows", []) },
    });
    const t = await testService({ program: fake.program, settings: { physicalInput: true } });
    const run = await runComputer(t, ["status"]);
    expect(run.json).toMatchObject({
      ok: true,
      data: {
        version: "1.3.1",
        penguin: {
          enabled: true,
          settings: { physicalInput: true, clipboardRead: false, notificationRead: false },
          refs: "session",
        },
      },
    });
    expect(typeof run.json!.data.penguin.plugin).toBe("string");
  });

  it("pauses commands that change the desktop while the user is active, observation aside", async () => {
    const fake = await fakeAgentDesktop({
      "list-apps": { stdout: ok("list-apps", { apps: [{ name: "Gedit", pid: 800 }] }) },
    });
    let idle: number | null = 1.2;
    const t = await testService({ program: fake.program, idleSeconds: () => idle });
    const click = await runComputer(t, ["click", "@s1:e2"]);
    expect(click.exitCode).toBe(1);
    expect(click.stderr).toMatch(
      /^error: user_active: the user is using the computer — their last keyboard or mouse input was 1\.2 s ago\. Pause and ask them/,
    );
    expect((await runComputer(t, ["snapshot", "--app", "Gedit"])).exitCode).toBe(0);
    expect(fake.calls().map((c) => c.argv[0])).toEqual(["list-apps", "snapshot"]);
    // Unknown here: nothing pauses.
    idle = null;
    expect((await runComputer(t, ["click", "@s1:e2"])).exitCode).toBe(0);
    // Turned off by an administrator: nothing pauses.
    idle = 0.5;
    t.reader.docs["computer-use"] = { pauseWhileUserActive: false };
    expect((await runComputer(t, ["click", "@s1:e2"])).exitCode).toBe(0);
  });

  it("does not take the plugin's own keystrokes for the user's", async () => {
    const fake = await fakeAgentDesktop({
      "list-apps": { stdout: ok("list-apps", { apps: [{ name: "Gedit", pid: 800 }] }) },
      "list-windows": {
        stdout: ok("list-windows", [{ id: "w-1", pid: 800, app_name: "Gedit", is_focused: true }]),
      },
    });
    let idle = 30;
    const t = await testService({ program: fake.program, idleSeconds: () => idle });
    expect((await runComputer(t, ["press", "ctrl+s", "--app", "Gedit"])).exitCode).toBe(0);
    // The press reset the system's idle time just now: the next command is not paused for it.
    idle = 0.2;
    expect((await runComputer(t, ["click", "@s1:e2"])).exitCode).toBe(0);
  });

  it("refuses keystrokes to a window that is not focused, naming the focus-window to run", async () => {
    const fake = await fakeAgentDesktop({
      "list-apps": {
        stdout: ok("list-apps", {
          apps: [
            { name: "QQ", pid: 800 },
            { name: "Gedit", pid: 900 },
          ],
        }),
      },
      "list-windows": {
        stdout: ok("list-windows", [
          { id: "w-qq", pid: 800, app_name: "QQ", is_focused: false },
          { id: "w-gedit", pid: 900, app_name: "Gedit", is_focused: true },
        ]),
      },
    });
    const t = await testService({ program: fake.program });
    const press = await runComputer(t, ["press", "return", "--app", "QQ"]);
    expect(press.exitCode).toBe(1);
    expect(press.stderr).toMatch(
      /^error: window_not_focused: QQ's window w-qq is not the focused window, so its keystrokes would go to another window/,
    );
    expect(press.stderr).toContain("penguin computer focus-window --window-id w-qq");
    const byId = await runComputer(t, ["press", "return", "--window-id", "w-qq"]);
    expect(byId.stderr).toMatch(
      /^error: window_not_focused: window w-qq is not the focused window/,
    );
    expect(fake.calls().filter((c) => c.argv[0] === "press")).toEqual([]);
    expect((await runComputer(t, ["press", "ctrl+s", "--app", "Gedit"])).exitCode).toBe(0);
    expect(fake.calls().filter((c) => c.argv[0] === "press")).toHaveLength(1);
  });

  it("reports the install, the checks and the desktop now in status", async () => {
    const fake = await fakeAgentDesktop({
      status: {
        stdout: ok("status", { permissions: { accessibility: { state: "granted" } } }),
      },
      "list-windows": {
        stdout: ok("list-windows", [
          { id: "w-1", pid: 800, app_name: "Gedit", title: "notes", is_focused: true },
        ]),
      },
      "list-displays": {
        stdout: ok("list-displays", [
          { id: "1", bounds: { x: 0, y: 0, width: 2880, height: 1864 }, is_primary: true },
          { id: "2", bounds: { x: 2880, y: 0, width: 2880, height: 5120 } },
        ]),
      },
    });
    const t = await testService({ program: fake.program, idleSeconds: 42.34, platform: "linux" });
    const run = await runComputer(t, ["status"]);
    const penguin = run.json!.data.penguin;
    expect(penguin.install).toMatchObject({
      state: expect.any(String),
      pinned: expect.any(String),
    });
    expect(penguin.checks.map((c: { id: string }) => c.id)).toContain("idle");
    expect(penguin.desktop).toEqual({
      focused: { app: "Gedit", windowId: "w-1", title: "notes", pid: 800 },
      displays: [
        { id: "1", bounds: { x: 0, y: 0, width: 2880, height: 1864 }, is_primary: true },
        { id: "2", bounds: { x: 2880, y: 0, width: 2880, height: 5120 } },
      ],
      userIdleSeconds: 42.3,
      userActive: false,
      idleSource: "XScreenSaver",
    });
    expect(penguin.settings.pauseWhileUserActive).toBe(true);
  });

  it("answers status with exit code 1 and the reason when Computer Use is off", async () => {
    const fake = await fakeAgentDesktop();
    const t = await testService({ program: fake.program, settings: { enabled: false } });
    const run = await runComputer(t, ["status"]);
    expect(run.exitCode).toBe(1);
    expect(run.json).toMatchObject({
      ok: false,
      data: { penguin: { ready: false, reason: "disabled" } },
    });
    expect(fake.calls()).toEqual([]);
  });

  it("refuses every other command while the plugin is off", async () => {
    const fake = await fakeAgentDesktop();
    const t = await testService({ program: fake.program, settings: { enabled: false } });
    const run = await runComputer(t, ["click", "@s1:e1"]);
    expect(run.stderr).toMatch(/^error: disabled: /);
    expect(fake.calls()).toEqual([]);
  });

  it("hands a screenshot back as a file under the name asked for, keeping no copy", async () => {
    const fake = await fakeAgentDesktop({
      "list-apps": { stdout: ok("list-apps", { apps: [{ name: "gedit", pid: 4242 }] }) },
      screenshot: {
        stdout: ok("screenshot", { path: "(the server's path)", width: 640 }),
        png: PNG.toString("base64"),
      },
    });
    const t = await testService({ program: fake.program });
    const run = await runComputer(t, [
      "screenshot",
      "--app",
      "gedit",
      "window.png",
      "--out-dir",
      "shots",
    ]);
    expect(run.exitCode).toBe(0);
    expect(run.files).toHaveLength(1);
    expect(run.files[0]).toMatchObject({ name: "window.png", mimeType: "image/png" });
    expect(Buffer.from(run.files[0]!.data)).toEqual(PNG);
    expect(run.json).toMatchObject({ ok: true, data: { path: "window.png", width: 640 } });
    const shot = fake.calls().find((c) => c.argv[0] === "screenshot")!;
    expect(shot.argv).not.toContain("--out-dir");
    expect(await fs.readdir(tmpDirOf(t.root))).toEqual([]);
  });

  it("types the file the terminal sent for --text-file, on stdin", async () => {
    const fake = await fakeAgentDesktop({ type: { stdout: ok("type") } });
    const t = await testService({ program: fake.program });
    const run = await runComputer(t, ["type", "@s1:e1", "--text-file", "pw.txt"], {
      sent: { "pw.txt": Buffer.from("s3cret") },
    });
    expect(run.exitCode).toBe(0);
    const call = fake.calls()[0]!;
    expect(call.stdin).toBe("s3cret");
    expect(call.argv).toEqual(["type", "@s1:e1", "--stdin"]);
  });

  it("keeps each Session's refs in a private state directory of its own", async () => {
    const fake = await fakeAgentDesktop();
    const t = await testService({ program: fake.program });
    await runComputer(t, ["get", "@s1:e1"], { caller: { sessionId: "s1" } });
    await runComputer(t, ["get", "@s1:e1"], { caller: { sessionId: "s2" } });
    const homes = fake.calls().map((c) => c.env.AGENT_DESKTOP_HOME!);
    expect(homes[0]).not.toBe(homes[1]);
    expect(homes[0]).toBe(path.join(t.root, "computer-use", "state", "sessions", "s1"));
    if (posix) expect((await fs.stat(homes[0]!)).mode & 0o777).toBe(0o700);
    expect(fake.calls()[0]!.env.PENGUIN_TEST_SECRET).toBeUndefined();
    // An app it launches starts in the user's home, so nothing holds a state directory open.
    expect(fake.calls().map((c) => path.resolve(c.cwd))).toEqual([
      path.resolve(os.homedir()),
      path.resolve(os.homedir()),
    ]);
  });

  it("prints its help in the caller's language when given nothing", async () => {
    const t = await testService({ program: (await fakeAgentDesktop()).program });
    expect((await runComputer(t, [])).stdout).toMatch(/^Usage: penguin computer/);
    expect((await runComputer(t, [], { language: "zh" })).stdout).toMatch(
      /^用法：penguin computer/,
    );
  });

  it("passes options through in the order given, before and after the command", async () => {
    const fake = await fakeAgentDesktop({
      "list-apps": { stdout: ok("list-apps", { apps: [] }) },
    });
    const t = await testService({ program: fake.program, settings: { physicalInput: true } });
    await runComputer(t, ["--headed", "click", "@s1:e1", "--timeout-ms", "200"]);
    expect(fake.calls().at(-1)!.argv).toEqual([
      "--headed",
      "click",
      "@s1:e1",
      "--timeout-ms",
      "200",
    ]);
  });
});
