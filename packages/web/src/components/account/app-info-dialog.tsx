/**
 * The App info dialog: the app's identity and links, its software update, the release notes of
 * every version, and the credits for the fonts and icons it ships. Opened from the account-menu
 * row and the version line's badge; mounted once by the app layout so it outlives the menu and
 * the page the badge sits on.
 *
 * One column of ruled sections in the standard dialog body, which scrolls as a whole (and docks
 * as a bottom sheet on a phone), so no scroller sits inside another:
 *
 * - Identity: the logo, the product name, the running version with its build date, and the two
 *   ways out — the homepage and the GitHub repository.
 * - Software Update, only where this session can update (see `updateModeFor`), for both backends
 *   (the server release, and the desktop shell's own updater in its window). It walks the flow
 *   the way an app updater does: a release offered with its notes and a confirmation before
 *   anything is fetched, a progress bar while it downloads (closing never cancels; the row keeps
 *   reporting and the outcome toasts), then "restart and update" once the release is ready.
 *   Opening the dialog checks nothing — the section shows what is already known, and its "check
 *   for updates" asks again. Failures show the backend's own text — the update command's output
 *   tail, the shell's updater message — and offer a retry; an install form that cannot update
 *   itself says why.
 * - What's new: the bundled release notes, newest first, the running version marked.
 * - Credits: the copyright line, then a fold holding the font and icon licences. The row that
 *   opens this dialog is in every session's menu, which is what keeps MiSans credited wherever
 *   the app runs.
 *
 * The flow and the actions live in `use-update-flow.ts`; this file only renders.
 */
import { useId, useState } from "react";
import type { ReactNode } from "react";
import {
  Badge,
  Button,
  Chevron,
  GlyphIcon,
  ICON_GAP,
  ICON_SIZE,
  ICONS,
  Link,
  Modal,
  PenguinLogo,
  ProgressBar,
  RuledSection,
  Spinner,
  buttonClass,
} from "@prismshadow/penguin-ui";
import { formatMonthDay, formatYearMonthDay } from "../../lib/format";
import { noteLines, releaseNotesNewestFirst } from "../../lib/release-notes";
import { S } from "../../lib/strings";
import { stripAnsi } from "../../lib/strip-ansi";
import { toneInk } from "../../lib/tone";
import type { UpdateFlow, UpdateMode } from "../../lib/update-flow";
import {
  checkForUpdates,
  closeAppInfo,
  downloadUpdate,
  installUpdate,
  useUpdateFlow,
  useUpdateFlowOwner,
} from "../../lib/use-update-flow";
import { useVersionInfo } from "../../lib/use-version-info";
import { useLocale } from "../../state/locale";
import { CreditsList } from "./credits-list";

const HOMEPAGE_URL = "https://penguin.ooo/";
const REPOSITORY_URL = "https://github.com/Prism-Shadow/penguin-harness";
const RELEASES_URL = "https://github.com/Prism-Shadow/penguin-harness/releases";

export function AppInfoDialog() {
  useUpdateFlowOwner();
  const { mode, flow, modalOpen, currentVersion } = useUpdateFlow();
  return (
    <Modal
      open={modalOpen}
      title={S.appInfo.title}
      onClose={closeAppInfo}
      widthClass="sm:max-w-2xl"
    >
      <div className="space-y-6">
        <Identity currentVersion={currentVersion} />
        {mode !== "none" && (
          <RuledSection level={3} title={S.update.title}>
            <UpdateStatus mode={mode} flow={flow} />
          </RuledSection>
        )}
        <ReleaseNotes currentVersion={currentVersion} />
        <Credits />
      </div>
    </Modal>
  );
}

/** The logo, the name, the running version with its build date, and the two links out. */
function Identity({ currentVersion }: { currentVersion: string | null }) {
  const { locale } = useLocale();
  const { version } = useVersionInfo(false);
  // The stamped date is the server's build's: shown only beside that same version (the shell's
  // window names its own, which is the same build in every install).
  const buildDate =
    version !== null && version.version === currentVersion ? version.buildDate : null;
  return (
    <div className="flex items-center gap-4">
      <PenguinLogo src="/penguin-logo.svg" className="h-14 w-14 shrink-0 rounded-2xl" />
      <div className="min-w-0">
        <p className="text-lg font-semibold">{S.appName}</p>
        {currentVersion !== null && (
          <p className="text-sm text-fg-muted">
            {`v${currentVersion}${
              buildDate !== null
                ? ` · ${S.update.lastUpdated(formatMonthDay(buildDate, locale))}`
                : ""
            }`}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <ExternalButton href={HOMEPAGE_URL} glyph={ICONS.house}>
            {S.appInfo.homepage}
          </ExternalButton>
          {/* The registry has no GitHub mark, so the external-link glyph after the name is the
              button's only one. */}
          <ExternalButton href={REPOSITORY_URL}>{S.appInfo.repository}</ExternalButton>
        </div>
      </div>
    </div>
  );
}

/**
 * A link out of the app in the small bordered button's look, treated as the shared `Link external`
 * treats one: a new tab isolated from this one (`noopener noreferrer`), the external-link glyph
 * after the text as the visible sign that a click leaves the app, and that same fact in the
 * accessible name, since the glyph itself is decorative.
 */
function ExternalButton({
  href,
  glyph,
  children,
}: {
  href: string;
  /** A leading mark naming the destination. */
  glyph?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClass("secondary", "sm")}
    >
      {glyph !== undefined && <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} />}
      {children}
      <GlyphIcon d={ICONS.externalLink} size={ICON_SIZE.inlineGlyph} />
      <span className="sr-only"> · {S.appInfo.opensInNewTab}</span>
    </a>
  );
}

