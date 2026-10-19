/**
 * The channel composer's draft (features/company/mention-draft.ts): a picked mention shows the
 * name a sent message renders and still goes out as the exact markdown span the server resolves.
 * It is one block — an edit that reaches into it takes all of it, the caret and the selection step over
 * it, an input method's edit waits for compositionend, an undo brings it back whole, and a copy,
 * a cut or a drag carries it through the clipboard — and the message sent splices each span in
 * verbatim, since a complete link needs no separating space.
 */
import { describe, expect, it } from "vitest";
import { mentionRuns, wireToken } from "../src/features/company/channel-mentions";
import {
  EMPTY_DRAFT,
  draftApplyClip,
  draftApplyEdit,
  draftFollowEdit,
  draftInsertMention,
  draftRecall,
  draftRemember,
  draftSegments,
  draftSlice,
  draftSnapSelection,
  draftWireText,
  mentionCovers,
  mentionDeletedByKey,
  parseClip,
  serializeClip,
} from "../src/features/company/mention-draft";
import type { DraftHistory, MentionDraft } from "../src/features/company/mention-draft";

/** The exact markdown wire a pick of `label` sends (channel-mentions.ts mentionInsertWire). */
const md = (label: string, kind: "agent" | "user" | "squad" | "all", id = ""): string =>
  kind === "all" ? `[@${label}](mention://all)` : `[@${label}](mention://${kind}/${id})`;

/** Types `value` at the end of the draft, the way a keystroke or a paste reports it. */
const typeAtEnd = (d: MentionDraft, value: string): MentionDraft =>
  draftApplyEdit(d, d.text + value, d.text.length + value.length).draft;

/** Types `@query` at the end, then picks the candidate. */
function pick(d: MentionDraft, query: string, label: string, wire: string): MentionDraft {
  const typed = typeAtEnd(d, `@${query}`);
  const start = typed.text.length - query.length - 1;
  return draftInsertMention(typed, start, typed.text.length, label, wire).draft;
}

/** The browser deleting `from`…`to` (a key, a cut, a drag out), which leaves the caret at `from`. */
const deleteSpan = (d: MentionDraft, from: number, to: number) =>
  draftApplyEdit(d, d.text.slice(0, from) + d.text.slice(to), from);

const tokens = (text: string) => mentionRuns(text).flatMap((r) => (r.mention ? [r.mention] : []));

/** `@Ada Lovelace please`: the mention is 0…13. */
const base = () =>
  typeAtEnd(pick(EMPTY_DRAFT, "A", "Ada Lovelace", md("Ada Lovelace", "agent", "ceo")), "please");

