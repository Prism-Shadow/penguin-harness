/**
 * Where a conversation's messaging binding runs, and what its editor may do from here
 * (features/messaging/messaging-binding-location.ts).
 *
 * - A Session listed from a machine is located there; any other is this server's.
 * - This server's own conversation is always live, with nothing to say.
 * - A machine's conversation is live only while its machine is connected; while the machines
 *   list has not answered, the editor waits without a notice.
 * - Out of reach, the notice names the machine and the time of the state shown under it, or says
 *   nothing was read; each way of being out of reach is said in its own words, and a machine not
 *   on the list gets a notice too.
 * - A holder on another server refuses an enable and is named (this server as itself); a holder
 *   on the binding's own server refuses nothing here; no holder, no refusal.
 * - Machines that could not be asked are named with why, leaving out the binding's own; when
 *   every machine was asked there is nothing to say.
 * - The bot a binding signs in as is its channel's public account id.
 */
import { afterEach, describe, expect, it } from "vitest";
import type {
  MessagingBindingInfo,
  MessagingUnreachableMachine,
} from "@prismshadow/penguin-server/api";
import {
  accountIdOf,
  bindingLocation,
  editorAccess,
  holderConflict,
  holdersNote,
} from "../src/features/messaging/messaging-binding-location";
import type { MachineLink } from "../src/lib/machine-link";
import { forgetSessionMachines, rememberSessionMachine } from "../src/lib/session-machines";
import { formatDateTime } from "../src/lib/format";

afterEach(() => forgetSessionMachines());

const READ_AT = "2026-10-19T09:30:00.000Z";

const OUT_OF_REACH = [
  "reconnecting",
  "reconnectStopped",
  "signInRefused",
  "stopped",
  "notConnected",
] as const satisfies readonly MachineLink[];

describe("bindingLocation", () => {
  it("locates a Session listed from a machine there, and any other on this server", () => {
    rememberSessionMachine("s-remote", "M1");
    expect(bindingLocation("s-remote")).toEqual({ machineId: "M1" });
    expect(bindingLocation("s-here")).toEqual({ machineId: null });
  });
});

describe("editorAccess", () => {
  it("keeps this server's own conversation live, with nothing to say", () => {
    expect(editorAccess(null, "", null)).toEqual({ live: true, reason: null });
  });

  it("keeps a machine's conversation live only while its machine is connected", () => {
    expect(editorAccess("connected", "mdi-b", READ_AT)).toEqual({ live: true, reason: null });
    for (const link of [...OUT_OF_REACH, "missing", "unknown"] as const) {
      expect(editorAccess(link, "mdi-b", READ_AT).live).toBe(false);
    }
  });

  it("waits without a notice while the machines list has not answered", () => {
    expect(editorAccess("unknown", "mdi-b", READ_AT)).toEqual({ live: false, reason: null });
  });

  it.each(OUT_OF_REACH)(
    "names the machine and the time of the state shown while it is %s",
    (link) => {
      const shown = editorAccess(link, "mdi-b", READ_AT).reason ?? "";
      expect(shown).toContain("mdi-b");
      expect(shown).toContain(formatDateTime(READ_AT));
      const nothingRead = editorAccess(link, "mdi-b", null).reason ?? "";
      expect(nothingRead).toContain("mdi-b");
      expect(nothingRead).not.toContain(formatDateTime(READ_AT));
      expect(nothingRead).not.toBe(shown);
    },
  );

  it("says each way of being out of reach in its own words", () => {
    const said = OUT_OF_REACH.map((link) => editorAccess(link, "mdi-b", READ_AT).reason);
    expect(new Set(said).size).toBe(OUT_OF_REACH.length);
  });

  it("gives a machine not on the list a notice too", () => {
    expect(editorAccess("missing", "mdi-b", READ_AT).reason).not.toBeNull();
  });
});

describe("holderConflict", () => {
  it("refuses for a holder on another server and names it, this server as itself", () => {
    expect(holderConflict([{ machineId: "M2", alias: "mdi-c" }], "M1")).toEqual({
      alias: "mdi-c",
    });
    expect(holderConflict([{ machineId: null, alias: null }], "M1")).toEqual({ alias: null });
    expect(holderConflict([{ machineId: "M1", alias: "mdi-b" }], null)).toEqual({
      alias: "mdi-b",
    });
  });

  it("leaves a holder on the binding's own server to that server", () => {
    expect(holderConflict([{ machineId: "M1", alias: "mdi-b" }], "M1")).toBeNull();
    expect(holderConflict([{ machineId: null, alias: null }], null)).toBeNull();
  });

  it("has nothing to refuse when nobody holds the bot", () => {
    expect(holderConflict([], "M1")).toBeNull();
  });
});

describe("holdersNote", () => {
  const unreachable: MessagingUnreachableMachine[] = [
    { machineId: "M2", alias: "mdi-c", reason: "not_connected" },
    { machineId: "M3", alias: "mdi-d", reason: "older_build" },
    { machineId: "M1", alias: "mdi-b", reason: "failed" },
  ];

  it("names every machine that could not be asked, with why, except the binding's own", () => {
    const note = holdersNote(unreachable, "M1") ?? "";
    expect(note).toContain("mdi-c");
    expect(note).toContain("mdi-d");
    expect(note).not.toContain("mdi-b");
    expect(holdersNote(unreachable.slice(0, 1), null)).not.toBe(
      holdersNote([{ ...unreachable[0]!, reason: "older_build" }], null),
    );
  });

  it("says nothing when every machine was asked", () => {
    expect(holdersNote([], null)).toBeNull();
    expect(holdersNote(unreachable.slice(2), "M1")).toBeNull();
  });
});

describe("accountIdOf", () => {
  const common = {
    sessionId: "s",
    enabled: false,
    linePerMessage: false,
    finalReplyOnly: false,
    renderMarkdown: true,
    lastChatKnown: false,
    createdAt: READ_AT,
    updatedAt: READ_AT,
  };

  it.each<[MessagingBindingInfo, string]>([
    [
      { ...common, channel: "feishu", appId: "cli_a1", baseDomain: "https://open.feishu.cn" },
      "cli_a1",
    ],
    [{ ...common, channel: "qq", appId: "102000001" }, "102000001"],
    [{ ...common, channel: "telegram", botId: "123456" }, "123456"],
    [{ ...common, channel: "wechat", botId: "wx-bot" }, "wx-bot"],
  ])("reads the public account id of a %o binding", (binding, id) => {
    expect(accountIdOf(binding)).toBe(id);
  });
});
