/**
 * Composer: the card the user types into, in the states it is seen in — empty, while a Task runs
 * (stop instead of send), carrying two attachment chips, with the slash-command menu open above
 * it, and with the model picker open over its model trigger. Static stand-ins for W6's
 * `ComposerCard`, `ChipRow`, `ToolbarTrigger`, `SendButton`, `SlashMenu` and `ModelSelect`.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { Fixtures, ModelFixture } from "../fixtures";
import { defineModule, viewFor } from "../module";
import { AgentTile } from "../screens/parts";
import { tokens, usd } from "../screens/format";
import {
  FloatingPanel,
  GlyphIcon,
  IconButton,
  Kbd,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  SearchInput,
} from "./parts";
import type { IconName } from "./parts";

type ComposerState = "idle" | "running" | "chips" | "slash" | "picker";

/**
 * The 14px context gauge: a ring filled to the share of the **compaction threshold** in use, the
 * basis the app fills against (`features/chat/context-gauge.tsx`), never the model window.
 */
function ContextRing({ used, basis, label }: { used: number; basis: number; label: string }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const share = Math.min(1, used / basis);
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
  // The session's model is one of the fixture's rows; a fixture that loses it fails the render.
  const model = f.models.find((m) => m.modelId === s.model.modelId)!;
  const draft = state === "idle" ? "" : state === "slash" ? "/" : s.composer.draft;
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
        className={`min-h-14 px-1 py-0.5 text-base leading-6 ${draft ? "text-fg" : "text-fg-subtle"}`}
      >
        {draft || c.inputPlaceholder}
        {draft && <span aria-hidden className="ml-px inline-block h-5 w-px translate-y-1 bg-fg" />}
      </p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <IconButton label={c.attach} icon="plus" />
        <ToolbarTrigger icon="shield" label={c.approvalModes[s.composer.approvalMode]} />
        <ToolbarTrigger icon="book" label={c.skills} />
        <span className="min-w-0 flex-1" />
        <ContextRing
          used={s.context.tokens}
          basis={s.context.threshold}
          label={c.contextOf(tokens(s.context.tokens), tokens(s.context.threshold))}
        />
        <ToolbarTrigger icon="sparkle" label={c.thinkingLevels[s.composer.thinkingLevel]} />
        <ToolbarTrigger
          label={model.displayName}
          lead={<AgentTile id={s.model.provider} name={model.providerLabel} size={16} />}
        />
        <SendButton
          state={state === "running" ? "running" : draft && state !== "slash" ? "ready" : "idle"}
          label={state === "running" ? c.stop : c.send}
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

function ModelRow({ model, selected, f }: { model: ModelFixture; selected: boolean; f: Fixtures }) {
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
        {tokens(model.contextWindow)} · {f.copy.models.perMTok(usd(model.pricing.output))}
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
                f={f}
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
  render: (variant, { lang }) => (
    <Composition f={fixturesFor(lang)} state={viewFor(STATES, variant)} />
  ),
});
