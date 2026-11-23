/**
 * `penguin computer <command> [args]` — agent-desktop's commands, run in the server for the
 * Agent's shell (a member plugin command: its caller is the run's Project and Session).
 *
 * The command line is agent-desktop's own: the words after `computer` are checked by policy.ts
 * and, when they pass, given to agent-desktop as they are. What comes back is agent-desktop's
 * envelope, printed as one line of JSON, with agent-desktop's exit code (0 ok, 1 an error
 * envelope, 2 a usage error). What this plugin refuses or cannot do is one line on stderr,
 * `error: <code>: <message>`, with exit code 1 (2 for a usage error) — the browser CLI's form.
 *
 * Three things differ from running agent-desktop by hand, each for the Agent's sake:
 *
 *   status          agent-desktop's status, plus `data.penguin`: this plugin's version, whether
 *                   it is on, agent-desktop's install (`install`), the settings, the machine's
 *                   `checks`, and the `desktop` now — the focused window, the displays, the
 *                   user's input idle seconds; exit code 1 when Computer Use cannot run here.
 *   screenshot      the PNG is taken on the server and handed back as a file, which the terminal
 *                   saves in the current directory or `--out-dir <dir>`; `data.path` is its name.
 *   --text-file F   the terminal reads F and sends it; it becomes the text of type, set-value or
 *                   clipboard-set on stdin, so a secret never appears on a command line.
 *
 * Who may run it: an administrator — for an Agent's call, the server resolves the caller to the
 * human driving its Session — or anyone once "Allow members" is on; and only in a Project that
 * enables the plugin on this machine (the command's `requiresProjectListing`, checked by the server).
 *
 * Before a command that names an app or a window runs, the name must be one `list-apps` prints
 * (the window one `list-windows` shows), and its processes are checked against PenguinHarness's
 * own (self-target.ts): Computer Use never operates PenguinHarness. Anything unresolved is refused.
 *
 * Two more checks keep an Agent from working against the person at this computer:
 *
 *   user_active          a command that changes the desktop is refused while that person used the
 *                        keyboard or mouse less than USER_ACTIVE_SECONDS ago (idle.ts) — input the
 *                        plugin itself sent excepted — when an administrator turned "Pause while
 *                        the user is active" on. An idle time that cannot be read pauses nothing.
 *   window_not_focused   keystrokes (`press`, `key-down`, `key-up`) go to whichever window has
 *                        focus, so the named window must be the focused one; the refusal names the
 *                        `focus-window` to run first. Focus is never taken silently.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { CliCommandCode, CliCommandContext } from "@prismshadow/penguin-core/cli";
import { budgetWithText, decide } from "./policy.js";
import type { RunPlan, Target } from "./policy.js";
import { preconditionsOf } from "./probe.js";
import type { Probe } from "./probe.js";
import type { Envelope, RunOutput } from "./runner.js";
import type { ComputerUseService, ProgramChoice } from "./service.js";
import { launchDirOf, mkdirPrivate, stateDirFor, tmpDirOf } from "./state.js";
import { USER_ACTIVE_SECONDS } from "./settings.js";
import type { ComputerUseSettings } from "./settings.js";
import type { IdleReading } from "./idle.js";
import { helpText } from "./strings.js";

const manifest = createRequire(import.meta.url)("../package.json") as { version: string };

/** This plugin's npm version, as `status` reports it. */
export const PLUGIN_VERSION = manifest.version;

/** The part of commander's Command the code half uses. */
interface CommandNode {
  helpOption(flags: false): CommandNode;
  allowUnknownOption(allow?: boolean): CommandNode;
  allowExcessArguments(allow?: boolean): CommandNode;
  argument(name: string, description?: string): CommandNode;
  action(fn: (args: string[]) => void | Promise<void>): CommandNode;
}

/** What a run writes to and reads from, the context the host gives. */
type Io = Pick<CliCommandContext, "stdout" | "stderr" | "exit" | "caller" | "input" | "output"> & {
  language: string;
};

function fail(io: Io, code: string, message: string, exit = 1): void {
  io.stderr.write(`error: ${code}: ${message}\n`);
  io.exit(exit);
}

type Ready = Extract<ProgramChoice, { ok: true }>;

/** One running app as agent-desktop lists it. */
interface ListedApp {
  name: string;
  pid: number;
}

