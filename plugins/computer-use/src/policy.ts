/**
 * What `penguin computer` runs, decided in the server before agent-desktop starts — the
 * default-safe profile of the design (05 「Computer Use」):
 *
 * - Observation and semantic ref actions run. Window management, `launch` (an app's name, no
 *   arguments, environment or working directory; the caller checks the name, launch-name.ts),
 *   `close-app` and clipboard writes run too; the Skill has the Agent ask the user first.
 * - Physical input (`--headed`, the pointer, hover, drag, multi-clicks, focus, the wheel, held
 *   keys) runs only with "Allow physical input"; reading the clipboard and notifications each
 *   have their own switch. All three are off by default.
 * - A command that would otherwise act on whatever window has focus must name its target:
 *   `snapshot`, `find`, `screenshot`, `press`, `list-surfaces`, a text `wait` and the window
 *   commands need `--app` or `--window-id` (a `--root` drill-down and `screenshot --screen`
 *   excepted). The targets named are returned for the caller to check against PenguinHarness's
 *   own processes (self-target.ts) before anything runs.
 * - Some commands and options never run from here, each refused with its reason.
 * - A `batch` runs only when each of its entries would run on its own; it may not launch, take a
 *   screenshot, or carry text to type (its JSON is a command-line argument).
 * - A line agent-desktop would read differently (a cluster of short options) is a usage error.
 * - Text to type is taken off the command line and sent on stdin.
 *
 * Every refusal names what was refused, why, and the setting that allows it when there is one,
 * so the Agent can tell the user. Usage errors (an unknown command, a malformed batch) are not
 * refusals: they print with exit code 2, like agent-desktop's own.
 */
import { has, parseArgv, rebuild, TEXT_FILE, valueOf } from "./argv.js";
import type { Parsed } from "./argv.js";
import { COMMANDS } from "./commands.js";

export interface PolicySettings {
  physicalInput: boolean;
  clipboardRead: boolean;
  notificationRead: boolean;
}

/** A process to check before running: an app by name, or a window by id. */
export type Target = { app: string } | { windowId: string };

export interface RunPlan {
  kind: "run";
  command: string;
  /** The arguments for agent-desktop (a screenshot's path is added by the caller). */
  argv: string[];
  /** `--help` / `--version`: plain text, not an envelope. */
  plain: boolean;
  /** What goes to stdin: text from the command line, or the file sent for `--text-file`. */
  stdin?: { text: string } | { file: string };
  targets: Target[];
  /** `screenshot`: the name of the file handed back. */
  screenshot?: { name: string };
  /**
   * `launch`: the app named, taken off `argv` — the caller checks it (launch-name.ts) and appends
   * what agent-desktop is given for it.
   */
  launch?: { app: string };
  /** The command's own budget, before any text read from a file. */
  budgetMs: number;
  /** Added to the budget per character of text read from a file. */
  perCharMs: number;
}

export type Decision =
  | { kind: "help" }
  | { kind: "status"; argv: string[] }
  | { kind: "usage"; code: string; message: string }
  | { kind: "refused"; message: string }
  | RunPlan;

/** The longest budget a command may have: the CLI's request would time out first. */
export const MAX_BUDGET_MS = 240_000;

const SETTINGS_PLACE = "Settings → Plugins → Computer Use";

/** What the checks read of one command, whether typed or a batch entry. */
interface Facts {
  command: string;
  has(option: string): boolean;
  value(option: string): string | undefined;
  positionals: readonly string[];
}

type Check = { refused: string } | { usage: string; code: string } | { targets: Target[] };

const FLAGS_REFUSED: Readonly<Record<string, string>> = {
  "--debug": "--debug writes a debug capture of the screen to the server's disk; it is not offered",
  "--screenshot":
    "--screenshot writes an HTML capture of the screen to the server's disk; it is not offered (use the screenshot command)",
  "--trace": "--trace writes a trace to the server's disk; traces are not recorded here",
  "--trace-strict": "--trace-strict belongs to traces, which are not recorded here",
  "--session":
    "--session is set by PenguinHarness: each Session already has its own refs, so it is not passed",
  "--agent-id": "--agent-id belongs to agent-desktop sessions, which are not used here",
  "--stdin":
    "--stdin is set by penguin computer itself: give the text as the argument, or with --text-file <file> to keep it off the command line",
};

