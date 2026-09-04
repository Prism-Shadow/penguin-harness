/**
 * The marketplace company, end to end on the runtime seams (SCN-004): one mission creates
 * the organization and its CEO; the CEO hires HR, finance, a developer and a marketer,
 * partitions the shared workspace, schedules everyone and files the first tickets; the
 * calendar drives the desks; ticket sessions do the work and write back; review and done
 * notify the right people; finance rolls the spend up the reporting line and to the parent
 * ticket. Every command an employee would run through `penguin org` hits the same service
 * methods the routes call, attributed to the employee's session.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parseOrgTriggerMessage } from "@prismshadow/penguin-core";
import { DEFAULT_CHANNEL_ID } from "../src/organization/paths.js";
import { makeOrgHarness } from "./org-harness.js";
import type { OrgHarness } from "./org-harness.js";

const ORG = "marketplace";
const CEO = "marketplace_ceo";
const HR = "marketplace_hr";
const FIN = "marketplace_finance";
const DEV = "marketplace_dev";
const MKT = "marketplace_marketing";
const T0 = Date.parse("2026-09-01T01:00:00Z");
const DAY = 86_400_000;
const MISSION =
  "Build a DeepSeek Harness plugin Marketplace, promote it on social media and SEO into the top three search results, and earn from paid featured slots on the home page.";

describe("scenario: the DeepSeek Harness plugin Marketplace company", () => {
  let h: OrgHarness;
  const P = "p1";

  const triggers = (): Array<{
    sessionId: string;
    origin: ReturnType<typeof parseOrgTriggerMessage>;
  }> => h.started.map((s) => ({ sessionId: s.sessionId, origin: parseOrgTriggerMessage(s.text) }));

  beforeEach(async () => {
    h = await makeOrgHarness({ nowMs: T0 });
  });

  it("runs the company from the mission to the first paid slot", async () => {
    const { service, scheduler, store } = h;

    // 1. The board creates the organization with one sentence: only the CEO exists.
    const detail = await service.create(
      P,
      { orgId: ORG, name: "Plugin Marketplace", mission: MISSION, timezone: "Asia/Shanghai" },
      "alice",
    );
    expect(detail.employeeCount).toBe(1);
    expect(h.agentsCreated.map((a) => a.agentId)).toEqual([CEO]);
    const init = triggers()[0]!;
    expect(init.origin?.origin.kind).toBe("init");
    // The CEO starts with the default budget, which is the whole company's: the trigger
    // block names it, so the proposal can be sized to it.
    expect(init.origin?.origin.budget).toBe("0.00 / 100.00 USD (0%)");
    expect(init.origin?.rest).toContain(MISSION);
    const ceoDesk = init.sessionId;
    const handbook = await service.handbook(P, ORG);
    expect(handbook).toContain("Plugin Marketplace");
    expect(handbook).toContain(MISSION);

    // 2. The CEO (from its desk) confirms the mission with the board in the all-hands channel …
    const m1 = await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
      text: "@alice I read the mission as: marketplace site first, then SEO and social, revenue from featured slots. Correct?",
      sessionId: ceoDesk,
    });
    expect(m1.sender).toBe(`agent:${CEO}`);
    expect(m1.mentions).toEqual(["user:alice"]);
    const board = await service.channelMessages(
      P,
      ORG,
      { userId: "alice" },
      DEFAULT_CHANNEL_ID,
      {},
    );
    expect(board.mentionsMe).toBe(1);
    await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
      text: `@${CEO} Correct. Go.`,
    });
    expect(
      triggers().filter((t) => t.origin?.origin.kind === "mention" && t.sessionId === ceoDesk),
    ).toHaveLength(1);

    // … hires HR and finance first, then the roles the mission needs, partitioning the workspace.
    const dir = store.dir(P, ORG);
    for (const sub of ["people", "finance", "site", "marketing"])
      await fs.mkdir(path.join(dir, "workspace", sub));
    await service.hire(P, ORG, {
      newAgent: { agentId: HR },
      title: "HR",
      reportsTo: CEO,
      workspace: "people",
      budget: 20,
    });
    await service.hire(P, ORG, {
      newAgent: { agentId: FIN },
      title: "Finance",
      reportsTo: CEO,
      workspace: "finance",
      budget: 20,
    });
    await service.hire(P, ORG, {
      newAgent: { agentId: DEV },
      title: "Developer",
      reportsTo: CEO,
      workspace: "site",
      budget: 100,
      duties: "Build and run the marketplace site",
    });
    await service.hire(P, ORG, {
      newAgent: { agentId: MKT },
      title: "Marketing",
      reportsTo: CEO,
      workspace: "marketing",
      budget: 60,
      duties: "SEO and social promotion",
    });
    await service.patchEmployee(P, ORG, CEO, { budget: 300 });
    const chart = await service.chart(P, ORG);
    expect(chart.employees.map((e) => e.agentId)).toEqual([CEO, HR, FIN, DEV, MKT]);
    expect(chart.employees.every((e) => e.invalid === undefined)).toBe(true);
    expect(h.agentsCreated.every((a) => a.plugins.includes("agent-company"))).toBe(true);
    expect(h.briefs.get(DEV)).toContain("Duties: Build and run the marketplace site");

    // 3. Everyone gets a daily sweep on the calendar.
    for (const agentId of [CEO, HR, FIN, DEV, MKT]) {
      await service.upsertCalendar(
        P,
        ORG,
        agentId,
        "daily-sweep",
        {
          prompt:
            "Sweep the board: start your tickets, check running sessions, write back, report in your channels.",
          enabled: true,
          startAt: new Date(T0 + 60_000).toISOString(),
          period: "1d",
        },
        { create: true },
      );
    }
    expect((await service.calendar(P, ORG)).events).toHaveLength(5);

    // 4. The mission becomes a ticket tree: one parent, one child per stream.
    const ceoActor = { userId: "alice", sessionId: ceoDesk };
    const parent = await service.createTicket(
      P,
      ORG,
      { title: "Plugin Marketplace", goal: MISSION, owner: `agent:${CEO}`, priority: "P0" },
      ceoActor,
    );
    expect(parent.initiator).toBe(`agent:${CEO}`);
    const site = await service.createTicket(
      P,
      ORG,
      {
        title: "Build the marketplace site",
        goal: "A site that lists DeepSeek Harness plugins with search and a featured row.",
        acceptanceCriteria: "- lists plugins\n- search works\n- home page has a featured row",
        owner: `agent:${DEV}`,
        parent: parent.ticketId,
        priority: "P1",
        notify: [`agent:${CEO}`],
      },
      ceoActor,
    );
    const seo = await service.createTicket(
      P,
      ORG,
      {
        title: "SEO to the top three",
        goal: "Rank in the top three for 'DeepSeek Harness plugins'.",
        owner: `agent:${MKT}`,
        parent: parent.ticketId,
        priority: "P1",
      },
      ceoActor,
    );
    const social = await service.createTicket(
      P,
      ORG,
      {
        title: "Social media launch",
        goal: "Announce the marketplace on the main channels.",
        owner: `agent:${MKT}`,
        parent: parent.ticketId,
      },
      ceoActor,
    );
    const slots = await service.createTicket(
      P,
      ORG,
      {
        title: "Paid featured slots",
        goal: "Sell time-limited pinned slots on the home page.",
        owner: `agent:${DEV}`,
        parent: parent.ticketId,
        priority: "P2",
      },
      ceoActor,
    );
    expect((await service.ticket(P, ORG, parent.ticketId)).children.sort()).toEqual(
      [site.ticketId, seo.ticketId, social.ticketId, slots.ticketId].sort(),
    );
    // Assignment notices reached the owners' desks (which opened lazily).
    const assigned = triggers().filter(
      (t) => t.origin?.origin.kind === "ticket_notice" && t.origin.origin.change === "assigned",
    );
    expect(assigned.map((t) => t.origin!.origin.ticket).sort()).toEqual(
      [parent.ticketId, site.ticketId, seo.ticketId, social.ticketId, slots.ticketId].sort(),
    );
    const devDesk = (await service.desk(P, ORG, DEV, {})).sessionId;
    const mktDesk = (await service.desk(P, ORG, MKT, {})).sessionId;

    // 5. The CEO accepts the streams; SEO waits on the site.
    for (const t of [site, seo, social, slots])
      await service.moveTicket(P, ORG, t.ticketId, "in_progress", undefined, ceoActor);
    await service.blockTicket(
      P,
      ORG,
      seo.ticketId,
      "Nothing to index until the site is live",
      site.ticketId,
      { userId: "alice", sessionId: mktDesk },
    );
    expect((await service.ticket(P, ORG, seo.ticketId)).blockedBy).toBe(site.ticketId);
    const board2 = await service.tickets(P, ORG);
    expect(board2.columns.in_progress.map((t) => t.ticketId).sort()).toEqual(
      [site.ticketId, seo.ticketId, social.ticketId, slots.ticketId].sort(),
    );
    expect(board2.columns.in_progress.find((t) => t.ticketId === seo.ticketId)?.blocked).toBe(
      "Nothing to index until the site is live",
    );

    // 5b. The site stream gets its own channel: the CEO opens it and invites the developer,
    // so the thread lives beside the all-hands channel instead of drowning it.
    const siteChannel = await service.createChannel(
      P,
      ORG,
      { channelId: "site", name: "Site launch", purpose: "Everything about shipping the site" },
      ceoActor,
    );
    expect(siteChannel).toMatchObject({
      createdBy: `agent:${CEO}`,
      memberCount: 1,
      everyone: false,
    });
    const withDev = await service.addChannelMember(P, ORG, "site", `agent:${DEV}`, ceoActor);
    expect(withDev.members.map((m) => m.principal)).toEqual([`agent:${CEO}`, `agent:${DEV}`]);
    // Marketing is not in it: a message naming it is refused before anything is written.
    await expect(
      service.sendChannelMessage(P, ORG, "alice", "site", {
        text: `@${MKT} can you look at the copy?`,
        sessionId: ceoDesk,
      }),
    ).rejects.toMatchObject({ status: 400, code: "mention_not_member" });
    h.started.length = 0;
    const kickoff = await service.sendChannelMessage(P, ORG, "alice", "site", {
      text: `@${DEV} the site ticket is yours; talk to me here.`,
      sessionId: ceoDesk,
    });
    const inChannel = triggers().filter((t) => t.origin?.origin.kind === "mention");
    expect(inChannel).toHaveLength(1);
    expect(inChannel[0]!.sessionId).toBe(devDesk);
    expect(inChannel[0]!.origin?.origin).toMatchObject({
      channel: "site",
      message: `${kickoff.id} from agent:${CEO}`,
    });
    // The CEO says so once in the all-hands channel, where the board reads.
    await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
      text: "Opened the #site channel for the site stream; @alice you can follow it there.",
      sessionId: ceoDesk,
    });
    const channels = await service.channels(P, ORG, { userId: "alice" });
    expect(channels.channels.map((c) => c.channelId)).toEqual([DEFAULT_CHANNEL_ID, "site"]);
    // The developer sees both; marketing only the all-hands channel.
    expect(
      (await service.channels(P, ORG, { userId: "alice", sessionId: devDesk })).channels.map(
        (c) => c.channelId,
      ),
    ).toEqual([DEFAULT_CHANNEL_ID, "site"]);
    expect(
      (await service.channels(P, ORG, { userId: "alice", sessionId: mktDesk })).channels.map(
        (c) => c.channelId,
      ),
    ).toEqual([DEFAULT_CHANNEL_ID]);

    // 6. The calendar fires the next day: every desk gets its sweep with a budget line.
    h.started.length = 0;
    h.clock.nowMs = T0 + DAY + 120_000;
    await scheduler.tickOnce();
    const sweeps = triggers().filter((t) => t.origin?.origin.kind === "event");
    expect(sweeps).toHaveLength(5);
    expect(sweeps.map((t) => t.origin!.origin.event)).toEqual(Array(5).fill("daily-sweep"));
    const devSweep = sweeps.find((t) => t.sessionId === devDesk)!;
    expect(devSweep.origin!.origin.budget).toBe("0.00 / 100.00 USD (0%)");

    // 7. The developer's desk opens a ticket session for the site; the session works and writes back.
    const { sessionId: siteWork } = await service.startTicket(P, ORG, site.ticketId, {
      agentId: DEV,
      message: "Start with a static site; featured row can be hard-coded for now.",
    });
    expect(h.sessions.findById(siteWork)?.agentId).toBe(DEV);
    expect(h.sessions.findById(siteWork)?.workspace).toBe(path.join(dir, "workspace", "site"));
    const work = h.started.find((s) => s.sessionId === siteWork)!;
    expect(parseOrgTriggerMessage(work.text)?.origin).toMatchObject({
      kind: "ticket_work",
      ticket: site.ticketId,
    });
    expect(work.text).toContain("- lists plugins");
    const devWork = { userId: "alice", sessionId: siteWork };
    await service.progressTicket(
      P,
      ORG,
      site.ticketId,
      "Scaffolded the site, plugin list renders from plugins.json",
      devWork,
    );
    await service.progressTicket(
      P,
      ORG,
      site.ticketId,
      "Search and the featured row are in; running on the local environment",
      devWork,
    );
    await service.moveTicket(P, ORG, site.ticketId, "review", undefined, devWork);
    const siteDetail = await service.ticket(P, ORG, site.ticketId);
    expect(siteDetail.status).toBe("review");
    // created (CEO), accepted (CEO), two progress lines and the move to review (the developer's session).
    expect(siteDetail.progress.map((p) => p.by)).toEqual([
      `agent:${CEO}`,
      `agent:${CEO}`,
      `agent:${DEV}`,
      `agent:${DEV}`,
      `agent:${DEV}`,
    ]);
    expect(siteDetail.progress.at(-1)?.sessionId).toBe(siteWork);
    expect(siteDetail.sessions).toEqual([siteWork]);

    // 8. The CEO reviews and closes it: the developer is told, and the marketer learns its blocker closed.
    h.started.length = 0;
    await service.moveTicket(P, ORG, site.ticketId, "done", undefined, ceoActor);
    const notices = triggers().filter((t) => t.origin?.origin.kind === "ticket_notice");
    expect(notices.map((t) => [t.origin!.origin.change, t.sessionId])).toEqual(
      expect.arrayContaining([
        ["done", ceoDesk],
        ["blocker_closed", mktDesk],
      ]),
    );
    await service.unblockTicket(P, ORG, seo.ticketId, { userId: "alice", sessionId: mktDesk });

    // 9. Marketing works SEO and social from one session attached to both tickets; finance rolls it all up.
    const { sessionId: mktWork } = await service.startTicket(P, ORG, seo.ticketId, {
      agentId: MKT,
    });
    await service.attachTicket(P, ORG, social.ticketId, mktWork, {
      userId: "alice",
      sessionId: mktDesk,
    });
    h.costs.set(siteWork, 40);
    h.costs.set(mktWork, 30);
    h.costs.set(devDesk, 2);
    const finance = await service.finance(P, ORG);
    const byId = new Map(finance.employees.map((e) => [e.agentId, e]));
    expect(byId.get(DEV)).toMatchObject({ own: 42, cumulative: 42, budget: 100 });
    expect(byId.get(MKT)).toMatchObject({ own: 30, cumulative: 30, budget: 60 });
    expect(byId.get(CEO)).toMatchObject({ own: 0, cumulative: 72, budget: 300 });
    expect(finance.total).toBe(72);
    const ticketCost = new Map(finance.tickets.map((t) => [t.ticketId, t]));
    expect(ticketCost.get(site.ticketId)?.cost).toBe(40);
    // The shared marketing session is split between its two tickets; the parent rolls everything up.
    expect(ticketCost.get(seo.ticketId)?.cost).toBe(15);
    expect(ticketCost.get(social.ticketId)?.cost).toBe(15);
    expect(ticketCost.get(parent.ticketId)?.rolledUp).toBe(70);

    // 10. Revenue: the paid featured slots ship and the board is told.
    const slotWork = await service.startTicket(P, ORG, slots.ticketId, { agentId: DEV });
    await service.progressTicket(
      P,
      ORG,
      slots.ticketId,
      "Pinned-slot checkout works; first slot sold for a week",
      { userId: "alice", sessionId: slotWork.sessionId },
    );
    await service.moveTicket(P, ORG, slots.ticketId, "done", undefined, ceoActor);
    await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
      text: "@alice The site is live, SEO and social are running, and the first paid featured slot sold.",
      sessionId: ceoDesk,
    });
    const overview = await service.detail(P, ORG, "alice");
    expect(overview.board).toMatchObject({ done: 2, in_progress: 2, proposed: 1 });
    expect(overview.employeeCount).toBe(5);
    expect(overview.spend).toMatchObject({ cost: 72, budget: 300 });
    expect(overview.pending.mentions).toBeGreaterThanOrEqual(1);
    expect(overview.recentMessages.at(-1)?.text).toContain("first paid featured slot sold");

    // Every automatic message went through the marker the frontend folds, never a bare prompt.
    for (const s of h.started) expect(parseOrgTriggerMessage(s.text)).not.toBeNull();
    expect(h.errors).toEqual([]);
  });
});
