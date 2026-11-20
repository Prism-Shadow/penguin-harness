#!/usr/bin/env node
/**
 * The computer-use plugin's smoke on a real desktop, run by
 * .github/workflows/computer-use-smoke.yml on Linux, Windows and macOS (and by hand:
 * `pnpm --filter @penguinharness/computer-use smoke` after a build).
 *
 * agent-desktop is installed by the plugin's own installer from the npm registry, then every
 * command goes through the plugin's own command handler — the policy, the check against this
 * process's own tree, the runner, the screenshot hand-back — which is what `penguin computer`
 * runs inside a server, without the server around it.
 *
 *   linux    a GTK window the workflow started (its pid in $FIXTURE_PID_FILE): snapshot, type,
 *            get, click, wait, screenshot; and a second window started by this process, which
 *            counts as this process's own and must be refused
 *   win32    Notepad: launch, snapshot, set-value, get, screenshot
 *   darwin   commands that need no Accessibility grant, and snapshot answering; where the
 *            runner has granted Accessibility, Calculator: launch, a bundle ID refused, snapshot,
 *            click, screenshot
 *   all      status, and the policy refusals (unscoped, launch arguments, a launch by path, an
 *            unlisted window, physical input)
 *
 * Prints one line per check and exits 1 when any failed.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ComputerUseService, handleComputer, Probe } from "../dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cu-smoke-"));
const service = new ComputerUseService({ root });
service.bind({ get: () => ({}) });
const probe = new Probe(service);
let failed = 0;

function check(label, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  return ok;
}

/** One `penguin computer` command line, as the server would run it. */
async function computer(args, sent = {}) {
  let stdout = "";
  let stderr = "";
  let code = 0;
  const files = [];
  await handleComputer(service, probe, args, {
    stdout: { write: (s) => void (stdout += s) },
    stderr: { write: (s) => void (stderr += s) },
    exit: (c) => void (code = c),
    caller: { userId: "ci", isAdmin: true, projectId: "smoke", sessionId: "smoke" },
    input: (value) => (sent[value] === undefined ? undefined : { name: value, data: sent[value] }),
    output: (file) => void files.push(file),
    language: "en",
  });
  let json = null;
  try {
    json = JSON.parse(stdout);
  } catch {}
  const brief = (stdout.trim() || stderr.trim()).slice(0, 200);
  return { code, stdout, stderr, json, files, brief };
}

/** The ref of the first element `pick` accepts, depth first. */
function findRef(tree, pick) {
  if (tree === null || typeof tree !== "object") return undefined;
  if (pick(tree) && typeof tree.ref_id === "string") return tree.ref_id;
  for (const child of tree.children ?? []) {
    const found = findRef(child, pick);
    if (found !== undefined) return found;
  }
  return undefined;
}

const isPng = (data) =>
  Buffer.from(data)
    .subarray(0, 4)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ install
const started = Date.now();
await service.start();
await service.install();
const state = service.state();
check(
  "agent-desktop installed from the registry",
  state.kind === "installed",
  state.kind === "installed"
    ? `${state.installed.dir} in ${Date.now() - started} ms`
    : JSON.stringify(state),
);
if (state.kind !== "installed") process.exit(1);

// ------------------------------------------------------------------ everywhere
const status = await computer(["status"]);
check(
  "status prints agent-desktop's status with the plugin's",
  status.json?.data?.penguin !== undefined,
  status.brief,
);
console.log(
  `     ready=${status.json?.data?.penguin?.ready} preconditions=${JSON.stringify(status.json?.data?.penguin?.preconditions)}`,
);
const version = await computer(["version"]);
check("version", version.code === 0 && version.json?.data?.version === "1.3.1", version.brief);
const unscoped = await computer(["snapshot", "-i"]);
check(
  "an unscoped snapshot is refused",
  unscoped.code === 1 && /^error: policy_refused: /.test(unscoped.stderr),
  unscoped.brief,
);
const launchArgs = await computer(["launch", "sh", "--arg=-c", "--arg=id"]);
check(
  "launch with arguments is refused",
  launchArgs.code === 1 && /--arg/.test(launchArgs.stderr),
  launchArgs.brief,
);
// A program written to disk would otherwise run outside every sandbox.
const payload = path.join(os.tmpdir(), process.platform === "win32" ? "payload.cmd" : "payload.sh");
const launchPath = await computer(["launch", payload]);
check(
  "launch by a path is refused",
  launchPath.code === 1 && /launch takes a plain app name/.test(launchPath.stderr),
  launchPath.brief,
);
const ghostWindow = await computer(["minimize", "--window-id", "w-no-such-window"]);
check(
  "a window list-windows does not show is refused",
  /no window has the id/.test(ghostWindow.stderr),
  ghostWindow.brief,
);
const physical = await computer(["mouse-click", "--xy", "1,1"]);
check(
  "physical input is refused by default",
  /Allow physical input/.test(physical.stderr),
  physical.brief,
);

