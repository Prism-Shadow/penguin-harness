/**
 * The version element: a program something installs and runs beside itself, as one segmented
 * capsule — its name, the version installed, the platform that build is for — then where it
 * stands as a mark and a word (`StatusMark`): installed, being prepared (a spinner, and a progress
 * bar under the capsule with the step in words), failed (the warning triangle in the attention
 * ink, never red, the reason in a line under it), not installed yet, not supported on this
 * machine, or not known. The button the state offers (install, retry) follows the word; what only
 * a careful reader wants (an install directory, the whole error) folds under it behind "Details"
 * (`HelpFold`).
 *
 * The word is on screen beside its mark, so colour is never the only carrier, and the spinner is
 * hidden from assistive technology so the state is announced once, by its word. A state this
 * component does not know — a newer plugin's — is drawn as not known, under the word the caller
 * gives. The capsule's segments are data (a name, a version, a platform), set in the monospace
 * face where they are code. Props only: every word is the caller's.
 */
import type { ReactNode } from "react";
import { ICON_GAP } from "../../../icon-scale";
import type { ToneName } from "../../../tokens";
import { ICONS } from "../../icons/icons";
import { Spinner } from "../../icons/spinner/spinner";
import { HelpFold } from "../../overlays/info-popover/help-fold";
import { ProgressBar } from "../progress-bar/progress-bar";
import { StatusMark } from "../status-mark/status-mark";

/** `preparing` = being downloaded or installed now; `missing` = not installed yet. */
export type InstalledVersionState =
  "installed" | "preparing" | "failed" | "missing" | "unsupported" | "unknown";

/** Each settled state's mark; `preparing` turns a spinner instead. A mark with no tone recedes. */
const MARK: Readonly<
  Record<Exclude<InstalledVersionState, "preparing">, { glyph: string; tone?: ToneName }>
> = {
  installed: { glyph: ICONS.checkCircle, tone: "success" },
  failed: { glyph: ICONS.triangleAlert, tone: "attention" },
  missing: { glyph: ICONS.arrowDownToLine },
  unsupported: { glyph: ICONS.stopCircle },
  unknown: { glyph: ICONS.helpCircle },
};

export interface InstalledVersionProps {
  /** The program's name as its maker spells it. */
  name: string;
  version?: string;
  /** The OS and CPU the installed build is for. */
  platform?: string;
  /** One of `InstalledVersionState`; anything else is drawn as `unknown`. */
  state: InstalledVersionState | (string & {});
  /** The state's word, beside its mark. */
  stateLabel: string;
  /** While preparing: how far, from 0 to 1; absent while the step has no amount. */
  progress?: number;
  /** One line under the capsule: the step while preparing, why when failed or unsupported. */
  text?: string;
  /** Folded under the element. */
  details?: ReactNode;
  /** The fold's title on screen ("Details"); needed with `details`. */
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
  const settled = state === "preparing" ? null : (MARK[state as keyof typeof MARK] ?? MARK.unknown);
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
        <span className="text-xs text-fg-muted">
          {settled === null ? (
            <span className={`inline-flex shrink-0 items-center ${ICON_GAP.tight}`}>
              {/* The word below announces the state; the spinner stays out of the reading. */}
              <span aria-hidden className="inline-flex">
                <Spinner size="xs" tone="success" label={stateLabel} />
              </span>
              <span>{stateLabel}</span>
            </span>
          ) : (
            <StatusMark
              glyph={settled.glyph}
              label={stateLabel}
              {...(settled.tone !== undefined ? { tone: settled.tone } : {})}
            />
          )}
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
        <HelpFold {...(detailsLabel !== undefined ? { title: detailsLabel } : { label: name })}>
          <p className="break-words whitespace-pre-line">{details}</p>
        </HelpFold>
      )}
    </div>
  );
}
