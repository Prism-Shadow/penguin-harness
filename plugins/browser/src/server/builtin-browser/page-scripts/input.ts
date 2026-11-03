/**
 * The page side of the trusted-input actions. The input itself is CDP (`Input.*`), which the
 * page cannot tell from a person's; these scripts only find where it goes: the element a click
 * lands on, scrolled into view, and the field typing goes into, focused. JavaScript SOURCE
 * STRINGS, for the reason simplify.ts gives; selectors travel as JSON strings.
 */

/** The text a clicked element is reported by: what a person would read on it, short. */
const LABEL_OF = String.raw`function __penguinLabelOf(el) {
  if (!el) return '';
  const text = el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || '';
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 80);
}`;

/**
 * Scrolls the `index`th match of `selector` to the middle of the viewport and resolves the
 * centre of its box, in the CSS pixels CDP's mouse events take. Throws when nothing matches or
 * the element has no size, so a click never lands on a guess.
 */
export function clickTargetScript(selector: string, index: number): string {
  return `${LABEL_OF}
const sel = ${JSON.stringify(selector)};
const index = ${JSON.stringify(index)};
const matches = document.querySelectorAll(sel);
const el = matches[index];
if (!el) throw new Error(matches.length === 0 ? 'No element matches ' + sel : matches.length + ' elements match ' + sel + '; there is no index ' + index);
el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
await new Promise((resolve) => setTimeout(resolve, 60));
const rect = el.getBoundingClientRect();
if (rect.width < 1 || rect.height < 1) throw new Error('The element matching ' + sel + ' has no size on the page (hidden?)');
return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), tag: el.tagName.toLowerCase(), text: __penguinLabelOf(el) };`;
}

/** What is at a viewport point, for a click by coordinates. */
export function pointTargetScript(x: number, y: number): string {
  return `${LABEL_OF}
const el = document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)});
return el ? { tag: el.tagName.toLowerCase(), text: __penguinLabelOf(el) } : {};`;
}

/**
 * Focuses the field typing goes into and selects what it holds, so the text replaces it —
 * a form is filled, not appended to. Throws when nothing matches or focus does not land.
 */
export function focusScript(selector: string): string {
  return String.raw`const sel = ${JSON.stringify(selector)};
const el = document.querySelector(sel);
if (!el) throw new Error('No element matches ' + sel);
el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
el.focus();
const active = document.activeElement;
if (active !== el && !el.contains(active)) throw new Error('The element matching ' + sel + ' cannot take focus');
if (typeof el.select === 'function') el.select();
else if (el.isContentEditable) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}
return { tag: el.tagName.toLowerCase() };`;
}

/**
 * After inserted text: input and change on the focused element, for controlled components
 * that only take a value from events (the SOP's note on CDP insertText).
 */
export const DISPATCH_INPUT_EVENTS_SCRIPT = String.raw`const el = document.activeElement;
if (!el || el === document.body || el === document.documentElement) return false;
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
return true;`;