/**
 * The running apps by name and pid: `list-apps`, else `list-windows` (its `app_name`s), which
 * answers where `list-apps` times out (agent-desktop's macOS #656). An error when neither answers.
 */
async function listedApps(
  run: (argv: string[]) => Promise<RunOutput>,
): Promise<{ apps: ListedApp[] } | { error: string }> {
  const apps = await run(["list-apps"]);
  const listed = (apps.envelope?.data as { apps?: Array<{ name?: unknown; pid?: unknown }> })?.apps;
  if (apps.envelope?.ok === true && Array.isArray(listed)) {
    return {
      apps: listed.flatMap((a) =>
        typeof a.name === "string" && typeof a.pid === "number"
          ? [{ name: a.name, pid: a.pid }]
          : [],
      ),
    };
  }
  const windows = await run(["list-windows"]);
  if (windows.envelope?.ok === true && Array.isArray(windows.envelope.data)) {
    return {
      apps: (windows.envelope.data as Array<{ app_name?: unknown; pid?: unknown }>).flatMap((w) =>
        typeof w.app_name === "string" && typeof w.pid === "number"
          ? [{ name: w.app_name, pid: w.pid }]
          : [],
      ),
    };
  }
  const why = apps.envelope?.error ?? windows.envelope?.error;
  return { error: why ? `${why.code}: ${why.message}` : "agent-desktop did not answer" };
}

/**
 * The processes `targets` name, checked against PenguinHarness's own; the refusal, or null when
 * the command may run.
 *
 * Fails closed. agent-desktop resolves `--app` more widely than it lists apps — a bundle ID or an
 * executable name on macOS, a desktop entry on Linux, a substring in `list-apps --app` — so the
 * only name checked is one that equals, ignoring case, a name `list-apps` prints; every process of
 * that name is checked. A name no running app has, a window `list-windows` does not show, and a
 * lookup that does not answer are each refused, saying which names to use.
 */
async function selfTargetRefusal(
  service: ComputerUseService,
  choice: Ready,
  targets: readonly Target[],
  stateDir: string,
): Promise<{ code: string; message: string } | null> {
  if (targets.length === 0) return null;
  const pids = new Map<number, string>();
  const run = (argv: string[]) => service.run(choice, argv, { stateDir, budgetMs: 5_000 });
  let apps: { apps: ListedApp[] } | { error: string } | undefined;
  let windows: Envelope | null | undefined;
  for (const target of targets) {
    if ("app" in target) {
      apps ??= await listedApps(run);
      if ("error" in apps) {
        return {
          code: "target_unverified",
          message: `could not list the running apps to tell which process '${target.app}' is (${apps.error}), so nothing was run`,
        };
      }
      const want = target.app.toLowerCase();
      const named = apps.apps.filter((a) => a.name.toLowerCase() === want);
      if (named.length === 0) {
        const names = [...new Set(apps.apps.map((a) => a.name))].slice(0, 20).join(", ");
        return {
          code: "policy_refused",
          message: `no running app is named '${target.app}': name the app exactly as penguin computer list-apps prints it${names ? ` (now: ${names})` : ""}`,
        };
      }
      for (const a of named) pids.set(a.pid, a.name);
    } else {
      windows ??= (await run(["list-windows"])).envelope;
      const list = windows?.ok === true && Array.isArray(windows.data) ? windows.data : null;
      if (list === null) {
        return {
          code: "target_unverified",
          message: `could not list the windows to tell whose window ${target.windowId} is, so nothing was run`,
        };
      }
      const w = (list as Array<{ id?: unknown; pid?: unknown }>).find(
        (x) => x.id === target.windowId,
      );
      if (w === undefined || typeof w.pid !== "number") {
        return {
          code: "policy_refused",
          message: `no window has the id '${target.windowId}': use an id penguin computer list-windows prints`,
        };
      }
      pids.set(w.pid, `window ${target.windowId}`);
    }
  }
  let own: number[];
  try {
    own = await service.selfTree.own([...pids.keys()]);
  } catch (err) {
    return {
      code: "target_unverified",
      message: `could not read this machine's process table (${err instanceof Error ? err.message : String(err)}), so nothing was run`,
    };
  }
  if (own.length === 0) return null;
  return {
    code: "policy_refused",
    message: `${pids.get(own[0]!)} is PenguinHarness itself (process ${own[0]}): Computer Use never operates PenguinHarness's own windows or processes`,
  };
}

