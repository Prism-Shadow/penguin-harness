/**
 * The "Open a roadmap" button, clicked in a real DOM (happy-dom): the page's own document and
 * script, a stand-in for the server's answers, and a person's clicks. The button unfolds a
 * form — a name and the organization's employees, no room to choose: the roadmap opens its own
 * — that sends the plugin's own `POST …/roadmaps` with the employees in the order picked (the
 * first moderates), and the page goes straight to the new roadmap's room — the app's own channel
 * page, through the app's history. Picking changes the form where it stands (nothing in the
 * dialog is drawn again), and a refusal keeps the form and says why. A roadmap on the list opens
 * its room the same way; in the channel page's column (view=detail) the page shows the roadmap
 * alone — no chat of its own — and follows its draft.
 */
import vm from "node:vm";
import { Window } from "happy-dom";
import type { Element, HTMLButtonElement, HTMLElement, HTMLInputElement } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PAGE_STRINGS, pageHtml } from "../src/index.js";

const ORG = "/api/projects/proj/organizations/acme";
const T = PAGE_STRINGS.en;

interface Call {
  method: string;
  url: string;
  body: unknown;
  contentType: string | null;
}

const CHART = {
  ceoAgentId: "acme_ceo",
  employees: [
    { agentId: "acme_dev", name: "Dev" },
    { agentId: "acme_web", name: "Web" },
  ],
};

let windows: Window[] = [];
afterEach(async () => {
  for (const w of windows) await w.happyDOM.close();
  windows = [];
});

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

/**
 * The page in a real document, its script run against it, its requests answered by `server`
 * (which sees each call) — the organization's roadmaps kept in `roadmaps`.
 */
