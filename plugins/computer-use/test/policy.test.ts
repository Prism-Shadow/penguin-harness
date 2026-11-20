/**
 * What a `penguin computer` command line may run — the default-safe profile, decided before
 * agent-desktop starts.
 *
 * - Given observation or a semantic action, it runs as typed, and the app it names is returned
 *   to be checked against PenguinHarness's own processes.
 * - Given a command that would act on the focused window (snapshot, find, screenshot, press,
 *   list-surfaces, a text wait, the window commands) without --app or --window-id, it is refused
 *   — except a --root drill-down and a whole-screen screenshot.
 * - Given physical input, a clipboard read or a notification read, it is refused until its
 *   setting allows it, and the refusal names the setting.
 * - Given a command or an option that never runs here, it is refused with its reason.
 * - Given text to type, it leaves the command line and goes to stdin, from the argument or the
 *   file the terminal sends.
 * - Given a screenshot, its name must be a file name; one is made up when none is given.
 * - Given a batch, it runs only when every entry would run on its own, and every entry's target
 *   is checked.
 * - Given launch with arguments, an environment or a working directory, it is refused: launch takes
 *   an app's name only (so no debugging port either).
 * - Given a batch that launches or carries text to type, it is refused.
 * - Given an unknown command, malformed input, a cluster of short options agent-desktop would read
 *   differently, or a budget past the limit, it is a usage error.
 */
import { describe, expect, it } from "vitest";
import { decide, MAX_BUDGET_MS } from "../src/policy.js";
import type { PolicySettings, RunPlan } from "../src/policy.js";

const OFF: PolicySettings = { physicalInput: false, clipboardRead: false, notificationRead: false };
const ALL: PolicySettings = { physicalInput: true, clipboardRead: true, notificationRead: true };

function run(argv: string[], settings = OFF): RunPlan {
  const d = decide(argv, settings);
  if (d.kind !== "run") throw new Error(`expected a run, got ${JSON.stringify(d)}`);
  return d;
}

function refusal(argv: string[], settings = OFF): string {
  const d = decide(argv, settings);
  if (d.kind !== "refused") throw new Error(`expected a refusal, got ${JSON.stringify(d)}`);
  return d.message;
}

