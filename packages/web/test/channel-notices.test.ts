/**
 * channel-notices.ts unit tests: every kind the contract declares has a sentence in both
 * dictionaries, the sentence names employees instead of spelling them `agent:<id>`, a member
 * reads as its user id, an unknown employee falls back to its id, and a kind this build does
 * not know renders nothing so the view can fall back to the server's English text.
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
  for (const [locale, dict] of Object.entries({ zh, en })) {
    it(`${locale} carries one sentence per kind, and no key the contract does not declare`, () => {
      const notices: Record<string, unknown> = dict.company.channels.notices;
      expect(Object.keys(notices).sort()).toEqual([...NOTICE_KINDS].sort());
      for (const kind of NOTICE_KINDS) expect(typeof notices[kind], kind).toBe("function");
    });
  }

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
    expect(enText(hire)).toBe("Dana Dev joined as 研究, reporting to Ada CEO.");
    expect(zhText(hire)).toBe("Dana Dev 以「研究」身份加入，汇报给 Ada CEO。");
  });

  it("renders a member as its user id and an unknown employee as its id", () => {
    const invited = notice("channel_invited", { by: "user:alice", principal: "agent:ghost" });
    expect(enText(invited)).toBe("alice invited ghost to the channel.");
  });

  it("carries a budget event's period, share and amounts", () => {
    const warned = notice("budget_warned", {
      agent: "agent:ceo",
      period: "2026-09",
      percent: "82",
      cost: "41.00",
      budget: "50.00",
    });
    expect(enText(warned)).toBe(
      "Budget warning: Ada CEO has used 82% of its 2026-09 budget (41.00 / 50.00 USD).",
    );
    expect(zhText(warned)).toContain("2026-09 预算的 82%");
  });

  it("carries a ticket's id and title", () => {
    const done = notice("ticket_done", { ticket: "T-3", title: "Build the site" });
    expect(enText(done)).toBe("Ticket T-3 (Build the site) is done.");
    expect(zhText(done)).toBe("工单 T-3（Build the site）已完成。");
  });

  it("renders nothing for a kind this build does not know", () => {
    expect(zhText(notice("teleported", { agent: "agent:ceo" }))).toBeNull();
  });
});
