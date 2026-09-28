/**
 * The Activity Script editor: one monospace surface where scenes fold to
 * their headings, media elements stand out from the prose around them, and a diff against
 * a chosen base is drawn in place rather than in a second view.
 *
 * There are two bases. "Since last save" is the author's own edits, each change revertible
 * where it stands. "Agent proposal" swaps in the proposed script, read-only, drawn against
 * what the author has now; the author's editor state is kept aside meanwhile, undo history
 * and all, and comes back untouched. A draft keeps no history, so there is no base older
 * than the last save.
 *
 * CodeMirror owns the document while the author types; `value` is pushed in only when it
 * changes from outside, as after a reload or an accepted proposal.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Compartment, EditorState, Facet, RangeSetBuilder, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  codeFolding,
  foldAll,
  foldGutter,
  foldKeymap,
  foldService,
  foldedRanges,
  unfoldAll,
  unfoldEffect,
} from "@codemirror/language";
import { goToNextChunk, goToPreviousChunk, unifiedMergeView } from "@codemirror/merge";
import { search, searchKeymap } from "@codemirror/search";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  diffMarkers,
  mediaTagSpans,
  sceneRanges,
  scenesTouched,
  type ScriptScene,
} from "./script-model";
import { diffLines, diffStats } from "./spec-diff";

export type ScriptDiffBase = "off" | "saved" | "proposal";

/**
 * "read" keeps the text focusable and selectable, so an author can still copy out of a
 * draft they can no longer save; "disabled" is a draft they may not touch at all.
 */
export type ScriptAccess = "edit" | "read" | "disabled";

function accessExtensions(access: ScriptAccess) {
  return [
    EditorState.readOnly.of(access !== "edit"),
    EditorView.editable.of(access !== "disabled"),
    EditorView.contentAttributes.of(access === "read" ? { "aria-readonly": "true" } : {}),
  ];
}

/** A document's scenes, worked out once per document rather than once per line asked about. */
const scenesByDoc = new WeakMap<
  Text,
  { list: ScriptScene[]; byHeading: Map<number, ScriptScene> }
>();
function scenesOf(doc: Text) {
  let entry = scenesByDoc.get(doc);
  if (!entry) {
    const list = sceneRanges(doc.toString());
    entry = { list, byHeading: new Map(list.map((scene) => [scene.heading, scene])) };
    scenesByDoc.set(doc, entry);
  }
  return entry;
}

/** A scene folds from the end of its heading to the end of its last line. */
const sceneFolding = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const scene = scenesOf(state.doc).byHeading.get(line.number);
  if (!scene || scene.last <= scene.heading) return null;
  return { from: line.to, to: state.doc.line(scene.last).to };
});

/** Scene numbers an open proposal changes, marked on their headings. */
const proposedScenes = Facet.define<number[], ReadonlySet<number>>({
  combine: (values) => new Set(values.flat()),
});

class ProposedHint extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: ProposedHint) {
    return other.text === this.text;
  }
  toDOM() {
    const hint = document.createElement("span");
    // A proposal waiting on the author is an attention state; its ink comes from tone.ts.
    hint.className = `cm-proposed-hint ${toneInk.attention}`;
    hint.textContent = this.text;
    return hint;
  }
}

const headingLine = Decoration.line({ class: "cm-scene-heading" });
const tagMark = Decoration.mark({ class: "cm-media-tag" });

function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  const scenes = scenesOf(doc).byHeading;
  const proposed = view.state.facet(proposedScenes);
  let done = 0;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      // Two visible ranges can share a line either side of a fold.
      if (line.number <= done) continue;
      done = line.number;
      const scene = scenes.get(line.number);
      if (scene) builder.add(line.from, line.from, headingLine);
      for (const span of mediaTagSpans(line.text))
        builder.add(line.from + span.from, line.from + span.to, tagMark);
      if (scene && proposed.has(scene.number))
        builder.add(
          line.to,
          line.to,
          Decoration.widget({
            widget: new ProposedHint(S.activities.studioScript.proposed),
            side: 1,
          }),
        );
    }
  }
  return builder.finish();
}

const scriptDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.startState.facet(proposedScenes) !== update.state.facet(proposedScenes)
      )
        this.decorations = decorate(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** What every state of this editor shares, author's or proposal's. */
function common() {
  return [
    history(),
    codeFolding({ placeholderText: "…" }),
    foldGutter(),
    sceneFolding,
    scriptDecorations,
    search({ top: true }),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": S.activities.studioScript.label }),
    // The editor's own words (search, folding, merge controls) in the app's dictionary.
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

/** Never a real setting, so a comparison against it always writes. */
const STALE = "\u0000stale";

/** Unchanged stretches longer than this fold away in a diff, leaving a few lines of context. */
const COLLAPSE = { margin: 3, minSize: 8 };

function savedDiff(saved: string, editable: boolean) {
  return unifiedMergeView({
    original: saved,
    gutter: true,
    collapseUnchanged: COLLAPSE,
    // Only "revert" means anything against the last save: accepting an edit into the saved
    // text is what Save does, for the whole script at once.
    mergeControls: editable
      ? (type, action) => {
          if (type === "accept") return document.createElement("span");
          const button = document.createElement("button");
          button.type = "button";
          button.className = "cm-revert";
          button.textContent = S.activities.studioScript.revert;
          button.onmousedown = action;
          return button;
        }
      : false,
  });
}

export function ScriptEditor({
  value,
  saved,
  proposal,
  access,
  canSave,
  saveDisabled,
  status = null,
  acceptBlocked,
  onChange,
  onSave,
  onAcceptProposal,
}: {
  value: string;
  /** The script as last saved. */
  saved: string;
  /** The open proposal's script, when the agent proposed one that differs from the draft. */
  proposal: string | null;
  access: ScriptAccess;
  /** Whether this author may save at all, which shows the Save action. */
  canSave: boolean;
  saveDisabled: boolean;
  /** Where saving stands, in words: pending, saving, saved or failed. */
  status?: string | null;
  /** Why the proposal cannot be accepted right now, if it cannot. */
  acceptBlocked: string | null;
  onChange: (value: string) => void;
  onSave: () => void;
  onAcceptProposal?: () => void;
}) {
  const words = S.activities.studioScript;
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The author's own state, set aside while the proposal is shown in its place.
  const stash = useRef<EditorState | null>(null);
  const applied = useRef({ base: STALE, saved: STALE, access: STALE, hints: STALE });
  const compartments = useRef({
    diff: new Compartment(),
    access: new Compartment(),
    hints: new Compartment(),
  }).current;
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  const [choice, setChoice] = useState<ScriptDiffBase>("off");
  const base: ScriptDiffBase = choice === "proposal" && proposal === null ? "off" : choice;
  const [folded, setFolded] = useState(false);

  // What the diff reads: the base's text against the text the editor shows.
  const [before, after] =
    base === "proposal" ? [value, proposal ?? ""] : base === "saved" ? [saved, value] : ["", ""];
  const rows = useMemo(
    () => (base === "off" ? [] : diffLines(before, after)),
    [base, before, after],
  );
  const stats = useMemo(() => diffStats(rows), [rows]);
  const shownScenes = useMemo(() => sceneRanges(after), [after]);
  const changed = useMemo(() => scenesTouched(rows, shownScenes), [rows, shownScenes]);
  const markers = useMemo(() => diffMarkers(rows, after.split("\n").length), [rows, after]);
  // Headings the proposal would change, marked while the author works on their own text.
  const hinted = useMemo(
    () =>
      proposal === null || base === "proposal"
        ? []
        : scenesTouched(diffLines(value, proposal), sceneRanges(proposal)),
    [proposal, base, value],
  );

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          common(),
          compartments.diff.of([]),
          compartments.access.of([]),
          compartments.hints.of([]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const text = update.state.doc.toString();
            if (text !== latest.current.value) latest.current.onChange(text);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [compartments]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (base === "proposal") {
      if (!stash.current) stash.current = view.state;
      view.setState(
        EditorState.create({
          doc: proposal ?? "",
          extensions: [
            common(),
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            unifiedMergeView({
              original: value,
              gutter: true,
              collapseUnchanged: COLLAPSE,
              mergeControls: false,
            }),
          ],
        }),
      );
      return;
    }
    if (stash.current) {
      view.setState(stash.current);
      stash.current = null;
      // The stashed state carries whatever was configured when it was set aside, so
      // nothing it holds can be assumed current: mark every setting as needing a write.
      applied.current = { base: STALE, saved: STALE, access: STALE, hints: STALE };
    }
    if (view.state.doc.toString() !== value)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    const last = applied.current;
    if (last.base !== base || last.saved !== saved || last.access !== access) {
      // A merge view takes its original once, when it is configured; a new base needs a
      // fresh one, so the old is taken out before the new goes in.
      view.dispatch({ effects: compartments.diff.reconfigure([]) });
      view.dispatch({
        effects: [
          compartments.diff.reconfigure(
            base === "saved" ? savedDiff(saved, access === "edit") : [],
          ),
          compartments.access.reconfigure(accessExtensions(access)),
        ],
      });
    }
    const hints = hinted.join(",");
    if (last.hints !== hints)
      view.dispatch({ effects: compartments.hints.reconfigure(proposedScenes.of(hinted)) });
    applied.current = { base, saved, access, hints };
  }, [base, proposal, saved, value, access, hinted, compartments]);

  function goTo(line: number) {
    const view = viewRef.current;
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

  function toggleScenes() {
    const view = viewRef.current;
    if (!view) return;
    if (folded) unfoldAll(view);
    else foldAll(view);
    setFolded(!folded);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <h2 className="text-sm font-semibold">{words.label}</h2>
        {status && (
          <span aria-live="polite" className="text-xs text-gray-500">
            {status}
          </span>
        )}
        <span className="flex-1" />
        {base !== "off" && (
          <span aria-live="polite" className="text-xs text-gray-500 tabular-nums">
            {stats.added || stats.removed
              ? words.stats(stats.added, stats.removed)
              : words.noChanges}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={folded}
          title={words.scenesHelp}
          onClick={toggleScenes}
        >
          {words.scenes}
        </Button>
        <div className="w-40">
          <Select
            size="sm"
            aria-label={words.diff}
            value={base}
            onChange={(event) => setChoice(event.target.value as ScriptDiffBase)}
          >
            <option value="off">{`${words.diff}: ${words.diffOff}`}</option>
            <option value="saved">{`${words.diff}: ${words.diffSaved}`}</option>
            <option value="proposal" disabled={proposal === null}>
              {`${words.diff}: ${words.diffProposal}`}
            </option>
          </Select>
        </div>
        {canSave && (
          <Button size="sm" onClick={onSave} disabled={saveDisabled || base === "proposal"}>
            {words.save}
          </Button>
        )}
      </div>
      {base === "proposal" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
          <p className="min-w-0 flex-1 text-xs text-gray-500">{words.proposalShown}</p>
          {acceptBlocked && <p className={`text-xs ${toneInk.attention}`}>{acceptBlocked}</p>}
          {onAcceptProposal && (
            <Button
              size="sm"
              variant="primary"
              disabled={!!acceptBlocked}
              onClick={onAcceptProposal}
            >
              {words.acceptProposal}
            </Button>
          )}
        </div>
      )}
      {changed.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 px-4 py-1.5 dark:border-gray-800">
          <span className="text-xs text-gray-500">{words.changedScenes}</span>
          {changed.map((number) => (
            <button
              key={number}
              type="button"
              onClick={() =>
                goTo(shownScenes.find((scene) => scene.number === number)?.heading ?? 0)
              }
              className="rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950"
            >
              {words.scene(number)}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div ref={host} className="script-editor min-h-0 min-w-0 flex-1" />
        {markers.length > 0 && (
          <div
            role="group"
            aria-label={words.minimap}
            className="relative w-2.5 shrink-0 border-l border-gray-200 dark:border-gray-800"
          >
            {markers.map((marker) => (
              <button
                key={`${marker.line}:${marker.top}`}
                type="button"
                aria-label={words.jump(marker.line)}
                title={words.jump(marker.line)}
                onClick={() => goTo(marker.line)}
                style={{ top: `${marker.top}%`, height: `${marker.height}%` }}
                className="absolute inset-x-0.5 min-h-1 rounded-sm bg-brand-400 hover:bg-brand-600 dark:bg-brand-500"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