/** Commands that act on whatever window has focus unless told otherwise. */
const NEEDS_TARGET = new Set([
  "snapshot",
  "find",
  "screenshot",
  "press",
  "list-surfaces",
  "focus-window",
  "move-window",
  "resize-window",
  "minimize",
  "maximize",
  "restore",
]);

function setting(name: string): string {
  return `an administrator allows it with "${name}" in ${SETTINGS_PLACE}`;
}

/** The checks every command passes, typed or in a batch. */
function check(facts: Facts, settings: PolicySettings, where: string): Check {
  const c = facts.command;
  const spec = COMMANDS[c];
  if (spec === undefined) {
    return {
      usage: `${where}'${c}' is not an agent-desktop command this plugin runs (penguin computer --help lists them)`,
      code: "unknown_command",
    };
  }
  if (spec.class === "refused") return { refused: `${where}${c}: ${spec.refused}` };
  for (const [flag, why] of Object.entries(FLAGS_REFUSED)) {
    if (facts.has(flag)) return { refused: `${where}${why}` };
  }
  if (spec.class === "physical" || facts.has("--headed")) {
    if (!settings.physicalInput) {
      const what = facts.has("--headed") ? "--headed" : c;
      return {
        refused: `${where}${what} is physical input (the real mouse and keyboard, which compete with the person at this computer); ${setting("Allow physical input")}`,
      };
    }
  }
  if (spec.class === "clipboard-read") {
    if (!settings.clipboardRead) {
      return {
        refused: `${where}clipboard-get reads the clipboard; ${setting("Allow reading the clipboard")}`,
      };
    }
    if (facts.has("--out")) {
      return {
        refused: `${where}clipboard-get --out writes a file on the server; read text without it`,
      };
    }
    const format = facts.value("--format");
    if (format !== undefined && format !== "text") {
      return { refused: `${where}only text is read from the clipboard here (--format text)` };
    }
  }
  if (spec.class === "notification-read" || (c === "wait" && facts.has("--notification"))) {
    if (!settings.notificationRead) {
      return {
        refused: `${where}${c === "wait" ? "wait --notification" : c} reads notifications; ${setting("Allow reading notifications")}`,
      };
    }
  }
  if (c === "close-app" && facts.has("--force")) {
    return {
      refused: `${where}close-app --force terminates the app without letting it save; quit it gracefully, without --force`,
    };
  }
  if (c === "press" && facts.has("--force")) {
    return {
      refused: `${where}press --force sends the shortcuts agent-desktop flags as dangerous (such as quitting an app); it is not offered`,
    };
  }
  if (c === "launch" && facts.has("--cdp")) {
    return {
      refused: `${where}launch --cdp opens a DevTools port that every account on this machine can connect to; it is not offered`,
    };
  }
  if (c === "launch") {
    const extra = ["--arg", "--env", "--cwd"].find((flag) => facts.has(flag));
    if (extra !== undefined) {
      return {
        refused: `${where}launch takes an app's name only: ${extra} (like --arg, --env and --cwd) would let it run any program with any arguments, such as a shell with a script or a browser with a debugging port; it is not offered`,
      };
    }
  }
  if (c === "clipboard-set" && (facts.has("--image") || facts.has("--file-url"))) {
    return {
      refused: `${where}clipboard-set --image and --file-url read files on the server; only text is put on the clipboard here`,
    };
  }
  if (c === "permissions" && (facts.has("--guide") || facts.has("--request"))) {
    return {
      refused: `${where}permissions --guide and --request change what the system shows the user; ask the user to use "Open System Settings" on the Computer Use card in ${SETTINGS_PLACE}`,
    };
  }
  const targets: Target[] = [];
  const app = facts.value("--app");
  const windowId = facts.value("--window-id");
  if (app !== undefined) targets.push({ app });
  if (windowId !== undefined) targets.push({ windowId });
  if (c === "close-app" && facts.positionals[0] !== undefined) {
    targets.push({ app: facts.positionals[0] });
  }
  const named = app !== undefined || windowId !== undefined;
  const exempt =
    ((c === "snapshot" || c === "find") && facts.has("--root")) ||
    (c === "screenshot" && facts.has("--screen")) ||
    (c === "list-surfaces" && app !== undefined);
  if (NEEDS_TARGET.has(c) && !named && !exempt) {
    const why =
      c === "press"
        ? "press sends real keystrokes: without --app or --window-id they go to whichever window has focus, which may be PenguinHarness itself"
        : `${c} needs --app <name> or --window-id <id>: without one it acts on the focused window, which may be PenguinHarness itself`;
    const extra =
      c === "snapshot" || c === "find"
        ? " (or --root <ref> to drill into an earlier snapshot)"
        : c === "screenshot"
          ? " (or --screen <index> for a whole display)"
          : "";
    return { refused: `${where}${why}${extra}` };
  }
  if (c === "list-surfaces" && app === undefined) {
    return { refused: `${where}list-surfaces needs --app <name>` };
  }
  if (c === "wait" && facts.has("--text") && app === undefined) {
    return {
      refused: `${where}wait --text needs --app <name>: without it the text is looked for in the focused app, which may be PenguinHarness itself`,
    };
  }
  return { targets };
}

