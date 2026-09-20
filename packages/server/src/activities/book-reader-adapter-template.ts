/** Framework-free glue between the generated book model, view and native media. */
export const bookReaderAdapterTemplate = String.raw`
import type { BookReaderController } from './controller.js';

export type NarrationTiming = { start: number; end: number };

export type AdapterNarration = {
  key: string;
  script?: string;
  timings?: readonly unknown[];
  words?: readonly unknown[];
} | null | undefined;

export type AdapterScene = {
  id: string;
  media?: {
    narration?: AdapterNarration;
    audioCues?: readonly { key: string }[];
  };
};

export type TimedEvent = { id: string; time: number };

const VISIBLE_WORD = /[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu;

function countVisibleWords(text: string | undefined): number {
  if (!text) return 0;
  const matches = text.match(VISIBLE_WORD);
  return matches ? matches.length : 0;
}

function wholeWordTiming(word: unknown): NarrationTiming | null {
  if (!word || typeof word !== 'object') return null;
  const timing = (word as Record<string, unknown>).wholeWordTiming;
  if (!timing || typeof timing !== 'object') return null;
  return numericTiming(timing as Record<string, unknown>);
}

function numericTiming(value: Record<string, unknown>): NarrationTiming | null {
  const start = value.start;
  const end = value.end;
  if (typeof start !== 'number' || !Number.isFinite(start)) return null;
  if (typeof end !== 'number' || !Number.isFinite(end)) return null;
  if (end < start) return null;
  return { start, end };
}

function narrationTimingAt(narration: NonNullable<AdapterNarration>, occurrence: number): NarrationTiming | null {
  const timings = Array.isArray(narration.timings) ? narration.timings : [];
  const fromTimings = timings[occurrence];
  if (fromTimings && typeof fromTimings === 'object') {
    const timing = numericTiming(fromTimings as Record<string, unknown>);
    if (timing) return timing;
  }
  const words = Array.isArray(narration.words) ? narration.words : [];
  return wholeWordTiming(words[occurrence]);
}

/**
 * Word highlight events in integer milliseconds, compiled only from timings
 * that the configuration actually carries. A book without real timings compiles
 * zero events: playback runs without highlighting, and nothing may be invented.
 * Occurrences beyond the narration's visible word count are dropped because the
 * view cannot highlight a word it never rendered.
 */
export function narrationEventsFromScene(scene: AdapterScene): TimedEvent[] {
  const narration = scene.media?.narration;
  if (!narration) return [];
  const limit = countVisibleWords(narration.script);
  if (limit <= 0) return [];
  const events: TimedEvent[] = [];
  for (let occurrence = 0; occurrence < limit; occurrence++) {
    const timing = narrationTimingAt(narration, occurrence);
    if (!timing) continue;
    events.push({ id: 'word-start:' + occurrence, time: Math.round(timing.start * 1000) });
    events.push({ id: 'word-end:' + occurrence, time: Math.round(timing.end * 1000) });
  }
  const rank = (event: TimedEvent): number => (event.id.indexOf('word-start:') === 0 ? 0 : 1);
  return events.sort((first, second) => first.time - second.time || rank(first) - rank(second));
}

/** Audio keys for a scene in playback order: cue list first, narration as the single fallback. */
export function cueKeysForScene(scene: AdapterScene): string[] {
  const cues = scene.media?.audioCues;
  if (Array.isArray(cues) && cues.length) {
    return cues.map((cue) => cue.key).filter((key) => typeof key === 'string' && key.length > 0);
  }
  const narration = scene.media?.narration;
  return narration && narration.key ? [narration.key] : [];
}

export type BookReaderLifecycle = {
  complete(): void;
  teardown(): void;
};

/**
 * Wires the coordinator into the framework's pause/resume events and the
 * page's eventual disappearance. Teardown disposes the controller first so
 * every outstanding operation and timer is rejected before subscriptions go.
 */
export function connectBookReaderLifecycle(options: {
  controller: Pick<BookReaderController, 'frameworkPause' | 'frameworkResume' | 'dispose'>;
  pauseEvent: string;
  resumeEvent: string;
  subscribe(event: string, listener: () => void): unknown;
  unsubscribe(event: string, listener: (...payload: unknown[]) => void): void;
  registerPagehide(handler: () => void): void;
  onComplete?(): void;
}): BookReaderLifecycle {
  let completed = false;
  let tornDown = false;

  const pauseListener = () => options.controller.frameworkPause();
  const resumeListener = () => options.controller.frameworkResume();
  options.subscribe(options.pauseEvent, pauseListener);
  options.subscribe(options.resumeEvent, resumeListener);
  options.registerPagehide(() => lifecycle.teardown());

  const lifecycle: BookReaderLifecycle = {
    complete() {
      if (completed || tornDown) return;
      completed = true;
      options.onComplete?.();
    },
    teardown() {
      if (tornDown) return;
      tornDown = true;
      options.controller.dispose();
      options.unsubscribe(options.pauseEvent, pauseListener);
      options.unsubscribe(options.resumeEvent, resumeListener);
    },
  };
  return lifecycle;
}
`;
