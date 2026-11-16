/** A visible, pausable loop: send the prompt, show its evaluation curve, then start a fresh round. */
import { S } from "../../../web/src/lib/strings";
import { IDS } from "./mock/ids";
import type { EvolutionClock } from "./evolution-clock";
import { EVOLUTION_CONTROL, EVOLUTION_STATE } from "./evolution-messages";

export function installEvolutionAutoplay(
  win: Window & typeof globalThis,
  prompt: string,
  playback: EvolutionClock,
  clearPreviousRound: () => void,
): () => void {
  if (win.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => undefined;
  const doc = win.document;
  const letters = Array.from(prompt);
  const setValue = Object.getOwnPropertyDescriptor(
    win.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  let visible = false;
  let stopped = false;
  let paused = false;
  let sent = false;
  let destination: "result" | "center" | "detail" | "chart" | "replay" | "restart" = "result";
  let index = 0;
  let timer: (() => void) | undefined;

  const cancelTimer = () => {
    timer?.();
    timer = undefined;
  };
  const stop = () => {
    stopped = true;
    cancelTimer();
    visibility.disconnect();
    changes.disconnect();
    doc.removeEventListener("visibilitychange", sync);
    doc.removeEventListener("pointerdown", takeOver, true);
    doc.removeEventListener("keydown", takeOver, true);
    doc.removeEventListener("input", takeOver, true);
    win.removeEventListener("pagehide", stop);
    win.removeEventListener("message", control);
    playback.setPaused(false);
    win.parent.postMessage({ type: EVOLUTION_STATE, state: "finished" }, win.location.origin);
  };
  const control = (event: MessageEvent) => {
    if (event.source !== win.parent || event.origin !== win.location.origin) return;
    if (event.data?.type !== EVOLUTION_CONTROL || typeof event.data.paused !== "boolean") return;
    paused = event.data.paused;
    sync();
    win.parent.postMessage(
      { type: EVOLUTION_STATE, state: event.data.paused ? "paused" : "playing" },
      win.location.origin,
    );
  };
  const takeOver = (event: Event) => {
    if (event.isTrusted) stop();
  };
  const tick = () => {
    timer = undefined;
    if (stopped || !visible || doc.hidden) return;
    const input = doc.querySelector<HTMLTextAreaElement>('[data-slot="composer"] textarea');
    if (!input || input.disabled) return;
    if (input.value !== letters.slice(0, index).join("")) {
      stop();
      return;
    }
    if (index < letters.length) {
      index += 1;
      setValue.call(input, letters.slice(0, index).join(""));
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
      timer = playback.schedule(tick, index === letters.length ? 500 : 1700 / letters.length);
      return;
    }
    const button = [...input.closest('[data-slot="composer"]')!.querySelectorAll("button")].find(
      (candidate) => candidate.getAttribute("aria-label") === S.chat.send,
    );
    if (!button || button.disabled) {
      timer = playback.schedule(tick, 100);
      return;
    }
    sent = true;
    button.click();
  };
  const revealChart = (chart: Element) => {
    for (
      let parent = chart.parentElement;
      parent && parent !== doc.body;
      parent = parent.parentElement
    ) {
      if (
        parent.scrollHeight > parent.clientHeight &&
        /auto|scroll/.test(win.getComputedStyle(parent).overflowY)
      ) {
        const rect = chart.getBoundingClientRect();
        const box = parent.getBoundingClientRect();
        if (rect.top < box.top + 48 || rect.bottom > box.bottom - 16)
          parent.scrollTop +=
            rect.top - box.top - Math.max(64, (parent.clientHeight - rect.height) / 2);
        break;
      }
    }
  };
  const advance = () => {
    timer = undefined;
    if (stopped || !visible || doc.hidden) return;
    if (destination === "result") {
      const running = [...doc.querySelectorAll('[data-slot="composer"] button')].some(
        (button) => button.getAttribute("aria-label") === S.chat.stop,
      );
      if (!running && doc.querySelector("main table")) {
        // The app opens its Agents panel during parallel evaluation; return the space to the result.
        doc.querySelector<HTMLButtonElement>('[data-testid="dock-tab-close"]')?.click();
        destination = "center";
        timer = playback.schedule(advance, 1300);
      }
    } else if (destination === "center") {
      const link = [...doc.querySelectorAll<HTMLAnchorElement>('a[href="/benchmark"]')].find(
        (candidate) => candidate.getClientRects().length > 0,
      );
      if (link) {
        destination = "detail";
        link.click();
        timer = playback.schedule(advance, 700);
      } else {
        // On a phone, open the real navigation drawer before choosing Evaluation Center.
        [...doc.querySelectorAll<HTMLButtonElement>("header button")]
          .find((button) => button.getClientRects().length > 0)
          ?.click();
        timer = playback.schedule(advance, 400);
      }
    } else if (destination === "detail") {
      const card = [...doc.querySelectorAll<HTMLButtonElement>("main button")].find((candidate) =>
        candidate.textContent?.includes(IDS.benchmarks.docs),
      );
      if (card) {
        destination = "chart";
        card.click();
      }
    } else if (destination === "chart") {
      const chart = doc.querySelector("main svg.ui-chart");
      if (chart) {
        revealChart(chart);
        destination = "replay";
        timer = playback.schedule(advance, 4000);
      }
    } else if (destination === "replay") {
      const button = [...doc.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) =>
          candidate.getClientRects().length > 0 &&
          (candidate.textContent?.trim() === S.chat.newSessionMenu ||
            candidate.getAttribute("aria-label")?.startsWith(S.chat.newSessionMenu)),
      );
      if (button) {
        destination = "restart";
        button.click();
        timer = playback.schedule(advance, 200);
      } else {
        [...doc.querySelectorAll<HTMLButtonElement>("header button")]
          .find((candidate) => candidate.getClientRects().length > 0)
          ?.click();
        timer = playback.schedule(advance, 400);
      }
    } else {
      const input = doc.querySelector<HTMLTextAreaElement>('[data-slot="composer"] textarea');
      if (!input || input.disabled) return;
      if (input.value !== "") {
        stop();
        return;
      }
      clearPreviousRound();
      index = 0;
      sent = false;
      destination = "result";
      queue();
    }
  };
  function sync() {
    playback.setPaused(paused || !visible || doc.hidden);
    queue();
  }
  function queue() {
    if (stopped) return;
    if (!visible || doc.hidden) return;
    if (sent) {
      if (timer === undefined) timer = playback.schedule(advance, 80);
      return;
    }
    if (timer === undefined) timer = playback.schedule(tick, index === 0 ? 650 : 50);
  }
  const changes = new win.MutationObserver(queue);
  changes.observe(doc.documentElement, { childList: true, subtree: true });
  const visibility = new win.IntersectionObserver(
    ([entry]) => {
      visible = entry?.isIntersecting === true && entry.intersectionRatio >= 0.25;
      sync();
    },
    { threshold: [0, 0.25] },
  );
  playback.setPaused(true);
  visibility.observe(doc.documentElement);
  doc.addEventListener("visibilitychange", sync);
  doc.addEventListener("pointerdown", takeOver, true);
  doc.addEventListener("keydown", takeOver, true);
  doc.addEventListener("input", takeOver, true);
  win.addEventListener("pagehide", stop, { once: true });
  win.addEventListener("message", control);
  win.parent.postMessage({ type: EVOLUTION_STATE, state: "ready" }, win.location.origin);
  return stop;
}
