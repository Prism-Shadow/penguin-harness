/**
 * The Activity Spec editor: the specification JSON on one full-height monospace surface, as
 * Loom shows it. Diff compares the text against the last save, inline or side by side, with
 * Loom's toolbar: change counts, previous and next, Revert all, and a minimap of the changes.
 *
 * CodeMirror owns the document while the author types; `value` is pushed in only when it
 * changes from outside, as after a save, a reload, a restored candidate or Revert all.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  HighlightStyle,
  codeFolding,
  foldGutter,
  foldKeymap,
  foldedRanges,
  indentOnInput,
  syntaxHighlighting,
  unfoldEffect,
} from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { MergeView, goToNextChunk, goToPreviousChunk } from "@codemirror/merge";
import { search, searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { Button } from "../../components/ui/button";
import { S } from "../../lib/strings";
import { toneDot, toneInk } from "../../lib/tone";
import { diffMarkers } from "./script-model";
import { COLLAPSE, savedDiff } from "./script-editor";
import { diffLines, diffStats, stepRegion } from "./spec-diff";

/** JSON's parts as classes; their colours are in styles.css, matching the app's code views. */
const jsonHighlight = HighlightStyle.define([
  { tag: tags.propertyName, class: "cm-json-key" },
  { tag: tags.string, class: "cm-json-string" },
  { tag: [tags.number, tags.bool, tags.null], class: "cm-json-literal" },
  {
    tag: [tags.brace, tags.squareBracket, tags.separator, tags.punctuation],
    class: "cm-json-punctuation",
  },
]);

/** Never a real setting, so a comparison against it always writes. */
const STALE = "\u0000stale";

type Access = "edit" | "read" | "disabled";
type Layout = "inline" | "side-by-side";

const LAYOUT_KEY = "penguin.activitySpec.diffLayout";

function readLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "side-by-side" ? "side-by-side" : "inline";
  } catch {
    // Private windows and blocked site data throw rather than return null.
    return "inline";
  }
}

function writeLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // A remembered layout is a convenience; losing it is not worth failing the toggle.
  }
}

/** What every editor of the specification shares, inline or either side of a side-by-side. */
function common(): Extension {
  return [
    history(),
    json(),
    syntaxHighlighting(jsonHighlight),
    codeFolding({ placeholderText: "…" }),
    foldGutter(),
    indentOnInput(),
    search({ top: true }),
    EditorState.tabSize.of(2),
    EditorState.phrases.of(S.activities.studioScript.editorPhrases),
    keymap.of([
      { key: "Alt-ArrowDown", run: goToNextChunk },
      { key: "Alt-ArrowUp", run: goToPreviousChunk },
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
    ]),
  ];
}

function accessExtensions(access: Access): Extension {
  return [
    EditorState.readOnly.of(access !== "edit"),
    EditorView.editable.of(access !== "disabled"),
    EditorView.contentAttributes.of(access === "read" ? { "aria-readonly": "true" } : {}),
  ];
}

/** Why `text` is not a specification the server could take, or null when it parses. */
function parseProblem(text: string): string | null {
  if (!text.trim()) return S.activities.studioSpec.empty;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? null
      : S.activities.studioSpec.notObject;
  } catch (error) {
    return S.activities.studioSpec.invalid(error instanceof Error ? error.message : String(error));
  }
}