/** The window ids a reply names: a snapshot's window, an action's window surfaces. */
function windowIdsOf(data: unknown): string[] {
  if (data === null || typeof data !== "object") return [];
  const d = data as {
    window?: { id?: unknown };
    surfaces?: Array<{ id?: unknown; type?: unknown }>;
  };
  const ids: string[] = [];
  if (typeof d.window?.id === "string") ids.push(d.window.id);
  for (const s of Array.isArray(d.surfaces) ? d.surfaces : []) {
    if (s.type === "window" && typeof s.id === "string") ids.push(s.id);
  }
  return ids;
}

/**
 * The check after a run, on what agent-desktop says it acted on: the refusal, or null to keep
 * the reply.
 *
 * agent-desktop resolves `--app` again after the check before the run, so the window it read or
 * acted on is checked once more: each window id the reply names that was not already checked is
 * mapped to its process through `list-windows`, and a `launch` that attached to a running app is
 * checked by the pid it reports. A process of PenguinHarness's own tree discards the reply — an
 * action may already have happened, but its result never reaches the Agent. Only commands that
 * named a target (and `launch`) are checked; a ref action's refs come from a checked snapshot.
 * A window that is gone by then cannot be mapped and is let be.
 */
async function afterRunRefusal(
  service: ComputerUseService,
  choice: Ready,
  decision: { command: string; targets: readonly Target[] },
  envelope: Envelope,
  stateDir: string,
): Promise<{ code: string; message: string } | null> {
  if (!envelope.ok) return null;
  const pids = new Map<number, string>();
  if (decision.command === "launch") {
    const pid = (envelope.data as { pid?: unknown } | null)?.pid;
    if (typeof pid === "number") pids.set(pid, "the app launch reached");
  }
  if (decision.targets.length > 0) {
    const checked = new Set(decision.targets.flatMap((t) => ("windowId" in t ? [t.windowId] : [])));
    const fresh = windowIdsOf(envelope.data).filter((id) => !checked.has(id));
    if (fresh.length > 0) {
      const windows = (await service.run(choice, ["list-windows"], { stateDir, budgetMs: 5_000 }))
        .envelope;
      const list = windows?.ok === true && Array.isArray(windows.data) ? windows.data : [];
      for (const id of fresh) {
        const w = (list as Array<{ id?: unknown; pid?: unknown }>).find((x) => x.id === id);
        if (typeof w?.pid === "number") pids.set(w.pid, `window ${id}`);
      }
    }
  }
  if (pids.size === 0) return null;
  let own: number[];
  try {
    own = await service.selfTree.own([...pids.keys()]);
  } catch (err) {
    return {
      code: "target_unverified",
      message: `could not read this machine's process table to check what ${decision.command} reached (${err instanceof Error ? err.message : String(err)}), so its result was discarded`,
    };
  }
  if (own.length === 0) return null;
  return {
    code: "policy_refused",
    message: `${pids.get(own[0]!)} turned out to be PenguinHarness itself (process ${own[0]}): Computer Use never operates PenguinHarness's own windows or processes, so the result was discarded`,
  };
}

/**
 * The user-active guard: a refusal while the person at this computer is using it, or null. Input
 * the plugin itself just sent (`ownInputAt`) is not theirs; an idle time it cannot read, or the
 * setting turned off, pauses nothing.
 */
async function activityRefusal(
  service: ComputerUseService,
  settings: ComputerUseSettings,
): Promise<string | null> {
  if (!settings.pauseWhileUserActive) return null;
  const idle = await service.idle();
  if (idle.seconds === null || idle.seconds >= USER_ACTIVE_SECONDS) return null;
  if (service.ownInputAt(idle.seconds)) return null;
  return `the user is using the computer — their last keyboard or mouse input was ${idle.seconds.toFixed(1)} s ago. Pause and ask them before acting on their desktop; working the same window at the same time makes focus and positions change under you (an administrator can turn this check off with "Pause while the user is active" in Settings → Plugins → Computer Use)`;
}

/** One window as `list-windows` reports it. */
interface ListedWindow {
  id?: unknown;
  app_name?: unknown;
  pid?: unknown;
  title?: unknown;
  is_focused?: unknown;
}

