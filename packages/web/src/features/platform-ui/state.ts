/**
 * What the page shows, written down for the Agent: the route, the dialog on top, the
 * interactive controls (with xpaths), and the visible text.
 *
 * This is the `state` command's whole answer. It is a reading of the screen in the same
 * vocabulary the picker uses, so a session that read the state and then receives a picked
 * element's xpath can reason about both with one vocabulary — and the picker's link resolves
 * back to the same element through `element`.
 *
 * The element list is bounded twice (count and characters): a page with hundreds of rows
 * would otherwise turn one state read into a context-sized dump. The text is the page's
 * visible words, never an input's value; values appear only for the controls listed, and a
 * password box's is `***` from `describeElement`.
 */
import { OVERLAY_ATTRIBUTE, clamp, describeElement, isOverlayElement, isVisible } from "./dom";

/** Everything a `state` answer carries. */
export interface UiState {
  route: string;
  title: string;
  viewport: { width: number; height: number };
  focus: string | null;
  dialogs: string[];
  elements: Array<{
    xpath: string;
    tag: string;
    role: string;
    name: string;
    value?: string;
    disabled?: boolean;
    checked?: boolean;
  }>;
  /** The screen's visible words, and the element list, in the CLI's reading order. */
  text: string;
  truncated: boolean;
}

/** The controls worth listing: anything a person can act on, plus the boxes they type into. */
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=menuitemcheckbox]",
  "[role=option]",
  "[role=checkbox]",
  "[role=switch]",
  "[role=radio]",
  "[role=combobox]",
  "[role=slider]",
  "[contenteditable=true]",
].join(",");

/** How many controls one state read lists. */
const MAX_ELEMENTS = 250;
/** How much of the screen's visible text one state read carries. */
const MAX_TEXT = 4_000;
/** How much of the rendered answer the CLI receives; the rest is cut with a note. */
const MAX_RENDERED = 24_000;

/** The page's visible words with the bridge's own surfaces taken out. */
function visibleText(): string {
  const overlays = [...document.querySelectorAll<HTMLElement>(`[${OVERLAY_ATTRIBUTE}]`)];
  const hidden = overlays.map((el) => el.style.display);
  for (const el of overlays) el.style.display = "none";
  try {
    return (document.body.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    overlays.forEach((el, i) => {
      el.style.display = hidden[i] ?? "";
    });
  }
}

/** The dialog-like surfaces on screen, by their accessible names. */
function dialogsOnScreen(): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const el of document.querySelectorAll("[role=dialog], dialog, [aria-modal=true]")) {
    if (isOverlayElement(el) || !isVisible(el)) continue;
    const name = describeElement(el).name || el.tagName.toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** The element a person's keyboard is in, described the same way as the rest. */
function focusDescription(): string | null {
  const active = document.activeElement;
  if (active === null || active === document.body || isOverlayElement(active)) return null;
  const d = describeElement(active);
  const name = d.name === "" ? "" : ` "${d.name}"`;
  return `${d.role}${name} (${d.xpath})`;
}

/** Collects the page's state; `route` and `title` come from the caller (the app knows them). */
export function collectUiState(input: { route: string; title: string }): UiState {
  const elements: UiState["elements"] = [];
  let truncated = false;
  for (const el of document.querySelectorAll(INTERACTIVE_SELECTOR)) {
    if (isOverlayElement(el) || el === document.documentElement || el === document.body) continue;
    if (!isVisible(el)) continue;
    if (elements.length >= MAX_ELEMENTS) {
      truncated = true;
      break;
    }
    const d = describeElement(el);
    elements.push({
      xpath: d.xpath,
      tag: d.tag,
      role: d.role,
      name: d.name,
      ...(d.value === undefined ? {} : { value: d.value }),
      ...(d.disabled === undefined ? {} : { disabled: d.disabled }),
      ...(d.checked === undefined ? {} : { checked: d.checked }),
    });
  }
  const dialogs = dialogsOnScreen();
  const text = clamp(visibleText(), MAX_TEXT);
  const state: UiState = {
    route: input.route,
    title: input.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    focus: focusDescription(),
    dialogs,
    elements,
    text: "",
    truncated,
  };
  state.text = renderUiState(state);
  return state;
}

/** The state as text: what the CLI prints, and what the model reads first. */
export function renderUiState(state: UiState): string {
  const lines: string[] = [];
  lines.push(`route: ${state.route}`);
  if (state.title !== "") lines.push(`title: ${state.title}`);
  lines.push(`viewport: ${state.viewport.width}x${state.viewport.height}`);
  if (state.dialogs.length > 0) lines.push(`dialogs: ${state.dialogs.join(" | ")}`);
  if (state.focus !== null) lines.push(`focus: ${state.focus}`);
  lines.push(`controls (${state.elements.length}${state.truncated ? ", cut" : ""}):`);
  for (const el of state.elements) {
    const bits = [`${el.tag}[${el.role}]`];
    if (el.name !== "") bits.push(`"${el.name}"`);
    if (el.value !== undefined) bits.push(`value="${el.value}"`);
    if (el.disabled === true) bits.push("disabled");
    if (el.checked !== undefined) bits.push(el.checked ? "checked" : "unchecked");
    lines.push(`- ${bits.join(" ")}  xpath=${el.xpath}`);
  }
  lines.push("");
  lines.push("visible text:");
  lines.push(state.text);
  const rendered = lines.join("\n");
  return rendered.length > MAX_RENDERED
    ? `${rendered.slice(0, MAX_RENDERED)}\n… (state cut at ${MAX_RENDERED} chars)`
    : rendered;
}