async function page(
  server: (
    call: Call,
    roadmaps: Array<Record<string, unknown>>,
  ) => { status: number; body: unknown },
  seed: Array<Record<string, unknown>> = [],
  where: { parent?: string; search?: string; own?: string } = {},
) {
  const window = new Window({
    url: `http://localhost:7364/api/company-roadmaps/page${where.own ?? ""}`,
  });
  windows.push(window);
  const document = window.document;
  const html = pageHtml();
  document.body.innerHTML = /<body>([\s\S]*)<script>/.exec(html)![1]!;
  const calls: Call[] = [];
  const roadmaps: Array<Record<string, unknown>> = [...seed];
  // The detail's poll: kept, and run when the test says a period has passed.
  const ticks: Array<() => void> = [];
  const heard: Array<{ type: string; f: () => void }> = [];
  // What the app's window was asked to do: history entries pushed, events raised.
  const pushed: string[] = [];
  const popped: string[] = [];
  const sandbox = {
    document,
    window: {
      parent: {
        location: {
          pathname: where.parent ?? "/org/proj/acme/roadmaps",
          search: where.search ?? "",
        },
        document,
        history: { pushState: (_s: unknown, _t: string, url: string) => pushed.push(url) },
        dispatchEvent: (ev: { type: string }) => popped.push(ev.type),
        PopStateEvent: window.PopStateEvent,
      },
      // The page's own window: what it listens for is kept here and raised by the test (follow).
      addEventListener: (type: string, f: () => void) => heard.push({ type, f }),
    },
    location: window.location,
    localStorage: { getItem: () => "en" },
    navigator: { language: "en-US" },
    setTimeout,
    clearTimeout,
    setInterval: (f: () => void) => ticks.push(f),
    clearInterval: (id: number) => {
      ticks[id - 1] = () => {};
    },
    fetch: async (
      url: string,
      init: { method?: string; headers?: Record<string, string>; body?: string } = {},
    ) => {
      const call: Call = {
        method: init.method ?? "GET",
        url,
        body: init.body === undefined ? undefined : JSON.parse(init.body),
        contentType: init.headers?.["content-type"] ?? null,
      };
      calls.push(call);
      const a = server(call, roadmaps);
      return { ok: a.status < 300, status: a.status, json: async () => a.body };
    },
  };
  vm.runInNewContext(/<script>([\s\S]*)<\/script>/.exec(html)![1]!, sandbox);
  await settle();
  const main = document.getElementById("main")!;
  const $ = <E extends Element>(selector: string) => main.querySelector(selector) as E;
  const fire = async (el: Element, type: string) => {
    el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
    await settle();
  };
  return {
    calls,
    roadmaps,
    pushed,
    popped,
    text: () => (main.textContent ?? "").replace(/\s+/g, " "),
    $,
    click: async (selector: string) => {
      $<HTMLElement>(selector).click();
      await settle();
    },
    pick: async (id: string, checked = true) => {
      const box = $<HTMLInputElement>(`input[name="employee"][value="${id}"]`);
      box.checked = checked;
      await fire(box, "change");
    },
    tick: async () => {
      for (const f of ticks) f();
      await settle();
    },
    name: async (value: string) => {
      const input = $<HTMLInputElement>('input[name="name"]');
      input.value = value;
      await fire(input, "input");
    },
    submit: async () => fire($("form[data-form]"), "submit"),
    press: async (key: string, selector: string) => {
      $(selector).dispatchEvent(
        new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
      await settle();
    },
    focused: () => document.activeElement?.getAttribute("name") ?? null,
    hash: () => window.location.hash,
    /** The hash changed: raise it to the page, as a browser does. */
    follow: async () => {
      for (const h of heard) if (h.type === "hashchange") h.f();
      await settle();
    },
    clearHash: () => {
      window.location.hash = "";
    },
    reads: () => calls.filter((c) => c.method === "GET" && c.url === `${ORG}/roadmaps`).length,
  };
}

/**
 * The organization's server as the page sees it: the Project's organization list, the roadmaps,
 * its chart, and the open (which opens the room; `hints` are what the server adds to its answer).
 */
function organization(
  opts: { refuse?: { status: number; message: string }; hints?: string[] } = {},
) {
  return (call: Call, roadmaps: Array<Record<string, unknown>>) => {
    if (call.method === "GET" && call.url === "/api/projects/proj/organizations")
      return { status: 200, body: { organizations: [{ orgId: "acme" }] } };
    if (call.method === "GET" && call.url === `${ORG}/roadmaps`)
      return { status: 200, body: { roadmaps } };
    const one = /\/roadmaps\/(\d+)$/.exec(call.url);
    if (call.method === "GET" && one !== null) {
      const r = roadmaps.find((x) => x.number === Number(one[1]));
      return r ? { status: 200, body: r } : { status: 404, body: {} };
    }
    if (call.method === "GET" && call.url === `${ORG}/chart`) return { status: 200, body: CHART };
    if (call.method === "POST" && call.url === `${ORG}/roadmaps`) {
      if (opts.refuse)
        return {
          status: opts.refuse.status,
          body: { error: { code: "x", message: opts.refuse.message } },
        };
      const b = call.body as { name: string; employees: string[] };
      const number = roadmaps.length + 1;
      const roadmap = {
        number,
        name: b.name,
        status: "discussing",
        channelId: `roadmap_${number}`,
        employees: b.employees,
        moderator: b.employees[0],
        record: "",
        body: "",
        items: [],
        delegations: {},
      };
      roadmaps.push(roadmap);
      return { status: 201, body: { roadmap, hints: opts.hints ?? [] } };
    }
    return { status: 404, body: {} };
  };
}

describe("the Open a roadmap button", () => {
  it("opens a roadmap: button → form (a name, the employees) → POST → straight into its room, the app's channel page", async () => {
    const p = await page(organization());
    expect(p.text()).toContain(T.empty);
    await p.click("button[data-open]");
    // No room to choose: the roadmap opens its own; the employees are the organization's.
    expect(p.$('select[name="room"]')).toBeNull();
    expect(p.text()).toContain(T.formRoomNote);
    const boxes = [...p.$<HTMLElement>("fieldset").querySelectorAll('input[name="employee"]')].map(
      (b) => b.getAttribute("value"),
    );
    expect(boxes).toEqual(["acme_dev", "acme_web"]);
    await p.pick("acme_web");
    await p.pick("acme_dev");
    expect(p.text()).toContain(`Web acme_web ${T.moderates}`);
    await p.name("Queue migration");
    await p.submit();

    const post = p.calls.filter((c) => c.method === "POST");
    expect(post).toEqual([
      {
        method: "POST",
        url: `${ORG}/roadmaps`,
        body: { name: "Queue migration", employees: ["acme_web", "acme_dev"] },
        contentType: "application/json",
      },
    ]);
    // Not the list, and no chat of this page's own: the app goes to the room's channel page.
    expect(p.pushed).toEqual(["/org/proj/acme/channels/roadmap_1"]);
    expect(p.popped).toEqual(["popstate"]);
    expect(p.calls.at(-1)).toMatchObject({ method: "POST" });
  });

  it("stays on the new roadmap and says so first when the server had something to add", async () => {
    const p = await page(organization({ hints: ["No room session for acme_dev: offline"] }));
    await p.click("button[data-open]");
    await p.pick("acme_dev");
    await p.name("Queue migration");
    await p.submit();
    expect(p.pushed).toEqual([]);
    expect(p.hash()).toBe("#1");
    expect(p.text()).toContain(T.opened.replace("{n}", "1"));
    expect(p.text()).toContain("No room session for acme_dev: offline");
    expect(p.$<HTMLElement>("a[data-room]").getAttribute("href")).toBe(
      "/org/proj/acme/channels/roadmap_1",
    );
  });

  it("is up on arrival when the sidebar's + opened the page (?open=1)", async () => {
    const p = await page(organization(), [], { search: "?open=1" });
    expect(p.$("[data-overlay]")).not.toBeNull();
    expect(p.$('input[name="employee"][value="acme_dev"]')).not.toBeNull();
  });

  it("changes the form where it stands when an employee is picked — nothing in the dialog is drawn again", async () => {
    const p = await page(organization());
    await p.click("button[data-open]");
    await p.name("Queue migration");
    const dialog = p.$("[data-overlay]");
    const picks = p.$<HTMLElement>("ul.picks");
    const name = p.$("input[name=name]");
    picks.scrollTop = 40;
    await p.pick("acme_web");
    await p.pick("acme_dev");
    await p.pick("acme_web", false);
    // The same elements, still where they were: the list keeps its scroll, the name its text.
    expect(p.$("[data-overlay]")).toBe(dialog);
    expect(p.$("ul.picks")).toBe(picks);
    expect(p.$("input[name=name]")).toBe(name);
    expect(picks.scrollTop).toBe(40);
    expect(p.$<HTMLInputElement>("input[name=name]").value).toBe("Queue migration");
    // The moderator's pill follows the first one picked, and there is only ever one.
    expect(p.$<HTMLElement>("ul.picks").querySelectorAll("[data-moderates]")).toHaveLength(1);
    expect(p.text()).toContain(`Dev acme_dev ${T.moderates}`);
    expect(p.text()).not.toContain(`Web acme_web ${T.moderates}`);
    expect(p.$<HTMLButtonElement>("button[data-submit]").disabled).toBe(false);
    await p.pick("acme_dev", false);
    expect(p.$<HTMLElement>("ul.picks").querySelectorAll("[data-moderates]")).toHaveLength(0);
    expect(p.$<HTMLButtonElement>("button[data-submit]").disabled).toBe(true);
  });

  it("keeps the form and says why when the server refuses, and sends nothing until the form is complete", async () => {
    const p = await page(
      organization({
        refuse: { status: 409, message: "No free channel id for roadmap #1's room." },
      }),
    );
    await p.click("button[data-open]");
    await p.name("Half done");
    await p.submit();
    expect(p.text()).toContain(T.incomplete);
    expect(p.calls.filter((c) => c.method === "POST")).toEqual([]);

    await p.pick("acme_dev");
    await p.submit();
    expect(p.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(p.text()).toContain(T.openFailed);
    expect(p.text()).toContain("HTTP 409 — No free channel id for roadmap #1's room.");
    expect(p.$<HTMLInputElement>('input[name="name"]').value).toBe("Half done");
    expect(p.$<HTMLInputElement>('input[value="acme_dev"]').checked).toBe(true);
    expect(p.$<HTMLButtonElement>("button[data-submit]").disabled).toBe(false);
  });

  it("says the organization has no employee when it has none, and Cancel goes back to the list", async () => {
    const p = await page((call, roadmaps) =>
      call.url === `${ORG}/chart`
        ? { status: 200, body: { ceoAgentId: "", employees: [] } }
        : organization()(call, roadmaps),
    );
    await p.click("button[data-open]");
    expect(p.text()).toContain(T.noMembers);
    await p.click("button[data-cancel]");
    expect(p.text()).toContain(T.empty);
    expect(p.$("button[data-open]")).not.toBeNull();
  });

  it("keeps Open disabled until the form is complete, and puts the cursor in the name", async () => {
    const p = await page(organization());
    await p.click("button[data-open]");
    expect(p.focused()).toBe("name");
    expect(p.$<HTMLButtonElement>("button[data-submit]").disabled).toBe(true);
    await p.name("Queue migration");
    expect(p.$<HTMLButtonElement>("button[data-submit]").disabled).toBe(true);
    await p.pick("acme_dev");
    expect(p.$<HTMLButtonElement>("button[data-submit]").disabled).toBe(false);
  });

  it("closes the dialog on Esc, on the backdrop and on Cancel — back to the list as it was, without reading it again", async () => {
    const p = await page(organization());
    const reads = p.reads();
    await p.click("button[data-open]");
    expect(p.$("[data-overlay]")).not.toBeNull();
    await p.press("Escape", 'input[name="name"]');
    expect(p.$("[data-overlay]")).toBeNull();
    expect(p.text()).toContain(T.empty);
    await p.click("button[data-open]");
    await p.click("[data-overlay]");
    expect(p.$("[data-overlay]")).toBeNull();
    await p.click("button[data-open]");
    await p.click("button[data-cancel]");
    expect(p.$("[data-overlay]")).toBeNull();
    expect(p.$("button[data-open]")).not.toBeNull();
    expect(p.reads()).toBe(reads);
  });
});

const SEEDED = {
  number: 1,
  name: "Queue migration",
  status: "discussing",
  channelId: "roadmap_1",
  employees: ["acme_dev", "acme_web"],
  moderator: "acme_dev",
  record: "We agreed on the ledger.",
  body: "## Why\nBecause.",
  items: [],
  delegations: {},
};

describe("a roadmap and its room", () => {
  it("opens the room from anywhere on its row, from the keyboard, and from Enter the room — the app's channel page", async () => {
    const p = await page(organization(), [SEEDED]);
    const room = "/org/proj/acme/channels/roadmap_1";
    await p.click("li.row .num");
    await p.press("Enter", "li.row");
    const enter = p.$<HTMLElement>("a.room");
    expect(enter.textContent).toBe(T.enterRoom);
    expect(enter.getAttribute("href")).toBe(room);
    await p.click("a.room");
    expect(p.pushed).toEqual([room, room, room]);
    expect(p.hash()).toBe("");
  });

  it("shows the detail itself only for a roadmap still waiting for its room", async () => {
    const waiting = { ...SEEDED, number: 2, status: "awaiting_room", channelId: null };
    const p = await page(organization(), [SEEDED, waiting]);
    await p.click('li.row[data-n="2"] .num');
    expect(p.hash()).toBe("#2");
    await p.follow();
    expect(p.text()).toContain(T.noRoom);
    expect(p.pushed).toEqual([]);
    // Opened by its own URL, a roadmap with a room goes to the room.
    const q = await page(organization(), [SEEDED], { parent: "/org/proj/acme/roadmaps/1" });
    expect(q.pushed).toEqual(["/org/proj/acme/channels/roadmap_1"]);
  });

  it("in the channel page's column shows the roadmap alone — record, body, items, no chat — and follows its draft", async () => {
    const p = await page(organization(), [SEEDED], {
      parent: "/org/proj/acme/channels/roadmap_1",
      own: "?view=detail&n=1",
    });
    expect(p.$("h1")?.textContent).toContain("Queue migration");
    expect(p.text()).toContain("We agreed on the ledger.");
    expect(p.text()).toContain("## Why");
    expect(p.$("textarea")).toBeNull();
    expect(p.$("a[data-room]")).toBeNull();
    expect(p.$("button[data-open]")).toBeNull();
    // The moderator writes; the next period shows it without a reload.
    p.roadmaps[0] = { ...SEEDED, record: "We agreed on the ledger, then the page." };
    await p.tick();
    expect(p.text()).toContain("We agreed on the ledger, then the page.");
    // Every roadmap is one link away, inside the app.
    await p.click("a[data-list]");
    expect(p.pushed).toEqual(["/org/proj/acme/roadmaps"]);
  });

  it("shows a proposal item as a brief with its two approvals, and gives the person its Approve", async () => {
    const established = {
      ...SEEDED,
      status: "established",
      items: [
        {
          key: "a",
          kind: "proposal",
          title: "Ledger",
          brief: "An append-only ledger.",
          owner: "acme_dev",
          cites: [],
        },
      ],
      delegations: {
        a: {
          key: "a",
          owner: "acme_dev",
          brief: "An append-only ledger.",
          stage: "brief",
          approvals: {
            moderator: { by: "agent:acme_dev", at: "2026-09-29T02:00:00.000Z" },
          },
        },
      },
    };
    const approvals: string[] = [];
    const p = await page(
      (call, roadmaps) => {
        if (call.method === "POST" && call.url === `${ORG}/roadmaps/1/items/a/approve`) {
          approvals.push(call.url);
          roadmaps[0] = {
            ...established,
            delegations: {
              a: {
                ...established.delegations.a,
                stage: "delegated",
                approvals: {
                  ...established.delegations.a.approvals,
                  person: { by: "user:admin", at: "2026-09-29T02:05:00.000Z" },
                },
              },
            },
          };
          return { status: 200, body: { roadmap: roadmaps[0], hints: [] } };
        }
        return organization()(call, roadmaps);
      },
      [established],
      { parent: "/org/proj/acme/channels/roadmap_1", own: "?view=detail&n=1" },
    );
    expect(p.text()).toContain(T.brief);
    expect(p.text()).toContain(`${T.byModerator} acme_dev`);
    expect(p.text()).toContain(`${T.byPerson} ${T.waiting}`);
    expect(p.text()).toContain(T.approveHint);
    await p.click("button[data-approve]");
    expect(approvals).toEqual([`${ORG}/roadmaps/1/items/a/approve`]);
    // Read again: approved by both, so no longer a brief and no button.
    expect(p.$("button[data-approve]")).toBeNull();
    expect(p.text()).not.toContain(T.waiting);
  });

  it("takes an existing proposal in: the organization's proposals less the roadmap's own, one picked, one POST", async () => {
    const established = {
      ...SEEDED,
      status: "established",
      delegations: { a: { key: "a", owner: "acme_dev", stage: "delegated", proposal: 61 } },
    };
    const PROPOSALS = [
      { number: 61, title: "Ledger", status: "ready", author: "acme_dev", implementer: null },
      {
        number: 107,
        title: "Old <one>",
        status: "ready",
        author: "acme_dev",
        implementer: "acme_web",
      },
    ];
    const adopted: unknown[] = [];
    const p = await page(
      (call, roadmaps) => {
        if (call.method === "GET" && call.url === `${ORG}/proposals`)
          return { status: 200, body: { proposals: PROPOSALS } };
        if (call.method === "POST" && call.url === `${ORG}/roadmaps/1/adopt`) {
          adopted.push(call.body);
          roadmaps[0] = {
            ...established,
            items: [
              {
                key: "proposal-107",
                kind: "proposal",
                title: "Old <one>",
                brief: "Old <one>",
                owner: "acme_web",
                cites: [],
                proposal: 107,
              },
            ],
          };
          return { status: 200, body: { roadmap: roadmaps[0], hints: [] } };
        }
        return organization()(call, roadmaps);
      },
      [established],
      { parent: "/org/proj/acme/channels/roadmap_1", own: "?view=detail&n=1" },
    );
    await p.click("button[data-adopt-open]");
    // #61 is in the roadmap already: only #107 is offered, escaped.
    const offered = [...p.$<HTMLElement>("[data-overlay]").querySelectorAll("[data-adopt]")].map(
      (b) => b.getAttribute("data-adopt"),
    );
    expect(offered).toEqual(["107"]);
    expect(p.text()).toContain(T.adoptHint);
    expect(p.$<HTMLElement>("[data-overlay]").innerHTML).toContain("Old &lt;one&gt;");
    await p.click('button[data-adopt="107"]');
    // The implementer carries it (else the author); the title is the proposal's own.
    expect(adopted).toEqual([{ proposal: 107, title: "Old <one>", owner: "acme_web" }]);
    expect(p.$("[data-overlay]")).toBeNull();
    expect(p.text()).toContain(`${T.proposal} #107`);
    expect(p.text()).toContain(T.existing);
  });

  it("offers no proposal to take in while the roadmap waits for its room, and says so when none is left", async () => {
    const waiting = { ...SEEDED, status: "awaiting_room", channelId: null };
    const p = await page(organization(), [waiting], { own: "#1" });
    await p.follow();
    expect(p.text()).toContain(T.noRoom);
    expect(p.$("button[data-adopt-open]")).toBeNull();

    const q = await page(
      (call, roadmaps) =>
        call.url === `${ORG}/proposals`
          ? { status: 200, body: { proposals: [] } }
          : organization()(call, roadmaps),
      [SEEDED],
      { parent: "/org/proj/acme/channels/roadmap_1", own: "?view=detail&n=1" },
    );
    await q.click("button[data-adopt-open]");
    expect(q.text()).toContain(T.adoptNone);
    await q.press("Escape", "button[data-cancel]");
    expect(q.$("[data-overlay]")).toBeNull();
  });
});
