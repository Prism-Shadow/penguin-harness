/**
 * A machine's card on the Machines page, in the Agents list's shape: one band of "info | middle |
 * quick buttons".
 *
 * The info column says which machine this is and how it stands: the alias beside its status pill
 * (a word, never a bare dot) — this server's tag and the update pill beside them when they apply,
 * so the title row carries at most two capsules besides the name; the server root; and a line of
 * stats, each a glyph and a value (how the machine is reached, its build, the port its server
 * answers on, when it was last checked). The title is the card's main button and opens the Machine
 * dialog; the caller's `onBodyClick` decides whether a click elsewhere on the body opens it too,
 * while the buttons on the card act on their own.
 *
 * The middle holds the job's stepper while a job for the machine is queued or running; else the
 * retry status while the server brings the machine back (`RetryStatus`: the attempt, the countdown
 * to the next, where the automatic attempts stopped, and the Retry); else, while Use waits, why
 * in one muted line. The quick buttons: Sync config (an icon,
 * first, so the buttons after it line up across cards whether or not it is there), Use with its
 * word, Settings with its gear and word, and Delete as a bare icon in the danger look. This
 * server's own card keeps Use and Settings; its Delete is a placeholder that cannot be pressed,
 * saying why on its hint.
 *
 * Props only: every word and every state is the caller's.
 */
import type { MouseEventHandler } from "react";
import { ICON_GAP, ICON_SIZE } from "../../../icon-scale";
import { Button } from "../../actions/button/button";
import { Pill } from "../../feedback/pill/pill";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { UpdatePill } from "../../icons/update-dot/update-dot";
import { Card } from "../../layout/card/card";
import { MachineStatusPill } from "../machine-status/machine-status";
import type { MachineStatusPillProps } from "../machine-status/machine-status";
import { MachineStepper } from "../machine-stepper/machine-stepper";
import type { MachineStepperProps } from "../machine-stepper/machine-stepper";
import { RetryStatus } from "../../feedback/retry-status/retry-status";
import type { RetryStatusProps } from "../../feedback/retry-status/retry-status";

/** One stat on the card's third line: a glyph and a value. The dialog says what each one means. */
export interface MachineCardFact {
  /** A registry path from `ICONS`. */
  glyph: string;
  value: string;
}

