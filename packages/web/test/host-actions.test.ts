/**
 * The palette's host commands: every command this build knows has words, and one it does
 * not know is skipped rather than read.
 *
 * The second half is the whole point. The host is a separate program on its own schedule —
 * a desktop shell reaches users through an installer, the page through a hot push — so a
 * shell that offers a command the page predates is ordinary. Reading its words unchecked
 * threw inside the actions `useMemo` and blanked the entire App.
 */
import { describe, expect, it } from "vitest";
import { HOST_COMMANDS, type HostCommand } from "@prismshadow/penguin-server/api";
import { knownHostActions } from "../src/features/palette/app-palette";

describe("knownHostActions", () => {
  it("has words for every command this build declares", () => {
    expect(knownHostActions(HOST_COMMANDS).map((a) => a.command)).toEqual([...HOST_COMMANDS]);
  });

  it("skips a command from a newer host", () => {
    const fromNewerShell = ["install-cli", "some-command-from-the-future"] as HostCommand[];
    expect(knownHostActions(fromNewerShell).map((a) => a.command)).toEqual(["install-cli"]);
  });
});
