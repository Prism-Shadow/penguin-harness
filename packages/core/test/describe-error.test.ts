import { describe, expect, it } from "vitest";
import { describeError } from "../src/llm/generative-model.js";

describe("describeError", () => {
  it("walks the cause chain, surfacing the real reason behind a wrapper like 'terminated'", () => {
    // Node's fetch throws TypeError("terminated") with the actual transport failure on cause.
    const cause = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
    const err = new TypeError("terminated", { cause });
    expect(describeError(err)).toBe("terminated: other side closed (UND_ERR_SOCKET)");
  });

  it("appends a top-level error code when not already in the message", () => {
    const err = Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" });
    expect(describeError(err)).toBe("connect failed (ECONNREFUSED)");
  });

  it("does not duplicate a code already present in the message", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:443"), {
      code: "ECONNREFUSED",
    });
    expect(describeError(err)).toBe("connect ECONNREFUSED 1.2.3.4:443");
  });

  it("returns a plain message unchanged and stringifies non-Errors", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError("nope")).toBe("nope");
  });

  it("keeps a non-Error cause tail and de-duplicates repeated segments", () => {
    expect(describeError(new Error("outer", { cause: "inner reason" }))).toBe(
      "outer: inner reason",
    );
    const a = new Error("same");
    (a as { cause?: unknown }).cause = new Error("same"); // duplicate message, dropped
    expect(describeError(a)).toBe("same");
  });

  it("guards against a cyclic cause chain", () => {
    const a = new Error("a");
    const b = new Error("b");
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a; // cycle
    expect(describeError(a)).toBe("a: b");
  });
});
