/** Native book reader DOM adapter staged into generated book modules. */
export const bookReaderViewTemplate = String.raw`
import { htmlToElement } from 'waf-utils';
import { Interactable, inputEventTypes } from 'input-manager-system';

export type BookViewMode = 'readAlong' | 'decodable';

export type BookViewScene = {
  id: string;
  role?: 'cover' | 'title' | 'story';
  pageNumber?: number | null;
  media?: {
    image?: { key?: string; alt?: string } | null;
    narration?: { key: string; script?: string } | null;
    audioCues?: readonly { key: string }[];
  };
};

export type BookViewControl = 'previous' | 'next' | 'narration';

export type BookControlState = {
  visible: boolean;
  enabled: boolean;
  active?: boolean;
};

const PAGE_TURN_FALLBACK_MS = 540;
const VISIBLE_WORD = /[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu;

export type BookReaderView = {
  readonly pageElement: HTMLElement;
  showPage(scene: BookViewScene, direction: 'forward' | 'backward' | null): void;
  setNarrationHighlight(occurrence: number | null): void;
  setControls(controls: Readonly<Partial<Record<BookViewControl, BookControlState>>>): void;
  setReaderState(state: string): void;
  announce(message: string): void;
  dispose(): void;
};

function sceneAnnouncement(scene: BookViewScene): string {
  if (scene.role === 'cover') return 'Cover page';
  if (scene.role === 'title') return 'Title page';
  if (typeof scene.pageNumber === 'number') return 'Page ' + scene.pageNumber;
  return 'Story page';
}

function controlLabel(control: BookViewControl): string {
  if (control === 'previous') return 'Previous page';
  if (control === 'next') return 'Next page';
  return 'Play or pause narration';
}

const CONTROL_GLYPHS: Record<BookViewControl, string> = {
  previous: '\u2190',
  next: '\u2192',
  narration: '\u25B6',
};

export function createBookReaderView(options: {
  root: HTMLElement;
  scenes: readonly BookViewScene[];
  onControl(control: BookViewControl): void;
  onWord(occurrence: number): void;
  resolveImage?(key: string, className: string): HTMLElement | null;
  trackInteractable?(interactable: Interactable): void;
}): BookReaderView {
  const pageInteractables: Interactable[] = [];
  const interactables: Interactable[] = [];
  const controlInteractables: Record<BookViewControl, Interactable | null> = {
    previous: null,
    next: null,
    narration: null,
  };
  const controlElements: Partial<Record<BookViewControl, HTMLElement>> = {};
  let pageElement: HTMLElement | null = null;
  let wordElements: HTMLElement[] = [];
  let highlightedOccurrence: number | null = null;
  let disposed = false;
  let pageTurnCleanupTimer = 0;

  const readerRoot = htmlToElement('<div class="book-reader"></div>');
  readerRoot.setAttribute('data-book-reader', '');
  const readerCanvas = htmlToElement('<div class="book-canvas"></div>');
  const statusRegion = htmlToElement(
    '<div class="book-status" aria-live="polite" aria-atomic="true"></div>',
  );
  const controlRow = htmlToElement('<div class="book-controls"></div>');
  readerRoot.appendChild(readerCanvas);
  readerRoot.appendChild(controlRow);
  readerRoot.appendChild(statusRegion);
  options.root.appendChild(readerRoot);

  function track(interactable: Interactable, pageScoped: boolean): Interactable {
    interactables.push(interactable);
    if (pageScoped) pageInteractables.push(interactable);
    options.trackInteractable?.(interactable);
    return interactable;
  }

  function icon(key: string, className: string, fallback: string): HTMLElement {
    const image = options.resolveImage ? options.resolveImage(key, className) : null;
    if (image) return image;
    const glyph = htmlToElement('<span class="' + className + ' book-control-glyph"></span>');
    glyph.textContent = fallback;
    return glyph;
  }

  for (const control of ['previous', 'next', 'narration'] as const) {
    const element = htmlToElement(
      '<div class="book-control" role="button" tabindex="-1"></div>',
    );
    element.setAttribute('data-book-control', control);
    element.setAttribute('aria-label', controlLabel(control));
    if (control === 'narration') {
      element.appendChild(icon('book-narration-active', 'book-control-image--active', CONTROL_GLYPHS[control]));
      element.appendChild(icon('book-narration-inactive', 'book-control-image--inactive', CONTROL_GLYPHS[control]));
    } else {
      element.appendChild(icon('book-' + control + '-page', 'book-control-image--' + control, CONTROL_GLYPHS[control]));
    }
    const interactable = track(new Interactable(element, inputEventTypes.CLICK), false);
    interactable.onClick = () => {
      if (!element.classList.contains('is-disabled')) options.onControl(control);
    };
    controlInteractables[control] = interactable;
    controlElements[control] = element;
    controlRow.appendChild(element);
  }

  function releasePageInteractables(): void {
    const released = pageInteractables.splice(0);
    for (const interactable of released) interactable.dispose();
    for (let index = interactables.length - 1; index >= 0; index--) {
      if (released.includes(interactables[index]!)) interactables.splice(index, 1);
    }
  }

  function buildWords(container: HTMLElement, script: string): void {
    wordElements = [];
    let occurrence = 0;
    for (const paragraph of script.split(/\n+/)) {
      const trimmed = paragraph.trim();
      if (!trimmed) continue;
      const paragraphElement = htmlToElement('<p class="book-paragraph"></p>');
      let cursor = 0;
      for (const match of trimmed.matchAll(VISIBLE_WORD)) {
        const start = match.index ?? 0;
        if (start > cursor) paragraphElement.appendChild(document.createTextNode(trimmed.slice(cursor, start)));
        const text = match[0];
        const word = htmlToElement(
          '<span class="book-word" role="button" tabindex="-1"></span>',
        );
        word.setAttribute('data-book-word', '');
        word.setAttribute('data-book-word-occurrence', String(occurrence));
        word.setAttribute('aria-label', 'Read word ' + text);
        const wordText = htmlToElement('<span class="book-word-text"></span>');
        wordText.textContent = text;
        word.appendChild(wordText);
        const interactable = track(new Interactable(word, inputEventTypes.CLICK), true);
        interactable.onClick = () => options.onWord(Number(word.getAttribute('data-book-word-occurrence')));
        paragraphElement.appendChild(word);
        wordElements.push(word);
        occurrence += 1;
        cursor = start + text.length;
      }
      if (cursor < trimmed.length) {
        paragraphElement.appendChild(document.createTextNode(trimmed.slice(cursor)));
      }
      container.appendChild(paragraphElement);
    }
    container.setAttribute('data-book-text-layout', wordElements.length >= 60 ? 'dense' : 'standard');
  }

  function showPage(scene: BookViewScene, direction: 'forward' | 'backward' | null): void {
    if (disposed) return;
    const outgoing = pageElement;
    if (outgoing) {
      outgoing.setAttribute('data-book-page-motion', 'outgoing');
      outgoing.setAttribute('aria-hidden', 'true');
      outgoing.inert = true;
      const cleanup = () => {
        outgoing.remove();
        releasePageInteractables();
      };
      outgoing.addEventListener('animationend', cleanup, { once: true });
      window.clearTimeout(pageTurnCleanupTimer);
      pageTurnCleanupTimer = window.setTimeout(() => {
        outgoing.removeEventListener('animationend', cleanup);
        cleanup();
      }, PAGE_TURN_FALLBACK_MS);
    }
    if (direction && outgoing) readerRoot.setAttribute('data-book-turn', direction);
    else readerRoot.removeAttribute('data-book-turn');

    const page = htmlToElement('<article class="book-page"></article>');
    page.setAttribute('data-book-page', scene.id);
    page.setAttribute('data-book-page-role', scene.role ?? 'story');
    page.setAttribute('aria-label', sceneAnnouncement(scene));
    const face = htmlToElement('<div class="book-page-face book-page-face--front"></div>');
    page.appendChild(face);

    const imageRegion = htmlToElement('<div class="book-image-region"></div>');
    const image = options.resolveImage
      ? options.resolveImage(scene.media?.image?.key ?? '', 'book-page-image')
      : null;
    if (image) {
      if (scene.media?.image?.alt) image.setAttribute('alt', scene.media.image.alt);
      imageRegion.appendChild(image);
    } else {
      imageRegion.setAttribute('aria-hidden', 'true');
    }
    face.appendChild(imageRegion);

    if (scene.role === 'story' && scene.media?.narration?.script) {
      const text = htmlToElement('<div class="book-page-text"></div>');
      buildWords(text, scene.media.narration.script);
      face.appendChild(text);
    }
    if (typeof scene.pageNumber === 'number') {
      const pageNumber = htmlToElement('<div class="book-page-number"></div>');
      pageNumber.textContent = String(scene.pageNumber);
      face.appendChild(pageNumber);
    }

    page.setAttribute('data-book-page-motion', 'incoming');
    readerCanvas.appendChild(page);
    pageElement = page;
    setNarrationHighlight(null);
    announce(sceneAnnouncement(scene));
  }

  function setNarrationHighlight(occurrence: number | null): void {
    if (highlightedOccurrence !== null && wordElements[highlightedOccurrence]) {
      wordElements[highlightedOccurrence]!.classList.remove('is-highlighted');
    }
    highlightedOccurrence = occurrence;
    if (occurrence === null) return;
    const word = wordElements[occurrence];
    if (!word) return;
    word.classList.add('is-highlighted');
  }

  function applyControl(control: BookViewControl, state: BookControlState | undefined): void {
    const element = controlElements[control];
    const interactable = controlInteractables[control];
    if (!element || !interactable) return;
    element.classList.toggle('is-book-control-visible', state?.visible !== false);
    element.setAttribute('aria-hidden', state?.visible === false ? 'true' : 'false');
    if (state && state.visible !== false && state.enabled) {
      element.classList.remove('is-disabled');
      element.removeAttribute('aria-disabled');
      interactable.unlock();
    } else {
      element.classList.add('is-disabled');
      element.setAttribute('aria-disabled', 'true');
      interactable.lock();
    }
    if (control === 'narration') {
      const active = state?.active === true;
      element.setAttribute('data-book-control-active', active ? 'true' : 'false');
    }
  }

  function setControls(controls: Readonly<Partial<Record<BookViewControl, BookControlState>>>): void {
    if (disposed) return;
    for (const control of ['previous', 'next', 'narration'] as const) {
      applyControl(control, controls[control]);
    }
  }

  function setReaderState(state: string): void {
    if (disposed) return;
    readerRoot.setAttribute('data-book-state', state);
  }

  let announceTimer = 0;
  function announce(message: string): void {
    if (disposed) return;
    statusRegion.textContent = '';
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      if (!disposed) statusRegion.textContent = message;
    }, 0);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(announceTimer);
    window.clearTimeout(pageTurnCleanupTimer);
    for (const interactable of interactables.splice(0)) interactable.dispose();
    pageInteractables.length = 0;
    readerRoot.remove();
  }

  return {
    get pageElement() {
      if (!pageElement) throw new Error('Book reader view has no page rendered yet.');
      return pageElement;
    },
    showPage,
    setNarrationHighlight,
    setControls,
    setReaderState,
    announce,
    dispose,
  };
}
`;
