/**
 * Where a click landed, for the node suite, which has no DOM.
 *
 * Code that decides what a click meant reads two things off the elements involved: `closest`
 * (which control, if any, the click landed in) and `contains` (whether that is inside the element
 * handling it). A {@link FakeElement} knows its tag, its attributes and its parent, which is all
 * both need; `closest` understands the selector shapes the app's decisions are written in — a
 * tag, `[attr]` or `[attr='value']`, a tag with one of those, and comma-separated lists of them.
 * A suite that needs React to commit and the events to run for real uses the live DOM in
 * `dom.ts` instead.
 */

export interface FakeElement {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly parent: FakeElement | null;
  closest(selector: string): FakeElement | null;
  contains(node: unknown): boolean;
}

function matchesOne(element: FakeElement, selector: string): boolean {
  const parsed = /^([a-z][a-z0-9-]*)?(?:\[([a-z-]+)(?:='([^']*)')?\])?$/.exec(selector.trim());
  if (parsed === null) throw new Error(`fake DOM: unsupported selector "${selector}"`);
  const [, tag, attr, value] = parsed;
  if (tag !== undefined && tag !== element.tag) return false;
  if (attr !== undefined && !(attr in element.attrs)) return false;
  if (attr !== undefined && value !== undefined && element.attrs[attr] !== value) return false;
  return tag !== undefined || attr !== undefined;
}

/** An element with `attrs`, inside `parent` (null: a root, as a portal's content is under body). */
export function fakeElement(
  tag: string,
  attrs: Record<string, string> = {},
  parent: FakeElement | null = null,
): FakeElement {
  const element: FakeElement = {
    tag,
    attrs,
    parent,
    closest(selector) {
      const alternatives = selector.split(",");
      for (let node: FakeElement | null = element; node !== null; node = node.parent) {
        const candidate = node;
        if (alternatives.some((one) => matchesOne(candidate, one))) return candidate;
      }
      return null;
    },
    contains(node) {
      for (let at = node as FakeElement | null; at !== null && at !== undefined; at = at.parent) {
        if (at === element) return true;
      }
      return false;
    },
  };
  return element;
}

/** A click event as a handler on `currentTarget` sees it after landing on `target`. */
export function clickOn(target: FakeElement, currentTarget: FakeElement) {
  return { target, currentTarget } as never;
}

/** A keydown as a handler on `currentTarget` sees it, for a key pressed while `target` has focus. */
export function keyOn(key: string, target: FakeElement, currentTarget: FakeElement) {
  let prevented = false;
  const event = {
    key,
    target,
    currentTarget,
    preventDefault: () => {
      prevented = true;
    },
  };
  return { event: event as never, prevented: () => prevented };
}
