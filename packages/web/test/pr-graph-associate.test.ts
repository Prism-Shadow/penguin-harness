import { describe, expect, it } from "vitest";
import type { ProposalDeployScript } from "@prismshadow/penguin-server/api";
import { associatedCommand, scriptIdOf } from "../src/features/proposals/pr-graph-associate";
import { scriptName } from "../src/features/proposals/pr-graph-deploy";

const script = (id: string, description = ""): ProposalDeployScript => ({
  id,
  command: ["bash", "deploy.sh", "53531"],
  description,
  by: "user:admin",
  at: "2026-10-02T00:00:00.000Z",
});

describe("Associate …", () => {
  it("turns the name a person gives into a registrable id", () => {
    expect(scriptIdOf("Desktop")).toBe("desktop");
    expect(scriptIdOf("  Dev 1 (staging)  ")).toBe("dev-1-staging");
    expect(scriptIdOf("--x")).toBe("x");
    expect(scriptIdOf("!!!")).toBe("");
  });

  it("runs the base script's command with the arguments after it, or a command written out", () => {
    expect(associatedCommand(script("desktop"), "--compat", "")).toEqual([
      "bash",
      "deploy.sh",
      "53531",
      "--compat",
    ]);
    expect(associatedCommand(null, "", "bash other.sh 9000")).toEqual(["bash", "other.sh", "9000"]);
  });

  it("names a script by its description in the menu, else by its id", () => {
    expect(scriptName(script("desktop", "Desktop"))).toBe("Desktop");
    expect(scriptName(script("dev1"))).toBe("dev1");
  });
});