/** Puts `line` in view in `view`, unfolding whatever hides it, and the cursor on it. */
function goTo(view: EditorView | null | undefined, line: number) {
  if (!view || line < 1) return;
  const pos = view.state.doc.line(Math.min(line, view.state.doc.lines)).from;
  const effects: ReturnType<typeof unfoldEffect.of>[] = [];
  foldedRanges(view.state).between(pos, pos, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  view.dispatch({
    selection: { anchor: pos },
    effects: [...effects, EditorView.scrollIntoView(pos, { y: "center" })],
  });
  view.focus();
}

export function SpecEditor({
  subject,
  value,
  saved,
  editable,
  readOnly,
  busy,
  onChange,
  onSave,
}: {
  /** Which activity and ref this is, for the title, as Loom names its panels. */
  subject: string;
  value: string;
  /** The specification as last saved, pretty-printed. */
  saved: string;
  /** Whether this author may save, which shows the Save action. */
  editable: boolean;
  /** Text stays selectable but cannot change, as on a draft that is not available here. */
  readOnly: boolean;
  busy: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const words = S.activities.studioSpec;
  const host = useRef<HTMLDivElement>(null);
  const mergeHost = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const mergeRef = useRef<MergeView | null>(null);
  const applied = useRef({ diff: STALE, saved: STALE, access: STALE });
  const compartments = useRef({ diff: new Compartment(), access: new Compartment() }).current;
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  // Both the inline editor and the right-hand side of side by side report the author's edits.
  const reportEdits = useRef(
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const text = update.state.doc.toString();
      if (text !== latest.current.value) latest.current.onChange(text);
    }),
  ).current;

  const [diffMode, setDiffMode] = useState(false);
  const [layout, setLayout] = useState<Layout>(readLayout);
  const [active, setActive] = useState(-1);
  const sideBySide = diffMode && layout === "side-by-side";
  const changed = value !== saved;
  const problem = useMemo(() => (changed ? parseProblem(value) : null), [changed, value]);
  const access: Access = readOnly ? "read" : editable && !busy ? "edit" : "disabled";

  const rows = useMemo(() => (diffMode ? diffLines(saved, value) : []), [diffMode, saved, value]);
  const stats = useMemo(() => diffStats(rows), [rows]);
  const markers = useMemo(() => diffMarkers(rows, value.split("\n").length), [rows, value]);
  const current = active < markers.length ? active : -1;

  /** The editor holding the author's text right now: the inline one or the right-hand side. */
  const editorView = () => (sideBySide ? mergeRef.current?.b : viewRef.current);

  function step(direction: 1 | -1) {
    const next = stepRegion(current, markers.length, direction);
    if (next < 0) return;
    setActive(next);
    goTo(editorView(), markers[next]!.line);
  }

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          common(),
          EditorView.contentAttributes.of({ "aria-label": words.editor }),
          compartments.diff.of([]),
          compartments.access.of([]),
          reportEdits,
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [compartments, words.editor]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || sideBySide) return;
    if (view.state.doc.toString() !== value)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    const diff = diffMode ? "saved" : "off";
    const last = applied.current;
    if (last.diff !== diff || last.saved !== saved || last.access !== access) {
      // A merge view takes its original once, when it is configured; a new one replaces it.
      view.dispatch({ effects: compartments.diff.reconfigure([]) });
      view.dispatch({
        effects: [
          compartments.diff.reconfigure(diffMode ? savedDiff(saved, access === "edit") : []),
          compartments.access.reconfigure(accessExtensions(access)),
        ],
      });
    }
    applied.current = { diff, saved, access };
  }, [value, saved, diffMode, sideBySide, access, compartments]);

  // Side by side is its own pair of editors, built while it shows and rebuilt for a new save.
  useEffect(() => {
    if (!sideBySide) return;
    const merge = new MergeView({
      parent: mergeHost.current!,
      collapseUnchanged: COLLAPSE,
      gutter: true,
      a: {
        doc: saved,
        extensions: [
          common(),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ "aria-label": words.savedSide }),
        ],
      },
      b: {
        doc: latest.current.value,
        extensions: [
          common(),
          accessExtensions(access),
          EditorView.contentAttributes.of({ "aria-label": words.editor }),
          reportEdits,
        ],
      },
      ...(access === "edit"
        ? {
            revertControls: "a-to-b" as const,
            renderRevertControl: () => {
              const button = document.createElement("button");
              button.type = "button";
              button.className = "cm-revert";
              button.textContent = S.activities.studioScript.revert;
              return button;
            },
          }
        : {}),
    });
    mergeRef.current = merge;
    return () => {
      merge.destroy();
      mergeRef.current = null;
    };
  }, [sideBySide, saved, access, words.editor, words.savedSide]);

  useEffect(() => {
    const b = mergeRef.current?.b;
    if (b && b.state.doc.toString() !== value)
      b.dispatch({ changes: { from: 0, to: b.state.doc.length, insert: value } });
  }, [value, sideBySide]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <h2 className="min-w-0 truncate text-sm font-semibold">{words.title(subject)}</h2>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={diffMode}
          title={!diffMode && changed ? words.diffHint : words.diffHelp}
          onClick={() => {
            setDiffMode((open) => !open);
            setActive(-1);
          }}
        >
          <span className="inline-flex items-center gap-1.5">
            {words.diff}
            {!diffMode && changed && (
              <span aria-hidden="true" className={`size-1.5 rounded-full ${toneDot.attention}`} />
            )}
          </span>
        </Button>
        {editable && (
          <Button size="sm" onClick={onSave} disabled={busy || !changed || problem !== null}>
            {words.save}
          </Button>
        )}
      </div>
      {diffMode && (
        <div
          role="toolbar"
          aria-label={words.toolbar}
          className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-1.5 dark:border-gray-800"
        >
          <span className="text-xs text-gray-500">{words.base}</span>
          {stats.regions > 0 ? (
            <div role="group" aria-label={words.changes} className="flex items-center gap-1">
              <span aria-live="polite" className="text-xs text-gray-500 tabular-nums">
                {words.stats(stats.added, stats.removed, stats.regions)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={words.previous}
                title={words.previousHelp}
                onClick={() => step(-1)}
              >
                ◀
              </Button>
              <span aria-live="polite" className="text-xs text-gray-500 tabular-nums">
                {words.counter(current, stats.regions)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={words.next}
                title={words.nextHelp}
                onClick={() => step(1)}
              >
                ▶
              </Button>
            </div>
          ) : (
            <span aria-live="polite" className="text-xs text-gray-500">
              {S.activities.studioScript.noChanges}
            </span>
          )}
          <span className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={sideBySide}
            title={sideBySide ? words.inlineHelp : words.sideBySideHelp}
            onClick={() => {
              const next = sideBySide ? "inline" : "side-by-side";
              setLayout(next);
              writeLayout(next);
            }}
          >
            {sideBySide ? words.inline : words.sideBySide}
          </Button>
          {access === "edit" && stats.regions > 0 && (
            <Button
              size="sm"
              variant="ghost"
              title={words.revertAllHelp}
              onClick={() => {
                setActive(-1);
                onChange(saved);
              }}
            >
              {words.revertAll}
            </Button>
          )}
        </div>
      )}
      {problem && (
        <p
          role="status"
          className={`border-b border-gray-200 px-4 py-1.5 text-xs dark:border-gray-800 ${toneInk.attention}`}
        >
          {problem}
        </p>
      )}
      <div className={sideBySide ? "hidden" : "flex min-h-0 flex-1"}>
        <div ref={host} className="script-editor min-h-0 min-w-0 flex-1" />
        {diffMode && markers.length > 0 && (
          <div
            role="group"
            aria-label={words.minimap}
            className="relative w-2.5 shrink-0 border-l border-gray-200 dark:border-gray-800"
          >
            {markers.map((marker, index) => (
              <button
                key={`${marker.line}:${marker.top}`}
                type="button"
                aria-label={words.jump(index + 1)}
                title={words.jump(index + 1)}
                onClick={() => {
                  setActive(index);
                  goTo(viewRef.current, marker.line);
                }}
                style={{ top: `${marker.top}%`, height: `${marker.height}%` }}
                className="absolute inset-x-0.5 min-h-1 rounded-sm bg-brand-400 hover:bg-brand-600 dark:bg-brand-500"
              />
            ))}
          </div>
        )}
      </div>
      <div
        ref={mergeHost}
        aria-label={words.sideBySideLabel}
        className={sideBySide ? "script-editor spec-merge min-h-0 min-w-0 flex-1" : "hidden"}
      />
    </div>
  );
}
