/**
 * The version element: a program something installs and runs beside itself, as one segmented
 * capsule — its name, the version installed, the platform that build is for — then where it
 * stands as a mark and a word: installed, being prepared (a spinner, and a progress bar under the
 * capsule with the step in words), failed (the warning triangle in the attention ink, never red,
 * the reason in a line under it), not installed yet, or not supported on this machine. The button
 * the state offers (install, retry) follows the word; what only a careful reader wants (an install
 * directory, the whole error) folds under it behind "Details".
 *
 * The word is on screen beside its mark, so colour is never the only carrier; the mark's shape
 * differs per state. The capsule's segments are data (a name, a version, a platform), set in the
 * monospace face where they are code. Props only: every word is the caller's.
 */
import { useId, useState, type ReactNode } from "react";
import { ICON_GAP, ICON_SIZE } from "../../../icon-scale";
import { Chevron } from "../../icons/chevron/chevron";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { Spinner } from "../../icons/spinner/spinner";
import { Fold } from "../../layout/fold/fold";
import { ProgressBar } from "../progress-bar/progress-bar";

/** `preparing` = being downloaded or installed now; `missing` = not installed yet. */
export type InstalledVersionState =
  "installed" | "preparing" | "failed" | "missing" | "unsupported";

/** Each state's mark; `preparing` turns a spinner instead. */
const MARK: Readonly<
  Record<Exclude<InstalledVersionState, "preparing">, { glyph: string; ink: string }>
> = {
  installed: { glyph: ICONS.checkCircle, ink: "text-tone-success-fg" },
  failed: { glyph: ICONS.triangleAlert, ink: "text-tone-attention-fg" },
  missing: { glyph: ICONS.arrowDownToLine, ink: "text-fg-subtle" },
  unsupported: { glyph: ICONS.stopCircle, ink: "text-fg-subtle" },
};

export interface InstalledVersionProps {
  /** The program's name as its maker spells it. */
  name: string;
  version?: string;
  /** The OS and CPU the installed build is for. */
  platform?: string;
  state: InstalledVersionState;
  /** The state's word, beside its mark. */
  stateLabel: string;
  /** While preparing: how far, from 0 to 1; absent while the step has no amount. */
  progress?: number;
  /** One line under the capsule: the step while preparing, why when failed or unsupported. */
  text?: string;
  /** Folded under the element. */
  details?: ReactNode;
  /** The fold's name ("Details"); needed with `details`. */
  detailsLabel?: string;
  /** The button the state offers (install, retry). */
  action?: ReactNode;
}

const SEGMENT = "px-2 py-0.5";

export function InstalledVersion({
  name,
  version,
  platform,
  state,
  stateLabel,
  progress,
  text,
  details,
  detailsLabel,
  action,
}: InstalledVersionProps) {
  return (
    <div data-version-state={state} className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex shrink-0 items-stretch overflow-hidden rounded-[var(--ui-radius-pill)] text-xs ring-1 ring-inset ring-line">
          <span className={`${SEGMENT} pl-2.5 font-medium`}>{name}</span>
          {version !== undefined && (
            // deslop-ignore-next-line 34: a version is code, set as the plugin cards set theirs.
            <span className={`${SEGMENT} border-l border-line font-mono tabular-nums`}>
              {version}
            </span>
          )}
          {platform !== undefined && (
            // deslop-ignore-next-line 34: a build target ("linux-x64") is an identifier.
            <span className={`${SEGMENT} border-l border-line pr-2.5 font-mono text-fg-muted`}>
              {platform}
            </span>
          )}
        </span>
        <span
          className={`inline-flex shrink-0 items-center ${ICON_GAP.tight} text-xs text-fg-muted`}
        >
          {state === "preparing" ? (
            <Spinner size="xs" tone="success" label={stateLabel} />
          ) : (
            <GlyphIcon
              d={MARK[state].glyph}
              size={ICON_SIZE.inlineGlyph}
              className={MARK[state].ink}
            />
          )}
          <span>{stateLabel}</span>
        </span>
        {action}
      </div>
      {state === "preparing" && (
        <ProgressBar
          size="xs"
          label={text ?? stateLabel}
          className="max-w-xs"
          {...(progress === undefined ? { indeterminate: true } : { value: progress * 100 })}
        />
      )}
      {text !== undefined && text !== "" && (
        <p className="text-xs break-words text-fg-muted">{text}</p>
      )}
      {details !== undefined && details !== null && details !== "" && (
        <DetailsFold label={detailsLabel ?? ""}>{details}</DetailsFold>
      )}
    </div>
  );
}

/**
 * "Details", folded: a row naming itself with the fold chevron, and the body under it through
 * `Fold`. For words a careful reader wants and nobody else needs on screen.
 */
export function DetailsFold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        {...(open ? { "aria-controls": panelId } : {})}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center whitespace-nowrap ${ICON_GAP.tight} rounded-sm text-xs text-fg-muted transition-colors duration-150 hover:text-fg`}
      >
        <Chevron open={open} size={ICON_SIZE.chevronDense} />
        {label}
      </button>
      <Fold open={open}>
        {/* pl-4 = the chevron's 12px plus the tight gap, so the body lines up under the label. */}
        <div
          id={panelId}
          className="pt-1.5 pl-4 text-xs leading-relaxed break-words whitespace-pre-line text-fg-muted"
        >
          {children}
        </div>
      </Fold>
    </div>
  );
}
