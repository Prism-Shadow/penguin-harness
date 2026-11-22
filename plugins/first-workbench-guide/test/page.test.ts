// @vitest-environment jsdom
/**
 * If the Session was removed or temporarily unavailable, the guide lets the person retry
 * its read or start over with a fresh key. Returning from Models offers the actual picker.
 */
import { afterEach, expect, it, vi } from "vitest";
import html from "../workbenches/first-workbench-guide/ui/index.html?raw";
import { mountGuide } from "../workbenches/first-workbench-guide/ui/guide-page.js";

const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const model = { provider: "draft", modelId: "inventory", label: "Inventory" };
const answer = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
it("recovers a pending conversation after a read failure and can leave a missing Session", async () => {
  document.documentElement.innerHTML = html;
  document.documentElement.lang = "en";
  const key = "a".repeat(32);
  sessionStorage.setItem(
    "first-workbench-guide:" + location.pathname,
    JSON.stringify({ key, request: "Take inventory", model }),
  );
  const reads = vi
    .fn()
    .mockResolvedValueOnce(answer({ error: "Disconnected" }, 503))
    .mockResolvedValueOnce(
      answer({ phase: "answered", model, request: "Take inventory", answer: "Check the totals." }),
    );
  vi.stubGlobal("fetch", reads);
  await mountGuide({});
  expect(button("send").disabled).toBe(true);
  expect(button("restart").hidden).toBe(false);
  expect(button("retry-read").hidden).toBe(false);
  await button("retry-read").onclick!(null as never);
  expect(button("answer").textContent).toBe("Check the totals.");
  expect(reads.mock.calls[1][0]).toBe(reads.mock.calls[0][0]);
  document.documentElement.innerHTML = html;
  reads.mockResolvedValueOnce(answer({ error: "The Session no longer exists" }, 404));
  await mountGuide({});
  button("restart").click();
  const draft = JSON.parse(sessionStorage.getItem("first-workbench-guide:" + location.pathname)!);
  expect(draft.key).not.toBe(key);
  expect(draft.model).toEqual(model);
  expect(button("status").textContent).toBe("");
});
it("points the returning user to the native picker without assuming setup succeeded", async () => {
  document.documentElement.innerHTML = html;
  document.documentElement.lang = "en";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(null)));
  const sdk = {
    getChatModel: vi.fn(async () => null),
    openModelSettings: vi.fn(async () => {}),
    chooseChatModel: vi.fn(async () => null),
  };
  await mountGuide(sdk);
  await button("settings").onclick!(null as never);
  expect(button("choose").classList.contains("wb-primary")).toBe(true);
  await button("choose").onclick!(null as never);
  expect(sdk.chooseChatModel).toHaveBeenCalledTimes(1);
  expect(button("send").disabled).toBe(true);
});
