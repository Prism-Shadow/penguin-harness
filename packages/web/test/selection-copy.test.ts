/** @vitest-environment jsdom */
/**
 * Copying selected text out of the Web App (lib/selection-copy.ts), through the document's real
 * `copy` event and a real jsdom selection. jsdom has no ClipboardEvent or DataTransfer, so the
 * event carries a recording `clipboardData` — the one fake, at the browser's clipboard boundary.
 *
 * - Given text selected in the conversation (a prompt bubble through a reply with code and a
 *   table), when it is copied, the clipboard gets exactly the text the selection reads, as
 *   `text/plain`, and nothing else: the browser's own copy (its HTML with the theme's colours
 *   inlined) is cancelled.
 * - Given a selection in the Files panel preview, a channel message or a Trace row, the same
 *   holds — one listener answers every surface, none of them wires anything of its own.
 * - Given a copy inside a field (the composer's textarea, a contenteditable editor), the field
 *   keeps the browser's copy: nothing written, nothing cancelled.
 * - Given a copy another handler already took (the terminal's), what that handler wrote stays
 *   the whole clipboard.
 * - Given nothing selected, or only whitespace, or a selection of several ranges, the browser
 *   keeps its copy; a copy event a script dispatched without a clipboard is left alone.
 * - Once uninstalled, the document's copy is the browser's again.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSelectionCopy, takesSelectionCopy } from "../src/lib/selection-copy";

/** A copy event as the browser raises it, with the clipboard writes it receives recorded. */
function copyEvent(): { event: Event; writes: [string, string][] } {
  const writes: [string, string][] = [];
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { setData: (type: string, data: string) => writes.push([type, data]) },
  });
  return { event, writes };
}

/** Selects from the start of `from` to the end of `to`, as a drag would. */
function select(from: Node, to: Node): Selection {
  const range = document.createRange();
  range.setStart(from, 0);
  range.setEnd(to, to.childNodes.length);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

/** Copies with the selection as it stands, from `target`, the way the browser targets the event. */
function copyFrom(target: Element): { writes: [string, string][]; cancelled: boolean } {
  const { event, writes } = copyEvent();
  target.dispatchEvent(event);
  return { writes, cancelled: event.defaultPrevented };
}

const $ = (selector: string): HTMLElement => document.querySelector<HTMLElement>(selector)!;

let uninstall: () => void = () => {};

beforeEach(() => {
  document.body.innerHTML = `
    <main>
      <div class="overflow-y-auto" data-surface="conversation" style="background-color: rgb(18, 18, 18); color: rgb(214, 214, 214)">
        <div class="rounded-lg bg-accent-tint"><p id="prompt" style="white-space: pre-wrap">copy style test
second line of the prompt</p></div>
        <div class="md-body" id="reply">
          <p>Here is the <strong>summary</strong> with <code>inline code</code>.</p>
          <pre><code><span style="color:#d73a49">const</span> x = 1;</code></pre>
          <table><tbody><tr><td>alpha</td><td>1</td></tr></tbody></table>
        </div>
      </div>
      <section data-surface="files"><div class="md-body"><h1 id="file">Notes</h1></div></section>
      <section data-surface="channel"><div class="md-body"><p id="channel">Launch is <em>Friday</em>.</p></div></section>
      <section data-surface="trace"><div class="md-body"><p id="trace">Called exec_command.</p></div></section>
      <textarea id="composer">a draft</textarea>
      <div id="editor" contenteditable="true">editable text</div>
      <div id="terminal"><span id="terminal-row">$ ls</span></div>
    </main>`;
  uninstall = installSelectionCopy(document);
});

afterEach(() => {
  uninstall();
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("copying selected text", () => {
  it("a conversation selection goes on the clipboard as its text alone, and the browser's own copy is cancelled", () => {
    const selection = select($("#prompt"), $("#reply"));
    const text = selection.toString();
    expect(text).toContain("second line of the prompt");
    expect(text).toContain("const x = 1;");

    const { writes, cancelled } = copyFrom($("#prompt"));

    expect(writes).toEqual([["text/plain", text]]);
    expect(cancelled).toBe(true);
  });

  it.each(["#file", "#channel", "#trace"])(
    "a selection in another surface (%s) copies the same way, with nothing of its own wired",
    (selector) => {
      const selection = select($(selector), $(selector));

      const { writes, cancelled } = copyFrom($(selector));

      expect(writes).toEqual([["text/plain", selection.toString()]]);
      expect(cancelled).toBe(true);
    },
  );

  it("a copy inside the composer's textarea is the field's own: nothing written, nothing cancelled", () => {
    // The document's selection may still sit on conversation text; the field is what copies.
    select($("#reply"), $("#reply"));

    const { writes, cancelled } = copyFrom($("#composer"));

    expect(writes).toEqual([]);
    expect(cancelled).toBe(false);
  });

  it("a selection inside a contenteditable editor keeps the browser's copy", () => {
    select($("#editor"), $("#editor"));

    const { writes, cancelled } = copyFrom($("#editor"));

    expect(writes).toEqual([]);
    expect(cancelled).toBe(false);
  });

  it("a copy the terminal already took keeps what the terminal wrote", () => {
    select($("#reply"), $("#reply"));
    $("#terminal").addEventListener("copy", (e) => {
      (e as ClipboardEvent).clipboardData!.setData("text/plain", "$ ls");
      e.preventDefault();
    });

    const { writes, cancelled } = copyFrom($("#terminal-row"));

    expect(writes).toEqual([["text/plain", "$ ls"]]);
    expect(cancelled).toBe(true);
  });

  it("a copy event a script dispatched, with no clipboard to write to, is left alone", () => {
    select($("#reply"), $("#reply"));
    const event = new Event("copy", { bubbles: true, cancelable: true });

    expect(() => $("#reply").dispatchEvent(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(false);
  });

  it("nothing selected keeps the browser's copy", () => {
    document.getSelection()!.removeAllRanges();

    expect(copyFrom($("#reply"))).toEqual({ writes: [], cancelled: false });
  });

  it("a collapsed or whitespace-only selection keeps the browser's copy", () => {
    const selection = document.getSelection()!;
    selection.collapse($("#reply"), 0);
    expect(copyFrom($("#reply"))).toEqual({ writes: [], cancelled: false });

    const blank = document.createTextNode(" \n\t ");
    $("#reply").append(blank);
    select(blank, blank);
    expect(selection.toString().trim()).toBe("");
    expect(copyFrom($("#reply"))).toEqual({ writes: [], cancelled: false });
  });

  it("a selection of several ranges is left for the browser to join", () => {
    // jsdom holds one range at most, so the rule is asked directly.
    expect(
      takesSelectionCopy({ selectedText: "two ranges", rangeCount: 2, onEditable: false }),
    ).toBe(false);
    expect(
      takesSelectionCopy({ selectedText: "one range", rangeCount: 1, onEditable: false }),
    ).toBe(true);
  });

  it("once uninstalled, the document's copy is the browser's again", () => {
    uninstall();
    select($("#reply"), $("#reply"));

    expect(copyFrom($("#reply"))).toEqual({ writes: [], cancelled: false });
  });
});