function Body({ mode, flow }: { mode: UpdateMode; flow: UpdateFlow }): ReactNode {
  switch (flow.kind) {
    case "unknown":
      return <p className="text-sm text-fg-muted">{S.update.notChecked}</p>;
    case "checking":
      return <Line spinner>{S.update.checkingBody}</Line>;
    case "disabled":
      return (
        <>
          <p className="text-sm">{S.update.checkDisabled}</p>
          <ReleasesLink href={RELEASES_URL}>{S.update.openReleases}</ReleasesLink>
        </>
      );
    case "up-to-date":
      return <p className={`text-sm font-medium ${toneInk.success}`}>{S.update.upToDate}</p>;
    case "available":
      return (
        <>
          <p className="text-sm font-medium">{S.update.newVersion(flow.version)}</p>
          {flow.releaseUrl !== null && (
            <ReleasesLink href={flow.releaseUrl}>{S.update.releaseNotes}</ReleasesLink>
          )}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {!flow.canInstall
              ? S.update.adminOnly
              : mode === "client"
                ? S.update.availableBodyClient
                : S.update.availableBodyRelease}
          </p>
        </>
      );
    case "downloading":
      return (
        <>
          <p className="text-sm font-medium">{S.update.downloading(flow.version)}</p>
          <ProgressBar
            size="md"
            label={S.update.downloadProgress}
            {...(flow.percent !== null ? { value: flow.percent } : { indeterminate: true })}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {flow.percent !== null
              ? `${flow.percent}%`
              : flow.phase === "installing"
                ? S.update.phaseInstalling
                : flow.phase === "downloading"
                  ? S.update.phaseDownloading
                  : S.update.phaseResolving}
          </p>
        </>
      );
    case "ready":
      return (
        <>
          <p className={`text-sm font-medium ${toneInk.success}`}>{S.update.ready(flow.version)}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {flow.restart === "manual"
              ? S.update.readyBodyManual
              : mode === "client"
                ? S.update.readyBodyClient
                : S.update.readyBodyRelease}
          </p>
        </>
      );
    case "restarting":
      return (
        <Line spinner>
          {S.update.restarting}{" "}
          <span className="text-gray-500 dark:text-gray-400">
            {mode === "client" ? S.update.restartingBodyClient : S.update.restartingBodyRelease}
          </span>
        </Line>
      );
    case "error":
      return (
        <>
          <p className={`text-sm font-medium ${toneInk.danger}`}>
            {flow.retry === "check" ? S.update.checkFailed : S.update.failed}
          </p>
          {flow.message !== null && <p className="text-sm">{flow.message}</p>}
          {flow.detail !== null && <OutputTail text={flow.detail} />}
        </>
      );
    case "unsupported":
      return (
        <>
          <p className={`text-sm font-medium ${toneInk.attention}`}>
            {flow.reason.code === "dev"
              ? S.update.unsupportedDev
              : flow.reason.code === "linux-not-appimage"
                ? S.update.unsupportedNonAppImage
                : flow.reason.code === "not_launched_via_cli"
                  ? S.update.unsupportedNotViaCli
                  : S.update.unsupportedCli}
          </p>
          {flow.reason.code === "cli_refused" && flow.reason.detail !== "" && (
            <OutputTail text={flow.reason.detail} />
          )}
          <ReleasesLink href={RELEASES_URL}>{S.update.openReleases}</ReleasesLink>
        </>
      );
  }
}

/**
 * The section as one row: where the flow stands on the left, its one next step on the right —
 * check again, download, restart, or retry — or no button while something runs, the spinner or
 * progress bar saying what. A one-line state centres the button on its line; a taller one keeps
 * it beside the state's first line, so the rest of the body reads below. The button drops under
 * the text only when the row is too narrow to hold both. The dialog has no footer; closing is
 * its header's cross, which never cancels anything.
 */
