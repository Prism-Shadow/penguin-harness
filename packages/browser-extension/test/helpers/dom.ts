/**
 * The one fake of an extension page's document the unit tests share. `openPage("pair")` builds
 * the page from its real HTML (every element with an id, so a script that looks up an id the page
 * lacks fails as it would in Chrome), installs it as `document` with a browser `navigator`, and
 * runs the page's script in a fresh module registry, as Chrome does when it opens the page. Only
 * the DOM surface the pages use is there. Install `installChrome()` first; `vi.unstubAllGlobals()`
 * in `afterEach` removes both.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

type Listener = (event: { type: string; preventDefault(): void }) => void;

export class FakeElement {
  id = "";
  className = "";
  hidden = false;
  title = "";
  lang = "";
  type = "";
  disabled = false;
  placeholder = "";
  value = "";
  href = "";
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  private ownText = "";
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly tagName: string) {}

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }

  set textContent(text: string) {
    this.ownText = text;
    this.children.length = 0;
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** A user's click: nothing happens on a disabled control. */
  click(): void {
    if (!this.disabled) this.dispatch("click");
  }

  /** An event such as a form's `submit`. */
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type, preventDefault() {} });
    }
  }

  /** This element and everything below it, depth first. */
  *walk(): Generator<FakeElement> {
    yield this;
    for (const child of this.children) yield* child.walk();
  }
}

export interface FakePage {
  /** The `lang` the page set on its document. */
  readonly lang: string;
  byId(id: string): FakeElement;
  /**
   * All the page's copy, hidden elements included: every text, placeholder, tooltip and label.
   * The EN / 中文 switch counts by its label only, since it names each language in that language.
   */
  text(): string;
  /** The first element below `id` whose `data-<key>` is `value`. */
  find(id: string, key: string, value: string): FakeElement | undefined;
}

const pagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../pages");

const scripts = {
  pair: () => import("../../pages/pair.js"),
  popup: () => import("../../pages/popup.js"),
};

/** Opens an extension page in a browser whose language is `browserLanguage`. */
export async function openPage(
  name: "pair" | "popup",
  { browserLanguage = "en-US" }: { browserLanguage?: string } = {},
): Promise<FakePage> {
  const html = readFileSync(path.join(pagesDir, `${name}.html`), "utf8");
  const byId = new Map<string, FakeElement>();
  for (const [, tag, id] of html.matchAll(/<([a-z0-9]+)\b[^>]*?\sid="([^"]+)"/g)) {
    const node = new FakeElement(tag!.toUpperCase());
    node.id = id!;
    byId.set(id!, node);
  }
  const root = { lang: "" };
  vi.stubGlobal("document", {
    documentElement: root,
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag.toUpperCase()),
  });
  vi.stubGlobal("navigator", {
    language: browserLanguage,
    languages: [browserLanguage],
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.6723.58 Safari/537.36",
    platform: "Linux x86_64",
  });

  vi.resetModules();
  await scripts[name]();
  await settled();

  return {
    get lang() {
      return root.lang;
    },
    byId(id) {
      const node = byId.get(id);
      if (node === undefined) throw new Error(`${name}.html has no #${id}`);
      return node;
    },
    text() {
      return [...byId.values()]
        .flatMap((node) =>
          node.id === "language"
            ? [node.getAttribute("aria-label")]
            : [...node.walk()].flatMap((each) => [
                each.textContent,
                each.placeholder,
                each.title,
                each.getAttribute("aria-label"),
              ]),
        )
        .filter((text): text is string => text !== null && text !== "")
        .join("\n");
    },
    find(id, key, value) {
      return [...(byId.get(id)?.walk() ?? [])].find((node) => node.dataset[key] === value);
    },
  };
}

/** Lets every storage read and render the last action started run to the end. */
export function settled(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
