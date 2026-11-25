/** A visible, pausable loop: send the prompt, show its evaluation curve, then start a fresh round. */
import { S } from "../../../web/src/lib/strings";
import { IDS } from "./mock/ids";
import type { EvolutionClock } from "./evolution-clock";

export function installEvolutionAutoplay(
  win: Window & typeof globalThis,
  prompt: string,
  playback: EvolutionClock,
  clearPreviousRound: () => void,
  playOnce = false,
): () => void {
  if (!playOnce && win.matchMedia("(prefers-reduced-motion: reduce)").matches)
    return () => undefined;
  const doc = win.document;
  // A suspended workspace tab retains its DOM while another page is on screen.
  const available = (element: Element) =>
    !element.closest("[inert]") &&
    element.getClientRects().length > 0 &&
    win.getComputedStyle(element).visibility !== "hidden";
  const shown = <T extends Element>(selector: string, matches?: (element: T) => boolean) =>
    [...doc.querySelectorAll<T>(selector)].find(
      (element) => available(element) && (!matches || matches(element)),
    );
  const letters = Array.from(prompt);
  const setValue = Object.getOwnPropertyDescriptor(
    win.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  let visible = false;
  let stopped = false;
  let sent = false;
  let resultSessionId: string | undefined;
  let destination: "result" | "center" | "detail" | "chart" | "comparison" | "replay" | "restart" =
    "result";
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
    playback.setPaused(false);
  };
  const takeOver = (event: Event) => {
    if (event.isTrusted) stop();
  };
  const tick = () => {
    timer = undefined;
    if (stopped || !visible || doc.hidden) return;
    const input = shown<HTMLTextAreaElement>('[data-slot="composer"] textarea');
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
  const revealChart = (chart: Element, center = false) => {
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
        if (center || rect.top < box.top + 48 || rect.bottom > box.bottom - 16)
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
      const running = shown(
        '[data-slot="composer"] button',
        (button) => button.getAttribute("aria-label") === S.chat.stop,
      );
      if (!running && shown("main table")) {
        // The app opens its Agents panel during parallel evaluation; return the space to the result.
        shown<HTMLButtonElement>('[data-testid="dock-tab-close"]')?.click();
        destination = "center";
        timer = playback.schedule(advance, 1300);
      }
    } else if (destination === "center") {
      // Open the default Agent's evaluation workbench from its App Center tile.
      const tile = shown<HTMLButtonElement>('li[data-app="default_agent/benchmark"] > button');
      const appCenter = shown<HTMLAnchorElement>('a[href="/apps"]');
      if (tile) {
        destination = "detail";
        tile.click();
        timer = playback.schedule(advance, 700);
      } else if (appCenter) {
        // Closing the Agents dock returns focus to the conversation. Remember its row
        // immediately before navigating away, so the final comparison uses that Session.
        resultSessionId = shown<HTMLElement>('[data-session-id][aria-current="page"]')?.dataset
          .sessionId;
        appCenter.click();
        timer = playback.schedule(advance, 700);
      } else {
        // On a phone, open the real navigation drawer before choosing the App Center.
        [...doc.querySelectorAll<HTMLButtonElement>("header button")].find(available)?.click();
        timer = playback.schedule(advance, 400);
      }
    } else if (destination === "detail") {
      const card = shown<HTMLButtonElement>("main button", (candidate) =>
        Boolean(candidate.textContent?.includes(IDS.benchmarks.docs)),
      );
      if (card) {
        destination = "chart";
        card.click();
      }
    } else if (destination === "chart") {
      const chart = shown("main svg.ui-chart");
      if (chart) {
        revealChart(chart);
        if (playOnce) {
          // Drag this round's conversation from its workspace group beside its chart.
          const session = shown<HTMLElement>(
            "[data-session-id]",
            (row) => row.dataset.sessionId === resultSessionId,
          )?.closest<HTMLElement>('[draggable="true"]');
          const pane = chart.closest<HTMLElement>('[data-workspace-page][data-pane="full"]');
          if (
            pane &&
            session?.getBoundingClientRect().width &&
            typeof win.DataTransfer === "function"
          ) {
            const dataTransfer = new win.DataTransfer();
            const drag = (type: string) =>
              new win.DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer,
                clientX: pane.getBoundingClientRect().left + 1,
              });
            session.dispatchEvent(drag("dragstart"));
            pane.dispatchEvent(drag("dragover"));
            const cancelDrop = playback.schedule(() => {
              timer = undefined;
              destination = "comparison";
              pane.dispatchEvent(drag("drop"));
              session.dispatchEvent(drag("dragend"));
              queue();
            }, 100);
            timer = () => {
              cancelDrop();
              pane.dispatchEvent(drag("dragleave"));
              session.dispatchEvent(drag("dragend"));
            };
          } else {
            stop();
          }
          return;
        }
        destination = "replay";
        timer = playback.schedule(advance, 4000);
      }
    } else if (destination === "comparison") {
      // The narrower dock lays the chart out in a different scrolling viewport.
      const chart = shown('[data-pane="right"] svg.ui-chart');
      if (chart) {
        revealChart(chart, true);
        stop();
      }
    } else if (destination === "replay") {
      // Real Agent apps retain their page across visits. Leave the list ready for the next round.
      shown<HTMLButtonElement>(
        "main button",
        (button) => button.getAttribute("aria-label") === S.benchmark.backToList,
      )?.click();
      const button = [...doc.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) =>
          available(candidate) &&
          (candidate.textContent?.trim() === S.chat.newSessionMenu ||
            candidate.getAttribute("aria-label")?.startsWith(S.chat.newSessionMenu)),
      );
      if (button) {
        destination = "restart";
        button.click();
        timer = playback.schedule(advance, 200);
      } else {
        [...doc.querySelectorAll<HTMLButtonElement>("header button")].find(available)?.click();
        timer = playback.schedule(advance, 400);
      }
    } else {
      const input = shown<HTMLTextAreaElement>('[data-slot="composer"] textarea');
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
    playback.setPaused(!visible || doc.hidden);
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
  // The homepage handles real control activation separately, including after its final scene.
  if (!playOnce) {
    doc.addEventListener("pointerdown", takeOver, true);
    doc.addEventListener("keydown", takeOver, true);
    doc.addEventListener("input", takeOver, true);
  }
  win.addEventListener("pagehide", stop, { once: true });
  return stop;
}
