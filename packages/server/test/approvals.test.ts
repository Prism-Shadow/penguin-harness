import { describe, expect, it } from "vitest";
import { toolCall } from "@prismshadow/penguin-core";
import { ApprovalRegistry, makeApprove } from "../src/runtime/approvals.js";

describe("makeApprove", () => {
  it("passes gateway arguments to call-aware permission resolution", async () => {
    const seen: Array<[string, string | undefined]> = [];
    const rawArguments =
      '{"tool_ref":"tr_1","tool_name":"mcp__fx__echo","arguments":{"text":"hi"}}';
    const approve = makeApprove({
      getMode: () => "read-only",
      toolPermission: (name, args) => {
        seen.push([name, args]);
        return "r";
      },
      registry: new ApprovalRegistry(),
      publishRequest: () => {
        throw new Error("read-only gateway calls must not request manual approval");
      },
    });

    const decision = await approve(
      toolCall({ name: "call_tool", arguments: rawArguments, toolCallId: "gateway-1" }),
    );

    expect(decision).toBe("allow");
    expect(seen).toEqual([["call_tool", rawArguments]]);
  });
});