// ------------------------------------------------------------------ per platform
if (process.platform === "linux") {
  check(
    "the server is ready here",
    status.code === 0 && status.json?.data?.penguin?.ready === true,
    status.brief,
  );
  const fixturePid = Number(fs.readFileSync(process.env.FIXTURE_PID_FILE ?? "fixture.pid", "utf8"));
  // A GTK app registers with AT-SPI only once accessibility is switched on, which agent-desktop's
  // first call does: give the window a moment to appear.
  let apps;
  let app;
  for (let i = 0; i < 30 && app === undefined; i++) {
    if (i > 0) await sleep(500);
    apps = await computer(["list-apps"]);
    app = apps.json?.data?.apps?.find((a) => a.pid === fixturePid)?.name;
  }
  if (check("the fixture is listed", typeof app === "string", apps.brief)) {
    const part = await computer(["snapshot", "--app", app.slice(0, -1)]);
    check(
      "a part of the app's name is refused",
      /no running app is named/.test(part.stderr),
      part.brief,
    );
    const snap = await computer(["snapshot", "--app", app, "-i", "--compact"]);
    const tree = snap.json?.data?.tree;
    const field = findRef(tree, (n) => n.name === "Name field");
    const greet = findRef(tree, (n) => n.name === "Greet");
    const refs = check(
      "snapshot gives refs",
      snap.code === 0 && field !== undefined && greet !== undefined,
      snap.brief,
    );
    if (refs) {
      const typed = await computer(["type", field, "CI"]);
      check("type", typed.code === 0, typed.brief);
      const value = await computer(["get", field, "--property", "value"]);
      check("get reads what was typed", value.json?.data?.value === "CI", value.brief);
      const fromFile = await computer(["set-value", field, "--text-file", "t.txt"], {
        "t.txt": Buffer.from("CI file"),
      });
      const value2 = await computer(["get", field, "--property", "value"]);
      check(
        "set-value from --text-file",
        fromFile.code === 0 && value2.json?.data?.value === "CI file",
        value2.brief,
      );
      const clicked = await computer(["click", greet]);
      check("click", clicked.code === 0, clicked.brief);
      const waited = await computer([
        "wait",
        "--text",
        "Hello, CI file",
        "--app",
        app,
        "--timeout",
        "5000",
      ]);
      check(
        "wait sees the click's effect",
        waited.code === 0 && waited.json?.data?.found === true,
        waited.brief,
      );
      const shot = await computer(["screenshot", "--app", app, "smoke.png"]);
      check(
        "screenshot is handed back as a PNG",
        shot.code === 0 && shot.files[0]?.name === "smoke.png" && isPng(shot.files[0].data),
        shot.brief,
      );
    }
    // A window of this process's own child is PenguinHarness's own, here.
    const own = spawn(
      process.env.FIXTURE_PYTHON ?? "/usr/bin/python3",
      ["-I", path.join(here, "gtk-fixture.py")],
      {
        stdio: "ignore",
      },
    );
    let ownWindow;
    let windows;
    for (let i = 0; i < 30 && ownWindow === undefined; i++) {
      await sleep(500);
      windows = await computer(["list-windows"]);
      ownWindow = (windows.json?.data ?? []).find((w) => w.pid === own.pid)?.id;
    }
    if (check("our own window is listed", typeof ownWindow === "string", windows.brief)) {
      const refused = await computer(["snapshot", "--window-id", ownWindow, "-i"]);
      check(
        "our own window is refused",
        /PenguinHarness itself/.test(refused.stderr),
        refused.brief,
      );
    }
    own.kill();
  }
}

