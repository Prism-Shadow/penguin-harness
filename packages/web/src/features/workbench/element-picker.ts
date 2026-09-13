/**
 * The element picker that runs inside the user's page, and the host's half of the channel it talks
 * over.
 *
 * The picker is a script, not a module: it is serialized and handed to the guest with
 * `webview.executeJavaScript` (the main world, which the page's CSP cannot keep us out of — M1/E2,
 * E3), so `installWorkbenchPicker` must be self-contained. It imports nothing, and everything it
 * shares with the panel — the label it paints over the element, the facts it reports — is written out
 * below rather than reached for, because a reference to this module's scope would not survive the
 * serialization.
 *
 * Everything the picker reports travels back over `console-message` (M1/E4a: the one channel measured
 * to work without a host preload). Messages are one JSON object per console line behind a fixed
 * prefix, and the host drops every line that does not parse — a page may log whatever it likes, and
 * its own console output must not be mistaken for ours.
 *
 * What the picker may do is bounded on purpose (PRD FR-10): it reads the DOM and reports facts. It
 * never fetches, never resolves a source map, and never touches the page's own state — the only things
 * it changes are the highlight box it owns and the clicks it swallows while the user is picking.
 * Locating the element in the user's source is split accordingly: the guest asks the page's framework
 * *what module it is in and where* (`framework-sniffer.ts`, handed in here as an argument so it
 * travels in the same script), and the host resolves the module text and its source map.
 */
import type { OriginEvidence } from "./framework-sniffer";
import { sniffScript } from "./framework-sniffer";

/** The console prefix that marks a picker message. Kept ASCII and unlikely: it travels through the page's console. */
export const PICKER_CHANNEL = "penguin-workbench";

/** The guest global the injected API hangs off, and the id of the highlight box it owns. */
const PICKER_KEY = "__penguinWorkbenchPicker";

/**
 * Where the pointer actually was, in the two cases the light DOM cannot say it (PRD §9.4's unsupported
 * structures, M4.4):
 *
 * - `"shadow"` — the point was inside an **open** shadow root, and the element reported is the shadow
 *   **host** the document's own tree holds (`document.elementFromPoint` does not enter a shadow tree).
 *   The host is a real element of the user's page and its location is a true answer to "what did I just
 *   click", but it is *not* the element under the cursor, and L1 does not promise to pierce the root
 *   (PRD §2.3) — so the panel has to say which of the two it handed over.
 * - `"frame"` — the element **is** an `<iframe>`, whose interior is a separate document the injected
 *   picker was never installed into. The element is reported truthfully; what cannot be reached is
 *   everything inside it.
 *
 * Absent means the ordinary case: the element is the thing under the pointer, in the document the
 * picker runs in. A closed shadow root is indistinguishable from an ordinary host here — nothing can
 * tell it apart, which is itself the honest answer.
 */
export type DomContext = "shadow" | "frame";

/**
 * What the picker knows about an element — the DOM half of the frozen payload (§6), gathered where
 * the DOM is. The source half (`source.*`) is the host's business (M3): the picker never resolves a
 * source map.
 */
export interface ElementFacts {
  tagName: string;
  id: string | null;
  classList: string[];
  /** A DOM path valid for this page as it is right now. Not a promise (see the payload's note). */
  cssSelector: string;
  /** The explicit `role`, or a small implied table — `null` when we cannot say, never a guess. */
  role: string | null;
  /** An accessible-name approximation: `aria-label`, then `aria-labelledby`, then text/alt/title. */
  name: string | null;
  /** `data-testid` and its two common spellings — the payload's second anchor (FR-06). */
  testId: string | null;
  /** The raw attributes worth keeping: `class`, and `id` when there is one. */
  attributes: Record<string, string>;
  /** Visible text, whitespace collapsed, cut to the payload's 200 characters. */
  text: string;
  /** A curated set of computed properties — what the element looks like right now, in Chromium's terms. */
  computed: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  /** Up to three ancestors, nearest first, described as the selector would describe them. */
  parentChain: string[];
  /**
   * What the page's framework said about where this element is written — present on a **selection**
   * only, because the React 18 route carries the component's compiled text, and a hover message that
   * size would be paid for on every element the cursor crosses.
   */
  origin?: OriginEvidence | null;
  /** Set only when the element is not the thing under the pointer (M4.4): a shadow host, an iframe. */
  domContext?: DomContext;
}

