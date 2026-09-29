/**
 * Composer: the card the user types into, in the states it is seen in — empty, while a Task runs
 * (stop instead of send), carrying two attachment chips, with the slash-command menu open above
 * it, and with the model picker open over its model trigger. The empty card is the one the reader
 * types into: it takes a draft, sends it, attaches and drops chips, and opens the slash menu.
 * Static stand-ins for W6's `ComposerCard`, `ChipRow`, `ToolbarTrigger`, `SendButton`, `SlashMenu`
 * and `ModelSelect`.
 */
import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { AttachmentChip, Fixtures, ModelFixture } from "../fixtures";
import { APP_COLUMN_WIDTH, defineModule } from "../module";
import { AgentTile } from "../screens/parts";
import { tokens, usd } from "../screens/format";
import { ComposerChips, ComposerToolbar, SendButton, StopButton } from "../screens/transcript";
import {
  FloatingPanel,
  GlyphIcon,
  Kbd,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Presence,
  SearchInput,
  useLater,
} from "./parts";
import { attach, slashMatches } from "./interaction";
import type { SlashEntry } from "./interaction";

/** The static picks. */
type ComposerState = "idle" | "running" | "chips" | "slash" | "picker";

/** What the reader's card holds and how it answers: `Idle` keeps the state, the card draws it. */
interface LiveCard {
  draft: string;
  chips: readonly AttachmentChip[];
  onDraft: (draft: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onRemove: (label: string) => void;
  onPlus: () => void;
  send: ReactNode;
}

/**
 * The card in one state. It is the chat's own composer (screens/transcript.tsx) — the chips, the
 * draft and the control row — so the two cannot drift apart; only what a state changes is here.
 * The model picker opens on the new-chat page, the one place the model can still be changed, so
 * that state draws the card as it is there: no context gauge yet, and a chevron on the model.
 * Given `live`, the draft is a real field the reader types into, in the same box, and the card
 * wears the focus ring while it has focus.
 */
function ComposerCard({ f, state, live }: { f: Fixtures; state: ComposerState; live?: LiveCard }) {
  const s = f.session;
  const c = f.copy.chat;
  if (live !== undefined) {
    return (
      <div className="ui-glass @container rounded-lg border border-line-emphasis bg-surface px-2.5 pb-2 pt-2 transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:[box-shadow:var(--ui-focus-ring-input)]">
        <ComposerChips
          chips={live.chips}
          removeLabel={f.copy.common.remove}
          onRemove={live.onRemove}
        />
        <textarea
          value={live.draft}
          onChange={(event) => live.onDraft(event.target.value)}
          onKeyDown={live.onKeyDown}
          placeholder={c.inputPlaceholder}
          aria-label={c.inputPlaceholder}
          rows={2}
          className="block min-h-[3.75rem] w-full resize-none bg-transparent px-1 py-0.5 font-sans text-base leading-6 text-fg outline-none placeholder:text-fg-subtle"
        />
        <ComposerToolbar
          f={f}
          skills={live.chips.filter((chip) => chip.kind === "skill").length}
          onPlus={live.onPlus}
          send={live.send}
        />
      </div>
    );
  }
  const draft =
    state === "idle" || state === "running" ? "" : state === "slash" ? "/" : s.composer.draft;
  const chips = state === "chips" || state === "picker" ? s.composer.chips : [];
  const ready = draft !== "" && state !== "slash";
  return (
    <div className="ui-glass @container rounded-lg border border-line-emphasis bg-surface px-2.5 pb-2 pt-2">
      <ComposerChips chips={chips} />
      <p
        className={`min-h-[3.75rem] px-1 py-0.5 font-sans text-base leading-6 ${draft ? "text-fg" : "text-fg-subtle"}`}
      >
        {draft || c.inputPlaceholder}
        {draft && <span aria-hidden className="ml-px inline-block h-5 w-px translate-y-1 bg-fg" />}
      </p>
      <ComposerToolbar
        f={f}
        session={state !== "picker"}
        skills={chips.filter((chip) => chip.kind === "skill").length}
        send={state === "running" ? <StopButton f={f} /> : <SendButton f={f} ready={ready} />}
      />
    </div>
  );
}

/** What the slash menu offers: the commands, then every enabled plugin's skill by its name. */
function slashEntries(f: Fixtures): SlashEntry[] {
  return [
    ...f.slashCommands.map((command) => ({
      kind: "command" as const,
      name: command.name,
      icon: command.icon,
      description: command.description,
    })),
    ...f.plugins
      .filter((plugin) => plugin.enabled)
      .map((plugin) => ({
        kind: "skill" as const,
        name: `/${plugin.name}`,
        icon: "book" as const,
        description: plugin.description,
      })),
  ];
}

/**
 * The menu `/` opens: the commands under their label, a rule, then the skills. As a still it
 * lists everything with the first row under the cursor; the live composer hands it the entries
 * its draft still matches, the cursor, and what a pick does.
 */
function SlashMenu({
  f,
  entries = slashEntries(f),
  active = 0,
  onPick,
  onHover,
}: {
  f: Fixtures;
  entries?: readonly SlashEntry[];
  active?: number;
  onPick?: (entry: SlashEntry) => void;
  onHover?: (index: number) => void;
}) {
  const c = f.copy.chat;
  const commands = entries.filter((entry) => entry.kind === "command");
  const skills = entries.filter((entry) => entry.kind === "skill");
  const row = (entry: SlashEntry) => {
    const index = entries.indexOf(entry);
    return (
      <MenuItem
        key={entry.name}
        icon={entry.icon}
        label={entry.name}
        description={entry.description}
        active={index === active}
        onClick={onPick && (() => onPick(entry))}
        onHover={onHover && (() => onHover(index))}
      />
    );
  };
  return (
    <FloatingPanel className="w-96">
      {commands.length > 0 && <MenuLabel>{c.commands}</MenuLabel>}
      {commands.map(row)}
      {commands.length > 0 && skills.length > 0 && <MenuSeparator />}
      {skills.length > 0 && <MenuLabel>{c.skills}</MenuLabel>}
      {skills.map(row)}
    </FloatingPanel>
  );
}

function ModelRow({
  model,
  selected,
  onPick,
}: {
  model: ModelFixture;
  selected: boolean;
  onPick?: () => void;
}) {
  const className = `flex w-full items-center gap-2 rounded-[var(--radius-inner)] px-2 py-1.5 text-left ${selected ? "bg-surface-muted" : ""}`;
  const body = (
    <>
      <AgentTile id={model.provider} name={model.providerLabel} size={18} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-fg">{model.displayName}</span>
        {model.note && <span className="block truncate text-xs text-fg-muted">{model.note}</span>}
      </span>
      <span className="shrink-0 text-right font-mono text-xs tabular-nums text-fg-muted">
        {tokens(model.contextWindow)} · {usd(model.pricing.output)}/M
      </span>
      <span className="w-4 shrink-0 text-fg-muted">
        {selected && <GlyphIcon name="check" size={14} />}
      </span>
    </>
  );
  return onPick === undefined ? (
    <span className={className}>{body}</span>
  ) : (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={`${className} transition-colors duration-150 hover:bg-surface-muted`}
    >
      {body}
    </button>
  );
}

/**
 * The model picker the new-chat composer's model trigger opens: a search, then the first three
 * providers' models with the one in use ticked. Exported for the app shell, which hangs it off
 * its own composer; `selected` and `onPick` make it a live list, and without them it is the still.
 */
export function ModelPicker({
  f,
  selected = f.session.model.modelId,
  onPick,
}: {
  f: Fixtures;
  /** The model id ticked. */
  selected?: string;
  onPick?: (modelId: string) => void;
}) {
  // The first three providers: enough to show grouping without a scroll.
  const providers = [...new Set(f.models.map((m) => m.providerLabel))].slice(0, 3);
  return (
    <FloatingPanel className="w-96">
      <div className="p-1">
        <SearchInput placeholder={f.copy.models.search} />
      </div>
      {providers.map((provider) => (
        <div key={provider}>
          <MenuLabel>{provider}</MenuLabel>
          {f.models
            .filter((m) => m.providerLabel === provider)
            .map((m) => (
              <ModelRow
                key={m.modelId}
                model={m}
                selected={m.modelId === selected}
                onPick={onPick && (() => onPick(m.modelId))}
              />
            ))}
        </div>
      ))}
    </FloatingPanel>
  );
}

function Composition({ f, state }: { f: Fixtures; state: ComposerState }) {
  const menu =
    state === "slash" ? (
      <div className="flex justify-start px-2">
        <SlashMenu f={f} />
      </div>
    ) : state === "picker" ? (
      <div className="flex justify-end px-2">
        <ModelPicker f={f} />
      </div>
    ) : null;
  return (
    <div
      className={`mx-auto flex ${menu === null ? "" : "min-h-80"} max-w-3xl flex-col justify-end gap-2`}
    >
      {menu}
      <ComposerCard f={f} state={state} />
      {state === "slash" && <SlashHints />}
    </div>
  );
}

/** How long a sent draft runs before the card is ready again: long enough to read the stop. */
const RUN_MS = 2400;

/** The slash menu's key hints, under the card while it is open. */
function SlashHints() {
  return (
    <p className="flex items-center gap-2 px-2 text-xs text-fg-muted">
      <Kbd keys={["↑", "↓"]} />
      <Kbd keys={["Enter"]} />
      <Kbd keys={["Esc"]} />
    </p>
  );
}

/**
 * The empty card, for the reader to use. It opens as the still does — empty, send off — and then
 * takes typing: send lights up once there is something to send, and Enter or send puts the draft
 * above the card as the user's bubble while the button turns to stop for a moment, as a started
 * run does. `+` attaches the Session's file chip and the chips' crosses drop them. A draft that
 * starts with `/` opens the slash menu over the card, narrowed by what follows the slash: arrows
 * move its cursor, Enter or a click picks — a command into the draft, a skill as a chip — and Esc
 * closes it. The space above the card grows once something has been put there and then stays, so
 * the card does not bounce as the menu opens and closes.
 */
function Idle({ f }: { f: Fixtures }) {
  const later = useLater();
  const [draft, setDraft] = useState("");
  const [chips, setChips] = useState<readonly AttachmentChip[]>([]);
  const [sent, setSent] = useState<readonly string[]>([]);
  const [running, setRunning] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [grown, setGrown] = useState(false);
  const matches = slashMatches(slashEntries(f), draft);
  const slash = !dismissed && matches.length > 0;
  // What the menu last listed, so it leaves showing its rows rather than an empty panel.
  const [listed, setListed] = useState<readonly SlashEntry[]>([]);
  if (slash && listed.map((e) => e.name).join() !== matches.map((e) => e.name).join()) {
    setListed(matches);
  }
  const active = Math.min(cursor, matches.length - 1);
  const ready = !running && (draft.trim() !== "" || chips.length > 0);

  const write = (value: string) => {
    setDraft(value);
    setCursor(0);
    setDismissed(false);
    if (value.startsWith("/")) setGrown(true);
  };
  const pick = (entry: SlashEntry) => {
    if (entry.kind === "skill") {
      const label = entry.name.slice(1);
      setChips((now) => attach(now, [{ kind: "skill", label }]));
      setDraft("");
    } else {
      setDraft(`${entry.name} `);
    }
    setDismissed(true);
  };
  const send = () => {
    if (!ready) return;
    // The bubble is the prompt; a message of chips alone reads as what it carries.
    const text = draft.trim() || chips.map((chip) => chip.label).join(" ");
    setSent((now) => [...now, text].slice(-2));
    setDraft("");
    setChips([]);
    setGrown(true);
    setRunning(true);
    later(() => setRunning(false), RUN_MS);
  };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setCursor((active + step + matches.length) % matches.length);
    } else if (slash && event.key === "Escape") {
      setDismissed(true);
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const entry = matches[active];
      if (slash && entry !== undefined) pick(entry);
      else send();
    }
  };
  const files = f.session.composer.chips.filter((chip) => chip.kind === "file");

  return (
    <div className={`mx-auto flex ${grown ? "min-h-80" : ""} max-w-3xl flex-col justify-end gap-2`}>
      {sent.map((text, i) => (
        <p
          key={`${i}-${text}`}
          data-reveal
          className="ml-auto max-w-[75%] rounded-lg bg-surface-muted px-4 py-2 font-sans text-base text-fg"
        >
          {text}
        </p>
      ))}
      <Presence show={slash} side="bottom" className="flex justify-start px-2">
        <SlashMenu
          f={f}
          entries={slash ? matches : listed}
          active={active}
          onPick={pick}
          onHover={setCursor}
        />
      </Presence>
      <ComposerCard
        f={f}
        state="idle"
        live={{
          draft,
          chips,
          onDraft: write,
          onKeyDown: keys,
          onRemove: (label) => setChips((now) => now.filter((chip) => chip.label !== label)),
          onPlus: () => setChips((now) => attach(now, files)),
          send: running ? (
            <StopButton f={f} onClick={() => setRunning(false)} />
          ) : (
            <SendButton f={f} ready={ready} onClick={send} />
          ),
        }}
      />
      {slash && <SlashHints />}
    </div>
  );
}

const STATES: Record<string, ComposerState> = {
  running: "running",
  chips: "chips",
  "slash-menu": "slash",
  "model-picker": "picker",
};

export const module = defineModule({
  id: "composer",
  title: "Composer",
  description:
    "The composer card: the chip row, a draft with its caret, the approval, Skill, thinking and model triggers, the context ring and send or stop, with its two menus.",
  width: "wide",
  viewport: APP_COLUMN_WIDTH,
  variants: [
    { key: "idle", title: "Idle", kind: "interactive" },
    { key: "running", title: "Running", kind: "static" },
    { key: "chips", title: "Chips", kind: "static" },
    { key: "slash-menu", title: "Slash menu", kind: "static" },
    { key: "model-picker", title: "Model picker", kind: "static" },
  ],
  parts: [
    "chat-composer",
    "forms-tag-input",
    "chat-context-ring",
    "chat-model-select",
    "chat-menu-select",
    "icons-logos",
    "overlays-floating-panel",
    "overlays-menu",
    "actions-kbd",
  ],
  render: (variant, { lang }) => {
    const f = fixturesFor(lang);
    const state = STATES[variant];
    return state === undefined ? <Idle f={f} /> : <Composition f={f} state={state} />;
  },
});
