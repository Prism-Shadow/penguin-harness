/**
 * The page's own DOM vocabulary for the platform UI bridge: how an element is named, how it
 * is written down, and what must never be written down.
 *
 * The xpath is the address (`xpathOf`), the link is the handle a person's message carries
 * (`elementLink`), and `describeElement` is the one serializer both `state` and `pick` use.
 * Everything sensitive is refused here, in one place: a password field's value is never read
 * at all — not read-then-masked, which would still put it in memory on this side of a bug —
 * and an element is marked `sensitive` so the picker can refuse to select it.
 */

/** The page's own overlays and surfaces no command may see or describe. */
export const OVERLAY_ATTRIBUTE = "data-platform-ui-overlay";

/** Whether the element is one of the bridge's own surfaces (overlay, window chrome). */
export function isOverlayElement(el: Element): boolean {
  return el.closest(`[${OVERLAY_ATTRIBUTE}]`) !== null;
}

/** An input whose value must never be read: a password box, or anything marked sensitive. */
export function isSensitiveElement(el: Element): boolean {
  if (el.closest("[data-sensitive]") !== null) return true;
  if (el instanceof HTMLInputElement && el.type === "password") return true;
  return false;
}

/** The element's own xpath from the document root: `/html/body/div[2]/button[1]`. */
export function xpathOf(el: Element): string {
  const document = el.ownerDocument;
  if (el === document.documentElement) return "/html";
  const id = el.getAttribute("id");
  if (id !== null && id !== "") {
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id;
    if (document.querySelectorAll(`#${escaped}`).length === 1) {
      return `//*[@id=${JSON.stringify(id)}]`;
    }
  }
  const parts: string[] = [];
  let node: Element | null = el;
  while (node !== null && node !== document.documentElement) {
    const parent: Element | null = node.parentElement;
    if (parent === null) break;
    const tag = node.tagName.toLowerCase();
    let index = 1;
    for (
      let sibling = node.previousElementSibling;
      sibling !== null;
      sibling = sibling.previousElementSibling
    ) {
      if (sibling.tagName === node.tagName) index += 1;
    }
    parts.unshift(`${tag}[${index}]`);
    node = parent;
  }
  return `/html/${parts.join("/")}`;
}

/** The element an xpath names, or null when the document no longer has it. */
export function elementByXpath(xpath: string): Element | null {
  const trimmed = xpath.trim();
  if (trimmed.startsWith("//*[@id=")) {
    try {
      const id = JSON.parse(trimmed.slice("//*[@id=".length, -1)) as unknown;
      if (typeof id !== "string") return null;
      return document.getElementById(id);
    } catch {
      return null;
    }
  }
  if (!trimmed.startsWith("/html")) return null;
  let node: Element | null = document.documentElement;
  for (const segment of trimmed.slice("/html".length).split("/")) {
    if (segment === "") continue;
    const match = /^([a-z0-9-]+)\[(\d+)\]$/i.exec(segment);
    if (match === null || match[1] === undefined || match[2] === undefined) return null;
    const tag = match[1].toUpperCase();
    const wanted = Number(match[2]);
    if (node === null) return null;
    let seen = 0;
    let next: Element | null = null;
    for (const child of node.children) {
      if (child.tagName !== tag) continue;
      seen += 1;
      if (seen === wanted) {
        next = child;
        break;
      }
    }
    node = next;
  }
  return node;
}

/** The handle a picked element is sent to the session under. */
export function elementLink(pageId: string, xpath: string): string {
  return `penguin-ui://${pageId}/element?xpath=${encodeURIComponent(xpath)}`;
}

/** An element's role as its attributes say it, or the implicit one every browser agrees on. */
export function roleOf(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit !== null && explicit !== "") return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a") return el.hasAttribute("href") ? "link" : "generic";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const type = (el as HTMLInputElement).type;
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "button" || type === "submit" || type === "reset") return "button";
    if (type === "password") return "password";
    return "textbox";
  }
  if (tag === "dialog") return "dialog";
  if (tag === "iframe") return "iframe";
  if (/^h[1-6]$/.test(tag)) return "heading";
  return "generic";
}

/** The name a person would use for the element: label first, text second, attribute last. */
export function nameOf(el: Element): string {
  const labelled = el.getAttribute("aria-labelledby");
  if (labelled !== null && labelled !== "") {
    const text = labelled
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text !== "") return clamp(text, 120);
  }
  for (const attribute of ["aria-label", "placeholder", "alt", "title"]) {
    const value = el.getAttribute(attribute);
    if (value !== null && value.trim() !== "") return clamp(value.trim(), 120);
  }
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text !== "") return clamp(text, 120);
  const name = el.getAttribute("name");
  if (name !== null && name !== "") return name;
  return "";
}

/** Visible to the person: a box on screen and not hidden by visibility. */
export function isVisible(el: Element): boolean {
  if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** What one element looks like to the bridge; the same shape for `state` rows and `element`. */
export interface ElementDescription {
  xpath: string;
  tag: string;
  role: string;
  name: string;
  text?: string;
  /** `***` for a password box — the value itself is never read. */
  value?: string;
  disabled?: boolean;
  checked?: boolean;
  href?: string;
  visible: boolean;
  sensitive: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

/** One element written down: attributes, state, and a box on screen. The picker adds its link. */
export function describeElement(el: Element): ElementDescription {
  const rect = el.getBoundingClientRect();
  const sensitive = isSensitiveElement(el);
  const description: ElementDescription = {
    xpath: xpathOf(el),
    tag: el.tagName.toLowerCase(),
    role: roleOf(el),
    name: nameOf(el),
    visible: isVisible(el),
    sensitive,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
  if (sensitive) {
    description.value = "***";
    return description;
  }
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text !== "") description.text = clamp(text, 200);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const value = el.value;
    if (value !== "") description.value = clamp(value, 200);
    if (el instanceof HTMLInputElement) {
      description.disabled = el.disabled;
      if (el.type === "checkbox" || el.type === "radio") description.checked = el.checked;
    } else {
      description.disabled = el.disabled;
    }
  } else if (el instanceof HTMLSelectElement) {
    description.value = clamp(el.value, 200);
    description.disabled = el.disabled;
  } else {
    const href = hrefOf(el);
    if (href !== null) description.href = clamp(href, 500);
  }
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") {
    description.disabled = true;
  }
  return description;
}

/** The element's own href as written, for a description that is not about the picker's link. */
function hrefOf(el: Element): string | null {
  return el instanceof HTMLAnchorElement && el.getAttribute("href") !== null
    ? el.getAttribute("href")
    : null;
}

/** Cuts a string to a length the model can read, on a word boundary when there is one. */
export function clamp(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
