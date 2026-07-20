import { describe, expect, it } from "vitest";
import { decideSigint } from "../src/commands/chat.js";
import { parseApprovalAnswer } from "../src/approval.js";

describe("decideSigint (Ctrl-C behavior state machine)", () => {
  it("approving -> deny (whether or not the buffer has content)", () => {
    expect(decideSigint("approving", false)).toBe("deny");
    expect(decideSigint("approving", true)).toBe("deny");
  });

  it("running -> abort (interrupts the current Task, does not exit)", () => {
    expect(decideSigint("running", false)).toBe("abort");
    expect(decideSigint("running", true)).toBe("abort");
  });

  it("idle + input -> clear (empties the buffer)", () => {
    expect(decideSigint("idle", true)).toBe("clear");
  });

  it("idle + no input -> confirm-exit (shows the y/N exit confirmation)", () => {
    expect(decideSigint("idle", false)).toBe("confirm-exit");
  });

  it("confirming-exit -> exit (a second Ctrl-C during confirmation exits immediately)", () => {
    expect(decideSigint("confirming-exit", false)).toBe("exit");
    expect(decideSigint("confirming-exit", true)).toBe("exit");
  });
});

describe("parseApprovalAnswer", () => {
  it("y / yes (trimmed, case-insensitive) -> allow; n / no -> deny", () => {
    expect(parseApprovalAnswer("y")).toBe("allow");
    expect(parseApprovalAnswer("  YES \n")).toBe("allow");
    expect(parseApprovalAnswer("Y")).toBe("allow");
    expect(parseApprovalAnswer("n")).toBe("deny");
    expect(parseApprovalAnswer("NO")).toBe("deny");
  });
  it("empty/unrelated input uses the fallback (default deny; tool approval passes allow)", () => {
    expect(parseApprovalAnswer("")).toBe("deny"); // default fallback
    expect(parseApprovalAnswer("nope")).toBe("deny");
    expect(parseApprovalAnswer("", "allow")).toBe("allow"); // tool approval defaults to allow
    expect(parseApprovalAnswer("nope", "allow")).toBe("allow");
    expect(parseApprovalAnswer("n", "allow")).toBe("deny"); // explicit n still denies
  });
});
