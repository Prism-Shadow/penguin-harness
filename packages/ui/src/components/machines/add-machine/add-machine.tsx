/**
 * The add-machine dialog's shell, in the shape of the other add and import dialogs — the parts a
 * `Modal` holds, props only (the dialog itself, its form and its requests are the caller's):
 *
 * - `AddMachineShell`, the body: one plain line saying what happens, a tab per way in, the active
 *   tab's panel, and — when the last Add did not go through — why, in the attention tone under it.
 * - `MachineHostList`, the panel that offers hosts from the ssh config: a search box over a ruled
 *   list of rows; with nothing left to offer, one muted line and a button to the other tab; with a
 *   search that matches nothing, a line saying so.
 * - `MachineHostRow`, one host to tick: the whole row toggles. The server glyph leads it, the
 *   name follows (the search's matched characters in the strong ink, the rest muted) with how its
 *   block reaches it muted beside it, and a neutral badge at the end when another Project has
 *   already installed it.
 * - `AddMachineFooter`, the footer: the "install right after adding" box at the start of the row,
 *   Cancel and Add at its end; on a phone the box takes a line of its own above them.
 */
import type { ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { Button } from "../../actions/button/button";
import { Badge } from "../../feedback/badge/badge";
import { NoticeStrip } from "../../feedback/notice/notice-strip";
import { Checkbox } from "../../forms/checkbox/checkbox";
import { SearchInput } from "../../forms/search-input/search-input";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { Tabs } from "../../navigation/tabs/tabs";
import type { TabItem } from "../../navigation/tabs/tabs";

export interface AddMachineShellProps<K extends string = string> {
  /** One line saying what Add does. */
  intro: string;
  tabs: ReadonlyArray<TabItem<K>>;
  tab: K;
  onTab: (tab: K) => void;
  /** The active tab's panel. */
  children: ReactNode;
  /** Why the last Add did not go through; null otherwise. */
  error?: string | null;
}

export function AddMachineShell<K extends string>({
  intro,
  tabs,
  tab,
  onTab,
  children,
  error = null,
}: AddMachineShellProps<K>) {
  const active = tabs.find((item) => item.key === tab);
  return (
    <div className="space-y-4">
      <p className="text-sm">{intro}</p>
      <div>
        <Tabs items={tabs} active={tab} onChange={onTab} />
        <div role="tabpanel" aria-label={active?.label ?? tab} data-tab={tab} className="pt-4">
          {children}
        </div>
      </div>
      {error !== null && (
        <NoticeStrip
          tone="attention"
          className="flex items-start gap-1.5 rounded-md border px-3 py-2 text-sm"
        >
          <span data-slot="icon" className="mt-1 shrink-0">
            <GlyphIcon d={ICONS.alertCircle} size={ICON_SIZE.inlineGlyph} />
          </span>
          <span>{error}</span>
        </NoticeStrip>
      )}
    </div>
  );
}

/** A piece of a name the search matched (`hit`) or did not. */
export interface MatchSegment {
  text: string;
  hit: boolean;
}

export interface MachineHostRowProps {
  alias: string;
  /** The alias split where the search matched; omitted or empty when there is no search. */
  segments?: readonly MatchSegment[];
  /** How the host's own block reaches it (`user@host:port`); null when it says nothing more. */
  reach: string | null;
  /** The badge at the row's end ("Installed by another Project"); null when none applies. */
  note?: string | null;
  checked: boolean;
  onToggle: () => void;
}

export function MachineHostRow({
  alias,
  segments = [],
  reach,
  note = null,
  checked,
  onToggle,
}: MachineHostRowProps) {
  return (
    <li data-host={alias} data-picked={checked ? "true" : "false"}>
      <label
        className={`flex min-w-0 items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-surface-muted ${
          checked ? "bg-surface-muted" : ""
        }`}
      >
        <Checkbox checked={checked} onChange={onToggle} aria-label={alias} />
        <GlyphIcon d={ICONS.server} size={ICON_SIZE.rowLead} className="shrink-0 text-fg-subtle" />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate font-mono text-sm">
            {segments.length === 0
              ? alias
              : segments.map((segment, i) => (
                  <span key={i} className={segment.hit ? "font-semibold text-fg" : "text-fg-muted"}>
                    {segment.text}
                  </span>
                ))}
          </span>
          {reach !== null && (
            <span className="min-w-0 truncate font-mono text-xs text-fg-muted">{reach}</span>
          )}
        </span>
        {note !== null && (
          <Badge variant="soft" tone="neutral">
            {note}
          </Badge>
        )}
      </label>
    </li>
  );
}

export interface MachineHostListProps {
  query: string;
  onQuery: (query: string) => void;
  /** The search box's placeholder and name. */
  searchLabel: string;
  /** Nothing left in the config to offer: the line, and the button to the other way in. */
  exhausted?: { text: string; actionLabel: string; onAction: () => void } | null;
  /** The search matched nothing: the line saying so; null while rows show. */
  noMatch?: string | null;
  /** The rows (`MachineHostRow`). */
  children?: ReactNode;
}

export function MachineHostList({
  query,
  onQuery,
  searchLabel,
  exhausted = null,
  noMatch = null,
  children,
}: MachineHostListProps) {
  if (exhausted !== null) {
    return (
      <div data-empty="no-hosts" className="flex flex-col items-start gap-3 py-2">
        <p className="flex items-start gap-2 text-sm text-fg-muted">
          <GlyphIcon
            d={ICONS.info}
            size={ICON_SIZE.inlineGlyph}
            className="mt-1 shrink-0 text-fg-subtle"
          />
          {exhausted.text}
        </p>
        <Button size="sm" variant="secondary" data-action="to-manual" onClick={exhausted.onAction}>
          <GlyphIcon d={ICONS.penLine} size={ICON_SIZE.inlineGlyph} />
          {exhausted.actionLabel}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <SearchInput
        value={query}
        onChange={onQuery}
        placeholder={searchLabel}
        aria-label={searchLabel}
      />
      {noMatch !== null ? (
        <p data-empty="no-match" className="py-2 text-sm text-fg-muted">
          {noMatch}
        </p>
      ) : (
        <ul className="max-h-72 divide-y divide-line overflow-y-auto border-y border-line">
          {children}
        </ul>
      )}
    </div>
  );
}

export interface AddMachineFooterProps {
  installNow: boolean;
  onInstallNow: (on: boolean) => void;
  /** The box's words ("Install and connect right after adding"). */
  installNowLabel: string;
  cancelLabel: string;
  /** Add's word: how many are ticked, when more than one. */
  submitLabel: string;
  canSubmit: boolean;
  /** Add is in flight: both buttons wait. */
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}

export function AddMachineFooter({
  installNow,
  onInstallNow,
  installNowLabel,
  cancelLabel,
  submitLabel,
  canSubmit,
  busy,
  onCancel,
  onSubmit,
}: AddMachineFooterProps) {
  return (
    <>
      <Checkbox
        size="sm"
        checked={installNow}
        onChange={onInstallNow}
        label={installNowLabel}
        data-option="install-now"
        className="mr-auto basis-full self-center sm:basis-auto"
      />
      <Button size="sm" disabled={busy} onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={!canSubmit || busy}
        aria-busy={busy}
        data-action="add"
        onClick={onSubmit}
      >
        <GlyphIcon d={ICONS.plus} size={ICON_SIZE.inlineGlyph} />
        {submitLabel}
      </Button>
    </>
  );
}
