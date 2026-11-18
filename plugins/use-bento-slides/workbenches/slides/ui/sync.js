// How two writers share one deck: the person in the editor and the Agent editing the file.
//
// The deck file is the truth. The editor holds a copy and two baselines: the document as the
// editor showed it when it was last in step with the file (`shown`), and whatever the person has
// done since. When the file changes under the editor, the person's work is not compared with the
// new file as text: it is read as a list of edits (`diff(shown, mine)`), and those edits are
// replayed on the new file (`rebase`). An edit to something the other side did not touch simply
// applies; where both sides set the same property the person's value wins and the pair is
// reported, so the page can say so. Slides and elements are told apart by their `id`, which is
// what Bento itself morphs and links by.
//
// Everything here is plain data in, plain data out: no DOM, no fetch.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const byId = (list) => new Map((list ?? []).map((item) => [item.id, item]));

/** Whether every item of the list has an id of its own: the only lists edits can be told apart in. */
const keyed = (list) => {
  const ids = (list ?? []).map((item) => item?.id);
  return ids.every((id) => typeof id === "string" && id !== "") && new Set(ids).size === ids.length;
};

/** The id of the item before `id` in `list`, or null at the front. */
const before = (list, id) => {
  const at = list.findIndex((item) => item.id === id);
  return at > 0 ? list[at - 1].id : null;
};

/** Property edits between two objects, leaving `skip` keys to their own comparison. */
function propEdits(from, to, skip) {
  const edits = [];
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (skip.includes(key)) continue;
    if (!(key in to)) edits.push({ key, drop: true });
    else if (!(key in from) || !same(from[key], to[key])) edits.push({ key, value: to[key] });
  }
  return edits;
}

/** Edits to a keyed list: what was added (and after what), removed, moved, and changed inside. */
function listEdits(from, to, inner) {
  const edits = [];
  const old = byId(from);
  const now = byId(to);
  for (const item of from) if (!now.has(item.id)) edits.push({ op: "remove", id: item.id });
  for (const item of to) {
    if (!old.has(item.id)) {
      edits.push({ op: "add", item, after: before(to, item.id) });
      continue;
    }
    const changes = inner(old.get(item.id), item);
    if (changes.length > 0) edits.push({ op: "change", id: item.id, changes });
  }
  // Order: only when the items both sides have are in a different order than before.
  const kept = (list, other) => list.filter((item) => other.has(item.id)).map((item) => item.id);
  if (!same(kept(from, now), kept(to, old))) {
    edits.push({ op: "order", ids: to.map((item) => item.id) });
  }
  return edits;
}

/**
 * The person's edits: what turns `shown` into `mine`. Both are documents as the editor reads
 * them, so what differs is what the person did.
 */
export function diff(shown, mine) {
  const edits = { props: propEdits(shown, mine, ["slides", "assets"]), slides: [], assets: [] };
  for (const [key, value] of Object.entries(mine.assets ?? {})) {
    if ((shown.assets ?? {})[key] !== value) edits.assets.push({ key, value });
  }
  const from = shown.slides ?? [];
  const to = mine.slides ?? [];
  if (!keyed(from) || !keyed(to)) {
    if (!same(from, to)) edits.slides.push({ op: "replace", slides: to });
    return edits;
  }
  edits.slides = listEdits(from, to, (a, b) => {
    const changes = propEdits(a, b, ["elements"]).map((edit) => ({ ...edit, of: "slide" }));
    const elsA = a.elements ?? [];
    const elsB = b.elements ?? [];
    if (!keyed(elsA) || !keyed(elsB)) {
      if (!same(elsA, elsB)) changes.push({ of: "elements", op: "replace", elements: elsB });
      return changes;
    }
    for (const edit of listEdits(elsA, elsB, (x, y) => propEdits(x, y, []))) {
      changes.push({ of: "elements", ...edit });
    }
    return changes;
  });
  return edits;
}

/** Whether a set of edits changes nothing. */
export const isEmpty = (edits) =>
  edits.props.length === 0 && edits.slides.length === 0 && edits.assets.length === 0;

/** Sets properties on `target`, noting each one `theirs` had also changed away from `base`. */
function setProps(target, edits, base, where, clashes) {
  for (const edit of edits) {
    const theirs = target[edit.key];
    const was = base?.[edit.key];
    const mineValue = edit.drop ? undefined : edit.value;
    if (base !== undefined && !same(theirs, was) && !same(theirs, mineValue)) {
      clashes.push({ ...where, key: edit.key, theirs, mine: mineValue });
    }
    if (edit.drop) delete target[edit.key];
    else target[edit.key] = edit.value;
  }
}

/** Replays keyed-list edits on `list` (changed in place); `change` handles an item's own edits. */
function applyList(list, edits, baseList, change) {
  const base = byId(baseList);
  for (const edit of edits) {
    if (edit.op === "remove") {
      const at = list.findIndex((item) => item.id === edit.id);
      // Removed here, but changed there since: their change keeps the item.
      if (at >= 0 && same(list[at], base.get(edit.id))) list.splice(at, 1);
    } else if (edit.op === "add") {
      if (list.some((item) => item.id === edit.item.id)) continue;
      const after = edit.after === null ? -1 : list.findIndex((item) => item.id === edit.after);
      list.splice(edit.after !== null && after < 0 ? list.length : after + 1, 0, edit.item);
    } else if (edit.op === "change") {
      let item = list.find((entry) => entry.id === edit.id);
      if (item === undefined) {
        // Edited here, removed there: the edit keeps the item, as it was plus the edit.
        const was = base.get(edit.id);
        if (was === undefined) continue;
        item = structuredClone(was);
        list.push(item);
      }
      change(item, edit.changes, base.get(edit.id));
    } else if (edit.op === "order") {
      const rank = new Map(edit.ids.map((id, index) => [id, index]));
      // Items the order names take that order; the rest keep their place among them.
      const named = list.filter((item) => rank.has(item.id));
      named.sort((a, b) => rank.get(a.id) - rank.get(b.id));
      let next = 0;
      for (let i = 0; i < list.length; i++) if (rank.has(list[i].id)) list[i] = named[next++];
    }
  }
}

