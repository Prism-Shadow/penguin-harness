/**
 * A checklist: the preconditions something needs on this machine, one ruled row each. A row leads
 * with a mark whose shape says its state — holds (a check), needs a person (the warning triangle,
 * in the attention ink, never red), could not be told yet (a question), does not apply here (a
 * dash) — then names what is checked and says in one line what was found. The action the row
 * needs sits on its own end; a tool's own words and paths fold under the row behind "Details",
 * collapsed, so the main line stays in the caller's words. The fold is `HelpFold`'s: its trigger
 * at the row's end, named for the row by the caller ("Details: Accessibility"), its panel under the
 * whole row, in the DOM and `hidden` while collapsed.
 *
 * The mark is wordless on screen, so its state rides on its tooltip and accessible name, and every
 * mark is drawn at 3:1 or more against the surface (the muted ink, never the subtle one). A state
 * this component does not know — a newer plugin's — is drawn as "could not be told". The line
 * truncates rather than wraps, and shows whole on hover (the tooltip layer's rule for cut-off
 * text); the label and the action keep their width, and short labels share one minimum so the
 * findings line up. On a narrow row the action drops under the line rather than squeezing it.
 *
 * Props only: every word, the action and the details are the caller's.
 */
import { useId, useState, type ReactNode } from "react";
import { ICON_GAP, ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { HelpFoldToggle } from "../../overlays/info-popover/help-fold";

/** `ok` holds; `action` needs a person; `unknown` could not be told yet; `na` does not apply here. */
export type ChecklistState = "ok" | "action" | "unknown" | "na";

/** Each state's mark: a shape of its own, so the states part without colour. */
const MARK: Readonly<Record<ChecklistState, { glyph: string; ink: string }>> = {
  ok: { glyph: ICONS.checkCircle, ink: "text-tone-success-fg" },
  action: { glyph: ICONS.triangleAlert, ink: "text-tone-attention-fg" },
  unknown: { glyph: ICONS.helpCircle, ink: "text-fg-muted" },
  na: { glyph: ICONS.minus, ink: "text-fg-muted" },
};

/** The rows, as one ruled list. */
export function Checklist({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="divide-y divide-line-muted">
      {children}
    </ul>
  );
}

export interface ChecklistRowProps {
  /** What is checked, in a few words. */
  label: string;
  /** One of `ChecklistState`; anything else is drawn as `unknown`. */
  state: ChecklistState | (string & {});
  /** The state's word: the mark's tooltip and accessible name. */
  stateLabel: string;
  /** One line: what was found, or what to do. */
  text?: string;
  /** Folded under the row: a tool's own words, paths. */
  details?: ReactNode;
  /** The fold's title on screen ("Details"); needed with `details`. */
  detailsLabel?: string;
  /** The fold's accessible name, naming the row ("Details: Accessibility"); `detailsLabel` its prefix. */
  detailsName?: string;
  /** The button the row needs, on its end. */
  action?: ReactNode;
  /** Names the row for whatever reads the markup (`data-check`). */
  id?: string;
}

export function ChecklistRow({
  label,
  state,
  stateLabel,
  text,
  details,
  detailsLabel,
  detailsName,
  action,
  id,
}: ChecklistRowProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const mark = MARK[state as ChecklistState] ?? MARK.unknown;
  const hasDetails = details !== undefined && details !== null && details !== "";
  return (
    <li data-check={id} data-state={state} className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`flex min-w-0 flex-1 basis-60 items-center ${ICON_GAP.menu}`}>
          <span
            role="img"
            aria-label={stateLabel}
            data-tooltip={stateLabel}
            className={`inline-flex shrink-0 ${mark.ink}`}
          >
            <GlyphIcon d={mark.glyph} size={ICON_SIZE.rowLead} />
          </span>
          {/* A shared minimum, so the findings of short labels start in one column. */}
          <span className="shrink-0 text-sm font-medium sm:min-w-28">{label}</span>
          {text !== undefined && text !== "" && (
            <span className="min-w-0 truncate text-xs text-fg-muted">{text}</span>
          )}
        </span>
        {(hasDetails || action !== undefined) && (
          <span className={`ml-auto flex shrink-0 items-center ${ICON_GAP.menu}`}>
            {hasDetails && (
              <HelpFoldToggle
                open={open}
                onToggle={() => setOpen((v) => !v)}
                panelId={panelId}
                {...(detailsLabel !== undefined ? { title: detailsLabel } : { label })}
                {...(detailsName !== undefined ? { name: detailsName } : {})}
              />
            )}
            {action}
          </span>
        )}
      </div>
      {hasDetails && (
        // Under the label: the mark's 14px plus the menu gap.
        <div
          id={panelId}
          hidden={!open}
          className="mt-1.5 pl-5.5 text-xs leading-relaxed break-words whitespace-pre-line text-fg-muted"
        >
          {details}
        </div>
      )}
    </li>
  );
}