/** Where the element was found — the page half of the payload, read at pick time so it is never stale. */
export interface PageFacts {
  url: string;
  title: string;
  viewport: { width: number; height: number; dpr: number };
}

export type PickerMessage =
  | { kind: "installed" }
  | { kind: "active" }
  | { kind: "paused" }
  | { kind: "stopped" }
  | { kind: "hover"; target: ElementFacts; page: PageFacts }
  | { kind: "selected"; target: ElementFacts; page: PageFacts }
  | { kind: "cleared" }
  | { kind: "exited" };

/**
 * The script injected into the guest. Called with the channel, so the host's copy and the guest's copy
 * cannot drift apart.
 *
 * The highlight is a `position: fixed` box with `pointer-events: none`: it cannot affect the page's
 * layout (PRD §7 pins hover highlighting to rAF so the user's page does not stutter), and it cannot
 * become the element under the cursor. Hover is coalesced to one lookup per frame and reported only
 * when the element under the cursor changes — a page's console should not receive 60 lines a second.
 *
 * While picking, mousedown/mouseup/click are swallowed in the capture phase at the document: that is
 * what keeps the next click from following a link or submitting a form (FR-02). Nothing else of the
 * page's is touched — Esc in particular is left alone, because the page has its own Esc (closing its
 * own modal) and the picker's job is to take clicks, not keys. `暂离` is the answer when the user needs
 * the page itself.
 */