/**
 * Keystrokes go to the focused window: the refusal when a named window (or none of a named app's
 * windows) is focused, naming the `focus-window` to run; null when it is, or when `list-windows`
 * cannot tell (agent-desktop then judges for itself).
 */
async function focusRefusal(
  service: ComputerUseService,
  choice: Ready,
  targets: readonly Target[],
  stateDir: string,
): Promise<string | null> {
  if (targets.length === 0) return null;
  const listed = (await service.run(choice, ["list-windows"], { stateDir, budgetMs: 5_000 }))
    .envelope;
  if (listed?.ok !== true || !Array.isArray(listed.data)) return null;
  const windows = listed.data as ListedWindow[];
  for (const target of targets) {
    const mine =
      "windowId" in target
        ? windows.filter((w) => w.id === target.windowId)
        : windows.filter(
            (w) =>
              typeof w.app_name === "string" &&
              w.app_name.toLowerCase() === target.app.toLowerCase(),
          );
    if (mine.length === 0 || mine.some((w) => w.is_focused === true)) continue;
    const id = String(mine[0]!.id);
    const what = "windowId" in target ? `window ${id}` : `${target.app}'s window ${id}`;
    return `${what} is not the focused window, so its keystrokes would go to another window: run penguin computer focus-window --window-id ${id}, check penguin computer list-windows shows it "is_focused": true, then retry (the user may be working in another window — ask first if so)`;
  }
  return null;
}

/** The text a plan sends on stdin, read from the file the terminal sent for `--text-file`. */
function stdinOf(plan: RunPlan, io: Io): { text?: Buffer | string; error?: string } {
  if (plan.stdin === undefined) return {};
  if ("text" in plan.stdin) return { text: plan.stdin.text };
  const file = io.input?.(plan.stdin.file);
  if (file === undefined)
    return { error: `the terminal sent no file for --text-file ${plan.stdin.file}` };
  return { text: Buffer.from(file.data) };
}

function reportRun(io: Io, out: RunOutput, plain: boolean): Envelope | null {
  if (out.spawnError !== undefined && out.code === null) {
    fail(io, "agent_desktop_failed", `agent-desktop could not be started: ${out.spawnError}`);
    return null;
  }
  if (out.timedOut) {
    fail(io, "timeout", "agent-desktop did not answer within its own time budget and was stopped");
    return null;
  }
  if (plain) {
    io.stdout.write(out.stdout);
    if (out.stderr !== "") io.stderr.write(out.stderr);
    io.exit(out.code ?? 1);
    return null;
  }
  if (out.envelope === null) {
    const said = (out.stderr.trim() || out.stdout.trim()).split("\n")[0] ?? "";
    fail(
      io,
      "agent_desktop_failed",
      `agent-desktop printed no JSON envelope (exit ${out.code ?? out.signal})${said ? `: ${said.slice(0, 300)}` : ""}`,
    );
    return null;
  }
  return out.envelope;
}

/**
 * What is on the desktop now, for an Agent about to act: the focused window (null when none is,
 * absent when it could not be listed), the displays with their bounds (coordinates are per
 * display), and how long ago the person at this computer last used the keyboard or mouse.
 */
function desktopOf(
  windows: Envelope | null,
  displays: Envelope | null,
  idle: IdleReading,
): Record<string, unknown> {
  const list =
    windows?.ok === true && Array.isArray(windows.data) ? (windows.data as ListedWindow[]) : null;
  const focused = list?.find((w) => w.is_focused === true);
  return {
    ...(list !== null
      ? {
          focused:
            focused === undefined
              ? null
              : {
                  app: focused.app_name,
                  windowId: focused.id,
                  title: focused.title,
                  pid: focused.pid,
                },
        }
      : {}),
    ...(displays?.ok === true && Array.isArray(displays.data) ? { displays: displays.data } : {}),
    userIdleSeconds: idle.seconds === null ? null : Math.round(idle.seconds * 10) / 10,
    userActive: idle.seconds !== null && idle.seconds < USER_ACTIVE_SECONDS,
    ...(idle.source !== null ? { idleSource: idle.source } : {}),
    ...(idle.reason !== undefined ? { idleUnknown: idle.reason } : {}),
  };
}

