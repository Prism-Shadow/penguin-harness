/**
 * How the Slides workbench keeps a person's edits when the Agent rewrites the deck file under
 * the editor: the person's edits are read as a list and replayed on the Agent's version.
 */
import { describe, expect, it } from "vitest";
// The page's own module, as the browser loads it.
import {
  deckFromHtml,
  diff,
  formatDeck,
  htmlWithDeck,
  isEmpty,
  parseDeck,
  rebase,
} from "../workbenches/slides/ui/sync.js";

const text = (id: string, html: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "text",
  x: 96,
  y: 100,
  w: 800,
  h: 80,
  html,
  ...extra,
});
const deck = (slides: unknown[], extra: Record<string, unknown> = {}) => ({
  format: "bento/slides",
  version: 1,
  title: "Deck",
  slides,
  ...extra,
});
const base = () =>
  deck([
    { id: "cover", transition: "none", elements: [text("title", "Hello"), text("sub", "World")] },
    { id: "numbers", transition: "morph", elements: [text("title", "Numbers")] },
  ]);

/** The person's edits on `shown`, replayed on the Agent's `theirs` (both started from `shown`). */
const merge = (shown: any, mine: any, theirs: any) => rebase(theirs, diff(shown, mine), shown);

describe("a person and the Agent editing one deck", () => {
  it("keeps both when they change different elements of the same slide", () => {
    const mine = base();
    mine.slides[0].elements[0].x = 300;
    const theirs = base();
    theirs.slides[0].elements[1].html = "Agent's subtitle";
    const { doc, clashes } = merge(base(), mine, theirs);
    expect(doc.slides[0].elements[0].x).toBe(300);
    expect(doc.slides[0].elements[1].html).toBe("Agent's subtitle");
    expect(clashes).toEqual([]);
  });

  it("keeps both when they change different properties of one element", () => {
    const mine = base();
    mine.slides[0].elements[0].x = 300;
    const theirs = base();
    theirs.slides[0].elements[0].html = "Agent's title";
    const { doc, clashes } = merge(base(), mine, theirs);
    expect(doc.slides[0].elements[0]).toMatchObject({ x: 300, html: "Agent's title" });
    expect(clashes).toEqual([]);
  });

  it("keeps the person's value, and says so, when both set the same property", () => {
    const mine = base();
    mine.slides[0].elements[0].html = "Mine";
    const theirs = base();
    theirs.slides[0].elements[0].html = "Theirs";
    const { doc, clashes } = merge(base(), mine, theirs);
    expect(doc.slides[0].elements[0].html).toBe("Mine");
    expect(clashes).toEqual([
      { slide: "cover", element: "title", key: "html", theirs: "Theirs", mine: "Mine" },
    ]);
  });

  it("keeps a slide the Agent added and a slide the person added, each where it was put", () => {
    const mine = base();
    mine.slides.splice(1, 0, { id: "mine", transition: "none", elements: [] });
    const theirs = base();
    theirs.slides.push({ id: "theirs", transition: "none", elements: [] });
    const { doc } = merge(base(), mine, theirs);
    expect(doc.slides.map((s: any) => s.id)).toEqual(["cover", "mine", "numbers", "theirs"]);
  });

  it("keeps an element the person edited although the Agent removed it", () => {
    const mine = base();
    mine.slides[0].elements[1].html = "Edited";
    const theirs = base();
    theirs.slides[0].elements.splice(1, 1);
    const { doc } = merge(base(), mine, theirs);
    expect(doc.slides[0].elements.map((e: any) => [e.id, e.html])).toEqual([
      ["title", "Hello"],
      ["sub", "Edited"],
    ]);
  });

  it("keeps an element the Agent changed although the person removed it", () => {
    const mine = base();
    mine.slides[0].elements.splice(1, 1);
    const theirs = base();
    theirs.slides[0].elements[1].html = "Agent's subtitle";
    const { doc } = merge(base(), mine, theirs);
    expect(doc.slides[0].elements.map((e: any) => e.html)).toEqual(["Hello", "Agent's subtitle"]);
  });

  it("removes what the person removed when the Agent left it alone", () => {
    const mine = base();
    mine.slides.splice(1, 1);
    const theirs = base();
    theirs.title = "Agent's title";
    const { doc } = merge(base(), mine, theirs);
    expect(doc.slides.map((s: any) => s.id)).toEqual(["cover"]);
    expect(doc.title).toBe("Agent's title");
  });

  it("applies the person's reordering to the slides both sides have", () => {
    const mine = base();
    mine.slides.reverse();
    const theirs = base();
    theirs.slides[0].elements[0].html = "Agent's title";
    const { doc } = merge(base(), mine, theirs);
    expect(doc.slides.map((s: any) => s.id)).toEqual(["numbers", "cover"]);
    expect(doc.slides[1].elements[0].html).toBe("Agent's title");
  });

  it("takes the Agent's version whole when the person changed nothing", () => {
    const theirs = base();
    theirs.slides[1].elements.push(text("chart", "A chart"));
    expect(isEmpty(diff(base(), base()))).toBe(true);
    expect(merge(base(), base(), theirs).doc).toEqual(theirs);
  });

  it("does not count what the editor filled in as an edit against the Agent's value", () => {
    // The editor shows a document with its defaults filled in; the file holds what was written.
    const file = base();
    const shown = base();
    shown.slides[0].elements[0].rotation = 0;
    const mine = structuredClone(shown);
    mine.slides[0].elements[0].x = 300;
    const theirs = base();
    (theirs.slides[0].elements[0] as any).rotation = 15;
    const { doc, clashes } = rebase(theirs, diff(shown, mine), file);
    expect(doc.slides[0].elements[0]).toMatchObject({ x: 300, rotation: 15 });
    expect(clashes).toEqual([]);
  });
});

