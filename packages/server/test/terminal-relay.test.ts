/**
 * A pty on a machine is named in the terminal id (machines/terminal-relay.ts).
 *
 * The runtime serves one socket path and asks the platform for the session by id, so the
 * whole of "which machine, which pty, which user" has to fit in that id. Pinned: the spelling
 * round-trips, an ordinary id is never mistaken for a remote one, and the owner the runtime
 * checks is exactly the user the client named — which is what makes naming anyone else
 * refusable before the relay runs.
 */
import { describe, expect, it } from "vitest";
import { isRemoteTerminalRef, parseRemoteTerminalRef } from "../src/machines/terminal-relay.js";

describe("remote terminal references", () => {
  it("parses <terminalId>@<machineId>@<userId>", () => {
    const ref = parseRemoteTerminalRef("t-1@AtZ2EEKC5jxZipMN@admin");
    expect(ref).toEqual({
      id: "t-1@AtZ2EEKC5jxZipMN@admin",
      ownerUserId: "admin",
      remote: { machineId: "AtZ2EEKC5jxZipMN", terminalId: "t-1" },
    });
    expect(isRemoteTerminalRef(ref!)).toBe(true);
  });

  it("is null for a plain local id, and for anything half-spelled", () => {
    expect(parseRemoteTerminalRef("6f4861fc-d64e-48d3-afad-89e1108e3e55")).toBeNull();
    expect(parseRemoteTerminalRef("t@m")).toBeNull();
    expect(parseRemoteTerminalRef("t@@u")).toBeNull();
    expect(parseRemoteTerminalRef("a@b@c@d")).toBeNull();
  });

  it("reads a percent-encoded separator too", () => {
    expect(parseRemoteTerminalRef("t%40m%40u")?.remote).toEqual({
      machineId: "m",
      terminalId: "t",
    });
  });
});
