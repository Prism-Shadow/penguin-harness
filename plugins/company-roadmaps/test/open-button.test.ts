/**
 * The "Open a roadmap" button, clicked in a real DOM (happy-dom): the page's own document and
 * script, a stand-in for the server's answers, and a person's clicks. The button unfolds a
 * form — a name and the organization's employees, no room to choose: the roadmap opens its own
 * — that sends the plugin's own `POST …/roadmaps` with the employees in the order picked (the
 * first moderates), and the page goes straight to the new roadmap: its room beside its detail.
 * Picking changes the form where it stands (nothing in the dialog is drawn again), a refusal
 * keeps the form and says why, and the room column reads and sends through the channel's own
 * routes.
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
) {
  const window = new Window({ url: "http://localhost:7364/api/company-roadmaps/page" });
  windows.push(window);
  const document = window.document;
  const html = pageHtml();
  document.body.innerHTML = /<body>([\s\S]*)<script>/.exec(html)![1]!;
  const calls: Call[] = [];
  const roadmaps: Array<Record<string, unknown>> = [...seed];
  // The room's poll: kept, and run when the test says a period has passed.
  const ticks: Array<() => void> = [];
  const heard: Array<{ type: string; f: () => void }> = [];
  // What the app's window was asked to do: history entries pushed, events raised.
  const pushed: string[] = [];
  const popped: string[] = [];
  const sandbox = {
    document,
    window: {
      parent: {
        location: { pathname: "/org/proj/acme/roadmaps" },
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
    say: async (text: string, how: "button" | "enter" = "button") => {
      const box = $<HTMLElement & { value: string }>('textarea[name="say"]');
      box.value = text;
      if (how === "enter") {
        box.dispatchEvent(
          new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
        await settle();
      } else await fire($("form[data-compose]"), "submit");
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

interface Said {
  id: string;
  time: string;
  sender: string;
  text: string;
}

/**
 * The organization's server as the page sees it: the Project's organization list, the roadmaps,
 * its chart, the open (which opens the room) and the rooms' messages (`said`, by channel).
 */
function organization(
  opts: { refuse?: { status: number; message: string }; said?: Record<string, Said[]> } = {},
) {
  const said = opts.said ?? {};
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
    const room = /\/channels\/([a-z0-9_]+)\/messages$/.exec(call.url);
    if (room !== null) {
      const list = (said[room[1]!] ??= []);
      if (call.method === "GET")
        return { status: 200, body: { date: "2026-09-28", days: ["2026-09-28"], messages: list } };
      const text = (call.body as { text: string }).text;
      const msg = {
        id: `m${list.length + 1}`,
        time: "2026-09-28T10:00:00Z",
        sender: "user:admin",
        text,
      };
      list.push(msg);
      return { status: 201, body: msg };
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
        archived: false,
        channelId: `roadmap_${number}`,
        employees: b.employees,
        moderator: b.employees[0],
        record: "",
        body: "",
        items: [],
        delegations: {},
      };
      roadmaps.push(roadmap);
      return { status: 201, body: { roadmap, hints: [] } };
    }
    return { status: 404, body: {} };
  };
}

describe("the Open a roadmap button", () => {
  it("opens a roadmap: button → form (a name, the employees) → POST → straight into its room and detail", async () => {
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
    // Not the list: the new roadmap itself, its room read at once.
    expect(p.calls.slice(-2).map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${ORG}/roadmaps/1`,
      `GET ${ORG}/channels/roadmap_1/messages`,
    ]);
    expect(p.hash()).toBe("#1");
    expect(p.$("[data-overlay]")).toBeNull();
    expect(p.text()).toContain(T.opened.replace("{n}", "1"));
    expect(p.$("h1")?.textContent).toContain("Queue migration");
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
  archived: false,
  channelId: "roadmap_1",
  employees: ["acme_dev", "acme_web"],
  moderator: "acme_dev",
  record: "We agreed on the ledger.",
  body: "## Why\nBecause.",
  items: [],
  delegations: {},
};

describe("a roadmap's room beside its detail", () => {
  it("opens a roadmap from anywhere on its row, from the keyboard, and from Enter the room", async () => {
    const p = await page(organization(), [SEEDED]);
    await p.click("li.row .num");
    expect(p.hash()).toBe("#1");
    p.clearHash();
    await p.press("Enter", "li.row");
    expect(p.hash()).toBe("#1");
    p.clearHash();
    const enter = p.$<HTMLElement>("a.room");
    expect(enter.textContent).toBe(T.enterRoom);
    expect(enter.getAttribute("href")).toBe("#1");
    await p.click("a.room");
    expect(p.hash()).toBe("#1");
    expect(p.pushed).toEqual([]);
  });

  it("shows the room on the left and the record, body and items on the right", async () => {
    const said = {
      roadmap_1: [
        {
          id: "m1",
          time: "2026-09-28T09:00:00Z",
          sender: "system",
          text: "admin opened the channel",
        },
        {
          id: "m2",
          time: "2026-09-28T09:01:00Z",
          sender: "agent:acme_dev",
          text: "@user:admin what do you want from this?",
        },
      ],
    };
    const p = await page(organization({ said }), [SEEDED]);
    await p.click("li.row .num");
    await p.follow();
    const split = p.$<HTMLElement>(".split");
    expect([...split.children].map((c) => c.className)).toEqual(["room-col", "detail"]);
    const room = p.$<HTMLElement>(".room-col");
    expect(room.textContent).toContain("acme_dev");
    expect(room.textContent).toContain("what do you want from this?");
    expect(room.textContent).toContain(T.system);
    expect(p.$<HTMLElement>(".detail").textContent).toContain("We agreed on the ledger.");
    // The channel's own page is one link away, inside the app.
    await p.click("a[data-room]");
    expect(p.pushed).toEqual(["/org/proj/acme/channels/roadmap_1"]);
    expect(p.popped).toEqual(["popstate"]);
  });

  it("sends into the room with the channel's own route — the button or Enter — and reads it again", async () => {
    const said: Record<string, Said[]> = {};
    const p = await page(organization({ said }), [SEEDED]);
    await p.click("li.row .num");
    await p.follow();
    expect(p.text()).toContain(T.quiet);
    await p.say("The ledger first.");
    await p.say("Then the page.", "enter");
    expect(p.calls.filter((c) => c.method === "POST").map((c) => [c.url, c.body])).toEqual([
      [`${ORG}/channels/roadmap_1/messages`, { text: "The ledger first." }],
      [`${ORG}/channels/roadmap_1/messages`, { text: "Then the page." }],
    ]);
    expect(p.$<HTMLElement>(".stream").textContent).toContain("Then the page.");
    expect(p.$<HTMLElement & { value: string }>('textarea[name="say"]').value).toBe("");
    // What others say arrives at the next period, without a reload.
    said.roadmap_1!.push({
      id: "m9",
      time: "2026-09-28T10:05:00Z",
      sender: "agent:acme_web",
      text: "Agreed.",
    });
    await p.tick();
    expect(p.$<HTMLElement>(".stream").textContent).toContain("Agreed.");
  });
});