describe("a deck as a file", () => {
  it("is written one element per line and reads back as the same document", () => {
    const doc = deck(base().slides, { assets: { hero: "data:image/png;base64,AAAA" } });
    const file = formatDeck(doc);
    expect(parseDeck(file)).toEqual(doc);
    const lines = file.split("\n");
    expect(lines.filter((line) => line.startsWith('  {"id":"'))).toHaveLength(3);
    expect(lines.some((line) => line.startsWith('"hero":'))).toBe(true);
  });

  it("never holds the keys of a live sharing room", () => {
    const doc = deck(base().slides, { collab: { room: "r", key: "k" } });
    expect(formatDeck(doc)).not.toContain("collab");
    expect(parseDeck(JSON.stringify(doc))).not.toHaveProperty("collab");
  });

  it("refuses a file that is not a Bento deck, saying why", () => {
    expect(() => parseDeck("{")).toThrow(/not valid JSON/);
    expect(() => parseDeck('{"format":"bento/spaces","slides":[]}')).toThrow(/bento\/slides/);
    expect(() => parseDeck('{"format":"bento/slides"}')).toThrow(/slides/);
  });

  it("imports a saved Bento HTML with reordered, single-quoted script attributes", () => {
    const doc = deck([{ id: "cover", elements: [text("t", "Saved copy")] }]);
    const html =
      "<script>throw Error('unrelated script');</script>" +
      `<script data-version="1" ID='bento-doc' type='application/bento+json'>${JSON.stringify(doc)}</script>`;
    expect(deckFromHtml(html)).toEqual(doc);
  });

  it("travels inside a Bento file and comes back out of it", () => {
    const runtime =
      '<html><head><script type="application/bento+json" id="bento-doc"></script></head><body></body></html>';
    const doc = deck([{ id: "s1", elements: [text("t", "a </script> b")] }]);
    const html = htmlWithDeck(runtime, doc);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(deckFromHtml(html)).toEqual(doc);
  });
});