describe("inserting a mention", () => {
  it("shows the name with a trailing space, moves the caret past it, and sends the markdown span", () => {
    const typed = typeAtEnd(EMPTY_DRAFT, "hi @ce");
    const wire = md("Ada Lovelace", "agent", "ceo");
    const { draft, caret } = draftInsertMention(typed, 3, 6, "Ada Lovelace", wire);
    expect(draft.text).toBe("hi @Ada Lovelace ");
    expect(caret).toBe(17);
    expect(draftWireText(draft)).toBe(`hi ${wire} `);
  });

  it("keeps the text after the caret when the pick lands mid-draft", () => {
    const d = draftApplyEdit(EMPTY_DRAFT, "hi @ce there", 6).draft;
    const wire = md("Ada", "agent", "ceo");
    const { draft } = draftInsertMention(d, 3, 6, "Ada", wire);
    expect(draft.text).toBe("hi @Ada  there");
    expect(draftWireText(draft)).toBe(`hi ${wire}  there`);
  });

  it("names in CJK and names with spaces send their spans, and the server grammar reads them back", () => {
    let d = pick(EMPTY_DRAFT, "张", "张三", md("张三", "agent", "zhangsan"));
    d = typeAtEnd(d, "和");
    d = pick(d, "Ada", "Ada Lovelace", md("Ada Lovelace", "agent", "ceo"));
    d = typeAtEnd(d, "请看一下。");
    expect(d.text).toBe("@张三 和@Ada Lovelace 请看一下。");
    const wire = draftWireText(d);
    expect(wire).toBe(
      `${md("张三", "agent", "zhangsan")} 和${md("Ada Lovelace", "agent", "ceo")} 请看一下。`,
    );
    expect(tokens(wire)).toEqual(["agent:zhangsan", "agent:ceo"]);
  });

  it("keeps two employees who share a name apart, down to which one a Backspace removes", () => {
    const dev = md("Alex", "agent", "dev_alex");
    const ops = md("Alex", "agent", "ops_alex");
    let d = pick(EMPTY_DRAFT, "Al", "Alex", dev);
    d = pick(d, "Al", "Alex", ops);
    expect(d.text).toBe("@Alex @Alex ");
    expect(draftWireText(d)).toBe(`${dev} ${ops} `);
    const second = deleteSpan(d, 10, 11).draft;
    expect(second.text).toBe("@Alex  ");
    expect(draftWireText(second)).toBe(`${dev}  `);
    const first = deleteSpan(d, 4, 5).draft;
    expect(first.text).toBe(" @Alex ");
    expect(draftWireText(first)).toBe(` ${ops} `);
  });

  it("carries the member and the everyone span as picked", () => {
    const alice = md("alice", "user", "alice");
    const everyone = md("所有人", "all");
    let d = pick(EMPTY_DRAFT, "al", "alice", alice);
    d = pick(d, "", "所有人", everyone);
    expect(d.text).toBe("@alice @所有人 ");
    expect(draftWireText(d)).toBe(`${alice} ${everyone} `);
  });

  it("marks where a picked mention sits, so no @ panel opens on its name", () => {
    const d = pick(typeAtEnd(EMPTY_DRAFT, "cc "), "A", "Ada", md("Ada", "agent", "ceo"));
    expect(mentionCovers(d, 3)).toBe(true);
    expect(mentionCovers(d, 6)).toBe(true);
    expect(mentionCovers(d, 2)).toBe(false);
    expect(mentionCovers(d, 7)).toBe(false);
  });
});

describe("a mention is one block", () => {
  it("Backspace at its end removes all of it, the caret landing where it started", () => {
    const { draft, caret } = deleteSpan(base(), 12, 13);
    expect(draft).toEqual({ text: " please", mentions: [] });
    expect(caret).toBe(0);
  });

  it("Delete at its start removes all of it", () => {
    const { draft, caret } = deleteSpan(base(), 0, 1);
    expect(draft).toEqual({ text: " please", mentions: [] });
    expect(caret).toBe(0);
  });

  it("a character deleted beside it, outside it, leaves it whole", () => {
    let d = typeAtEnd(EMPTY_DRAFT, "cc ");
    d = typeAtEnd(pick(d, "A", "Ada", md("Ada", "agent", "ceo")), "x");
    expect(d.text).toBe("cc @Ada x");
    const before = deleteSpan(d, 2, 3); // Backspace at its start
    expect(before.draft.text).toBe("cc@Ada x");
    expect(before.draft.mentions).toHaveLength(1);
    const after = deleteSpan(d, 7, 8); // Delete at its end
    expect(after.draft.text).toBe("cc @Adax");
    expect(after.draft.mentions).toHaveLength(1);
  });

  it("a word delete, a cut or a drag that takes part of it takes all of it", () => {
    // Ctrl+Backspace after "Lovelace ": the browser deletes the word and the space.
    const word = draftApplyEdit(base(), "@Ada please", 5);
    expect(word.draft).toEqual({ text: "please", mentions: [] });
    expect(word.caret).toBe(0);
    // A cut of "da Lovelace pl", starting inside the name.
    const cut = deleteSpan(base(), 2, 16);
    expect(cut.draft).toEqual({ text: "ease", mentions: [] });
  });

  it("replacing a selection that cuts into it replaces all of it", () => {
    // "Love" selected and "x" typed over it.
    const { draft, caret } = draftApplyEdit(base(), "@Ada xlace please", 6);
    expect(draft).toEqual({ text: "x please", mentions: [] });
    expect(caret).toBe(1);
  });

  it("text dropped inside it replaces it", () => {
    const { draft, caret } = draftApplyEdit(base(), "@Ada LoXvelace please", 8);
    expect(draft).toEqual({ text: "X please", mentions: [] });
    expect(caret).toBe(1);
  });

  it("text typed or pasted at either edge, or anywhere else, only moves it", () => {
    let d = typeAtEnd(base(), " review");
    const wire = md("Ada Lovelace", "agent", "ceo");
    expect(draftWireText(d)).toBe(`${wire} please review`);
    const pasted = draftApplyEdit(d, `hey ${d.text}`, 4);
    expect(pasted.draft.text).toBe("hey @Ada Lovelace please review");
    expect(pasted.caret).toBe(4);
    expect(draftWireText(pasted.draft)).toBe(`hey ${wire} please review`);
    d = draftApplyEdit(base(), "@Ada Lovelace, please", 14).draft;
    expect(d.mentions).toEqual([{ start: 0, label: "Ada Lovelace", wire }]);
  });

  it("an a typed after a name ending in a is typed after it, not inside it", () => {
    const wire = md("Anna", "agent", "anna_pm");
    const d = pick(EMPTY_DRAFT, "An", "Anna", wire);
    const { draft } = draftApplyEdit(d, "@Annaa ", 6);
    expect(draft.mentions).toEqual([{ start: 0, label: "Anna", wire }]);
  });

  it("of two glued mentions, a Backspace between them removes only the one before", () => {
    let d = pick(EMPTY_DRAFT, "张", "张三", md("张三", "agent", "zhangsan"));
    d = draftApplyEdit(d, "@张三", 3).draft; // its trailing space deleted
    const lisi = md("李四", "agent", "lisi");
    d = pick(d, "李", "李四", lisi);
    expect(d.text).toBe("@张三@李四 ");
    const { draft } = deleteSpan(d, 2, 3);
    expect(draft.text).toBe("@李四 ");
    expect(draftWireText(draft)).toBe(`${lisi} `);
  });

  it("clearing the whole draft clears its mentions", () => {
    expect(draftApplyEdit(base(), "", 0).draft).toEqual(EMPTY_DRAFT);
  });

  it("a pasted @Name is plain text, a pasted @id is sent as typed", () => {
    let d = typeAtEnd(EMPTY_DRAFT, "@Ada Lovelace ");
    expect(d.mentions).toEqual([]);
    expect(draftWireText(d)).toBe("@Ada Lovelace ");
    d = typeAtEnd(d, "@ceo");
    expect(draftWireText(d)).toBe("@Ada Lovelace @ceo");
  });
});

