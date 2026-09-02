/**
 * The update modal: the one place the software update is explained and acted on, for
 * both backends (the server release, and the desktop shell's own updater in its window).
 * Opened from the account-menu row and the version line's badge; mounted once by the app
 * layout so it outlives the menu and the page the badge sits on.
 *
 * It walks the flow the way an app updater does: a check, a release offered with its
 * notes and a confirmation before anything is fetched, a progress bar while it downloads
 * (with "background" — closing never cancels; the row keeps reporting and the outcome
 * toasts), then "restart and update" once the release is ready. Failures show the
 * backend's own text — the update command's output tail, the shell's updater message —
 * and offer a retry; an install form that cannot update itself says why.
 *
 * The flow and the actions live in `use-update-flow.ts`; this file only renders.
 */
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { stripAnsi } from "../../lib/strip-ansi";
import { toneInk } from "../../lib/tone";
import type { UpdateFlow, UpdateMode } from "../../lib/update-flow";
import {
  checkForUpdates,
  closeUpdateModal,
  downloadUpdate,
  installUpdate,
  useUpdateFlow,
  useUpdateFlowOwner,
} from "../../lib/use-update-flow";
import { Button } from "../ui/button";
import { Modal } from "../ui/modal";

const RELEASES_URL = "https://github.com/Prism-Shadow/penguin-harness/releases";

export function UpdateModal() {
  useUpdateFlowOwner();
  const { mode, flow, modalOpen, currentVersion } = useUpdateFlow();
  if (mode === "none") return null;
  return (
    <Modal
      open={modalOpen}
      title={S.update.title}
      onClose={closeUpdateModal}
      footer={<Footer mode={mode} flow={flow} />}
    >
      <div className="space-y-3">
        {currentVersion !== null && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {S.update.currentVersion(currentVersion)}
          </p>
        )}
        <Body mode={mode} flow={flow} />
      </div>
    </Modal>
  );
}

function Body({ mode, flow }: { mode: UpdateMode; flow: UpdateFlow }): ReactNode {
  switch (flow.kind) {
    case "unknown":
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
          <ProgressBar percent={flow.percent} />
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

function Footer({ mode, flow }: { mode: UpdateMode; flow: UpdateFlow }): ReactNode {
  const close = <Button onClick={closeUpdateModal}>{S.common.close}</Button>;
  switch (flow.kind) {
    case "unknown":
    case "checking":
      return close;
    case "up-to-date":
      return (
        <>
          {close}
          <Button variant="primary" onClick={() => void checkForUpdates()}>
            {S.update.checkNow}
          </Button>
        </>
      );
    case "available":
      if (!flow.canInstall) return close;
      return (
        <>
          <Button onClick={closeUpdateModal}>{S.update.later}</Button>
          <Button variant="primary" onClick={() => void downloadUpdate()}>
            {S.update.downloadAndInstall}
          </Button>
        </>
      );
    case "downloading":
      return <Button onClick={closeUpdateModal}>{S.update.background}</Button>;
    case "ready":
      if (flow.restart === "manual") return close;
      return (
        <>
          <Button onClick={closeUpdateModal}>{S.update.later}</Button>
          <Button variant="primary" onClick={() => void installUpdate()}>
            {S.update.restartNow}
          </Button>
        </>
      );
    case "restarting":
      return null;
    case "error":
      return (
        <>
          {close}
          <Button
            variant="primary"
            onClick={() => void (flow.retry === "check" ? checkForUpdates() : downloadUpdate())}
          >
            {S.update.retry}
          </Button>
        </>
      );
    case "unsupported":
      return mode === "client" ? (
        close
      ) : (
        // A server refusal is a fact about the install; the check can still run again.
        <>
          {close}
          <Button variant="primary" onClick={() => void checkForUpdates()}>
            {S.update.checkNow}
          </Button>
        </>
      );
  }
}

function Line({ spinner, children }: { spinner?: boolean; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      {spinner && (
        <span
          aria-hidden
          className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70"
        />
      )}
      <span>{children}</span>
    </p>
  );
}

function ReleasesLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
      >
        {children}
      </a>
    </p>
  );
}

/**
 * The download bar: determinate with a percentage (the shell's updater, the installer's
 * curl bar), indeterminate — a pulsing segment — while the backend reports a phase without
 * one (resolving the release, verifying and installing). Width transitions only, so the
 * global reduced-motion rule leaves a correct resting state.
 */
function ProgressBar({ percent }: { percent: number | null }) {
  return (
    <div
      role="progressbar"
      aria-label={S.update.downloadProgress}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent !== null ? { "aria-valuenow": percent } : {})}
      className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
    >
      <div
        className={`h-full rounded-full bg-[var(--accent-bg)] ${
          percent === null ? "w-1/3 animate-pulse" : "transition-[width] duration-300"
        }`}
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </div>
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
