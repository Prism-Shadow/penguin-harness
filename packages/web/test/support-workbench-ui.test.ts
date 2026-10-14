/** @vitest-environment jsdom */
/**
 * Given an answered ticket, submitting a follow-up sends its text before disabling the form,
 * ignores a duplicate submission, and clears the draft only after the server accepts it.
 * Given numbered citations, the answer shows clickable [1] markers with the source URL on the link.
 * A new question asks only for its text, follows the Session title and counts down while waiting.
 * An estimate that expires says research continues instead of inventing completion or restarting the timer.
 * Backdrop clicks dismiss a dialog without losing drafts; clicks inside and selection drags do not.
 * An unavailable service keeps the draft and shows a readable error rather than a JSON parse exception.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { stubFetch, json } from "./helpers/fetch";
const ui = path.resolve(__dirname, "../../../plugins/penguin-support/workbenches/support/ui");
const ticket = {
  id: "one",
  title: "Opening the workbench",
  status: "answered",
  createdAt: "2026-10-14T00:00:00Z",
  updatedAt: "2026-10-14T00:00:00Z",
  messages: [
    {
      role: "assistant",
      text: "Open its tab.[1](https://penguin.ooo/docs/chat)",
      at: "2026-10-14T00:00:00Z",
    },
  ],
  error: null,
};
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.setItem("penguin.support.lang", "en");
  const html = await fs.readFile(path.join(ui, "index.html"), "utf8");
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1]!;
  // jsdom has no native dialog implementation; the browser smoke test checks focus and Esc.
  const dialog = document.querySelector("dialog")!;
  dialog.showModal = () => dialog.setAttribute("open", "");
  dialog.close = () => {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  };
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});
async function openTicket() {
  await loadUi();
  document.querySelector<HTMLButtonElement>("#list button")!.click();
}
async function loadUi() {
  const url = path.join(ui, "app.js");
  await import(/* @vite-ignore */ url);
  await vi.advanceTimersByTimeAsync(0);
}
it("submits the full follow-up once and clears it only after success", async () => {
  let finish: (response: Response) => void = () => {};
  const request = stubFetch((req) =>
    req.method === "POST"
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : json({ tickets: [ticket] }),
  );
  await openTicket();
  const form = document.querySelector<HTMLFormElement>("#followup")!;
  const text = form.querySelector("textarea")!;
  text.value = "One more question";
  text.dispatchEvent(new Event("input", { bubbles: true }));
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(request.requests.filter((r) => r.method === "POST").map((r) => r.body)).toEqual([
    { text: "One more question" },
  ]);
  expect(text.disabled).toBe(true);
  expect(text.value).toBe("One more question");
  finish(json({ ...ticket, status: "running" }));
  await vi.advanceTimersByTimeAsync(0);
  expect(text.value).toBe("");
});
it("renders a citation number as a link without exposing its URL as prose", async () => {
  stubFetch(() => json({ tickets: [ticket] }));
  await openTicket();
  const answer = document.querySelector("#messages")!;
  const link = answer.querySelector("a")!;
  expect(link.textContent).toBe("[1]");
  expect(link.href).toBe("https://penguin.ooo/docs/chat");
  expect(answer.textContent).not.toContain("https://");
});
it("asks only for a question, follows its title and keeps an honest waiting estimate", async () => {
  vi.setSystemTime(new Date(ticket.createdAt));
  let current = { ...ticket, title: "Session-generated title", status: "running" };
  const requests = stubFetch((req) =>
    req.method === "POST" ? json(current) : json({ tickets: [current] }),
  );
  await loadUi();
  document.querySelector<HTMLButtonElement>("#new")!.click();
  const form = document.querySelector<HTMLFormElement>("#create")!;
  expect([...new FormData(form).keys()]).toEqual(["text"]);
  const input = form.querySelector("textarea")!;
  expect(document.activeElement).toBe(input);
  input.value = "Where is my workbench?";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(0);
  expect(requests.requests.find((r) => r.method === "POST")?.body).toEqual({
    text: "Where is my workbench?",
  });
  expect(document.querySelector("#dialog-title")!.textContent).toBe(current.title);
  expect(document.querySelector("#waiting")!.textContent).toContain("about 2 min");
  await vi.advanceTimersByTimeAsync(61000);
  expect(document.querySelector("#waiting")!.textContent).toContain("Waiting 1:01");
  expect(document.querySelector("#waiting")!.textContent).toContain("about 1 min");
  await vi.advanceTimersByTimeAsync(60000);
  expect(document.querySelector("#waiting")!.textContent).toContain("Taking longer");
  expect(document.querySelector("#waiting")!.textContent).not.toContain("about");
  current = { ...current, title: "Updated Session title", status: "answered" };
  await vi.advanceTimersByTimeAsync(2500);
  expect(document.querySelector("#dialog-title")!.textContent).toBe(current.title);
  expect(document.querySelector<HTMLElement>("#waiting")!.hidden).toBe(true);
});
it("keeps a draft when a proxy returns an empty 500", async () => {
  stubFetch((req) =>
    req.method === "POST"
      ? new Response("", { status: 500, headers: { "content-type": "text/plain" } })
      : json({ tickets: [] }),
  );
  await loadUi();
  document.querySelector<HTMLButtonElement>("#new")!.click();
  const form = document.querySelector<HTMLFormElement>("#create")!;
  const input = form.querySelector("textarea")!;
  input.value = "Please keep this question";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(0);
  expect(input.value).toBe("Please keep this question");
  expect(document.querySelector("#dialog-error")!.textContent).toContain("HTTP 500");
  expect(document.querySelector("#dialog-error")!.textContent).not.toContain("JSON");
  expect(form.querySelector<HTMLButtonElement>("[type=submit]")!.disabled).toBe(false);
});

it("dismisses on a backdrop click, preserving the draft and ignoring selection drags", async () => {
  stubFetch(() => json({ tickets: [] }));
  await loadUi();
  document.querySelector<HTMLButtonElement>("#new")!.click();
  const dialog = document.querySelector("dialog")!;
  dialog.getBoundingClientRect = () =>
    ({ left: 100, top: 100, right: 500, bottom: 500 }) as DOMRect;
  const input = document.querySelector<HTMLTextAreaElement>("#create textarea")!;
  input.value = "Unfinished question";
  const pointer = (type: string, x: number, y: number) =>
    dialog.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  pointer("pointerdown", 120, 120);
  pointer("click", 120, 120);
  expect(dialog.open).toBe(true);
  pointer("pointerdown", 120, 120);
  pointer("click", 10, 10);
  expect(dialog.open).toBe(true);
  pointer("pointerdown", 10, 10);
  pointer("click", 10, 10);
  expect(dialog.open).toBe(false);
  document.querySelector<HTMLButtonElement>("#new")!.click();
  expect(input.value).toBe("Unfinished question");
});
