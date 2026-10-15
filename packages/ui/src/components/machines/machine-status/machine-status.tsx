/**
 * A machine's state as one labelled pill: the state's glyph and its word in the state's tone — the
 * one status mark every machine surface wears (a card on the Machines page, the Machine dialog's
 * header). A machine's state is never a bare coloured dot: the word is always on screen, and the
 * reason behind it (a failure's own words, ssh's diagnostic, the line a job is on) is the pill's
 * hover hint and part of its accessible name.
 *
 * `MACHINE_STATE_LOOK` is the mapping from a state to its tone and glyph, by meaning: a held
 * connection is `info` (in contact, not a verdict), work under way is `success` (the busy tone's
 * fill) with a spinner where it is moving, what waits on someone or something is `attention`, a
 * failure is `danger`, and a state that should recede is `neutral`. States that share a tone read
 * apart by their glyph. The words are the caller's.
 */
import type { ToneName } from "../../../tokens";
import { Badge } from "../../feedback/badge/badge";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { Spinner } from "../../icons/spinner/spinner";
import { ICON_SIZE } from "../../../icon-scale";

/** Every state a machine's pill can say. `serving` is this server's own entry. */
export const MACHINE_STATES = [
  "serving",
  "ready",
  "queued",
  "working",
  "reconnecting",
  "failed",
  "signInRefused",
  "installedOnly",
  "behind",
  "notConnected",
  "unreachable",
  "stopped",
  "notInstalled",
  "unknown",
] as const;
export type MachineState = (typeof MACHINE_STATES)[number];

/** How a state looks: its tone, and its glyph — null for a moving state, which spins instead. */
export interface MachineStateLook {
  tone: ToneName;
  glyph: string | null;
}

export const MACHINE_STATE_LOOK: Readonly<Record<MachineState, MachineStateLook>> = {
  serving: { tone: "info", glyph: ICONS.house },
  ready: { tone: "info", glyph: ICONS.chainLink },
  queued: { tone: "success", glyph: ICONS.hourglass },
  working: { tone: "success", glyph: null },
  reconnecting: { tone: "success", glyph: null },
  failed: { tone: "danger", glyph: ICONS.xCircle },
  signInRefused: { tone: "danger", glyph: ICONS.xCircle },
  installedOnly: { tone: "neutral", glyph: ICONS.checkCircle },
  behind: { tone: "attention", glyph: ICONS.refresh },
  notConnected: { tone: "attention", glyph: ICONS.plugLifted },
  unreachable: { tone: "attention", glyph: ICONS.alertCircle },
  stopped: { tone: "attention", glyph: ICONS.stopCircle },
  notInstalled: { tone: "attention", glyph: ICONS.download },
  unknown: { tone: "neutral", glyph: ICONS.helpCircle },
};

export interface MachineStatusPillProps {
  state: MachineState;
  /** The state's word ("Running", "Stopped"). */
  label: string;
  /** What stands behind the word, when there is more to say; shown on hover. */
  reason?: string | null;
}

export function MachineStatusPill({ state, label, reason = null }: MachineStatusPillProps) {
  const look = MACHINE_STATE_LOOK[state];
  return (
    <Badge tone={look.tone} {...(reason === null ? {} : { tooltip: reason })}>
      <span data-machine-state={state} className="inline-flex items-center gap-1">
        {look.glyph === null ? (
          <Spinner size="xs" label={label} />
        ) : (
          <GlyphIcon d={look.glyph} size={ICON_SIZE.inlineGlyph} />
        )}
        <span>{label}</span>
        {reason !== null && <span className="sr-only">{` · ${reason}`}</span>}
      </span>
    </Badge>
  );
}
