import { describe, expect, it } from "vitest";
import { decideSigint } from "../src/commands/chat.js";
import { parseApprovalAnswer } from "../src/approval.js";

describe("decideSigint (Ctrl-C 行为状态机)", () => {
  it("approving → deny（无论缓冲区是否有内容）", () => {
    expect(decideSigint("approving", false)).toBe("deny");
    expect(decideSigint("approving", true)).toBe("deny");
  });

  it("running → abort（中断当前 Task，不退出）", () => {
    expect(decideSigint("running", false)).toBe("abort");
    expect(decideSigint("running", true)).toBe("abort");
  });

  it("idle + 有输入 → clear（清空缓冲区）", () => {
    expect(decideSigint("idle", true)).toBe("clear");
  });

  it("idle + 无输入 → confirm-exit（弹出 y/N 退出确认）", () => {
    expect(decideSigint("idle", false)).toBe("confirm-exit");
  });

  it("confirming-exit → exit（确认中再次 Ctrl-C 直接退出）", () => {
    expect(decideSigint("confirming-exit", false)).toBe("exit");
    expect(decideSigint("confirming-exit", true)).toBe("exit");
  });
});

describe("parseApprovalAnswer", () => {
  it("y / yes（trim、不区分大小写）→ allow；n / no → deny", () => {
    expect(parseApprovalAnswer("y")).toBe("allow");
    expect(parseApprovalAnswer("  YES \n")).toBe("allow");
    expect(parseApprovalAnswer("Y")).toBe("allow");
    expect(parseApprovalAnswer("n")).toBe("deny");
    expect(parseApprovalAnswer("NO")).toBe("deny");
  });
  it("空/无关输入用 fallback（缺省 deny；工具审批传 allow）", () => {
    expect(parseApprovalAnswer("")).toBe("deny"); // default fallback
    expect(parseApprovalAnswer("nope")).toBe("deny");
    expect(parseApprovalAnswer("", "allow")).toBe("allow"); // tool approval defaults to allow
    expect(parseApprovalAnswer("nope", "allow")).toBe("allow");
    expect(parseApprovalAnswer("n", "allow")).toBe("deny"); // explicit n still denies
  });
});