describe("Backspace and Delete at an edge, as one native delete", () => {
  it("names the whole mention a Backspace right after it or a Delete right before it reaches", () => {
    const d = base();
    expect(mentionDeletedByKey(d, "deleteContentBackward", 13, 13)).toEqual({ start: 0, end: 13 });
    expect(mentionDeletedByKey(d, "deleteContentForward", 0, 0)).toEqual({ start: 0, end: 13 });
  });

  it("is null for a key away from an edge, a selection, or any other edit", () => {
    const d = base();
    expect(mentionDeletedByKey(d, "deleteContentBackward", 14, 14)).toBeNull();
    expect(mentionDeletedByKey(d, "deleteContentBackward", 0, 0)).toBeNull();
    expect(mentionDeletedByKey(d, "deleteContentForward", 13, 13)).toBeNull();
    expect(mentionDeletedByKey(d, "deleteContentBackward", 0, 13)).toBeNull();
    expect(mentionDeletedByKey(d, "deleteWordBackward", 13, 13)).toBeNull();
    expect(mentionDeletedByKey(d, "insertText", 13, 13)).toBeNull();
  });
});

describe("the caret and the selection", () => {
  const sel = (start: number, end: number, backward = false) => ({ start, end, backward });

  it("an arrow key steps over a mention in either direction", () => {
    const d = base();
    expect(draftSnapSelection(d, sel(1, 1), 0)).toEqual({ start: 13, end: 13 });
    expect(draftSnapSelection(d, sel(12, 12), 13)).toEqual({ start: 0, end: 0 });
    // A word jump that lands inside continues the same way.
    expect(draftSnapSelection(d, sel(4, 4), 0)).toEqual({ start: 13, end: 13 });
  });

  it("a click inside a mention puts the caret at the nearer edge", () => {
    const d = base();
    expect(draftSnapSelection(d, sel(11, 11), null)).toEqual({ start: 13, end: 13 });
    expect(draftSnapSelection(d, sel(2, 2), null)).toEqual({ start: 0, end: 0 });
  });

  it("a caret outside every mention stays put", () => {
    const d = base();
    expect(draftSnapSelection(d, sel(13, 13), 12)).toEqual({ start: 13, end: 13 });
    expect(draftSnapSelection(d, sel(16, 16), null)).toEqual({ start: 16, end: 16 });
    expect(draftSnapSelection(d, sel(14, 18), 18)).toEqual({ start: 14, end: 18 });
  });

  it("Shift+arrow grows a selection by the whole mention and shrinks it back", () => {
    const d = base();
    expect(draftSnapSelection(d, sel(0, 1), 0)).toEqual({ start: 0, end: 13 });
    expect(draftSnapSelection(d, sel(0, 12), 13)).toEqual({ start: 0, end: 0 });
    expect(draftSnapSelection(d, sel(12, 20, true), 13)).toEqual({ start: 0, end: 20 });
    expect(draftSnapSelection(d, sel(1, 20, true), 0)).toEqual({ start: 13, end: 20 });
  });

  it("a range a pointer made that cuts into a mention grows to hold all of it", () => {
    const d = base();
    // A double-click on "Ada", and a drag from inside the name into the next word.
    expect(draftSnapSelection(d, sel(1, 4), null)).toEqual({ start: 0, end: 13 });
    expect(draftSnapSelection(d, sel(6, 17), null)).toEqual({ start: 0, end: 17 });
  });

  it("an end that did not move but sits inside a mention grows outward", () => {
    const d = typeAtEnd(
      pick(typeAtEnd(EMPTY_DRAFT, "cc "), "A", "Ada", md("Ada", "agent", "ceo")),
      "go",
    );
    expect(d.text).toBe("cc @Ada go");
    expect(draftSnapSelection(d, sel(5, 9), 9)).toEqual({ start: 3, end: 9 });
  });
});

