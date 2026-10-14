/** @vitest-environment jsdom */
/**
 * Given an answered ticket, submitting a follow-up sends its text before disabling the form,
 * ignores a duplicate submission, and clears the draft only after the server accepts it.
 * Given numbered citations, the answer shows clickable [1] markers with the source URL on the link.
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
  const url = path.join(ui, "app.js");
  await import(/* @vite-ignore */ url);
  await vi.advanceTimersByTimeAsync(0);
  document.querySelector<HTMLButtonElement>("#list button")!.click();
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
