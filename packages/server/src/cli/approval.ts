/**
 * CLI tool-call approval.
 *
 * The CLI consumes the output stream of `session.run()`; within a turn, the engine invokes the
 * injected `approve` callback for each tool_call.
 * Docs: /docs/cli § "Approval modes (--approve)"; /docs/tools § "Approval".
 */
import { createInterface } from "node:readline";
import type { ApprovalDecision, ApproveFn } from "@prismshadow/penguin-core";
import { defaultMessages } from "./i18n.js";
import type { Messages } from "./i18n.js";

/** Valid string values for the `--approve` option (includes the default allow-all, so scripts can specify it explicitly and get the default behavior). */
const APPROVE_MODES = ["allow-all", "deny-all", "read-only", "always-ask"] as const;

/**
 * Approval mode (derived from APPROVE_MODES, the single source of truth):
 *   - `allow-all`: auto-approve every tool (default mode);
 *   - `deny-all`: auto-reject every tool;
 *   - `read-only`: auto-approve read-only tools (permission === "r"), defer the rest to a human;
 *   - `always-ask`: interactive approval for each call.
 */
export type ApprovalMode = (typeof APPROVE_MODES)[number];

/**
 * Resolve the approval mode from the CLI: read `--approve`, default `allow-all`; print a
 * message and exit if the value is invalid.
 */
export function resolveApprovalMode(approve: string | undefined, t: Messages): ApprovalMode {
  if (approve === undefined) return "allow-all";
  const v = approve.trim().toLowerCase();
  if ((APPROVE_MODES as readonly string[]).includes(v)) {
    return v as ApprovalMode;
  }
  process.stderr.write(`${t.approveModeInvalid(approve)}\n`);
  process.exit(1);
}

/**
 * Build the `approve` callback for a given permission mode. `toolPermission` looks up a tool's
 * permission level; `interactivePrompt` is the actual Q&A used when deferring to a human (run
 * uses a one-off prompt, chat uses a persistent readline). Rendering the approval result is not
 * done here — `context_engine` emits the decision as an `approval_decision` event, rendered by
 * the frontend (see render.ts).
 */
export function makeApprove(args: {
  mode: ApprovalMode;
  toolPermission: (name: string) => "r" | "rw" | undefined;
  interactivePrompt: ApproveFn;
}): ApproveFn {
  const { mode, toolPermission, interactivePrompt } = args;
  return async (toolCall) => {
    const name = toolCall.payload.name;
    switch (mode) {
      case "allow-all":
        return "allow";
      case "deny-all":
        return "deny";
      case "read-only":
        // Auto-approve read-only tools; defer read-write/unknown tools to a human.
        if (toolPermission(name) === "r") return "allow";
        return interactivePrompt(toolCall);
      case "always-ask":
      default:
        return interactivePrompt(toolCall);
    }
  };
}

export interface PromptApprovalOptions {
  /** Message set; resolved from the env var by default. */
  t?: Messages;
  /** Stream to read the approval answer from; defaults to `process.stdin`. */
  input?: NodeJS.ReadableStream;
  /** Stream to print the approval prompt to; defaults to `process.stdout`. */
  output?: NodeJS.WritableStream;
}

/**
 * Callback that rejects the pending approval while `promptApproval` is waiting; `null`
 * otherwise. `penguin run` calls `denyActivePrompt()` from a single global SIGINT handler:
 * Ctrl-C during approval collapses to "deny" (consistent with chat), and only interrupts the
 * whole turn at other times. SIGINT is registered in exactly one place (run); promptApproval no
 * longer attaches its own listener.
 */
let activePromptDeny: (() => void) | null = null;
export function denyActivePrompt(): boolean {
  if (!activePromptDeny) return false;
  activePromptDeny();
  return true;
}

/**
 * One-off interactive approval Q&A (for non-persistent REPL scenarios like `run`). The pending
 * tool call has already been streamed above. Input-stream EOF/close is treated as a deny;
 * Ctrl-C while waiting is collapsed to a deny by the caller (run) via `denyActivePrompt`. The
 * readline instance is closed after reading.
 */
export function promptApproval(opts: PromptApprovalOptions = {}): Promise<ApprovalDecision> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const t = opts.t ?? defaultMessages();
  const rl = createInterface({ input, output });
  return new Promise<ApprovalDecision>((resolve) => {
    let resolved = false;
    const finish = (decision: ApprovalDecision) => {
      if (resolved) return;
      resolved = true;
      // Only clear our own slot: even under concurrent prompts (upstream already serializes
      // this; this is a defensive check), don't clobber someone else's deny hook.
      if (activePromptDeny === deny) activePromptDeny = null;
      rl.close();
      resolve(decision);
    };
    const deny = () => finish("deny");
    // Ctrl-C during approval is turned into a "deny" via run's global SIGINT calling
    // denyActivePrompt (no duplicate SIGINT listener registered here); input-stream EOF/close
    // is likewise treated as a deny, to avoid hanging.
    activePromptDeny = deny;
    rl.on("close", () => finish("deny"));
    rl.question(t.approvePrompt(), (answer) => {
      // Tool approval defaults to allow: a bare Enter (empty input) counts as allow.
      finish(parseApprovalAnswer(answer, "allow"));
    });
  });
}

/**
 * Parse an approval/confirmation answer (trimmed, case-insensitive): `y`/`yes` → allow,
 * `n`/`no` → deny, everything else (including empty input/bare Enter) → `fallback`. Tool
 * approval defaults to allow (pass `"allow"`); exit/restart-style confirmations default to no
 * (the default `"deny"`).
 */
export function parseApprovalAnswer(
  answer: string,
  fallback: ApprovalDecision = "deny",
): ApprovalDecision {
  const normalized = answer.trim().toLowerCase();
  if (normalized === "y" || normalized === "yes") return "allow";
  if (normalized === "n" || normalized === "no") return "deny";
  return fallback;
}
