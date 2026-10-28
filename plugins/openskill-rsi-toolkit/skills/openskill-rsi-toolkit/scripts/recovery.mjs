/** Bounded continuation of local practice tool errors. Never an answer validator. */
export class RecoveryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class ToolRecovery {
  constructor(limits, prior, frozenRoot, now = () => Date.now()) {
    this.limits = limits;
    this.prior = structuredClone(prior);
    this.usage = structuredClone(prior);
    this.frozenRoot = frozenRoot;
    this.now = now;
    this.calls = new Map();
    this.events = [];
    this.pending = null;
    this.request = 0;
    this.grants = new Map();
  }

  observe(output) {
    this.checkTime();
    if (output?.type === "request_begin") this.request += 1;
    if (output?.type === "tool_call")
      this.calls.set(output.tool_call_id, { name: output.name, request: this.request });
    if (output?.type !== "tool_call_output") return;
    const { name, request = 0 } = this.calls.get(output.tool_call_id) ?? {};
    const grouped = this.limits.version === 2;
    const text = typeof output.output === "string" ? output.output : "";
    if (!["fatal", "aborted"].includes(output.stop_reason)) {
      // A successful command or edit ends the bounded correction window. This
      // only establishes that the correction tool ran; independent tests still
      // judge the resulting output.
      if (
        this.pending &&
        (!grouped || request > (this.pending.request ?? 0)) &&
        ["exec_command", "input_command", "edit_file", "write_file"].includes(name) &&
        output.stop_reason === "completed" &&
        !/\[process still running with process_id /.test(text)
      ) {
        this.pending.resumed_at = this.now();
        this.pending = null;
      }
      return;
    }
    const entry = {
      tool_call_id: output.tool_call_id,
      tool: name,
      at: this.now(),
      decision: "stop",
    };
    if (grouped) entry.request = request;
    this.events.push(entry);
    // Text is untrusted diagnostic evidence, never authority to relax mounts or
    // accept a result. V2 permits ordinary command exits and bounded edit-file
    // text mismatches, but cancellation, signal-style exits and
    // permission/isolation errors still stop.
    const match = text.match(
      /^(KeyError|NameError|TypeError|ValueError|IndexError|AttributeError|SyntaxError|IndentationError|FileNotFoundError):[^\n]*$/m,
    );
    const exit = text.match(/\[exit code: ([1-9]\d*)\]\s*$/);
    const editMismatch =
      grouped &&
      name === "edit_file" &&
      /^old_string not found in .+\. Make sure it matches the file content exactly, including whitespace and indentation\.$/m.test(
        text,
      );
    const commandFailure = ["exec_command", "input_command"].includes(name);
    if (
      output.stop_reason === "aborted" ||
      (!commandFailure && !editMismatch) ||
      (commandFailure && !grouped && !match) ||
      (commandFailure && !exit) ||
      (commandFailure && grouped && Number(exit[1]) >= 125) ||
      /PermissionError|Permission denied|Read-only file system|outside the role mounts|Error response from daemon|OCI runtime|Operation not permitted/i.test(
        text,
      )
    ) {
      entry.category = "unclassified_or_boundary_failure";
      throw new RecoveryError(
        "PRACTICE_HARD_FAILURE",
        "Practice failed outside the recoverable local-error classes",
      );
    }
    const editPath = editMismatch
      ? ((text.match(/^old_string not found in "(.+?)"\./m) ?? [])[1] ?? "")
      : "";
    entry.family = editMismatch
      ? "edit_file:EditMismatch"
      : `${name}:${match?.[1] ?? "CommandExit"}`;
    if (
      text.includes(`File "${this.frozenRoot}/`) ||
      /File "skills\//.test(text) ||
      editPath.startsWith("skills/") ||
      editPath.startsWith("/opt/openskill-skills/")
    ) {
      entry.category = "frozen_skill_failure";
      throw new RecoveryError(
        "SKILL_EXECUTION_FAILED",
        "Frozen skill failed; repair it in authoring before a fresh practice",
      );
    }
    if (editPath.startsWith("inputs/")) {
      entry.category = "unclassified_or_boundary_failure";
      throw new RecoveryError(
        "PRACTICE_HARD_FAILURE",
        "Read-only inputs cannot be corrected by local editing",
      );
    }
    entry.category = editMismatch ? "local_edit_error" : "local_execution_error";
    // Sibling calls were planned before the model could see any of their
    // failures. Preserve each output, but charge that family once per request.
    const key = grouped && request > 0 ? `${request}:${entry.family}` : null;
    const grant = key ? this.grants.get(key) : null;
    if (grant) {
      entry.decision = "coalesced";
      entry.recovery_tool_call_id = grant.tool_call_id;
      entry.deadline = grant.deadline;
      return;
    }
    if (
      this.usage.used >= this.limits.max_tool_recoveries ||
      (this.usage.families[entry.family] ?? 0) >= this.limits.max_same_error_recoveries
    ) {
      entry.category = "recovery_budget_exhausted";
      throw new RecoveryError(
        "RECOVERY_BUDGET_EXHAUSTED",
        "Practice tool recovery count exhausted",
      );
    }
    entry.decision = "recover";
    this.usage.used += 1;
    this.usage.families[entry.family] = (this.usage.families[entry.family] ?? 0) + 1;
    // A different failure during correction cannot extend the existing window.
    entry.deadline = this.pending?.deadline ?? this.now() + this.limits.recovery_seconds * 1000;
    this.pending = entry;
    if (key) this.grants.set(key, entry);
  }

  checkTime() {
    if (this.pending && this.now() >= this.pending.deadline)
      throw new RecoveryError("RECOVERY_TIME_EXHAUSTED", "Practice correction deadline reached");
  }

  finish() {
    this.checkTime();
    if (this.pending)
      throw new RecoveryError(
        "PRACTICE_RECOVERY_UNRESOLVED",
        "Role ended without a successful command after its tool error",
      );
  }

  report() {
    return { prior: this.prior, usage: this.usage, events: this.events, pending: this.pending };
  }
}