/**
 * The file's document with the person's edits replayed on it.
 *
 * `base` is the file's document the editor was last in step with (what `theirs` changed from);
 * `edits` is `diff(shown, mine)`. Returns the merged document and the properties both sides set
 * differently, where the person's value was kept: `{ slide?, element?, key, theirs, mine }`.
 */
export function rebase(theirs, edits, base) {
  const doc = structuredClone(theirs);
  const clashes = [];
  setProps(doc, edits.props, base, {}, clashes);
  if (edits.assets.length > 0) {
    doc.assets = { ...(doc.assets ?? {}) };
    for (const { key, value } of edits.assets) doc.assets[key] = value;
  }
  const replaced = edits.slides.find((edit) => edit.op === "replace");
  if (replaced) {
    doc.slides = structuredClone(replaced.slides);
    return { doc, clashes };
  }
  doc.slides = doc.slides ?? [];
  applyList(doc.slides, edits.slides, base?.slides ?? [], (slide, changes, was) => {
    setProps(
      slide,
      changes.filter((c) => c.of === "slide"),
      was,
      { slide: slide.id },
      clashes,
    );
    const elementEdits = changes.filter((c) => c.of === "elements");
    const whole = elementEdits.find((c) => c.op === "replace");
    if (whole) {
      slide.elements = structuredClone(whole.elements);
      return;
    }
    slide.elements = slide.elements ?? [];
    applyList(slide.elements, elementEdits, was?.elements ?? [], (element, props, elementWas) =>
      setProps(element, props, elementWas, { slide: slide.id, element: element.id }, clashes),
    );
  });
  return { doc, clashes };
}

/**
 * A deck as the file holds it: valid JSON laid out one slide header, one element and one asset
 * per line, so a text tool can find and replace a single element and a diff reads slide by
 * slide. `collab` never reaches the file: it would be the keys to a live sharing room.
 */
export function formatDeck(doc) {
  const { slides = [], assets, collab: _keys, ...head } = doc;
  const line = (value) => JSON.stringify(value);
  const out = [];
  const headText = line(head);
  out.push(`${headText.slice(0, -1)}${headText === "{}" ? "" : ","}"slides":[`);
  slides.forEach((slide, s) => {
    const { elements = [], ...props } = slide;
    const propsText = line(props);
    out.push(`${propsText.slice(0, -1)}${propsText === "{}" ? "" : ","}"elements":[`);
    elements.forEach((element, e) => {
      out.push(`  ${line(element)}${e < elements.length - 1 ? "," : ""}`);
    });
    out.push(`]}${s < slides.length - 1 ? "," : ""}`);
  });
  const keys = Object.keys(assets ?? {});
  if (keys.length === 0) {
    out.push("]}");
  } else {
    out.push(`],"assets":{`);
    keys.forEach((key, k) => {
      out.push(`${line(key)}:${line(assets[key])}${k < keys.length - 1 ? "," : ""}`);
    });
    out.push("}}");
  }
  return `${out.join("\n")}\n`;
}

/** A deck file's text as a document; throws with a short reason when it is not one. */
export function parseDeck(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new Error(`not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("not a JSON object");
  }
  if (doc.format !== "bento/slides") throw new Error('its "format" is not "bento/slides"');
  if (!Array.isArray(doc.slides)) throw new Error('it has no "slides" list');
  const { collab: _keys, ...rest } = doc;
  return rest;
}

/** The `#bento-doc` block of a `.bento.html` file, as a document. */
export function deckFromHtml(html) {
  // Older exporters re-order or single-quote these attributes. Read the JSON block as
  // text; scripts and other contents of the imported page never run.
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = new Map();
    for (const part of match[1].matchAll(
      /(?:^|\s)([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
    )) {
      attrs.set(part[1].toLowerCase(), part[2] ?? part[3] ?? part[4]);
    }
    if (
      attrs.get("id") === "bento-doc" &&
      ["application/bento+json", "application/json"].includes(attrs.get("type")?.toLowerCase()) &&
      match[2].trim()
    )
      return parseDeck(match[2]);
  }
  throw new Error("the file holds no Bento document");
}

/** A Bento runtime file with `doc` written into its `#bento-doc` block. */
export function htmlWithDeck(runtime, doc) {
  const json = JSON.stringify(doc).replace(/</g, "\\u003c");
  const open = '<script type="application/bento+json" id="bento-doc">';
  const start = runtime.indexOf(open);
  const end = start < 0 ? -1 : runtime.indexOf("</script>", start);
  if (start < 0 || end < 0) throw new Error("the Bento runtime has no document block");
  return runtime.slice(0, start + open.length) + json + runtime.slice(end);
}