/** `status`: agent-desktop's, with this plugin's own state under `data.penguin`. */
async function status(service: ComputerUseService, probe: Probe, argv: string[], io: Io) {
  await service.refresh();
  const settings = service.settings();
  const state = service.state();
  const allowed = mayUse(settings, io);
  const choice = settings.enabled && allowed ? await service.program() : null;
  let envelope: Envelope | null = null;
  let probeResult = probe.latest();
  let windows: Envelope | null = null;
  let displays: Envelope | null = null;
  if (choice !== null && choice.ok) {
    const stateDir = await stateDirFor(service.root, callerOf(io));
    const out = await service.run(choice, argv, { stateDir, budgetMs: 10_000 });
    envelope = out.envelope;
    probeResult = await probe.refresh();
    windows = (await service.run(choice, ["list-windows"], { stateDir, budgetMs: 5_000 })).envelope;
    displays = (await service.run(choice, ["list-displays"], { stateDir, budgetMs: 5_000 }))
      .envelope;
  }
  const idle = probeResult?.idle ?? (await service.idle());
  const checks = preconditionsOf(service.platform, process.env, probeResult);
  const reason = !settings.enabled
    ? "disabled"
    : !allowed
      ? "admin_only"
      : choice !== null && !choice.ok
        ? choice.code
        : envelope === null
          ? "agent_desktop_failed"
          : checks.some((p) => p.ok === false)
            ? "checks"
            : undefined;
  const penguin = {
    plugin: PLUGIN_VERSION,
    enabled: settings.enabled,
    ready: reason === undefined && envelope?.ok === true,
    ...(reason !== undefined ? { reason } : {}),
    // The install and version summary, apart from the checks (one block each on a status page).
    install: {
      pinned: service.pin.version,
      state: state.kind,
      ...(state.kind === "installed"
        ? { version: state.installed.version, target: state.installed.target }
        : {}),
      ...(state.kind === "override" && state.version !== null ? { version: state.version } : {}),
      ...(choice !== null && !choice.ok ? { detail: choice.message } : {}),
    },
    settings: {
      allowMembers: settings.allowMembers,
      physicalInput: settings.physicalInput,
      clipboardRead: settings.clipboardRead,
      notificationRead: settings.notificationRead,
      pauseWhileUserActive: settings.pauseWhileUserActive,
    },
    // What this machine offers: each check holds (true), fails (false) or is not known (null).
    checks: checks.map((p) => ({
      id: p.id,
      ok: p.ok,
      detail: p.text.en,
      ...(p.detail !== undefined ? { agentDesktop: p.detail } : {}),
    })),
    desktop: desktopOf(windows, displays, idle),
    refs: io.caller?.sessionId !== undefined ? "session" : "user",
  };
  const base: Envelope = envelope ?? { ok: false, command: "status" };
  const data =
    base.data !== null && typeof base.data === "object" && !Array.isArray(base.data)
      ? (base.data as Record<string, unknown>)
      : {};
  io.stdout.write(`${JSON.stringify({ ...base, data: { ...data, penguin } })}\n`);
  io.exit(penguin.ready ? 0 : 1);
}

/**
 * Whether this caller may use Computer Use: an administrator — which, for an Agent's call, the
 * server resolves to the human driving its Session — or anyone once "Allow members" is on.
 */
function mayUse(settings: ComputerUseSettings, io: Io): boolean {
  return settings.allowMembers || io.caller?.isAdmin === true;
}

function callerOf(io: Io): { sessionId?: string; userId: string } {
  return {
    userId: io.caller?.userId ?? "local",
    ...(io.caller?.sessionId !== undefined ? { sessionId: io.caller.sessionId } : {}),
  };
}

