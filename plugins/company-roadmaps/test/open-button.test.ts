/**
 * The "Open a roadmap" button, clicked in a real DOM (happy-dom): the page's own document and
 * script, a stand-in for the server's answers, and a person's clicks. The button unfolds a
 * form whose rooms are the organization's channels (never the all-hands one, never an archived
 * one) and whose employees are the chosen channel's; the form sends the plugin's own
 * `POST …/roadmaps` with the employees in the order picked (the first moderates), and the new
 * roadmap is on the list straight after. A refusal keeps the form and says why.
 */
import vm from "node:vm";
import { Window } from "happy-dom";
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

const CHANNELS = [
  { channelId: "default_channel", name: "default_channel", everyone: true, archived: false },
  { channelId: "room_a", name: "Queue room", everyone: false, archived: false },
  { channelId: "old_room", name: "Old room", everyone: false, archived: true },
];
const ROOM_A = {
  channelId: "room_a",
  members: [
    { principal: "user:boss", name: "boss", kind: "user" },
    { principal: "agent:acme_dev", name: "Dev", kind: "agent" },
    { principal: "agent:acme_web", name: "Web", kind: "agent" },
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
  server: (call: Call, roadmaps: Array<Record<string, unknown>>) => { status: number; body: unknown },
) {
  const window = new Window({ url: "http://localhost:7364/api/company-roadmaps/page" });
  windows.push(window);
  const document = window.document;
  const html = pageHtml();
  document.body.innerHTML = /<body>([\s\S]*)<script>/.exec(html)![1]!;
  const calls: Call[] = [];
  const roadmaps: Array<Record<string, unknown>> = [];
  const sandbox = {
    document,
    window: {
      parent: { location: { pathname: "/org/proj/acme/roadmaps" }, document },
      addEventListener: () => {},
    },
    location: window.location,
    localStorage: { getItem: () => "en" },
    navigator: { language: "en-US" },
    setTimeout,
    clearTimeout,
    fetch: async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
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
  const $ = <E extends Element>(selector: string) => main.querySelector(selector) as unknown as E;
  const fire = async (el: Element, type: string) => {
    el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
    await settle();
  };
  return {
    calls,
    roadmaps,
    text: () => (main.textContent ?? "").replace(/\s+/g, " "),
    $,
    click: async (selector: string) => {
      ($<HTMLElement>(selector)).click();
      await settle();
    },
    choose: async (value: string) => {
      const select = $<HTMLSelectElement>('select[name="room"]');
      select.value = value;
      await fire(select as unknown as Element, "change");
    },
    pick: async (id: string) => {
      const box = $<HTMLInputElement>(`input[name="employee"][value="${id}"]`);
      box.checked = true;
      await fire(box as unknown as Element, "change");
    },
    name: async (value: string) => {
      const input = $<HTMLInputElement>('input[name="name"]');
      input.value = value;
      await fire(input as unknown as Element, "input");
    },
    submit: async () => fire($("form[data-form]"), "submit"),
  };
}

/** The organization's server as the page sees it: the roadmaps, its channels, one channel, and the open. */
function organization(opts: { refuse?: { status: number; message: string } } = {}) {
  return (call: Call, roadmaps: Array<Record<string, unknown>>) => {
    if (call.method === "GET" && call.url === `${ORG}/roadmaps`) return { status: 200, body: { roadmaps } };
    if (call.method === "GET" && call.url === `${ORG}/channels`) return { status: 200, body: { channels: CHANNELS } };
    if (call.method === "GET" && call.url === `${ORG}/channels/room_a`) return { status: 200, body: ROOM_A };
    if (call.method === "POST" && call.url === `${ORG}/roadmaps`) {
      if (opts.refuse) return { status: opts.refuse.status, body: { error: { code: "x", message: opts.refuse.message } } };
      const b = call.body as { name: string; channelId: string; employees: string[] };
      const roadmap = {
        number: roadmaps.length + 1,
        name: b.name,
        status: "discussing",
        archived: false,
        channelId: b.channelId,
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
  it("opens a roadmap: button → form (a room, its employees, a name) → POST → the new roadmap on the list", async () => {
    const p = await page(organization());
    expect(p.text()).toContain(T.empty);
    await p.click("button[data-open]");
    // The rooms are the channels that can hold one: not the all-hands channel, not an archived one.
    const options = [...p.$<HTMLSelectElement>('select[name="room"]').querySelectorAll("option")].map(
      (o) => o.getAttribute("value"),
    );
    expect(options).toEqual(["", "room_a"]);
    await p.choose("room_a");
    // The employees are the room's agents, not its people.
    const boxes = [...p.$<HTMLElement>("fieldset").querySelectorAll('input[name="employee"]')].map((b) =>
      b.getAttribute("value"),
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
        body: { name: "Queue migration", channelId: "room_a", employees: ["acme_web", "acme_dev"] },
        contentType: "application/json",
      },
    ]);
    // The list is read again, and the new roadmap is on it.
    expect(p.calls.at(-1)).toMatchObject({ method: "GET", url: `${ORG}/roadmaps` });
    expect(p.text()).toContain(T.opened.replace("{n}", "1"));
    expect(p.text()).toContain("Queue migration");
    expect(p.text()).toContain("room_a");
    expect(p.$("form[data-form]")).toBeNull();
  });

  it("keeps the form and says why when the server refuses, and sends nothing until the form is complete", async () => {
    const p = await page(
      organization({ refuse: { status: 400, message: "Not in channel room_a: acme_dev." } }),
    );
    await p.click("button[data-open]");
    await p.name("Half done");
    await p.submit();
    expect(p.text()).toContain(T.incomplete);
    expect(p.calls.filter((c) => c.method === "POST")).toEqual([]);

    await p.choose("room_a");
    await p.pick("acme_dev");
    await p.submit();
    expect(p.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(p.text()).toContain(T.openFailed);
    expect(p.text()).toContain("HTTP 400 — Not in channel room_a: acme_dev.");
    expect(p.$<HTMLInputElement>('input[name="name"]').value).toBe("Half done");
  });

  it("says no channel can hold a room when there is none, and Cancel goes back to the list", async () => {
    const p = await page((call, roadmaps) =>
      call.url === `${ORG}/channels`
        ? { status: 200, body: { channels: [CHANNELS[0], CHANNELS[2]] } }
        : organization()(call, roadmaps),
    );
    await p.click("button[data-open]");
    expect(p.text()).toContain(T.noRooms);
    await p.click("button[data-cancel]");
    expect(p.text()).toContain(T.empty);
    expect(p.$("button[data-open]")).not.toBeNull();
  });
});