describe("input methods", () => {
  it("while composing the draft follows the box without rewriting it; compositionend widens the edit", () => {
    const before = base();
    // A keyboard app that composes over "Lovelace" deletes its last letter.
    const composing = draftFollowEdit(before, "@Ada Lovelac please", 12);
    expect(composing).toEqual({ text: "@Ada Lovelac please", mentions: [] });
    // At compositionend the edit is judged against the draft the composition started from.
    const ended = draftApplyEdit(before, "@Ada Lovelac please", 12);
    expect(ended.draft).toEqual({ text: " please", mentions: [] });
    expect(ended.caret).toBe(0);
  });

  it("a composition beside a mention keeps it", () => {
    const wire = md("张三", "agent", "zhangsan");
    const before = pick(EMPTY_DRAFT, "张", "张三", wire);
    const composing = draftFollowEdit(before, "@张三 ni", 6);
    expect(composing.mentions).toEqual(before.mentions);
    const ended = draftApplyEdit(before, "@张三 你好", 6);
    expect(ended.draft.mentions).toEqual(before.mentions);
    expect(draftWireText(ended.draft)).toBe(`${wire} 你好`);
  });
});

describe("undo and redo", () => {
  it("text an undo, a redo or a drop leaves selected is placed by where the selection ends", () => {
    const d = base();
    // " please" selected and deleted …
    const deleted = deleteSpan(d, 13, 20).draft;
    expect(deleted.text).toBe("@Ada Lovelace");
    // … then Ctrl+Z puts it back with 13…20 selected: the edit ends at 20, beside the name.
    expect(draftFollowEdit(deleted, d.text, 20)).toEqual(d);
    expect(draftApplyEdit(deleted, d.text, 20)).toEqual({ draft: d, caret: 20 });
  });

  it("an undo that brings back a deleted mention's text brings the mention back", () => {
    const d = base();
    let history: DraftHistory = [];
    history = draftRemember(history, d);
    const deleted = deleteSpan(d, 12, 13).draft;
    history = draftRemember(history, deleted);
    expect(draftRecall(history, d.text)).toEqual(d);
    // Without the history the same undo only gets the text back.
    expect(draftFollowEdit(deleted, d.text, 13).mentions).toEqual([]);
  });

  it("the history keeps the latest draft per text, skips drafts without mentions, and stays short", () => {
    const ada = pick(EMPTY_DRAFT, "A", "Ada", md("Ada", "agent", "ceo"));
    const other = pick(EMPTY_DRAFT, "A", "Ada", md("Ada", "agent", "ada_ops"));
    let history = draftRemember(draftRemember([], ada), other);
    expect(history).toEqual([other]);
    expect(draftRemember(history, typeAtEnd(EMPTY_DRAFT, "plain"))).toBe(history);
    expect(draftRecall(history, "missing")).toBeNull();
    for (let i = 0; i < 60; i += 1) history = draftRemember(history, typeAtEnd(ada, `${i}`));
    expect(history).toHaveLength(50);
    expect(draftRecall(history, ada.text)).toBeNull();
  });
});