function UpdateStatus({ mode, flow }: { mode: UpdateMode; flow: UpdateFlow }) {
  const step = nextStep(mode, flow);
  return (
    <div
      className={`flex flex-wrap justify-between gap-x-4 gap-y-3 ${isOneLine(flow) ? "items-center" : "items-baseline"}`}
    >
      <div className="min-w-0 grow basis-64 space-y-3">
        <Body mode={mode} flow={flow} />
      </div>
      {step !== null && <div className="ml-auto flex shrink-0">{step}</div>}
    </div>
  );
}

/** Whether a state's body is a single line of text, which its button sits level with. */
function isOneLine(flow: UpdateFlow): boolean {
  switch (flow.kind) {
    case "unknown":
    case "checking":
    case "up-to-date":
    case "restarting":
      return true;
    case "error":
      return flow.message === null && flow.detail === null;
    default:
      return false;
  }
}

function nextStep(mode: UpdateMode, flow: UpdateFlow): ReactNode {
  const check = (
    <Button size="sm" onClick={() => void checkForUpdates()}>
      {S.update.checkNow}
    </Button>
  );
  switch (flow.kind) {
    case "unknown":
    case "up-to-date":
      return check;
    case "disabled":
      // Checks are off on the server, and a forced check answers the same: the body's Releases
      // link is the way to look.
      return null;
    case "available":
      // A non-admin on a server reads the offer; the body says the update is an admin's.
      return flow.canInstall ? (
        <Button size="sm" variant="primary" onClick={() => void downloadUpdate()}>
          {S.update.downloadAndInstall}
        </Button>
      ) : null;
    case "ready":
      // A manual restart is the user's, in a terminal; the body says how.
      return flow.restart === "auto" ? (
        <Button size="sm" variant="primary" onClick={() => void installUpdate()}>
          {S.update.restartNow}
        </Button>
      ) : null;
    case "error":
      return (
        <Button
          size="sm"
          onClick={() => void (flow.retry === "check" ? checkForUpdates() : downloadUpdate())}
        >
          {S.update.retry}
        </Button>
      );
    case "unsupported":
      // A server refusal is a fact about the install; the check can still run again. The
      // shell's refusal (a dev run, a package-managed Linux install) is the same whatever a
      // check would say.
      return mode === "release" ? check : null;
    case "checking":
    case "downloading":
    case "restarting":
      return null;
  }
}

/** Every released version's notes, newest first; the running version's entry is marked. */
function ReleaseNotes({ currentVersion }: { currentVersion: string | null }) {
  const { locale } = useLocale();
  const notes = releaseNotesNewestFirst();
  return (
    <RuledSection level={3} title={S.appInfo.releaseNotes} count={notes.length}>
      <ol className="divide-y divide-line-muted">
        {notes.map((note) => (
          <li key={note.version} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-3">
              <h4 className={`flex items-center ${ICON_GAP.row} text-sm font-medium`}>
                {`v${note.version}`}
                {note.version === currentVersion && (
                  <Badge tone="neutral" variant="soft" size="sm">
                    {S.appInfo.current}
                  </Badge>
                )}
              </h4>
              <span className="shrink-0 text-xs text-fg-subtle">
                {formatYearMonthDay(note.date, locale)}
              </span>
            </div>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-fg-muted">
              {noteLines(note, locale).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </RuledSection>
  );
}

/**
 * The copyright line, then the font and icon licences behind a fold (the WAI-ARIA disclosure: a
 * real button with `aria-expanded` and `aria-controls`, the panel kept in the DOM and `hidden`
 * while folded), so the dialog stays short until someone wants pages of licence text.
 */
function Credits() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <RuledSection level={3} title={S.appInfo.credits}>
      <p className="text-sm text-fg-muted">{S.appInfo.copyright}</p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`mt-3 flex items-center ${ICON_GAP.row} text-sm text-fg-muted transition-colors duration-150 hover:text-fg`}
      >
        <Chevron open={open} size={ICON_SIZE.chevron} />
        {S.appInfo.licenses}
      </button>
      <div id={panelId} hidden={!open} className="mt-4">
        <CreditsList />
      </div>
    </RuledSection>
  );
}

function Line({ spinner, children }: { spinner?: boolean; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      {spinner && <Spinner size="md" label={S.common.loading} />}
      <span>{children}</span>
    </p>
  );
}

function ReleasesLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p>
      <Link href={href} external variant="standalone" className="text-sm">
        {children}
      </Link>
    </p>
  );
}

/** The update command's output tail (may carry ANSI colour when the server env forces it). */
function OutputTail({ text }: { text: string }) {
  return (
    <pre className="max-h-56 overflow-auto rounded-md bg-gray-100 p-3 text-xs leading-relaxed whitespace-pre-wrap text-gray-700 dark:bg-gray-800 dark:text-gray-300">
      {stripAnsi(text)}
    </pre>
  );
}
