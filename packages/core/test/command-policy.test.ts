import { describe, expect, it } from "vitest";
import { evaluateCommandPolicy, vetoForToolCall } from "../src/environment/command-policy.js";
import { DEFAULT_COMMAND_POLICY_RULES } from "../src/environment/command-policy-defaults.js";
import type { CommandPolicyConfig } from "../src/interfaces.js";

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
    ]) {
      expect(hit(cmd), cmd).toBeNull();
    }
  });

  it("catches mkfs including dotted variants, not lookalikes", () => {
    expect(hit("mkfs /dev/sdb1")).toBe("mkfs");
    expect(hit("sudo mkfs.ext4 /dev/sdb1")).toBe("mkfs");
    expect(hit("man mkfs")).toBe("mkfs"); // guardrail accepts this false positive: the word is the risk signal
    expect(hit("mkfsomething else")).toBeNull();
  });

  it("catches dd onto block devices but allows /dev/null and file targets", () => {
    expect(hit("dd if=/dev/zero of=/dev/sda bs=1M")).toBe("dd-to-block-device");
    expect(hit("sudo dd if=img.iso of=/dev/nvme0n1")).toBe("dd-to-block-device");
    expect(hit("dd if=/dev/rdisk2 of=/dev/rdisk3")).toBe("dd-to-block-device");
    expect(hit("dd if=/dev/zero of=/dev/null bs=1M count=1")).toBeNull();
    expect(hit("dd if=in.bin of=out.bin")).toBeNull();
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

  it("denial message names the rule and says approval cannot unblock it", () => {
    const veto = evaluateCommandPolicy("rm -rf /");
    expect(veto).not.toBeNull();
    expect(veto?.message).toContain("rm-recursive-force");
    expect(veto?.message).toContain("approval mode");
  });
});

describe("vetoForToolCall", () => {
  it("evaluates exec_command cmd only", () => {
    expect(vetoForToolCall("exec_command", { cmd: "rm -rf /" })?.rule).toBe("rm-recursive-force");
    expect(vetoForToolCall("exec_command", { cmd: "ls" })).toBeNull();
    // Other tools carry no launch command; even a same-shaped argument is not evaluated.
    expect(vetoForToolCall("write_file", { cmd: "rm -rf /" })).toBeNull();
    expect(vetoForToolCall("input_command", { chars: "rm -rf /\n" })).toBeNull();
  });

  it("treats a malformed cmd as the tool's own validation problem, not a hit", () => {
    expect(vetoForToolCall("exec_command", {})).toBeNull();
    expect(vetoForToolCall("exec_command", { cmd: 42 })).toBeNull();
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