function installWorkbenchPicker(channel: string, sniffOrigin: (el: Element) => unknown): string {
  const key = "__penguinWorkbenchPicker";
  const previous = (window as unknown as Record<string, { teardown?: () => void }>)[key];
  if (previous && typeof previous.teardown === "function") previous.teardown();

  const send = (message: unknown): void => {
    console.log(channel + " " + JSON.stringify(message));
  };

  const state = {
    active: false,
    hovered: null as Element | null,
    selected: null as Element | null,
  };
  let lastX = 0;
  let lastY = 0;
  let frame = 0;

  const classes = (el: Element, max: number): string[] => Array.from(el.classList).slice(0, max);

  const described = (el: Element): string => {
    return (
      el.tagName.toLowerCase() +
      (el.id ? "#" + el.id : "") +
      classes(el, 3)
        .map((c) => "." + c)
        .join("")
    );
  };

  /** A short DOM path. `:nth-of-type` appears only where siblings of the same tag would make it ambiguous. */
  const selector = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (
      node !== null &&
      node.nodeType === 1 &&
      node !== document.documentElement &&
      parts.length < 6
    ) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(part + "#" + node.id);
        break;
      }
      const own = classes(node, 2);
      if (own.length > 0) part += own.map((c) => "." + c).join("");
      const parent = node.parentElement;
      if (parent !== null) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (sameTag.length > 1) part += ":nth-of-type(" + (sameTag.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };

  // A deliberately small implied-role table: the common cases a design workbench meets, and nothing
  // invented. An element we cannot name a role for reports `null` rather than a guess.
  const impliedRoles: Record<string, string> = {
    article: "article",
    aside: "complementary",
    button: "button",
    dialog: "dialog",
    fieldset: "group",
    figure: "figure",
    footer: "contentinfo",
    form: "form",
    h1: "heading",
    h2: "heading",
    h3: "heading",
    h4: "heading",
    h5: "heading",
    h6: "heading",
    header: "banner",
    img: "img",
    li: "listitem",
    main: "main",
    nav: "navigation",
    ol: "list",
    option: "option",
    progress: "progressbar",
    select: "combobox",
    summary: "button",
    table: "table",
    textarea: "textbox",
    ul: "list",
  };

  const roleOf = (el: Element): string | null => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.trim() || null;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : null;
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "button" || type === "submit" || type === "reset") return "button";
      return "textbox";
    }
    return impliedRoles[tag] || null;
  };

  /** An approximation of the accessible name, in the order the real algorithm looks. */
  const nameOf = (el: Element): string | null => {
    const clean = (value: string | null): string | null => {
      const text = (value || "").replace(/\s+/g, " ").trim();
      return text ? text.slice(0, 200) : null;
    };
    const label = clean(el.getAttribute("aria-label"));
    if (label) return label;
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => {
          const target = document.getElementById(id);
          return target === null ? "" : target.textContent || "";
        })
        .join(" ");
      const named = clean(parts);
      if (named) return named;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === "img") return clean(el.getAttribute("alt"));
    if (tag === "input") {
      const value = clean((el as HTMLInputElement).value);
      const placeholder = clean(el.getAttribute("placeholder"));
      return value || placeholder || clean(el.getAttribute("title"));
    }
    return clean(el.textContent) || clean(el.getAttribute("title"));
  };

  /**
   * What the element looks like right now — the half of the payload a style change is written from.
   * A curated list, not the ~340 properties a computed style holds: this is read by a person and by
   * a model, and dumping everything would bury the six values that matter. Values are Chromium's
   * own strings, untouched.
   */
  const computedProperties = [
    "display",
    "position",
    "width",
    "height",
    "margin",
    "padding",
    "gap",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "color",
    "background-color",
    "border",
    "border-radius",
    "box-shadow",
    "text-align",
    "flex-direction",
    "justify-content",
    "align-items",
    "grid-template-columns",
    "opacity",
    "overflow",
    "z-index",
  ];

  const computedOf = (el: Element): Record<string, string> => {
    const style = getComputedStyle(el);
    const computed: Record<string, string> = {};
    for (const property of computedProperties) {
      const value = style.getPropertyValue(property);
      // An empty answer means the property does not apply here, not that its value is empty:
      // report nothing rather than "".
      if (value) computed[property] = value;
    }
    return computed;
  };

  /**
   * The element under a point, and the deepest node actually there.
   *
   * `document.elementFromPoint` looks at the document's own tree and stops at a shadow host, so the two
   * answers differ exactly when the point is inside an open shadow root. Descending with each host's own
   * `shadowRoot.elementFromPoint` recovers the node the user's cursor is really over (M4.4) — up to a
   * few levels, since a nested component is still a shadow root and a loop of them is a page bug, not a
   * structure to chase. A closed root has no `shadowRoot` to descend into, which is why the answer for
   * one is indistinguishable from an ordinary host.
   */
  const at = (x: number, y: number): { el: Element | null; deep: Element | null } => {
    const el = document.elementFromPoint(x, y);
    if (el === null) return { el: null, deep: null };
    let deep: Element = el;
    for (let level = 0; level < 8; level += 1) {
      const root = deep.shadowRoot;
      if (!root) break;
      const inner = root.elementFromPoint(x, y);
      if (inner === null || inner === deep) break;
      deep = inner;
    }
    return { el: el, deep: deep };
  };

  /**
   * Which of §9.4's unsupported structures the pointer was in, if either. An `<iframe>` is answered by
   * the tag itself (the element is right, its interior is another document); a shadow root is answered
   * by the deepest node's own root — the host we report lives in the document, and the node under the
   * cursor does not.
   */
  const contextOf = (el: Element | null, deep: Element | null): string => {
    if (el === null) return "open";
    const tag = el.tagName.toLowerCase();
    if (tag === "iframe" || tag === "frame") return "frame";
    if (deep !== null && typeof deep.getRootNode === "function") {
      const root = deep.getRootNode();
      if (root !== null && root !== document) return "shadow";
    }
    return "open";
  };

  /**
   * The same answer without a pointer to consult (M4.1's re-read): the element itself has to carry the
   * fact. A host with an open root still says what it is, and an `<iframe>` says it by its tag; anything
   * else is ordinary. Refresh can therefore never *gain* a context the pick did not have — it can only
   * reproduce it, which is what a re-read is for.
   */
  const contextOfElement = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    if (tag === "iframe" || tag === "frame") return "frame";
    if (el.shadowRoot) return "shadow";
    return "open";
  };

  /**
   * The element's facts. `withOrigin` is false for a hover: the origin evidence can carry a
   * component's compiled text (React 18), and paying that per hovered element is exactly the kind of
   * quiet cost a console channel should not carry. The selection is where it is needed.
   */
  const facts = (el: Element, withOrigin?: boolean, context?: string): unknown => {
    const rect = el.getBoundingClientRect();
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200);
    const attributes: Record<string, string> = {};
    const classAttribute = el.getAttribute("class");
    if (classAttribute) attributes["class"] = classAttribute;
    if (el.id) attributes["id"] = el.id;
    const testId =
      el.getAttribute("data-testid") ||
      el.getAttribute("data-test-id") ||
      el.getAttribute("data-test") ||
      null;
    const parentChain: string[] = [];
    let parent = el.parentElement;
    while (parent !== null && parent !== document.documentElement && parentChain.length < 3) {
      parentChain.push(described(parent));
      parent = parent.parentElement;
    }
    const out: Record<string, unknown> = {
      tagName: el.tagName.toLowerCase(),
      id: el.id ? el.id : null,
      classList: classes(el, 6),
      cssSelector: selector(el),
      role: roleOf(el),
      name: nameOf(el),
      testId: testId,
      attributes: attributes,
      text: text,
      computed: computedOf(el),
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      parentChain: parentChain,
    };
    // Assigned after the literal rather than spread into it: this function is serialized with
    // `toString()`, so it must contain no syntax a bundler might lower into a helper from module scope.
    if (withOrigin === true) out.origin = sniffOrigin(el);
    if (context === "shadow" || context === "frame") out.domContext = context;
    return out;
  };

  /** Read at pick time, so a route change between two picks cannot leave the payload saying otherwise. */
  const pageFacts = (): unknown => ({
    url: location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    },
  });

  const box = document.createElement("div");
  box.setAttribute("data-penguin-workbench", "overlay");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText =
    "position:fixed;left:0;top:0;width:0;height:0;display:none;pointer-events:none;" +
    "box-sizing:border-box;border:2px solid #3b82f6;background:rgba(59,130,246,0.18);" +
    "border-radius:2px;margin:0;padding:0;z-index:2147483647;transition:none";
  const label = document.createElement("span");
  label.style.cssText =
    "position:absolute;left:-2px;max-width:320px;padding:1px 5px;white-space:nowrap;overflow:hidden;" +
    "text-overflow:ellipsis;font:11px/16px ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;" +
    "background:#3b82f6;border-radius:2px";
  box.appendChild(label);

  const paint = (el: Element, locked: boolean): void => {
    if (!el.isConnected) {
      hide();
      return;
    }
    const rect = el.getBoundingClientRect();
    const colour = locked ? "#10b981" : "#3b82f6";
    box.style.display = "block";
    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    box.style.width = rect.width + "px";
    box.style.height = rect.height + "px";
    box.style.borderColor = colour;
    label.style.background = colour;
    // Above the element for an ordinary one; below it when the element is at the top edge, where a
    // label above would fall off the viewport.
    label.style.top = rect.top < 20 ? "100%" : "-18px";
    label.textContent = described(el);
  };

  const hide = (): void => {
    box.style.display = "none";
  };

  const project = (): void => {
    if (!state.active || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!state.active) return;
      const under = at(lastX, lastY);
      const el = under.el;
      if (state.selected !== null) return;
      if (el === null || el === state.hovered) return;
      state.hovered = el;
      paint(el, false);
      send({
        kind: "hover",
        target: facts(el, false, contextOf(el, under.deep)),
        page: pageFacts(),
      });
    });
  };

  const onMove = (event: MouseEvent): void => {
    lastX = event.clientX;
    lastY = event.clientY;
    project();
  };

  const swallow = (event: Event): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
  };

  const onDown = (event: MouseEvent): void => {
    if (!state.active) return;
    swallow(event);
  };

  const onClick = (event: MouseEvent): void => {
    if (!state.active) return;
    swallow(event);
    const under = at(event.clientX, event.clientY);
    const el = under.el;
    if (el === null) return;
    state.selected = el;
    state.hovered = el;
    paint(el, true);
    send({
      kind: "selected",
      target: facts(el, true, contextOf(el, under.deep)),
      page: pageFacts(),
    });
  };

  const onScroll = (): void => {
    if (!state.active) return;
    if (state.selected !== null) paint(state.selected, true);
    else project();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (!state.active) return;
    if (event.key !== "Escape" && event.key !== "Esc") return;
    if (state.selected !== null) {
      state.selected = null;
      send({ kind: "cleared" });
      if (state.hovered !== null) paint(state.hovered, false);
      else hide();
      return;
    }
    pause();
    send({ kind: "exited" });
  };

  const listening = { added: false };
  const addListeners = (): void => {
    if (listening.added) return;
    listening.added = true;
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("mouseup", onDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onDown, true);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKey, true);
  };
  const removeListeners = (): void => {
    if (!listening.added) return;
    listening.added = false;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("mouseup", onDown, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("auxclick", onDown, true);
    document.removeEventListener("scroll", onScroll, true);
    document.removeEventListener("keydown", onKey, true);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  const start = (): boolean => {
    if (box.parentNode === null) document.documentElement.appendChild(box);
    state.active = true;
    addListeners();
    if (state.selected !== null) paint(state.selected, true);
    send({ kind: "active" });
    return true;
  };

  /**
   * Stand down: no listeners, no highlight, the page is the user's again. Deliberately keeps
   * `selected`, so coming back from `暂离` re-locks the highlight on the same element — the user paused
   * to reach something, not to lose what they had.
   */
  const pause = (): boolean => {
    state.active = false;
    removeListeners();
    hide();
    send({ kind: "paused" });
    return true;
  };

  const teardown = (): void => {
    state.active = false;
    state.hovered = null;
    state.selected = null;
    removeListeners();
    if (box.parentNode !== null) box.parentNode.removeChild(box);
    delete (window as unknown as Record<string, unknown>)[key];
  };

  (window as unknown as Record<string, unknown>)[key] = {
    start: start,
    pause: pause,
    stop: function (): boolean {
      pause();
      send({ kind: "stopped" });
      return true;
    },
    /** Re-read the selected element — the host asks for this when it needs the facts again (FR-06). */
    refacts: function (): unknown {
      if (state.selected === null || !state.selected.isConnected) return null;
      return {
        target: facts(state.selected, true, contextOfElement(state.selected)),
        page: pageFacts(),
      };
    },
    /**
     * Re-read an element the host staged earlier, by the two handles a payload carries: the CSS path
     * it recorded, and the element's own `data-testid` when it had one (M4.1, AC-8).
     *
     * The path is what finds the node again after the user edited the page — a payload's selector
     * describes the page as it was, and this is the one call that is allowed to use it, because the
     * question being asked is "is the thing I wrote down still there". The testid is what keeps the
     * answer honest: a path that now matches a *different* element is not the element the user picked,
     * and returning null is how the host tells "it moved" from "someone else lives there now".
     * An unstaged element, a page that no longer has it, an invalid path: all null, never repaired.
     */
    resolve: function (selector: unknown, testId: unknown): unknown {
      if (typeof selector !== "string" || selector === "") return null;
      let el: Element | null = null;
      try {
        el = document.querySelector(selector);
      } catch {
        // A path the page itself can no longer parse (a provider renamed the syntax, or the payload
        // was doctored): no element, and no guess.
        return null;
      }
      if (el === null) return null;
      const found =
        el.getAttribute("data-testid") ||
        el.getAttribute("data-test-id") ||
        el.getAttribute("data-test") ||
        null;
      if (typeof testId === "string" && testId !== "" && found !== testId) return null;
      return { target: facts(el, true, contextOfElement(el)), page: pageFacts() };
    },
    status: function (): unknown {
      return { active: state.active, selected: state.selected !== null };
    },
    teardown: teardown,
  };
  return "installed";
}

/**
 * The script to hand to `webview.executeJavaScript`: the installer, called with our channel and with
 * the framework sniffer. The sniffer travels as an argument rather than being called from inside the
 * installer's body so that it stays a separately testable function while the guest still receives one
 * self-contained script with no imports.
 */
export function pickerScript(): string {
  return `(${installWorkbenchPicker.toString()})(${JSON.stringify(PICKER_CHANNEL)}, ${sniffScript()})`;
}

/** The command that turns picking on or off in an installed picker; `"missing"` when there is none. */
export function pickerCommand(mode: "picking" | "off" | "paused"): string {
  const call = mode === "picking" ? "start()" : "pause()";
  return `window.${PICKER_KEY} ? (window.${PICKER_KEY}.${call} && "ok") || "error" : "missing"`;
}

/** Ask the page's picker to re-read the element it has selected — null once that element is gone. */
export function pickerRefacts(): string {
  return `window.${PICKER_KEY} ? window.${PICKER_KEY}.refacts() : null`;
}

/**
 * Ask the page's picker to re-read a **staged** element by the two handles its payload recorded: the
 * CSS path, and the element's own `data-testid` when it had one (null otherwise). Null comes back when
 * the element is not there any more, which is the whole answer to "is this chip still true" (M4.1).
 */
export function pickerResolve(selector: string, testId: string | null): string {
  return `window.${PICKER_KEY} ? window.${PICKER_KEY}.resolve(${JSON.stringify(selector)}, ${JSON.stringify(testId)}) : null`;
}

/** Whether the picker is in the guest at all — asked before believing a pause that had nothing to pause. */
export function pickerProbe(): string {
  return `typeof window.${PICKER_KEY} === "object" && window.${PICKER_KEY} !== null`;
}

/**
 * How many frames the page embeds (M4.4). The picker cannot reach inside one, and a person cannot tell
 * by looking whether the card they want is a frame, so the panel asks the question the page can answer
 * — "how many frames are there" — and says it before the user hunts for an element that cannot be
 * picked. Read-only, and counted fresh on every navigation.
 */
export function pickerFrameCount(): string {
  return `document.querySelectorAll("iframe, frame").length`;
}

function text(value: unknown, fallback: string | null = null): string | null {
  return typeof value === "string" ? value : fallback;
}

function rectOf(value: unknown): ElementFacts["rect"] | null {
  if (typeof value !== "object" || value === null) return null;
  const rect = value as Record<string, unknown>;
  const numbers = [rect["x"], rect["y"], rect["width"], rect["height"]];
  if (!numbers.every((n) => typeof n === "number")) return null;
  return {
    x: rect["x"] as number,
    y: rect["y"] as number,
    width: rect["width"] as number,
    height: rect["height"] as number,
  };
}

/**
 * Read one element's facts. The picker and the host ship together, so a missing field is a bug rather
 * than a supported shape — but a page is untrusted input either way, and the answer to a malformed
 * message is to drop it, never to half-believe it.
 */
function targetOf(value: unknown): ElementFacts | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const tagName = text(raw["tagName"]);
  const rect = rectOf(raw["rect"]);
  if (tagName === null || rect === null) return null;
  const classList = Array.isArray(raw["classList"])
    ? raw["classList"].filter((c): c is string => typeof c === "string")
    : [];
  const attributes: Record<string, string> = {};
  const rawAttributes = raw["attributes"];
  if (typeof rawAttributes === "object" && rawAttributes !== null) {
    for (const [name, attribute] of Object.entries(rawAttributes)) {
      if (typeof attribute === "string") attributes[name] = attribute;
    }
  }
  const computed: Record<string, string> = {};
  const rawComputed = raw["computed"];
  if (typeof rawComputed === "object" && rawComputed !== null) {
    for (const [property, value] of Object.entries(rawComputed)) {
      if (typeof value === "string") computed[property] = value;
    }
  }
  const parentChain = Array.isArray(raw["parentChain"])
    ? raw["parentChain"].filter((p): p is string => typeof p === "string")
    : [];
  const origin = originOf(raw["origin"]);
  const facts: ElementFacts = {
    tagName,
    id: text(raw["id"]),
    classList,
    cssSelector: text(raw["cssSelector"], "") ?? "",
    role: text(raw["role"]),
    name: text(raw["name"]),
    testId: text(raw["testId"]),
    attributes,
    text: text(raw["text"], "") ?? "",
    computed,
    rect,
    parentChain,
    origin,
  };
  // §9.4's structures travel as one of two words or not at all; anything else the page sends is
  // dropped like every other unreadable field, rather than becoming a third kind of context.
  const context = raw["domContext"];
  if (context === "shadow" || context === "frame") facts.domContext = context;
  return facts;
}