/** Handles one command line. */
export async function handleComputer(
  service: ComputerUseService,
  probe: Probe,
  args: readonly string[],
  io: Io,
): Promise<void> {
  const settings = service.settings();
  const decision = decide(args, settings);
  if (decision.kind === "help") {
    io.stdout.write(helpText(io.language === "zh" ? "zh" : "en"));
    return;
  }
  if (decision.kind === "usage") return fail(io, decision.code, decision.message, 2);
  if (decision.kind === "refused") return fail(io, "policy_refused", decision.message);
  if (decision.kind === "status") return status(service, probe, decision.argv, io);
  if (!settings.enabled) {
    return fail(
      io,
      "disabled",
      "Computer Use is off on this server; an administrator turns it on in Settings → Plugins → Computer Use",
    );
  }
  if (!mayUse(settings, io)) {
    return fail(
      io,
      "admin_only",
      `Computer Use runs only for administrators on this server (and Agents working for one); an administrator can allow members with "Allow members" in Settings → Plugins → Computer Use`,
    );
  }
  const choice = await service.program();
  if (!choice.ok) return fail(io, choice.code, choice.message);
  const stdin = stdinOf(decision, io);
  if (stdin.error !== undefined) return fail(io, "invalid_argument", stdin.error, 2);
  let budgetMs = decision.budgetMs;
  if (stdin.text !== undefined && decision.stdin !== undefined && "file" in decision.stdin) {
    const withText = budgetWithText(decision, [...stdin.text.toString()].length);
    if (typeof withText !== "number") {
      return withText.kind === "usage" ? fail(io, withText.code, withText.message, 2) : undefined;
    }
    budgetMs = withText;
  }
  let argv = decision.argv;
  // A Linux launch also runs with a PATH of system directories only (launch-name.ts).
  let launchPath: string | undefined;
  if (decision.launch !== undefined) {
    const target = await service.launchTarget(decision.launch.app);
    if (!target.ok)
      return fail(io, "policy_refused", `launch takes a plain app name: ${target.message}`);
    argv = [...argv, target.app];
    launchPath = target.path;
  }
  const stateDir = await stateDirFor(service.root, callerOf(io));
  const refusal = await selfTargetRefusal(service, choice, decision.targets, stateDir);
  if (refusal !== null) return fail(io, refusal.code, refusal.message);
  if (decision.input) {
    const active = await activityRefusal(service, settings);
    if (active !== null) return fail(io, "user_active", active);
  }
  if (decision.focus) {
    const unfocused = await focusRefusal(service, choice, decision.targets, stateDir);
    if (unfocused !== null) return fail(io, "window_not_focused", unfocused);
  }
  // agent-desktop hands its environment, AGENT_DESKTOP_HOME included, to what it launches: a
  // launch gets a state directory of its own, holding no Session's refs.
  const runDir = decision.command === "launch" ? await launchDirOf(service.root) : stateDir;
  let shot: string | null = null;
  if (decision.screenshot !== undefined) {
    const dir = tmpDirOf(service.root);
    await mkdirPrivate(service.root, dir);
    shot = path.join(dir, `${randomUUID()}.png`);
    argv = [...argv, shot];
  }
  try {
    const out = await service.run(choice, argv, {
      stateDir: runDir,
      ...(stdin.text !== undefined ? { stdin: stdin.text } : {}),
      ...(launchPath !== undefined ? { path: launchPath } : {}),
      budgetMs,
    });
    // Real input events this command sent reset the system's idle time: they are not the user's.
    if (decision.ownInput) service.noteOwnInput();
    const envelope = reportRun(io, out, decision.plain);
    if (envelope === null) return;
    const after = await afterRunRefusal(service, choice, decision, envelope, stateDir);
    if (after !== null) return fail(io, after.code, after.message);
    if (shot !== null && envelope.ok && decision.screenshot !== undefined) {
      const data = await fs.readFile(shot);
      io.output?.({ name: decision.screenshot.name, mimeType: "image/png", data });
      if (envelope.data !== null && typeof envelope.data === "object") {
        (envelope.data as Record<string, unknown>).path = decision.screenshot.name;
      }
    }
    io.stdout.write(`${JSON.stringify(envelope)}\n`);
    io.exit(out.code ?? 1);
  } finally {
    if (shot !== null) await fs.rm(shot, { force: true });
  }
}

/** The code half of the `computer` command. */
export function computerCommand(
  ready: () => { service: ComputerUseService; probe: Probe },
): CliCommandCode {
  return {
    register(command, ctx) {
      (command as unknown as CommandNode)
        .helpOption(false)
        .allowUnknownOption()
        .allowExcessArguments()
        .argument("[args...]")
        .action(async (args) => {
          const { service, probe } = ready();
          await handleComputer(service, probe, args ?? [], {
            stdout: ctx.stdout,
            stderr: ctx.stderr,
            exit: ctx.exit,
            ...(ctx.caller !== undefined ? { caller: ctx.caller } : {}),
            ...(ctx.input !== undefined ? { input: ctx.input } : {}),
            ...(ctx.output !== undefined ? { output: ctx.output } : {}),
            language: ctx.messages.language,
          });
        });
    },
  };
}