describe("the clipboard", () => {
  const names: Record<string, string> = { "agent:ceo": "Ada Lovelace", "agent:zhangsan": "张三" };
  /** The composer's labelOf: an employee's name, a member's id, the token itself for an unknown id. */
  const labelOf = (wire: string) => {
    const token = wireToken(wire);
    return names[token] ?? token.replace(/^user:/, "");
  };

  it("a copy carries the mentions wholly inside the selection, offsets relative to it", () => {
    const wire = md("Ada Lovelace", "agent", "ceo");
    const d = typeAtEnd(
      pick(typeAtEnd(EMPTY_DRAFT, "cc "), "A", "Ada Lovelace", wire),
      "go",
    );
    expect(d.text).toBe("cc @Ada Lovelace go");
    expect(draftSlice(d, 3, 19)).toEqual({
      text: "@Ada Lovelace go",
      mentions: [{ start: 0, label: "Ada Lovelace", wire }],
    });
    expect(draftSlice(d, 0, 3)).toEqual({ text: "cc ", mentions: [] });
    // A stretch cutting into a mention carries none of it; the selection snaps, so a copy never does.
    expect(draftSlice(d, 5, 19).mentions).toEqual([]);
  });

  it("serializes a clip and parses it back, CJK names and members included", () => {
    let d = pick(EMPTY_DRAFT, "张", "张三", md("张三", "agent", "zhangsan"));
    d = typeAtEnd(d, "和");
    d = pick(d, "Ada", "Ada Lovelace", md("Ada Lovelace", "agent", "ceo"));
    d = pick(d, "al", "alice", md("alice", "user", "alice"));
    const clip = draftSlice(d, 0, d.text.length);
    expect(clip.mentions).toHaveLength(3);
    expect(parseClip(serializeClip(clip), clip.text, labelOf)).toEqual(clip);
  });

  it("reads a payload only beside its own text, whatever line endings the clipboard gave it", () => {
    const clip = draftSlice(base(), 0, 20);
    expect(parseClip(serializeClip(clip), "@Ada Lovelace pleas", labelOf)).toBeNull();
    const lines = { text: "@Ada Lovelace\nplease", mentions: clip.mentions };
    expect(parseClip(serializeClip(lines), "@Ada Lovelace\r\nplease", labelOf)).toEqual(lines);
  });

  it("reads a payload that does not parse, or whose mentions do not read @<label> in order, as no clip", () => {
    const text = "hi @Ada Lovelace";
    const ok = { start: 3, label: "Ada Lovelace", wire: md("Ada Lovelace", "agent", "ceo") };
    const payload = (mentions: unknown) => JSON.stringify({ text, mentions });
    expect(parseClip(payload([ok]), text, labelOf)).toEqual({ text, mentions: [ok] });
    const bad = [
      "",
      "{",
      "null",
      "[]",
      JSON.stringify({ text }),
      JSON.stringify({ text: 1, mentions: [ok] }),
      payload("x"),
      payload([null]),
      payload([{ ...ok, start: "3" }]),
      payload([{ ...ok, start: 3.5 }]),
      payload([{ ...ok, start: -1 }]),
      payload([{ ...ok, start: 2 }]), // not where its @ is
      payload([{ ...ok, start: 30 }]), // past the end
      payload([{ ...ok, label: 7 }]),
      payload([{ ...ok, wire: null }]),
      payload([ok, ok]), // overlapping
    ];
    for (const p of bad) expect(parseClip(p, text, labelOf), p).toBeNull();
  });

  it("brings back only a mention whose label is still what its token shows here", () => {
    const text = "@Ada Lovelace @张三 @Grace";
    const ada = md("Ada Lovelace", "agent", "ceo");
    const mentions = [
      { start: 0, label: "Ada Lovelace", wire: ada },
      // A name that would send someone else's mention.
      { start: 14, label: "张三", wire: ada },
      // Another organization's employee, kept as the legacy bare wire: this one does not know the id.
      { start: 18, label: "Grace", wire: "lab_grace" },
    ];
    expect(parseClip(JSON.stringify({ text, mentions }), text, labelOf)).toEqual({
      text,
      mentions: [mentions[0]],
    });
    const none = JSON.stringify({ text, mentions: mentions.slice(1) });
    expect(parseClip(none, text, labelOf)).toBeNull();
  });

  it("a cut pasted elsewhere is a mention again, and is sent as its span", () => {
    const wire = md("Ada Lovelace", "agent", "ceo");
    const d = base();
    const clip = draftSlice(d, 0, 14);
    const cut = typeAtEnd(deleteSpan(d, 0, 14).draft, " ");
    expect(cut).toEqual({ text: "please ", mentions: [] });
    // The box inserts the text and leaves the caret after it.
    const pasted = draftApplyClip(cut, "please @Ada Lovelace ", 21, clip);
    expect(pasted).toEqual({
      draft: {
        text: "please @Ada Lovelace ",
        mentions: [{ start: 7, label: "Ada Lovelace", wire }],
      },
      caret: 21,
    });
    expect(draftWireText(pasted!.draft)).toBe(`please ${wire} `);
    // Pasted again right after itself: two mentions.
    const twice = draftApplyClip(pasted!.draft, `${pasted!.draft.text}${clip.text}`, 35, clip);
    expect(draftWireText(twice!.draft)).toBe(`please ${wire} ${wire} `);
  });

  it("a paste over a selection replaces it", () => {
    const d = typeAtEnd(EMPTY_DRAFT, "hello world");
    const clip = draftSlice(base(), 0, 13);
    const pasted = draftApplyClip(d, "hello @Ada Lovelace", 19, clip);
    expect(pasted?.draft.mentions).toEqual([
      { start: 6, label: "Ada Lovelace", wire: md("Ada Lovelace", "agent", "ceo") },
    ]);
    expect(pasted?.caret).toBe(19);
  });

  it("a drag within the box moves the mention: deleted where it was, a mention where it lands", () => {
    const wire = md("Ada Lovelace", "agent", "ceo");
    const d = base();
    const clip = draftSlice(d, 0, 13);
    // The box deletes the dragged text (deleteByDrag) …
    const deleted = draftApplyEdit(d, " please", 0).draft;
    expect(deleted).toEqual({ text: " please", mentions: [] });
    // … then inserts it where it lands, left selected (insertFromDrop).
    const dropped = draftApplyClip(deleted, " please@Ada Lovelace", 20, clip);
    expect(dropped?.draft.mentions).toEqual([{ start: 7, label: "Ada Lovelace", wire }]);
    expect(draftWireText(dropped!.draft)).toBe(` please${wire}`);
    expect(tokens(draftWireText(dropped!.draft))).toEqual(["agent:ceo"]);
  });

  it("a clip landing inside a mention replaces the whole of it", () => {
    const zhangsan = md("张三", "agent", "zhangsan");
    const clip = draftSlice(pick(EMPTY_DRAFT, "张", "张三", zhangsan), 0, 3);
    const dropped = draftApplyClip(base(), "@Ada@张三 Lovelace please", 7, clip);
    expect(dropped).toEqual({
      draft: { text: "@张三 please", mentions: [{ start: 0, label: "张三", wire: zhangsan }] },
      caret: 3,
    });
  });

  it("is null when the box inserted something other than the clip in front of the caret", () => {
    const clip = draftSlice(base(), 0, 13);
    const d = typeAtEnd(EMPTY_DRAFT, "hi ");
    expect(draftApplyClip(d, "hi @Ada Lovelac", 15, clip)).toBeNull();
    expect(draftApplyClip(d, "hi  @Ada Lovelace ", 18, clip)).toBeNull();
    expect(draftApplyClip(d, "hi @Ada Lovelace", 3, clip)).toBeNull();
  });
});

