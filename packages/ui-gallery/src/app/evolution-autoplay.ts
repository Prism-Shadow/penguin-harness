/**
 * A visible, pausable loop: send the prompt, then open the default Agent's Self-Evolution
 * Workbench from the App Center, open the round's Benchmark in its page and show the score curve,
 * then start a fresh round. The workbench is the pinned package's page in a frame of its own, so
 * the walkthrough reads and clicks inside that frame's document, by the page's own words.
 */
import { S } from "../../../web/src/lib/strings";
import type { Lang } from "./mock/types";
import type { EvolutionClock } from "./evolution-clock";

/** What the walkthrough types and looks for. */
export interface EvolutionScene {
  /** The request typed into the new conversation. */
  prompt: string;
  /** The interface language, which the workbench page shares with the app. */
  lang: Lang;
  /** The round's Benchmark, by the title the workbench lists it under. */
  benchmarkTitle: string;
}

/**
 * The pinned workbench page's own words the walkthrough finds its way by, as its dictionary
 * (the package's src/ui/strings.ts) prints them: the way back over a Benchmark's page, and the
 * name of the page's score chart.
 */
const PAGE_WORDS: Record<Lang, { backToList: string; scoreChart: string }> = {
  en: { backToList: "Back to list", scoreChart: "Score over time" },
  zh: { backToList: "返回列表", scoreChart: "分数随时间变化" },
};

/** The workbench's page frame, in the App Center's window or a pane beside a conversation. */
const WORKBENCH_FRAME = 'iframe[src*="/workbenches/benchmark/ui/"]';

/** How often the walkthrough looks into the frame, whose changes the app's observer never sees. */
const FRAME_POLL_MS = 200;

