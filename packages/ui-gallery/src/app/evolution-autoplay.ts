/** Types into the real composer and sends once, when its embedded window becomes visible. */
import { S } from "../../../web/src/lib/strings";

export function installEvolutionAutoplay(
  win: Window & typeof globalThis,
  prompt: string,
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
  let sent = false;
  let index = 0;
  let timer: number | undefined;

  const cancelTimer = () => {
    win.clearTimeout(timer);
    timer = undefined;
  };
  const stop = () => {
    stopped = true;
    cancelTimer();
    visibility.disconnect();
    changes.disconnect();
    doc.removeEventListener("visibilitychange", queue);
    doc.removeEventListener("pointerdown", takeOver, true);
    doc.removeEventListener("keydown", takeOver, true);
    doc.removeEventListener("input", takeOver, true);
    win.removeEventListener("pagehide", stop);
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
      timer = win.setTimeout(tick, index === letters.length ? 700 : 2200 / letters.length);
      return;
    }
    const button = [...input.closest('[data-slot="composer"]')!.querySelectorAll("button")].find(
      (candidate) => candidate.getAttribute("aria-label") === S.chat.send,
    );
    if (!button || button.disabled) {
      timer = win.setTimeout(tick, 100);
      return;
    }
    sent = true;
    button.click();
  };
  function queue() {
    if (sent) {
      const running = [...doc.querySelectorAll('[data-slot="composer"] button')].some(
        (button) => button.getAttribute("aria-label") === S.chat.stop,
      );
      if (!stopped && !running && doc.querySelector("main table")) {
        // The app opens its Agents panel during parallel evaluation; return the space to the result.
        doc.querySelector<HTMLButtonElement>('[data-testid="dock-tab-close"]')?.click();
        stop();
      }
      return;
    }
    if (!visible || doc.hidden) {
      cancelTimer();
      return;
    }
    if (!stopped && timer === undefined) timer = win.setTimeout(tick, index === 0 ? 800 : 50);
  }
  const changes = new win.MutationObserver(queue);
  changes.observe(doc.documentElement, { childList: true, subtree: true });
  const visibility = new win.IntersectionObserver(
    ([entry]) => {
      visible = entry?.isIntersecting === true && entry.intersectionRatio >= 0.25;
      queue();
    },
    { threshold: [0, 0.25] },
  );
  visibility.observe(doc.documentElement);
  doc.addEventListener("visibilitychange", queue);
  doc.addEventListener("pointerdown", takeOver, true);
  doc.addEventListener("keydown", takeOver, true);
  doc.addEventListener("input", takeOver, true);
  win.addEventListener("pagehide", stop, { once: true });
  return stop;
}
