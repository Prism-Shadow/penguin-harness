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
 *                   it is on, agent-desktop's install, the settings, the machine's preconditions;
 *                   exit code 1 when Computer Use cannot run here.
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
import type { ComputerUseSettings } from "./settings.js";
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

/** `status`: agent-desktop's, with this plugin's own state under `data.penguin`. */
async function status(service: ComputerUseService, probe: Probe, argv: string[], io: Io) {
  await service.refresh();
  const settings = service.settings();
  const state = service.state();
  const allowed = mayUse(settings, io);
  const choice = settings.enabled && allowed ? await service.program() : null;
  let envelope: Envelope | null = null;
  let probeResult = probe.latest();
  if (choice !== null && choice.ok) {
    const stateDir = await stateDirFor(service.root, callerOf(io));
    const out = await service.run(choice, argv, { stateDir, budgetMs: 10_000 });
    envelope = out.envelope;
    probeResult = await probe.refresh();
  }
  const preconditions = preconditionsOf(service.platform, process.env, probeResult);
  const reason = !settings.enabled
    ? "disabled"
    : !allowed
      ? "admin_only"
      : choice !== null && !choice.ok
        ? choice.code
        : envelope === null
          ? "agent_desktop_failed"
          : preconditions.some((p) => p.ok === false)
            ? "preconditions"
            : undefined;
  const penguin = {
    plugin: PLUGIN_VERSION,
    enabled: settings.enabled,
    ready: reason === undefined && envelope?.ok === true,
    ...(reason !== undefined ? { reason } : {}),
    agentDesktop: {
      pinned: service.pin.version,
      state: state.kind,
      ...(state.kind === "installed" ? { version: state.installed.version } : {}),
      ...(state.kind === "override" && state.version !== null ? { version: state.version } : {}),
      ...(choice !== null && !choice.ok ? { detail: choice.message } : {}),
    },
    settings: {
      allowMembers: settings.allowMembers,
      physicalInput: settings.physicalInput,
      clipboardRead: settings.clipboardRead,
      notificationRead: settings.notificationRead,
    },
    preconditions: preconditions.map((p) => ({
      id: p.id,
      ok: p.ok,
      detail: p.text.en,
      ...(p.detail !== undefined ? { agentDesktop: p.detail } : {}),
    })),
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
  const stateDir = await stateDirFor(service.root, callerOf(io));
  const refusal = await selfTargetRefusal(service, choice, decision.targets, stateDir);
  if (refusal !== null) return fail(io, refusal.code, refusal.message);
  // agent-desktop hands its environment, AGENT_DESKTOP_HOME included, to what it launches: a
  // launch gets a state directory of its own, holding no Session's refs.
  const runDir = decision.command === "launch" ? await launchDirOf(service.root) : stateDir;
  let shot: string | null = null;
  let argv = decision.argv;
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
      budgetMs,
    });
    const envelope = reportRun(io, out, decision.plain);
    if (envelope === null) return;
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