const num = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * A command's own budget: what it waits at most before it answers, by agent-desktop's defaults
 * and the timeout the command line gives. `perChar` is what each character of typed text adds.
 */
function budgetOf(facts: Facts): { budgetMs: number; perCharMs: number } {
  const c = facts.command;
  const cls = COMMANDS[c]?.class;
  let budget = 10_000;
  let perChar = 0;
  if (c === "snapshot") budget = num(facts.value("--timeout-ms")) ?? 3_000;
  else if (c === "find" || c === "list-apps" || c === "list-windows" || c === "list-surfaces")
    budget = num(facts.value("--timeout-ms")) ?? 5_000;
  else if (c === "wait")
    budget = num(facts.positionals[0]) ?? num(facts.value("--timeout")) ?? 30_000;
  else if (c === "launch") budget = num(facts.value("--timeout")) ?? 30_000;
  else if (c === "batch") budget = num(facts.value("--timeout-ms")) ?? 60_000;
  else if (c === "screenshot") budget = 30_000;
  else if (c === "close-app") budget = 15_000;
  else if (cls === "act" || cls === "physical") budget = num(facts.value("--timeout-ms")) ?? 5_000;
  if (c === "type") {
    perChar = 30 + (num(facts.value("--interval-ms")) ?? 0);
  }
  if (facts.has("--wait-for") || facts.has("--wait-for-gone")) {
    budget += num(facts.value("--wait-timeout")) ?? 30_000;
  }
  return { budgetMs: budget, perCharMs: perChar };
}

function factsOf(parsed: Parsed): Facts {
  return {
    command: parsed.command!,
    has: (option) => has(parsed, option),
    value: (option) => valueOf(parsed, option),
    positionals: parsed.positionals,
  };
}

/** A batch entry's `args` as options: `window_id: "w1"` reads as `--window-id w1`. */
function entryFacts(entry: { command: string; args?: unknown }): Facts {
  const options = new Map<string, string | true>();
  const args =
    entry.args !== null && typeof entry.args === "object" && !Array.isArray(entry.args)
      ? (entry.args as Record<string, unknown>)
      : {};
  for (const [key, value] of Object.entries(args)) {
    const name = `--${key.replace(/_/g, "-")}`;
    if (value === true) options.set(name, true);
    else if (typeof value === "string" || typeof value === "number")
      options.set(name, String(value));
    else if (Array.isArray(value) && value.length > 0) options.set(name, String(value.at(-1)));
  }
  return {
    command: entry.command,
    has: (option) => options.has(option),
    value: (option) => {
      const v = options.get(option);
      return typeof v === "string" ? v : undefined;
    },
    positionals: [],
  };
}

