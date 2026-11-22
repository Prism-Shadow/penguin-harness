/**
 * agent-desktop 1.3.1's commands as this plugin sorts them, and the options of each that take a
 * value (read off each command's `--help`), which is what tells a positional argument from an
 * option's value when a command line is checked.
 *
 * The classes are the default-safe profile of the design (05 「Computer Use」):
 *
 *   observe          reads the desktop; allowed
 *   act              a semantic action on a ref from a snapshot; allowed
 *   window           moves, sizes, raises a window; allowed, the Skill asks the user first
 *   app              starts or quits an app; allowed, the Skill asks the user first
 *   clipboard-write  puts text on the clipboard or clears it; allowed, the Skill asks first
 *   keyboard         `press`: real keystrokes even headless, so it must name its target
 *   physical         real pointer or keyboard input; only with "Allow physical input"
 *   clipboard-read   only with "Allow reading the clipboard"
 *   notification-read only with "Allow reading notifications"
 *   batch            each entry is checked as if it ran on its own
 *   refused          never run from here, for the reason given
 */

export type CommandClass =
  | "observe"
  | "act"
  | "window"
  | "app"
  | "clipboard-write"
  | "keyboard"
  | "physical"
  | "clipboard-read"
  | "notification-read"
  | "batch"
  | "refused";

export interface CommandSpec {
  class: CommandClass;
  /** The command's own options that take a value. */
  values?: readonly string[];
  /** Options whose value may be left out (`--cdp [PORT]`). */
  optional?: readonly string[];
  /** For a refused command: why, in the words the refusal prints. */
  refused?: string;
}

/** Options every command accepts that take a value. */
export const GLOBAL_VALUES: readonly string[] = [
  "--session",
  "--agent-id",
  "--trace",
  "--screenshot",
  "--wait-for",
  "--wait-for-gone",
  "--wait-timeout",
];

/** Short options, by the long name they stand for. */
export const SHORT_OPTIONS: Readonly<Record<string, string>> = {
  "-w": "--wait-for",
  "-i": "--interactive-only",
  "-v": "--verbose",
  "-h": "--help",
  "-V": "--version",
};

const REF_ACTION = { class: "act", values: ["--timeout-ms"] } as const;
const WINDOW_OP = { class: "window", values: ["--app", "--window-id"] } as const;
const PHYSICAL_REF = { class: "physical", values: ["--timeout-ms"] } as const;

export const COMMANDS: Readonly<Record<string, CommandSpec>> = {
  status: { class: "observe" },
  permissions: { class: "observe" },
  version: { class: "observe" },
  skills: { class: "observe" },
  "list-apps": { class: "observe", values: ["--app", "--timeout-ms"] },
  "list-windows": { class: "observe", values: ["--app", "--timeout-ms"] },
  "list-displays": { class: "observe" },
  "list-surfaces": { class: "observe", values: ["--app"] },
  snapshot: {
    class: "observe",
    values: ["--app", "--window-id", "--max-depth", "--surface", "--root", "--timeout-ms"],
  },
  find: {
    class: "observe",
    values: [
      "--app",
      "--window-id",
      "--role",
      "--name",
      "--value",
      "--text",
      "--description",
      "--native-id",
      "--root",
      "--surface",
      "--state",
      "--timeout-ms",
      "--nth",
      "--limit",
    ],
  },
  get: { class: "observe", values: ["--property"] },
  is: { class: "observe", values: ["--property"] },
  wait: {
    class: "observe",
    values: [
      "--element",
      "--window",
      "--text",
      "--event",
      "--window-id",
      "--predicate",
      "--value",
      "--action",
      "--count",
      "--timeout",
      "--app",
    ],
  },
  screenshot: { class: "observe", values: ["--app", "--window-id", "--screen"] },

  click: REF_ACTION,
  type: { class: "act", values: ["--timeout-ms", "--interval-ms"] },
  "set-value": REF_ACTION,
  clear: REF_ACTION,
  select: REF_ACTION,
  toggle: REF_ACTION,
  check: REF_ACTION,
  uncheck: REF_ACTION,
  expand: REF_ACTION,
  collapse: REF_ACTION,
  "scroll-to": REF_ACTION,
  "right-click": REF_ACTION,

  "focus-window": { class: "window", values: ["--app", "--window-id", "--title"] },
  "move-window": { class: "window", values: ["--app", "--window-id", "--x", "--y"] },
  "resize-window": { class: "window", values: ["--app", "--window-id", "--width", "--height"] },
  minimize: WINDOW_OP,
  maximize: WINDOW_OP,
  restore: WINDOW_OP,

  launch: {
    class: "app",
    values: ["--timeout", "--arg", "--env", "--cwd"],
    optional: ["--cdp"],
  },
  "close-app": { class: "app" },

  "clipboard-set": { class: "clipboard-write", values: ["--image", "--file-url"] },
  "clipboard-clear": { class: "clipboard-write" },
  "clipboard-get": { class: "clipboard-read", values: ["--format", "--out"] },
  "list-notifications": { class: "notification-read", values: ["--app", "--text", "--limit"] },

  press: { class: "keyboard", values: ["--app", "--window-id"] },

  "double-click": PHYSICAL_REF,
  "triple-click": PHYSICAL_REF,
  focus: PHYSICAL_REF,
  scroll: { class: "physical", values: ["--direction", "--amount", "--timeout-ms"] },
  hover: { class: "physical", values: ["--xy", "--duration", "--timeout-ms"] },
  drag: {
    class: "physical",
    values: [
      "--from",
      "--from-xy",
      "--to",
      "--to-xy",
      "--duration",
      "--drop-delay",
      "--timeout-ms",
      "--wait-for-scope",
    ],
  },
  "mouse-move": { class: "physical", values: ["--xy"] },
  "mouse-click": { class: "physical", values: ["--xy", "--button", "--count", "--modifiers"] },
  "mouse-down": { class: "physical", values: ["--xy", "--button", "--modifiers"] },
  "mouse-up": { class: "physical", values: ["--xy", "--button", "--modifiers"] },
  "mouse-wheel": { class: "physical", values: ["--x", "--y", "--dy", "--dx", "--modifiers"] },
  "key-down": { class: "physical" },
  "key-up": { class: "physical" },

  batch: { class: "batch", values: ["--timeout-ms"] },

  sandbox: {
    class: "refused",
    refused: "sandboxes are managed outside PenguinHarness",
  },
  mcp: {
    class: "refused",
    refused: "the MCP server is not offered; run each command with penguin computer",
  },
  "cursor-overlay": { class: "refused", refused: "the cursor overlay is not offered" },
  session: {
    class: "refused",
    refused:
      "each PenguinHarness Session already has its own refs; agent-desktop sessions are not used",
  },
  trace: { class: "refused", refused: "traces are not recorded here" },
  "dismiss-notification": {
    class: "refused",
    refused: "acting on notifications is not offered",
  },
  "dismiss-all-notifications": {
    class: "refused",
    refused: "acting on notifications is not offered",
  },
  "notification-action": {
    class: "refused",
    refused: "acting on notifications is not offered",
  },
  "open-system-surface": {
    class: "refused",
    refused: "opening system surfaces (Start menu, Dock, tray) is not offered",
  },
};