/**
 * The origin evidence, read the same defensive way as the rest: a message whose evidence we cannot
 * read is a message with no evidence, never a half-believed one. The page's console is the channel
 * anyone can write on, so every field here is checked before it is used as a location.
 */
function originOf(value: unknown): OriginEvidence | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const number = (candidate: unknown): number | null =>
    typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
  const line = number(raw["line"]);
  const column = number(raw["column"]);
  switch (raw["via"]) {
    case "frames": {
      const list = raw["frames"];
      if (!Array.isArray(list)) return null;
      const frames: { url: string; line: number; column: number; fn: string | null }[] = [];
      for (const entry of list) {
        if (typeof entry !== "object" || entry === null) continue;
        const frame = entry as Record<string, unknown>;
        const url = text(frame["url"]);
        const frameLine = number(frame["line"]);
        const frameColumn = number(frame["column"]);
        // A frame we cannot read is dropped, not repaired: the remaining frames are still ordered, so
        // dropping one loses a candidate rather than shifting the meaning of the others.
        if (url === null || frameLine === null || frameColumn === null) continue;
        frames.push({ url, line: frameLine, column: frameColumn, fn: text(frame["fn"]) });
      }
      return frames.length === 0 ? null : { via: "frames", frames };
    }
    case "component-text": {
      const fnText = raw["fnText"];
      const offset = number(raw["offset"]);
      if (typeof fnText !== "string" || fnText === "" || offset === null) return null;
      return {
        via: "component-text",
        component: text(raw["component"]),
        fnText,
        offset,
        moduleHint: text(raw["moduleHint"]),
        candidates: number(raw["candidates"]) ?? 1,
      };
    }
    case "source-loc": {
      const file = text(raw["file"]);
      if (file === null) return null;
      return { via: "source-loc", file, line: line ?? 0, column: column ?? 0 };
    }
    case "file-only": {
      const file = text(raw["file"]);
      if (file === null) return null;
      return { via: "file-only", file, component: text(raw["component"]) };
    }
    default:
      return null;
  }
}

