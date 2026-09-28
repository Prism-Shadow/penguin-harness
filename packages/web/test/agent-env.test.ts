import { describe, expect, it } from "vitest";
import { envKeyProblem, keepAllExcept } from "../src/features/models/agent-env";
import { S } from "../src/lib/strings";

describe("agent env helpers", () => {
  it("checks a new key the way the server does", () => {
    expect(envKeyProblem("GEMINI_API_KEY")).toBeNull();
    expect(envKeyProblem("")).toBe(S.common.requiredField);
    expect(envKeyProblem("1BAD")).toBe(S.models.cliEnvKeyInvalid);
    expect(envKeyProblem("path")).toBe(S.models.cliEnvKeyReserved);
    expect(envKeyProblem("PENGUIN_X")).toBe(S.models.cliEnvKeyReserved);
    expect(envKeyProblem("NO_BROWSER")).toBe(S.models.cliEnvKeyReserved);
  });

  it("keeps every stored key by name, minus the one being replaced or removed", () => {
    const entries = [
      { key: "A", valueMasked: "***" },
      { key: "B", valueMasked: "***" },
    ];
    expect(keepAllExcept(entries)).toEqual([{ key: "A" }, { key: "B" }]);
    expect(keepAllExcept(entries, "A")).toEqual([{ key: "B" }]);
  });
});