describe("what runs as typed", () => {
  it("an observation of a named app runs as typed and names the app to check", () => {
    const plan = run(["snapshot", "--app", "Calculator", "-i", "--compact"]);
    expect(plan.argv).toEqual(["snapshot", "--app", "Calculator", "-i", "--compact"]);
    expect(plan.targets).toEqual([{ app: "Calculator" }]);
    expect(plan.plain).toBe(false);
  });

  it.each([
    [["click", "@s1:e2"]],
    [["get", "@s1:e2", "--property", "value"]],
    [["wait", "--element", "@s1:e3", "--predicate", "actionable"]],
    [["snapshot", "--root", "@s1:e4", "-i"]],
    [["find", "--root", "@s1:e4", "--name", "Save"]],
    [["screenshot", "--screen", "0"]],
    [["list-apps"]],
    [["list-windows"]],
    [["version"]],
    [["skills", "get", "desktop"]],
    [["launch", "gnome-calculator", "--activate"]],
    [["clipboard-clear"]],
  ])("%j runs", (argv) => {
    expect(run(argv).argv[0]).toBe(argv[0]);
  });

  it("launch hands its app name to the caller to check, off the command line", () => {
    expect(run(["launch", "Calculator", "--activate"])).toMatchObject({
      argv: ["launch", "--activate"],
      launch: { app: "Calculator" },
    });
    expect(decide(["launch"], OFF)).toMatchObject({ kind: "usage", code: "invalid_argument" });
    expect(decide(["launch", "a", "b"], OFF)).toMatchObject({ kind: "usage" });
  });

  it("tells what changes the desktop, what sends real input, and what needs window focus", () => {
    const flags = (argv: string[], settings = OFF) => {
      const d = decide(argv, settings);
      return d.kind === "run" ? [d.input, d.ownInput, d.focus] : d.kind;
    };
    expect(flags(["snapshot", "--app", "x"])).toEqual([false, false, false]);
    expect(flags(["click", "@s1:e1"])).toEqual([true, false, false]);
    expect(flags(["press", "return", "--app", "x"])).toEqual([true, true, true]);
    expect(flags(["focus-window", "--app", "x"])).toEqual([true, false, false]);
    const physical = { ...OFF, physicalInput: true };
    expect(flags(["mouse-click", "--xy", "1,1"], physical)).toEqual([true, true, false]);
    expect(flags(["--headed", "click", "@s1:e1"], physical)).toEqual([true, true, false]);
    expect(
      flags(["batch", '[{"command":"get","args":{"ref_id":"@s1:e1","property":"value"}}]']),
    ).toEqual([false, false, false]);
    expect(flags(["batch", '[{"command":"click","args":{"ref_id":"@s1:e1"}}]'])).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("a window is named by its id, which is checked like an app", () => {
    expect(run(["focus-window", "--window-id", "w-12"]).targets).toEqual([{ windowId: "w-12" }]);
  });

  it("close-app names the app it quits, which is checked too", () => {
    expect(run(["close-app", "gedit"]).targets).toEqual([{ app: "gedit" }]);
  });

  it("an option's value is not taken for the command", () => {
    expect(run(["--wait-for", "button:OK", "snapshot", "--app", "x"]).command).toBe("snapshot");
  });

  it("help and version print agent-desktop's text, unchecked", () => {
    expect(run(["snapshot", "--help"])).toMatchObject({
      argv: ["snapshot", "--help"],
      plain: true,
    });
    expect(run(["help", "click"])).toMatchObject({ argv: ["click", "--help"], plain: true });
    expect(run(["--version"])).toMatchObject({ argv: ["--version"], plain: true });
    expect(decide([], OFF)).toEqual({ kind: "help" });
  });
});

describe("a command that would act on the focused window must name its target", () => {
  it.each([
    [["snapshot", "-i"], "--app"],
    [["find", "--name", "OK"], "--app"],
    [["screenshot"], "--screen"],
    [["press", "return"], "whichever window has focus"],
    [["list-surfaces"], "--app"],
    [["wait", "--text", "Done"], "--app"],
    [["minimize"], "--app"],
    [["move-window", "--x", "0", "--y", "0"], "--app"],
  ])("%j is refused", (argv, says) => {
    expect(refusal(argv)).toContain(says);
  });

  it("the refusal says why: the focused window may be PenguinHarness itself", () => {
    expect(refusal(["snapshot"])).toContain("PenguinHarness itself");
  });
});

describe("what waits for a setting", () => {
  it.each([
    [["--headed", "click", "@s1:e1"], "Allow physical input"],
    [["mouse-click", "--xy", "10,10"], "Allow physical input"],
    [["double-click", "@s1:e1"], "Allow physical input"],
    [["drag", "--from", "@s1:e1", "--to", "@s1:e2"], "Allow physical input"],
    [["scroll", "@s1:e1", "--direction", "down"], "Allow physical input"],
    [["focus", "@s1:e1"], "Allow physical input"],
    [["clipboard-get"], "Allow reading the clipboard"],
    [["list-notifications"], "Allow reading notifications"],
    [["wait", "--notification"], "Allow reading notifications"],
  ])("%j is refused until %s", (argv, setting) => {
    expect(refusal(argv)).toContain(setting);
    expect(decide(argv, ALL).kind).toBe("run");
  });

  it("even allowed, a clipboard read stays text, on stdout", () => {
    expect(refusal(["clipboard-get", "--out", "x.png"], ALL)).toContain(
      "writes a file on the server",
    );
    expect(refusal(["clipboard-get", "--format", "image"], ALL)).toContain("only text");
  });
});

describe("what never runs here", () => {
  it.each([
    [["sandbox", "list"]],
    [["mcp"]],
    [["cursor-overlay", "enable"]],
    [["session", "start"]],
    [["trace", "show"]],
    [["dismiss-all-notifications"]],
    [["notification-action", "1", "Reply"]],
    [["open-system-surface", "--surface", "dock"]],
    [["sandbox", "--help"]],
  ])("%j is refused", (argv) => {
    expect(decide(argv, ALL).kind).toBe("refused");
  });

  it.each([
    [["snapshot", "--app", "x", "--debug"], "--debug"],
    [["click", "@s1:e1", "--screenshot", "a.html"], "HTML capture"],
    [["click", "@s1:e1", "--trace", "t.jsonl"], "--trace"],
    [["snapshot", "--app", "x", "--session", "abc"], "--session"],
    [["close-app", "gedit", "--force"], "without --force"],
    [["press", "cmd+q", "--app", "x", "--force"], "press --force"],
    [["launch", "slack", "--cdp", "9222"], "DevTools port"],
    [["clipboard-set", "--image", "/etc/x.png"], "read files on the server"],
    [["permissions", "--guide"], "Open System Settings"],
    [["type", "@s1:e1", "--stdin"], "--text-file"],
    [["launch", "sh", "--arg=-c", "--arg=id"], "--arg"],
    [["launch", "Google Chrome", "--arg=--remote-debugging-port=9222"], "debugging port"],
    [["launch", "gedit", "--env", "LD_PRELOAD=/tmp/x.so"], "--env"],
    [["launch", "gedit", "--cwd", "/"], "--cwd"],
  ])("%j is refused, saying %s", (argv, says) => {
    expect(refusal(argv, ALL)).toContain(says);
  });
});

describe("text to type", () => {
  it("leaves the command line for stdin", () => {
    const plan = run(["type", "@s1:e1", "hunter2", "--timeout-ms", "100"]);
    expect(plan.argv).toEqual(["type", "@s1:e1", "--timeout-ms", "100", "--stdin"]);
    expect(plan.argv).not.toContain("hunter2");
    expect(plan.stdin).toEqual({ text: "hunter2" });
  });

  it("comes from the file the terminal sent for --text-file", () => {
    const plan = run(["set-value", "@s1:e1", "--text-file", "secret.txt"]);
    expect(plan.argv).toEqual(["set-value", "@s1:e1", "--stdin"]);
    expect(plan.stdin).toEqual({ file: "secret.txt" });
  });

  it("is given one way only", () => {
    expect(decide(["clipboard-set", "a", "--text-file", "b"], OFF)).toMatchObject({
      kind: "usage",
      code: "invalid_argument",
    });
    expect(decide(["click", "@s1:e1", "--text-file", "b"], OFF)).toMatchObject({ kind: "usage" });
  });

  it("adds its length to the command's budget", () => {
    const short = run(["type", "@s1:e1", "a"]).budgetMs;
    const long = run(["type", "@s1:e1", "a".repeat(1001)]).budgetMs;
    expect(long - short).toBe(30_000);
  });
});

describe("a screenshot's file", () => {
  it("is named as asked, with .png added", () => {
    const plan = run(["screenshot", "--app", "x", "calc"]);
    expect(plan.screenshot).toEqual({ name: "calc.png" });
    expect(plan.argv).toEqual(["screenshot", "--app", "x"]);
  });

  it("gets a dated name when none is given", () => {
    const d = decide(["screenshot", "--app", "x"], OFF, new Date(2026, 10, 19, 14, 30, 5));
    expect(d).toMatchObject({ screenshot: { name: "screenshot-20261119-143005.png" } });
  });

  it("is a file name, never a path on the server", () => {
    expect(decide(["screenshot", "--app", "x", "../../etc/x.png"], OFF)).toMatchObject({
      kind: "usage",
    });
  });

  it("is saved by the terminal: --out-dir is never passed on", () => {
    expect(run(["screenshot", "--app", "x", "--out-dir", "shots"]).argv).toEqual([
      "screenshot",
      "--app",
      "x",
    ]);
  });
});

describe("a batch", () => {
  const batch = (entries: unknown[], settings = OFF) =>
    decide(["batch", JSON.stringify(entries), "--stop-on-error"], settings);

  it("runs when every entry would, and names every entry's target", () => {
    const d = batch([
      { command: "snapshot", args: { app: "gedit", interactive_only: true } },
      { command: "click", args: { ref_id: "@s1:e1" } },
      { command: "close-app", args: { app: "gnome-calculator" } },
    ]);
    expect(d).toMatchObject({
      kind: "run",
      targets: [{ app: "gedit" }, { app: "gnome-calculator" }],
    });
  });

  it("is refused as a whole by one entry that would be", () => {
    const d = batch([
      { command: "click", args: { ref_id: "@s1:e1" } },
      { command: "mouse-click", args: { xy: "1,1" } },
    ]);
    expect(d).toMatchObject({ kind: "refused" });
    expect((d as { message: string }).message).toMatch(/^batch entry 1: .*Allow physical input/);
  });

  it.each([
    [[{ command: "snapshot", args: {} }], "--app"],
    [[{ command: "click", args: { ref_id: "@s1:e1", headed: true } }], "physical input"],
    [[{ command: "screenshot", args: { app: "x" } }], "cannot run inside a batch"],
    [[{ command: "batch", args: { json: "[]" } }], "another batch"],
    [[{ command: "click", args: { ref_id: "@s1:e1" }, session: "x" }], "--session"],
  ])("%j is refused, saying %s", (entries, says) => {
    const d = batch(entries);
    expect(d.kind).toBe("refused");
    expect((d as { message: string }).message).toContain(says);
  });

  it("that is not a JSON array of entries is a usage error", () => {
    expect(decide(["batch", "{nope"], OFF)).toMatchObject({ kind: "usage", code: "invalid_batch" });
    expect(decide(["batch", "{}"], OFF)).toMatchObject({ kind: "usage", code: "invalid_batch" });
    expect(batch([{ args: {} }])).toMatchObject({ kind: "usage", code: "invalid_batch" });
  });

  it.each([
    [[{ command: "launch", args: { app: "gedit" } }], "launch cannot run inside a batch"],
    [[{ command: "type", args: { ref_id: "@s1:e1", text: "hunter2" } }], "command line"],
    [[{ command: "set-value", args: { ref_id: "@s1:e1", value: "hunter2" } }], "command line"],
    [[{ command: "clipboard-set", args: { text: "hunter2" } }], "command line"],
  ])("%j is refused, saying %s", (entries, says) => {
    const d = batch(entries);
    expect(d.kind).toBe("refused");
    expect((d as { message: string }).message).toContain(says);
  });

  it("with --headed applies it to every entry", () => {
    expect(decide(["--headed", "batch", "[]"], OFF).kind).toBe("refused");
  });
});

describe("usage errors", () => {
  it("an unknown command is one, not a refusal", () => {
    expect(decide(["snapshoot", "--app", "x"], ALL)).toMatchObject({
      kind: "usage",
      code: "unknown_command",
    });
  });

  it("a cluster of short options is one: agent-desktop would read -vw x as -v --wait-for x", () => {
    expect(decide(["close-app", "-vw", "zz", "PenguinHarness"], ALL)).toMatchObject({
      kind: "usage",
      code: "invalid_argument",
    });
    expect(run(["snapshot", "-i", "-v", "--app", "x"]).argv).toEqual([
      "snapshot",
      "-i",
      "-v",
      "--app",
      "x",
    ]);
  });

  it("a command that could wait past the limit is one", () => {
    const d = decide(["wait", "--element", "@s1:e1", "--timeout", String(MAX_BUDGET_MS + 1)], OFF);
    expect(d).toMatchObject({ kind: "usage", code: "too_long" });
    expect(decide(["wait", String(MAX_BUDGET_MS)], OFF).kind).toBe("run");
  });
});

describe("status", () => {
  it("is answered by the plugin, with agent-desktop's own status inside", () => {
    expect(decide(["status"], OFF)).toEqual({ kind: "status", argv: ["status"] });
  });
});