/** The checks of a batch's entries, in order; the first that does not pass is the answer. */
function checkBatch(json: string | undefined, settings: PolicySettings): Check {
  if (json === undefined) {
    return { usage: "batch takes a JSON array of {command, args} objects", code: "invalid_batch" };
  }
  let entries: unknown;
  try {
    entries = JSON.parse(json);
  } catch (err) {
    return {
      usage: `batch takes a JSON array of {command, args} objects: ${err instanceof Error ? err.message : String(err)}`,
      code: "invalid_batch",
    };
  }
  if (!Array.isArray(entries)) {
    return { usage: "batch takes a JSON array of {command, args} objects", code: "invalid_batch" };
  }
  const targets: Target[] = [];
  for (const [i, raw] of entries.entries()) {
    const where = `batch entry ${i}: `;
    if (
      raw === null ||
      typeof raw !== "object" ||
      typeof (raw as { command?: unknown }).command !== "string"
    ) {
      return { usage: `${where}an entry is {command, args}`, code: "invalid_batch" };
    }
    const entry = raw as { command: string; args?: unknown; session?: unknown };
    if (entry.session !== undefined) return { refused: `${where}${FLAGS_REFUSED["--session"]}` };
    if (entry.command === "batch") return { refused: `${where}a batch cannot hold another batch` };
    if (entry.command === "screenshot") {
      return {
        refused: `${where}screenshot cannot run inside a batch: its file comes back to you on its own, so run it alone`,
      };
    }
    if (entry.command === "launch") {
      return { refused: `${where}launch cannot run inside a batch: run it on its own` };
    }
    // A batch's JSON is agent-desktop's argument, which every process on the machine can read:
    // text to type goes through its own command, where it travels on stdin.
    const args = entry.args as Record<string, unknown> | undefined;
    const inline =
      (entry.command === "type" || entry.command === "clipboard-set"
        ? args?.text
        : entry.command === "set-value"
          ? args?.value
          : undefined) !== undefined;
    if (inline) {
      return {
        refused: `${where}text inside a batch would be visible on agent-desktop's command line: run ${entry.command} on its own (or with --text-file)`,
      };
    }
    const outcome = check(entryFacts(entry), settings, where);
    if (!("targets" in outcome)) return outcome;
    targets.push(...outcome.targets);
  }
  return { targets };
}

/** The positional that holds a command's text, for the commands whose text goes to stdin. */
const TEXT_POSITIONAL: Readonly<Record<string, number>> = {
  type: 1,
  "set-value": 1,
  "clipboard-set": 0,
};

/** `screenshot-20261119-143005.png` for now. */
function defaultScreenshotName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `screenshot-${stamp}.png`;
}

/**
 * A plan's budget once the text of a `--text-file` is known; a usage error when it passes the limit,
 * so a long file cannot keep the server typing after the CLI has given up.
 */
export function budgetWithText(plan: RunPlan, textLength: number): number | Decision {
  const total = plan.budgetMs + plan.perCharMs * textLength;
  if (total <= MAX_BUDGET_MS) return total;
  return {
    kind: "usage",
    code: "too_long",
    message: `typing this file could take ${Math.round(total / 1000)} s; one command waits at most ${MAX_BUDGET_MS / 1000} s here — split the text`,
  };
}

/** A run that prints agent-desktop's own help or version text. */
function plainRun(command: string, argv: string[]): RunPlan {
  return { kind: "run", command, argv, plain: true, targets: [], budgetMs: 10_000, perCharMs: 0 };
}