function pageOf(value: unknown): PageFacts | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const url = text(raw["url"]);
  if (url === null) return null;
  const viewport = raw["viewport"];
  const numbers =
    typeof viewport === "object" && viewport !== null ? (viewport as Record<string, unknown>) : {};
  const width = typeof numbers["width"] === "number" ? numbers["width"] : 0;
  const height = typeof numbers["height"] === "number" ? numbers["height"] : 0;
  const dpr = typeof numbers["dpr"] === "number" ? numbers["dpr"] : 1;
  return { url, title: text(raw["title"], "") ?? "", viewport: { width, height, dpr } };
}

/**
 * Read one console line. Anything that is not one of our messages — the page's own logging above all —
 * is `null`, which is the whole point of the prefix and the parse: a guest's console is a shared
 * channel and we only trust the lines we wrote.
 */
export function parsePickerMessage(line: string): PickerMessage | null {
  if (!line.startsWith(`${PICKER_CHANNEL} `)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(PICKER_CHANNEL.length + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const message = parsed as { kind?: unknown; target?: unknown; page?: unknown };
  switch (message.kind) {
    case "installed":
    case "active":
    case "paused":
    case "stopped":
    case "cleared":
    case "exited":
      return { kind: message.kind };
    case "hover":
    case "selected": {
      const target = targetOf(message.target);
      const page = pageOf(message.page);
      if (target === null || page === null) return null;
      return { kind: message.kind, target, page };
    }
    default:
      return null;
  }
}

/**
 * Read what `pickerResolve` came back with: an element re-read from the page, or null once the page
 * no longer has it. Read through the same defensive parsers as a console message, because the answer
 * crosses the same boundary — a guest that returns half a shape is a guest that answered nothing.
 */
export function elementFromGuest(value: unknown): { target: ElementFacts; page: PageFacts } | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { target?: unknown; page?: unknown };
  const target = targetOf(raw.target);
  const page = pageOf(raw.page);
  return target === null || page === null ? null : { target, page };
}

/** The panel's one-line name for an element: `span.badge`, `button#save.primary`, `div`. */
export function describeTarget(facts: ElementFacts): string {
  const classes = facts.classList.slice(0, 2).map((name) => `.${name}`);
  return `${facts.tagName}${facts.id === null ? "" : `#${facts.id}`}${classes.join("")}`;
}