export function installEvolutionAutoplay(
  win: Window & typeof globalThis,
  scene: EvolutionScene,
  playback: EvolutionClock,
  clearPreviousRound: () => void,
  playOnce = false,
): () => void {
  if (!playOnce && win.matchMedia("(prefers-reduced-motion: reduce)").matches)
    return () => undefined;
  const doc = win.document;
  const words = PAGE_WORDS[scene.lang];
  const scoreChart = `svg.ui-chart[aria-label="${words.scoreChart}"]`;
  // A suspended workspace tab retains its DOM while another page is on screen. An element in the
  // workbench's frame is styled by the frame's own window.
  const available = (element: Element) =>
    !element.closest("[inert]") &&
    element.getClientRects().length > 0 &&
    (element.ownerDocument.defaultView ?? win).getComputedStyle(element).visibility !== "hidden";
  const shownIn = <T extends Element>(
    root: Document | Element,
    selector: string,
    matches?: (element: T) => boolean,
  ) =>
    [...root.querySelectorAll<T>(selector)].find(
      (element) => available(element) && (!matches || matches(element)),
    );
  const shown = <T extends Element>(selector: string, matches?: (element: T) => boolean) =>
    shownIn<T>(doc, selector, matches);
  /** The workbench page's document in a shown frame, once it has rendered its root. */
  const workbenchPage = (selector = WORKBENCH_FRAME) => {
    const frame = shown<HTMLIFrameElement>(selector);
    const page = frame?.contentDocument;
    return frame && page?.getElementById("root")?.childElementCount ? { frame, page } : undefined;
  };
  const letters = Array.from(scene.prompt);
  const setValue = Object.getOwnPropertyDescriptor(
    win.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  let visible = false;
  let stopped = false;
  let sent = false;
  let resultSessionId: string | undefined;
  let destination: "result" | "center" | "window" | "chart" | "comparison" | "replay" | "restart" =
    "result";
  /** The workbench documents a reader's input there also takes the walkthrough over in. */
  const watched = new Set<Document>();
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
    for (const target of [doc, ...watched]) {
      target.removeEventListener("pointerdown", takeOver, true);
      target.removeEventListener("keydown", takeOver, true);
      target.removeEventListener("input", takeOver, true);
    }
    watched.clear();
    win.removeEventListener("pagehide", stop);
    playback.setPaused(false);
  };
  const takeOver = (event: Event) => {
    if (event.isTrusted) stop();
  };
  /** The page's own events stay in its frame: listen there too, as on the app's document. */
  const watchPage = (page: Document) => {
    if (playOnce || watched.has(page)) return;
    watched.add(page);
    page.addEventListener("pointerdown", takeOver, true);
    page.addEventListener("keydown", takeOver, true);
    page.addEventListener("input", takeOver, true);
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
  /** Scrolls the chart's nearest scroller, inside its own document, to bring it into view. */
  const revealChart = (chart: Element, center = false) => {
    const page = chart.ownerDocument;
    const view = page.defaultView ?? win;
    const rect = chart.getBoundingClientRect();
    const bring = (scroller: Element, top: number, bottom: number) => {
      if (center || rect.top < top + 48 || rect.bottom > bottom - 16)
        scroller.scrollTop +=
          rect.top - top - Math.max(64, (scroller.clientHeight - rect.height) / 2);
    };
    for (
      let parent = chart.parentElement;
      parent && parent !== page.body;
      parent = parent.parentElement
    ) {
      if (
        parent.scrollHeight > parent.clientHeight &&
        /auto|scroll/.test(view.getComputedStyle(parent).overflowY)
      ) {
        const box = parent.getBoundingClientRect();
        bring(parent, box.top, box.bottom);
        return;
      }
    }
    // No scroller of its own: the frame's document scrolls.
    const root = page.scrollingElement;
    if (root && root.scrollHeight > root.clientHeight) bring(root, 0, view.innerHeight);
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
      // Open the default Agent's Self-Evolution Workbench from its App Center tile.
      const tile = shown<HTMLButtonElement>('li[data-app="default_agent/benchmark"] > button');
      const appCenter = shown<HTMLAnchorElement>('a[href="/apps"]');
      if (tile) {
        destination = "window";
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
    } else if (destination === "window") {
      // The window is open once its page lists the round's Benchmark: open its card.
      const shownPage = workbenchPage();
      const card =
        shownPage &&
        shownIn<HTMLButtonElement>(shownPage.page, "li button", (candidate) =>
          Boolean(candidate.textContent?.includes(scene.benchmarkTitle)),
        );
      if (shownPage && card) {
        watchPage(shownPage.page);
        destination = "chart";
        card.click();
      }
      timer = playback.schedule(advance, FRAME_POLL_MS);
    } else if (destination === "chart") {
      const shownPage = workbenchPage();
      const chart = shownPage && shownIn(shownPage.page, scoreChart);
      if (!shownPage || !chart) {
        timer = playback.schedule(advance, FRAME_POLL_MS);
        return;
      }
      revealChart(chart);
      if (playOnce) {
        // Drag this round's conversation from its workspace group beside its chart.
        const session = shown<HTMLElement>(
          "[data-session-id]",
          (row) => row.dataset.sessionId === resultSessionId,
        )?.closest<HTMLElement>('[draggable="true"]');
        const pane = shownPage.frame.closest<HTMLElement>(
          '[data-workspace-page][data-pane="full"]',
        );
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
    } else if (destination === "comparison") {
      // The narrower dock lays the chart out in a different scrolling viewport.
      const shownPage = workbenchPage(`[data-pane="right"] ${WORKBENCH_FRAME}`);
      const chart = shownPage && shownIn(shownPage.page, scoreChart);
      if (chart) {
        revealChart(chart, true);
        stop();
      } else {
        timer = playback.schedule(advance, FRAME_POLL_MS);
      }
    } else if (destination === "replay") {
      // Real Agent apps retain their page across visits. Leave the list ready for the next round.
      const shownPage = workbenchPage();
      if (shownPage) {
        shownIn<HTMLButtonElement>(
          shownPage.page,
          "button",
          (button) => button.textContent?.trim() === words.backToList,
        )?.click();
      }
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
