/**
 * The "Open a roadmap" button, clicked in a real DOM (happy-dom): the page's own document and
 * script, a stand-in for the server's answers, and a person's clicks. The button unfolds a
 * form — a name and the organization's employees, no room to choose: the roadmap opens its own
 * — that sends the plugin's own `POST …/roadmaps` with the employees in the order picked (the
 * first moderates), and the new roadmap is on the list straight after, with the way into its
 * room. A refusal keeps the form and says why.
 */
import vm from "node:vm";
import { Window } from "happy-dom";
import type {
  Element,
  HTMLButtonElement,
  HTMLElement,
  HTMLInputElement,
} from "happy-dom";
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
) {
  const window = new Window({ url: "http://localhost:7364/api/company-roadmaps/page" });
  windows.push(window);
  const document = window.document;
  const html = pageHtml();
  document.body.innerHTML = /<body>([\s\S]*)<script>/.exec(html)![1]!;
  const calls: Call[] = [];
  const roadmaps: Array<Record<string, unknown>> = [];
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
      addEventListener: () => {},
    },
    location: window.location,
    localStorage: { getItem: () => "en" },
    navigator: { language: "en-US" },
    setTimeout,
    clearTimeout,
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
    pick: async (id: string) => {
      const box = $<HTMLInputElement>(`input[name="employee"][value="${id}"]`);
      box.checked = true;
      await fire(box, "change");
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
    clearHash: () => {
      window.location.hash = "";
    },
    reads: () => calls.filter((c) => c.method === "GET" && c.url === `${ORG}/roadmaps`).length,
  };
}

/** The organization's server as the page sees it: the roadmaps, its chart, and the open (which opens the room). */
function organization(opts: { refuse?: { status: number; message: string } } = {}) {
  return (call: Call, roadmaps: Array<Record<string, unknown>>) => {
    if (call.method === "GET" && call.url === `${ORG}/roadmaps`)
      return { status: 200, body: { roadmaps } };
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
  it("opens a roadmap: button → form (a name, the employees) → POST → the new roadmap on the list", async () => {
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
    // The list is read again, and the new roadmap is on it, with the way into its room.
    expect(p.calls.at(-1)).toMatchObject({ method: "GET", url: `${ORG}/roadmaps` });
    expect(p.text()).toContain(T.opened.replace("{n}", "1"));
    expect(p.text()).toContain("Queue migration");
    expect(p.$("a[data-room]")?.getAttribute("href")).toBe("/org/proj/acme/channels/roadmap_1");
    expect(p.$("form[data-form]")).toBeNull();
  });

  it("enters the room inside the app: its own channel page, through the app's history", async () => {
    const p = await page(organization());
    await p.click("button[data-open]");
    await p.pick("acme_dev");
    await p.name("Queue migration");
    await p.submit();
    const link = p.$<HTMLElement>("a[data-room]");
    expect(link.getAttribute("target")).toBe("_top");
    expect(link.textContent).toBe(T.enterRoom);
    await p.click("a[data-room]");
    expect(p.pushed).toEqual(["/org/proj/acme/channels/roadmap_1"]);
    expect(p.popped).toEqual(["popstate"]);
    // A click on the room's link is not a click on the row.
    expect(p.hash()).toBe("");
  });

  it("keeps the form and says why when the server refuses, and sends nothing until the form is complete", async () => {
    const p = await page(
      organization({ refuse: { status: 409, message: "No free channel id for roadmap #1's room." } }),
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

  it("opens a roadmap from anywhere on its row, and from the keyboard", async () => {
    const p = await page(organization());
    await p.click("button[data-open]");
    await p.pick("acme_dev");
    await p.name("Queue migration");
    await p.submit();
    await p.click("li.row .num");
    expect(p.hash()).toBe("#1");
    p.clearHash();
    await p.press("Enter", "li.row");
    expect(p.hash()).toBe("#1");
  });
});
