/**
 * A channel's system lines in the reader's language (features/company/channel-notices.ts).
 *
 * - Every kind the contract declares has wording in both languages, even for a notice that is
 *   missing its parameters.
 * - A hire names its employees and keeps the job title verbatim.
 * - A member reads as its user id and an unknown employee as its id, never as a principal.
 * - A budget event carries its period, share and amounts; a ticket event its id and title.
 * - A kind this build does not know renders nothing, so the view falls back to the server's
 *   English text.
 */
import { describe, expect, it } from "vitest";
import type { OrgChannelNotice } from "@prismshadow/penguin-server/api";
import { NOTICE_KINDS, noticeText } from "../src/features/company/channel-notices";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const names = new Map([
  ["ceo", "Ada CEO"],
  ["dev", "Dana Dev"],
]);

const notice = (kind: string, params: Record<string, string>): OrgChannelNotice =>
  ({ kind, params }) as OrgChannelNotice;

describe("the notice dictionaries", () => {
  it("has wording for every kind, even for a notice missing its parameters", () => {
    for (const kind of NOTICE_KINDS) {
      expect(noticeText(notice(kind, {}), names, zh.company.channels.notices), kind).toBeTruthy();
      expect(noticeText(notice(kind, {}), names, en.company.channels.notices), kind).toBeTruthy();
    }
  });
});

describe("noticeText", () => {
  const zhText = (n: OrgChannelNotice) => noticeText(n, names, zh.company.channels.notices);
  const enText = (n: OrgChannelNotice) => noticeText(n, names, en.company.channels.notices);

  it("names the employees of a hire and keeps the job title verbatim", () => {
    const hire = notice("employee_joined", {
      agent: "agent:dev",
      title: "研究",
      reportsTo: "agent:ceo",
    });
    for (const text of [enText(hire), zhText(hire)]) {
      expect(text).toContain("Dana Dev");
      expect(text).toContain("研究");
      expect(text).toContain("Ada CEO");
      expect(text).not.toContain("agent:");
    }
  });

  it("renders a member as its user id and an unknown employee as its id", () => {
    const invited = notice("channel_invited", { by: "user:alice", principal: "agent:ghost" });
    const text = enText(invited)!;
    expect(text).toContain("alice");
    expect(text).toContain("ghost");
    expect(text).not.toMatch(/user:|agent:/);
  });

  it("carries a budget event's period, share and amounts", () => {
    const warned = notice("budget_warned", {
      agent: "agent:ceo",
      period: "2026-09",
      percent: "82",
      cost: "41.00",
      budget: "50.00",
    });
    for (const text of [enText(warned), zhText(warned)]) {
      for (const part of ["Ada CEO", "2026-09", "82%", "41.00", "50.00"]) {
        expect(text).toContain(part);
      }
    }
  });

  it("warns before a legacy ticket id migration: the count, the data-loss risk and the backup advice", () => {
    const migrating = notice("ticket_ids_migrating", { count: "2" });
    for (const text of [enText(migrating), zhText(migrating)]) {
      expect(text).toContain("2");
      // The risk and the advice, in the reader's language.
      expect(text).toMatch(/risks losing ticket data|遗失工单数据的风险/);
      expect(text).toMatch(/keep a backup|请先备份/);
    }
  });

  it("reports a finished legacy ticket id migration: the count and where the originals are", () => {
    const migrated = notice("ticket_ids_migrated", {
      count: "2",
      backup: "tickets/.legacy-backup-2026-11-23T22-45-00-000Z",
    });
    for (const text of [enText(migrated), zhText(migrated)]) {
      expect(text).toContain("2");
      expect(text).toContain("tickets/.legacy-backup-2026-11-23T22-45-00-000Z");
    }
  });

  it("carries a ticket's id and title", () => {
    const done = notice("ticket_done", { ticket: "T-3", title: "Build the site" });
    for (const text of [enText(done), zhText(done)]) {
      expect(text).toContain("T-3");
      expect(text).toContain("Build the site");
    }
  });

  it("renders nothing for a kind this build does not know", () => {
    expect(zhText(notice("teleported", { agent: "agent:ceo" }))).toBeNull();
  });
});
