/**
 * Composer: the card the user types into, in the states it is seen in — empty, while a Task runs
 * (stop instead of send), carrying two attachment chips, with the slash-command menu open above
 * it, and with the model picker open over its model trigger. The empty card is where a draft is
 * typed and sent, so that is the state its scene plays into.
 * Static stand-ins for W6's `ComposerCard`, `ChipRow`, `ToolbarTrigger`, `SendButton`, `SlashMenu`
 * and `ModelSelect`.
 */
import { fixturesFor } from "../fixtures";
import type { Fixtures, ModelFixture } from "../fixtures";
import { APP_COLUMN_WIDTH, defineModule } from "../module";
import type { SceneSpec } from "../module";
import { useScene } from "../scene";
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
  SearchInput,
  TypingText,
} from "./parts";

/** The static picks, plus the two the scene passes through on its way back to an empty card. */
type ComposerState = "idle" | "running" | "chips" | "slash" | "picker" | "typing" | "ready";

/**
 * The card in one state. It is the chat's own composer (screens/transcript.tsx) — the chips, the
 * draft and the control row — so the two cannot drift apart; only what a state changes is here.
 * The model picker opens on the new-chat page, the one place the model can still be changed, so
 * that state draws the card as it is there: no context gauge yet, and a chevron on the model.
 */
function ComposerCard({ f, state }: { f: Fixtures; state: ComposerState }) {
  const s = f.session;
  const c = f.copy.chat;
  const draft =
    state === "idle" || state === "running" ? "" : state === "slash" ? "/" : s.composer.draft;
  const chips = state === "chips" || state === "picker" ? s.composer.chips : [];
  const ready = draft !== "" && state !== "slash" && state !== "typing";
  return (
    <div className="ui-glass @container rounded-lg border border-line-emphasis bg-surface px-2.5 pb-2 pt-2">
      <ComposerChips chips={chips} />
      <p
        className={`min-h-[3.75rem] px-1 py-0.5 font-sans text-base leading-6 ${draft ? "text-fg" : "text-fg-subtle"}`}
      >
        {state === "typing" ? (
          <TypingText text={draft} frame="typing" />
        ) : (
          draft || c.inputPlaceholder
        )}
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

function SlashMenu({ f }: { f: Fixtures }) {
  const c = f.copy.chat;
  // Every enabled plugin offers its skill under its own name.
  const skills = f.plugins.filter((plugin) => plugin.enabled);
  return (
    <FloatingPanel className="w-96">
      <MenuLabel>{c.commands}</MenuLabel>
      {f.slashCommands.map((command, i) => (
        <MenuItem
          key={command.name}
          icon={command.icon}
          label={command.name}
          description={command.description}
          active={i === 0}
        />
      ))}
      <MenuSeparator />
      <MenuLabel>{c.skills}</MenuLabel>
      {skills.map((skill) => (
        <MenuItem
          key={skill.name}
          icon="book"
          label={`/${skill.name}`}
          description={skill.description}
        />
      ))}
    </FloatingPanel>
  );
}

function ModelRow({ model, selected }: { model: ModelFixture; selected: boolean }) {
  return (
    <span
      className={`flex items-center gap-2 rounded-[var(--radius-inner)] px-2 py-1.5 ${selected ? "bg-surface-muted" : ""}`}
    >
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
    </span>
  );
}

function ModelPicker({ f }: { f: Fixtures }) {
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
                selected={m.modelId === f.session.model.modelId}
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
      {state === "slash" && (
        <p className="flex items-center gap-2 px-2 text-xs text-fg-muted">
          <Kbd keys={["↑", "↓"]} />
          <Kbd keys={["Enter"]} />
          <Kbd keys={["Esc"]} />
        </p>
      )}
    </div>
  );
}

const SEND: SceneSpec = {
  frames: [
    { key: "typing", title: "Typing", hold: 1800 },
    { key: "ready", title: "Ready", hold: 800 },
    { key: "sent", title: "Sent", hold: 1400 },
  ],
};

/** The card's state on each frame; anywhere else — a still, another variant — it is empty. */
const SEND_STATES: Record<string, ComposerState> = { typing: "typing", ready: "ready" };

/**
 * Type and send: the draft types in, send still off; send lights up once the draft is written;
 * then the draft is gone and the card waits empty — the state this variant shows when nothing is
 * playing.
 */
function Idle({ f }: { f: Fixtures }) {
  const clock = useScene();
  return <Composition f={f} state={SEND_STATES[clock?.frame ?? ""] ?? "idle"} />;
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
    { key: "idle", title: "Idle", scene: SEND },
    { key: "running", title: "Running" },
    { key: "chips", title: "Chips" },
    { key: "slash-menu", title: "Slash menu" },
    { key: "model-picker", title: "Model picker" },
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