describe("the message sent", () => {
  it("a mention glued to a word before it goes out verbatim — the link needs no space", () => {
    const wire = md("Ada", "agent", "ceo");
    const d = pick(EMPTY_DRAFT, "A", "Ada", wire);
    const glued = draftApplyEdit(d, `x${d.text}`, 1).draft;
    expect(glued.mentions).toHaveLength(1);
    expect(draftWireText(glued)).toBe(`x${wire} `);
    expect(tokens(draftWireText(glued))).toEqual(["agent:ceo"]);
  });

  it("text glued right after it goes out verbatim too — neighbours cannot swallow the link", () => {
    const wire = md("Ada", "agent", "ceo");
    const d = pick(EMPTY_DRAFT, "A", "Ada", wire);
    expect(draftWireText(draftApplyEdit(d, "@Aday", 5).draft)).toBe(`${wire}y`);
    expect(draftWireText(draftApplyEdit(d, "@Ada.md", 7).draft)).toBe(`${wire}.md`);
    expect(draftWireText(draftApplyEdit(d, "@Ada.", 5).draft)).toBe(`${wire}.`);
    expect(tokens(`${wire}.md`)).toEqual(["agent:ceo"]);
  });

  it("text right after a CJK name goes out glued to the link, as it always did", () => {
    const wire = md("张三", "agent", "zhangsan");
    const d = pick(EMPTY_DRAFT, "张", "张三", wire);
    const glued = draftApplyEdit(d, "@张三你好", 5).draft;
    expect(draftWireText(glued)).toBe(`${wire}你好`);
    expect(tokens(draftWireText(glued))).toEqual(["agent:zhangsan"]);
  });

  it("an @id typed after a mention is sent as typed and still chips — but only the markdown mention pages", () => {
    const wire = md("张三", "agent", "zhangsan");
    let d = pick(EMPTY_DRAFT, "张", "张三", wire);
    d = draftApplyEdit(d, "@张三", 3).draft; // trailing space deleted
    d = typeAtEnd(d, "@ceo ");
    expect(d.text).toBe("@张三@ceo ");
    expect(tokens(d.text)).toEqual(["ceo"]);
    expect(draftWireText(d)).toBe(`${wire}@ceo `);
    // Both chip in the stream (rendering is generous); only the markdown span triggers (organization/names.ts).
    expect(tokens(draftWireText(d))).toEqual(["agent:zhangsan", "ceo"]);
  });

  it("two glued mentions both convert", () => {
    const zhangsan = md("张三", "agent", "zhangsan");
    const lisi = md("李四", "agent", "lisi");
    let d = pick(EMPTY_DRAFT, "张", "张三", zhangsan);
    d = draftApplyEdit(d, "@张三", 3).draft;
    d = pick(d, "李", "李四", lisi);
    expect(d.text).toBe("@张三@李四 ");
    expect(draftWireText(d)).toBe(`${zhangsan}${lisi} `);
    expect(tokens(draftWireText(d))).toEqual(["agent:zhangsan", "agent:lisi"]);
  });

  it("a mention after a typed token's full stop still needs no space: the stop ends that token", () => {
    // A handle stops at the end of its word (organization/names.ts findMentions), so the `.`
    // after `@bob` is not part of it and the markdown span that follows starts cleanly.
    const wire = md("Ada", "agent", "ceo");
    const d = pick(typeAtEnd(EMPTY_DRAFT, "@bob."), "A", "Ada", wire);
    expect(d.text).toBe("@bob.@Ada ");
    expect(draftWireText(d)).toBe(`@bob.${wire} `);
    expect(tokens(draftWireText(d))).toEqual(["bob", "agent:ceo"]);
  });
});

describe("draftSegments", () => {
  it("splits the draft into plain runs and the mentions the highlight layer tints, glued ones included", () => {
    let d = typeAtEnd(EMPTY_DRAFT, "cc ");
    d = pick(d, "A", "Ada", md("Ada", "agent", "ceo"));
    d = typeAtEnd(d, "and x");
    d = pick(d, "B", "Bob", md("Bob", "agent", "bob"));
    expect(d.text).toBe("cc @Ada and x@Bob ");
    expect(draftSegments(d)).toEqual([
      { text: "cc ", mention: false },
      { text: "@Ada", mention: true },
      { text: " and x", mention: false },
      { text: "@Bob", mention: true },
      { text: " ", mention: false },
    ]);
  });

  it("is empty for an empty draft", () => {
    expect(draftSegments(EMPTY_DRAFT)).toEqual([]);
  });
});
