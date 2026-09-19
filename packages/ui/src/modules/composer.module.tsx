/**
 * Composer: the card the user types into, in the states it is seen in — empty, while a Task runs
 * (stop instead of send), carrying two attachment chips, with the slash-command menu open above
 * it, and with the model picker open over its model trigger; and live, a draft typed and sent.
 * Static stand-ins for W6's `ComposerCard`, `ChipRow`, `ToolbarTrigger`, `SendButton`, `SlashMenu`
 * and `ModelSelect`.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { Fixtures, ModelFixture } from "../fixtures";
import { defineModule } from "../module";
import type { SceneSpec } from "../module";
import { reached, useScene } from "../scene";
import { AgentTile } from "../screens/parts";
import { tokens, usd } from "../screens/format";
import { UserBubble } from "../screens/transcript";
import {
  FloatingPanel,
  GlyphIcon,
  IconButton,
  Kbd,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  RunSpinner,
  SearchInput,
  TypingText,
} from "./parts";
import type { IconName } from "./parts";

/** The static picks, then the live scene's own: typing a draft, ready to send, and sent. */
type ComposerState =
  "idle" | "running" | "chips" | "slash" | "picker" | "typing" | "ready" | "sent";

/** The 14px context gauge: a ring filled to the share of the model's window in use. */
function ContextRing({ used, window, label }: { used: number; window: number; label: string }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const share = Math.min(1, used / window);
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--ui-line)" strokeWidth="2" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke="var(--ui-fg-muted)"
        strokeWidth="2"
        strokeDasharray={`${Math.max(share * c, 1.5)} ${c}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

function ToolbarTrigger({
  icon,
  label,
  lead,
}: {
  icon?: IconName;
  label: string;
  lead?: ReactNode;
}) {
  return (
    <span className="flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-control px-2 text-fg-muted">
      {lead ?? (icon && <GlyphIcon name={icon} size={14} />)}
      <span className="min-w-0 truncate">{label}</span>
      <GlyphIcon name="chevronDown" size={12} className="text-fg-subtle" />
    </span>
  );
}

function SendButton({ state, label }: { state: "idle" | "ready" | "running"; label: string }) {
  if (state === "running") {
    return (
      <span
        role="button"
        aria-label={label}
        className="flex size-8 shrink-0 items-center justify-center rounded-control bg-tone-danger-emphasis text-tone-danger-emphasis-fg"
      >
        <span className="size-2.5 rounded-xs bg-current" />
      </span>
    );
  }
  return (
    <span
      role="button"
      aria-label={label}
      aria-disabled={state === "idle" || undefined}
      className={`flex size-8 shrink-0 items-center justify-center rounded-control ${
        state === "ready" ? "bg-accent text-accent-fg" : "bg-surface-muted text-fg-subtle"
      }`}
    >
      <GlyphIcon name="arrowUp" size={16} />
    </span>
  );
}

function ComposerCard({ f, state }: { f: Fixtures; state: ComposerState }) {
  const s = f.session;
  const c = f.copy.chat;
  const model = f.models.find((m) => m.modelId === s.model.modelId);
  // Sent, the draft has left the input for the transcript while the Task runs.
  const draft =
    state === "idle" || state === "sent" ? "" : state === "slash" ? "/" : s.composer.draft;
  const chips = state === "chips" || state === "picker" ? s.composer.chips : [];
  return (
    <div className="ui-glass rounded-lg border border-line-emphasis bg-surface px-2.5 pb-2 pt-2">
      {chips.length > 0 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1">
          {chips.map((chip) => (
            <span
              key={chip.label}
              className="flex max-w-48 items-center gap-1 rounded-sm bg-surface-muted py-0.5 pl-2 pr-1 font-mono text-xs text-fg"
            >
              <GlyphIcon
                name={chip.kind === "skill" ? "book" : "fileText"}
                size={12}
                className="text-fg-muted"
              />
              <span className="truncate">{chip.label}</span>
              {chip.lines && <span className="shrink-0 text-fg-subtle">{chip.lines}</span>}
              <GlyphIcon name="cross" size={11} className="ml-0.5 text-fg-subtle" />
            </span>
          ))}
        </div>
      )}
      <p
        className={`min-h-14 px-1 py-0.5 font-sans text-base leading-6 ${draft ? "text-fg" : "text-fg-subtle"}`}
      >
        {state === "typing" ? (
          <TypingText text={draft} frame="typing" />
        ) : (
          draft || c.inputPlaceholder
        )}
        {draft && <span aria-hidden className="ml-px inline-block h-5 w-px translate-y-1 bg-fg" />}
      </p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <IconButton label={c.attach} icon="plus" />
        <ToolbarTrigger icon="shield" label={c.approvalModes[s.composer.approvalMode]} />
        <ToolbarTrigger icon="book" label={c.skills} />
        <span className="min-w-0 flex-1" />
        <ContextRing
          used={s.context.tokens}
          window={s.context.window}
          label={c.contextOf(tokens(s.context.tokens), tokens(s.context.window))}
        />
        <ToolbarTrigger icon="sparkle" label={c.thinkingLevels[s.composer.thinkingLevel]} />
        <ToolbarTrigger
          label={model?.displayName ?? s.model.modelId}
          lead={<AgentTile id={s.model.provider} name={model?.providerLabel ?? "?"} size={16} />}
        />
        <SendButton
          state={
            state === "running" || state === "sent"
              ? "running"
              : draft && state !== "slash" && state !== "typing"
                ? "ready"
                : "idle"
          }
          label={state === "running" || state === "sent" ? c.stop : c.send}
        />
      </div>
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

const LIVE_SEND: SceneSpec = {
  frames: [
    { key: "empty", title: "Empty", hold: 900 },
    { key: "typing", title: "Typing", hold: 1800 },
    { key: "ready", title: "Ready", hold: 800 },
    { key: "running", title: "Running", hold: 2000 },
  ],
};

/** The card's state on each frame of the live scene. */
const LIVE_STATES: Record<string, ComposerState> = {
  empty: "idle",
  typing: "typing",
  ready: "ready",
  running: "sent",
};

/**
 * Type and send: the empty card; the draft typing in, send still off; send on once the draft is
 * written; then sent — the draft lands in the transcript above with the run's live mark, the
 * input clears and send turns to stop. The room above the card is held in every frame, so the
 * card stays put when the message lands.
 */
function LiveSend({ f }: { f: Fixtures }) {
  const clock = useScene();
  const state = LIVE_STATES[clock?.frame ?? "running"] ?? "idle";
  return (
    <div className="mx-auto flex min-h-64 max-w-3xl flex-col justify-end gap-2">
      {reached(clock, "running") && (
        <div data-reveal>
          <UserBubble item={{ text: f.session.composer.draft }} dense={false} />
          <p className="flex items-center gap-1 px-1 text-xs text-tone-success-fg">
            <RunSpinner />
            {f.copy.chat.running}
          </p>
        </div>
      )}
      <ComposerCard f={f} state={state} />
    </div>
  );
}

const STATES: Record<string, ComposerState> = {
  idle: "idle",
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
  variants: [
    { key: "idle", title: "Idle" },
    { key: "running", title: "Running" },
    { key: "chips", title: "Chips" },
    { key: "slash-menu", title: "Slash menu" },
    { key: "model-picker", title: "Model picker" },
    { key: "live-send", title: "Type and send", scene: LIVE_SEND },
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
  render: (variant, { lang }) =>
    variant === "live-send" ? (
      <LiveSend f={fixturesFor(lang)} />
    ) : (
      <Composition f={fixturesFor(lang)} state={STATES[variant] ?? "idle"} />
    ),
});