/** Decides what a `penguin computer` command line runs. */
export function decide(
  argv: readonly string[],
  settings: PolicySettings,
  now: Date = new Date(),
): Decision {
  const parsed = parseArgv(argv);
  if (parsed.fault !== undefined) {
    return { kind: "usage", code: "invalid_argument", message: parsed.fault };
  }
  const command = parsed.command;
  if (command === null) {
    if (has(parsed, "--version")) return plainRun("--version", ["--version"]);
    return { kind: "help" };
  }
  if (command === "help") {
    const of = parsed.positionals[0];
    if (of === undefined) return { kind: "help" };
    return decide([of, "--help"], settings, now);
  }
  const spec = COMMANDS[command];
  if (spec !== undefined && spec.class !== "refused" && has(parsed, "--help")) {
    return plainRun(command, [command, "--help"]);
  }
  const facts = factsOf(parsed);
  // A batch's own options (`--headed` applies to every entry) first, then each entry.
  let outcome = check(facts, settings, "");
  if (command === "batch" && "targets" in outcome) {
    outcome = checkBatch(parsed.positionals[0], settings);
  }
  if ("refused" in outcome) return { kind: "refused", message: outcome.refused };
  if ("usage" in outcome) return { kind: "usage", code: outcome.code, message: outcome.usage };
  if (command === "status") return { kind: "status", argv: rebuild(parsed) };

  const textFile = valueOf(parsed, TEXT_FILE);
  const textAt = TEXT_POSITIONAL[command];
  if (has(parsed, TEXT_FILE) && textAt === undefined) {
    return {
      kind: "usage",
      code: "invalid_argument",
      message: `${TEXT_FILE} gives the text of type, set-value or clipboard-set`,
    };
  }
  const drop = new Set<number>();
  const extra: string[] = [];
  let stdin: RunPlan["stdin"];
  let textLength = 0;
  if (textAt !== undefined) {
    const text = parsed.positionals[textAt];
    if (text !== undefined && textFile !== undefined) {
      return {
        kind: "usage",
        code: "invalid_argument",
        message: `give the text either as the argument or with ${TEXT_FILE}, not both`,
      };
    }
    if (text !== undefined) {
      stdin = { text };
      textLength = [...text].length;
      drop.add(textAt);
      extra.push("--stdin");
    } else if (textFile !== undefined) {
      stdin = { file: textFile };
      extra.push("--stdin");
    }
  }
  let launch: RunPlan["launch"];
  if (command === "launch") {
    const app = parsed.positionals[0];
    if (app === undefined || parsed.positionals.length > 1) {
      return {
        kind: "usage",
        code: "invalid_argument",
        message: "launch takes one app name, such as penguin computer launch Calculator",
      };
    }
    launch = { app };
    drop.add(0);
  }
  let screenshot: RunPlan["screenshot"];
  if (command === "screenshot") {
    const given = parsed.positionals[0];
    if (given !== undefined) {
      if (/[/\\]/.test(given) || given === "." || given === ".." || given.trim() === "") {
        return {
          kind: "usage",
          code: "invalid_argument",
          message: `screenshot takes a file name, not a path: the file is saved in the current directory, or in --out-dir <dir>`,
        };
      }
      drop.add(0);
    }
    const name = given ?? defaultScreenshotName(now);
    screenshot = { name: /\.png$/i.test(name) ? name : `${name}.png` };
  }
  const { budgetMs, perCharMs } = budgetOf(facts);
  const total = budgetMs + perCharMs * textLength;
  if (total > MAX_BUDGET_MS) {
    return {
      kind: "usage",
      code: "too_long",
      message: `this command could wait ${Math.round(total / 1000)} s; one command waits at most ${MAX_BUDGET_MS / 1000} s here — split it, or give a shorter timeout`,
    };
  }
  return {
    kind: "run",
    command,
    argv: rebuild(parsed, drop, extra),
    plain: false,
    ...(stdin !== undefined ? { stdin } : {}),
    targets: outcome.targets,
    ...(screenshot !== undefined ? { screenshot } : {}),
    ...(launch !== undefined ? { launch } : {}),
    budgetMs: total,
    perCharMs,
  };
}