if (process.platform === "win32") {
  const launched = await computer(["launch", "notepad.exe", "--activate", "--timeout", "30000"]);
  check("launch notepad", launched.code === 0, launched.brief);
  await sleep(1500);
  const apps = await computer(["list-apps"]);
  const app = apps.json?.data?.apps?.find((a) => /notepad/i.test(a.name))?.name;
  if (check("notepad is listed", typeof app === "string", apps.brief)) {
    const snap = await computer(["snapshot", "--app", app, "-i"]);
    const editor = findRef(
      snap.json?.data?.tree,
      (n) =>
        Array.isArray(n.available_actions) &&
        n.available_actions.includes("SetValue") &&
        ["textfield", "document", "textarea", "edit"].includes(n.role),
    );
    check("snapshot finds the editor", snap.code === 0 && editor !== undefined, snap.brief);
    if (editor !== undefined) {
      const set = await computer(["set-value", editor, "hello from CI"]);
      check("set-value", set.code === 0, set.brief);
      const got = await computer(["get", editor, "--property", "value"]);
      check(
        "get reads it back",
        String(got.json?.data?.value ?? "").includes("hello from CI"),
        got.brief,
      );
    }
    const shot = await computer(["screenshot", "--app", app]);
    check(
      "screenshot is handed back as a PNG",
      shot.code === 0 && isPng(shot.files[0]?.data ?? []),
      shot.brief,
    );
  }
}

if (process.platform === "darwin") {
  for (const args of [["permissions"], ["list-displays"], ["skills", "list"]]) {
    const out = await computer(args);
    check(args.join(" "), out.code === 0 && out.json?.ok === true, out.brief);
  }
  for (const args of [["list-apps"], ["list-windows"]]) {
    const out = await computer(args);
    check(`${args[0]} answers`, out.json !== null, out.brief);
  }
  // Without an Accessibility grant snapshot answers PERM_DENIED; a Finder with no window open
  // answers WINDOW_NOT_FOUND. Either is agent-desktop answering, which is what this checks.
  const finder = await computer(["snapshot", "--app", "Finder", "-i"]);
  check(
    "snapshot of Finder answers",
    finder.json?.ok === true ||
      ["PERM_DENIED", "WINDOW_NOT_FOUND"].includes(finder.json?.error?.code) ||
      /PERM_DENIED/.test(finder.stderr),
    finder.brief,
  );
  // Where the runner has granted Accessibility (GitHub's macOS runners do), operate a real app.
  if (status.json?.data?.permissions?.accessibility?.state === "granted") {
    const launched = await computer(["launch", "Calculator", "--activate", "--timeout", "30000"]);
    check("launch Calculator", launched.code === 0, launched.brief);
    // A bundle ID resolves in agent-desktop but is no name list-apps prints: refused, never run.
    const bundle = await computer(["snapshot", "--app", "com.apple.calculator", "-i"]);
    check(
      "a bundle ID is refused, not resolved past the check",
      bundle.code === 1 && /no running app is named 'com\.apple\.calculator'/.test(bundle.stderr),
      bundle.brief,
    );
    const snap = await computer(["snapshot", "--app", "Calculator", "-i"]);
    const seven = findRef(snap.json?.data?.tree, (n) => n.name === "7");
    check("snapshot finds the 7 key", snap.code === 0 && seven !== undefined, snap.brief);
    if (seven !== undefined) {
      const clicked = await computer(["click", seven]);
      check(
        "click lands",
        clicked.code === 0 && clicked.json?.data?.disposition?.delivery !== "not_delivered",
        clicked.brief,
      );
    }
    const shot = await computer(["screenshot", "--app", "Calculator"]);
    check(
      "screenshot is handed back as a PNG",
      shot.code === 0 && isPng(shot.files[0]?.data ?? []),
      shot.brief,
    );
    const closed = await computer(["close-app", "Calculator"]);
    check("close-app", closed.code === 0, closed.brief);
  }
}

// Best effort: on Windows an app the smoke launched may still hold a file open for a moment.
try {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
} catch (err) {
  console.log(`(left ${root}: ${err.message})`);
}
console.log(failed === 0 ? "smoke passed" : `smoke: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