/** One of the card's buttons: its word (the name of an icon button), whether it waits, its press. */
export interface MachineCardAction {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

export interface MachineCardProps {
  /** The machine's id, for whatever reads the markup (`data-machine`). */
  id: string;
  alias: string;
  status: MachineStatusPillProps;
  /** This server's own entry: its tag, and why its Delete cannot be pressed. */
  local?: { tag: string; undeletable: string } | null;
  /** The pill for a machine on another build than this server's; it opens the dialog. */
  update?: { label: string; onClick: () => void } | null;
  /** The server root on the machine. */
  root: string;
  facts: readonly MachineCardFact[];
  /** The job's steps while one is queued or running; null when none is. */
  progress?: MachineStepperProps | null;
  /**
   * The retry status while the server brings the machine back or has stopped trying, with its
   * Retry; shown in the middle when no job is moving there. Null otherwise.
   */
  retry?: RetryStatusProps | null;
  /** Why Use waits, when it does and no job is moving to say so; null otherwise. */
  waits?: string | null;
  /** Opens the Machine dialog: the title and Settings. */
  onOpen: () => void;
  /** The card body's click (the caller's rule for when a click on the body opens the dialog). */
  onBodyClick?: MouseEventHandler<HTMLElement>;
  use: MachineCardAction;
  /** Settings' word; it opens the dialog. */
  settingsLabel: string;
  /** Delete; on this server's own card the placeholder stands in its place. */
  remove: MachineCardAction;
  /** Sync config, on a connected machine on this server's build; null otherwise. */
  sync?: MachineCardAction | null;
}

/** One stat: a glyph and a value. */
function Stat({ fact }: { fact: MachineCardFact }) {
  return (
    <span className={`inline-flex shrink-0 items-center ${ICON_GAP.tight}`}>
      <GlyphIcon d={fact.glyph} size={ICON_SIZE.inlineGlyph} />
      {fact.value}
    </span>
  );
}

/**
 * Why Use waits, in the card's middle: a muted line with a mark that says the line is a reason —
 * decorative, so a theme may drop it and the words still say it all.
 */
function UseWaits({ why }: { why: string }) {
  return (
    <p data-use-waits="" className="flex items-start gap-1.5 text-xs text-fg-muted">
      <GlyphIcon
        d={ICONS.info}
        size={ICON_SIZE.inlineGlyph}
        className="ui-icon-decor mt-0.5 shrink-0"
      />
      <span>{why}</span>
    </p>
  );
}

export function MachineCard({
  id,
  alias,
  status,
  local = null,
  update = null,
  root,
  facts,
  progress = null,
  retry = null,
  waits = null,
  onOpen,
  onBodyClick,
  use,
  settingsLabel,
  remove,
  sync = null,
}: MachineCardProps) {
  return (
    <Card
      padding="md"
      data-machine={id}
      interactive
      className="flex flex-wrap items-center gap-x-6 gap-y-2"
      onClick={onBodyClick}
    >
      <div className="min-w-[14rem] flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {/* Wraps rather than squeezes: on a phone the capsules go under the name, which would
              otherwise be truncated to its first letter. The glyph stays with the name. */}
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={onOpen}
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-sm text-left"
          >
            <span className="flex min-w-0 items-center gap-2">
              <GlyphIcon
                d={ICONS.server}
                size={ICON_SIZE.navRow}
                className="shrink-0 text-fg-muted"
              />
              <span className="min-w-0 truncate text-base font-bold">{alias}</span>
            </span>
            {local !== null && <Pill>{local.tag}</Pill>}
            <MachineStatusPill {...status} />
          </button>
          {update !== null && <UpdatePill onClick={update.onClick}>{update.label}</UpdatePill>}
        </div>
        <p className="mt-1.5 min-h-4 truncate font-mono text-xs text-fg-muted">{root}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
          {facts.map((fact) => (
            <Stat key={`${fact.glyph} ${fact.value}`} fact={fact} />
          ))}
        </div>
      </div>

      {/* The middle: the job's stepper while one moves, else the retry status while the machine
          is being brought back, else why Use waits — and on a narrow screen nothing, taking no
          line, when there is none of them. */}
      <div
        className={
          progress !== null || retry !== null || waits !== null
            ? "w-44 shrink-0"
            : "hidden w-44 shrink-0 md:block"
        }
      >
        {progress !== null ? (
          <MachineStepper {...progress} />
        ) : retry !== null ? (
          <RetryStatus {...retry} />
        ) : (
          waits !== null && <UseWaits why={waits} />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {sync !== null && (
          <Button
            size="icon"
            data-action="sync-config"
            title={sync.label}
            aria-label={sync.label}
            disabled={sync.disabled === true}
            onClick={sync.onClick}
          >
            <GlyphIcon d={ICONS.upload} size={ICON_SIZE.iconButton} />
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          data-action="use"
          disabled={use.disabled === true}
          onClick={use.onClick}
        >
          <GlyphIcon d={ICONS.messagePlus} />
          {use.label}
        </Button>
        <Button size="sm" data-action="settings" onClick={onOpen}>
          <GlyphIcon d={ICONS.gear} />
          {settingsLabel}
        </Button>
        {local !== null ? (
          // This server cannot be taken off its own page: a placeholder in the delete button's
          // box, so every card's buttons line up, saying why on the hint its bare icon carries.
          <span
            role="img"
            data-tooltip={local.undeletable}
            aria-label={local.undeletable}
            className="inline-flex cursor-not-allowed items-center justify-center rounded-md border border-transparent p-1.5 text-fg-subtle"
          >
            <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
          </span>
        ) : (
          <Button
            size="icon"
            variant="danger"
            data-action="delete"
            title={remove.label}
            aria-label={remove.label}
            disabled={remove.disabled === true}
            onClick={remove.onClick}
          >
            <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
          </Button>
        )}
      </div>
    </Card>
  );
}
