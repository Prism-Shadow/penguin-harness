/**
 * The Machine dialog: everything about one machine that its card leaves out, and every verb it
 * takes, in three ruled sections.
 *
 * - Connection: how this server reaches the machine — the ssh alias and the host block that alias
 *   names — the server root, the state, what the last probe found over there and when, the build
 *   it carries, and last, quiet, the machine's own id with a copy button.
 * - Job: the current or last job's stepper and its output, the newest line bright. A failed
 *   machine offers Retry, and Force install when the failure asks for it.
 * - Actions: Enable (or Update) and Disable — the whole pipeline, as on the card — then the
 *   single steps the server also takes one at a time: install, connect, restart, disconnect and
 *   remove from the Project; and the ssh host's form.
 *
 * This server's own entry has the first section alone: it runs no jobs and takes no verbs.
 *
 * `MachineDetailBody` is a pure function of its props. The dialog around it adds one read, the
 * host block, which the machines list does not carry: the list is the ssh config's aliases only.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { MachineInfo, MachineJob, SshHostResponse } from "@prismshadow/penguin-server/api";
import {
  Button,
  CopyButton,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  KeyValue,
  KeyValueRow,
  Modal,
  NoticeStrip,
  RuledSection,
} from "@prismshadow/penguin-ui";
import type { ButtonVariant } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { formatDateTime, formatMessageTime } from "../../lib/format";
import { Stepper, jobMoving } from "./machine-card";
import { outOfDate, readMachine, wantsUse } from "./machines-view";

/** Everything the dialog can ask its page to do for the machine. */
export type MachineVerb =
  | "use"
  | "stopUsing"
  | "replaceProgram"
  | "install"
  | "connect"
  | "restart"
  | "disconnect"
  | "release"
  | "configure";

export interface MachineDetailBodyProps {
  machine: MachineInfo;
  /** The machine's job: queued, running, or its last finished one. */
  job: MachineJob | null;
  imageVersion: string | null;
  locale: "zh" | "en";
  /** The host block the alias names; null until read, or when the config has none this app can read. */
  host: SshHostResponse | null;
  /** The page's last error, repeated here because the dialog covers the notice that says it. */
  error: string | null;
  /** A request from this page is in flight: every verb waits for it. */
  busy: boolean;
  /** This server has no build to push, so an install has nothing to send. */
  noImage: boolean;
  onAct: (verb: MachineVerb) => void;
}

/**
 * One pair in the Connection lists: the label in the muted ink, at a minimum width every list
 * shares so they line up when a phone stacks them, and the value semibold — the part that is read
 * — or, for a `quiet` detail you go looking for, in the muted ink like its label.
 */
function Row({
  label,
  mono = false,
  quiet = false,
  children,
}: {
  label: string;
  mono?: boolean;
  quiet?: boolean;
  children: ReactNode;
}) {
  return (
    <KeyValueRow label={<span className="inline-block min-w-[6em]">{label}</span>} mono={mono}>
      <span className={quiet ? "text-fg-muted" : "font-semibold"}>{children}</span>
    </KeyValueRow>
  );
}

/** `user@host:port`, the way ssh itself would be told; the default port goes unsaid. */
function hostLine(host: SshHostResponse): string {
  const user = host.user === undefined || host.user === "" ? "" : `${host.user}@`;
  const port = host.port === undefined || host.port === 22 ? "" : `:${host.port}`;
  return `${user}${host.hostName}${port}`;
}

/** One verb: a flat button, its glyph before its word, what it does on hover. */
function Verb({
  glyph,
  label,
  why,
  variant = "ghost",
  disabled,
  onClick,
}: {
  glyph: string;
  label: string;
  why?: string;
  variant?: ButtonVariant;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button size="sm" variant={variant} title={why} disabled={disabled} onClick={onClick}>
      <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} />
      {label}
    </Button>
  );
}

/** A thin rule between groups of verbs. */
function VerbRule() {
  return <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />;
}

/** The job's output with its latest line bright, so the line that matters is the one that stands out. */
function JobOutput({ job }: { job: MachineJob }) {
  if (job.log.length === 0) return null;
  return (
    <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-gray-50 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-gray-500 dark:bg-gray-900">
      {job.log.slice(0, -1).join("\n")}
      {job.log.length > 1 ? "\n" : ""}
      <span className="text-gray-900 dark:text-gray-100">{job.log.at(-1)}</span>
    </pre>
  );
}

export function MachineDetailBody({
  machine,
  job,
  imageVersion,
  locale,
  host,
  error,
  busy,
  noImage,
  onAct,
}: MachineDetailBodyProps) {
  const m = S.machines;
  const reading = machine.local ? null : readMachine(machine, job, imageVersion);
  const moving = jobMoving(job);
  const status = machine.status;
  const failed = reading?.kind === "failed" ? reading : null;
  // The whole pipeline, as the card offers it: Update for a machine on another build, Enable for
  // one that needs bringing up, nothing while a job is already on its way.
  const pipeline = moving
    ? null
    : outOfDate(machine, imageVersion)
      ? { glyph: ICONS.refresh, label: m.card.update }
      : reading !== null && wantsUse(reading)
        ? { glyph: ICONS.plug, label: m.use }
        : null;
  return (
    <div className="space-y-6">
      {error !== null && (
        <NoticeStrip tone="danger" className="rounded-md border px-3 py-2 text-sm">
          {error}
        </NoticeStrip>
      )}

      <RuledSection level={3} title={m.detail.connection}>
        {/* Two columns from sm up — where the machine is, and how it stands — which keeps the
            verbs below in view; the first is wider, since paths live there. One column on a
            phone. */}
        <div className="grid items-start gap-x-6 gap-y-1 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <KeyValue size="sm">
            {!machine.local && (
              <Row label={m.detail.alias} mono>
                {machine.alias}
              </Row>
            )}
            {!machine.local && host !== null && (
              <Row label={m.detail.host} mono>
                {hostLine(host)}
              </Row>
            )}
            {/* Which installation over there this entry is about: a dev instance and a release
                one reach the same machine and mean different roots. */}
            <Row label={m.detailRoot} mono>
              {machine.root}
            </Row>
          </KeyValue>
          <KeyValue size="sm">
            <Row label={m.detail.state}>
              {reading === null ? m.state.serving : m.state[reading.kind]}
            </Row>
            {status !== null && (
              <>
                <Row label={m.detailServer}>
                  {status.state === "running"
                    ? m.serverUpOn(status.port ?? 0)
                    : status.state === "stopped"
                      ? m.state.stopped
                      : (status.detail ?? m.state.unreachable)}
                </Row>
                <Row label={m.detailChecked}>
                  {formatMessageTime(new Date(status.checkedAt).getTime(), locale)}
                </Row>
              </>
            )}
            {machine.installed !== null && (
              <>
                <Row label={machine.local ? m.detailVersion : m.detailInstalled} mono>
                  {machine.installed.version}
                </Row>
                <Row label={machine.local ? m.detailStarted : m.detailSince}>
                  {formatDateTime(machine.installed.at)}
                </Row>
              </>
            )}
          </KeyValue>
        </div>
        {/* The machine's own id is a detail you go looking for: it closes the section, quiet,
            with its copy button. */}
        {machine.machineId !== null && (
          <KeyValue size="sm" className="mt-1">
            <Row label={m.detailMachineId} mono quiet>
              <span className="inline-flex items-center gap-1.5">
                {machine.machineId}
                <CopyButton size="sm" text={machine.machineId} label={m.detail.copyMachineId} />
              </span>
            </Row>
          </KeyValue>
        )}
      </RuledSection>

      {!machine.local && job !== null && (
        <RuledSection level={3} title={m.detail.job}>
          <Stepper job={job} className="max-w-xs" />
          <JobOutput job={job} />
          {failed !== null && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Verb
                glyph={ICONS.rotateCcw}
                label={m.detail.retry}
                variant="secondary"
                disabled={busy}
                onClick={() => onAct("use")}
              />
              {failed.canReplaceProgram && (
                <Verb
                  glyph={ICONS.plug}
                  label={m.replaceProgram}
                  why={m.replaceProgramWhy}
                  // Secondary like Retry: the confirmation that follows carries the danger tone.
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onAct("replaceProgram")}
                />
              )}
            </div>
          )}
        </RuledSection>
      )}

      {!machine.local && (
        <RuledSection level={3} title={m.detail.actions}>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
            {pipeline !== null && (
              <Verb
                glyph={pipeline.glyph}
                label={pipeline.label}
                disabled={busy}
                onClick={() => onAct("use")}
              />
            )}
            <Verb
              glyph={ICONS.plugLifted}
              label={m.stopUsing}
              disabled={busy}
              onClick={() => onAct("stopUsing")}
            />
            <VerbRule />
            {/* The single steps answer 409 while a job runs for the machine, so they wait for it;
                letting go of the machine does not. */}
            <Verb
              glyph={ICONS.download}
              label={m.verbs.install}
              why={m.verbs.installWhy}
              disabled={busy || moving || noImage}
              onClick={() => onAct("install")}
            />
            <Verb
              glyph={ICONS.chainLink}
              label={m.verbs.connect}
              why={m.verbs.connectWhy}
              disabled={busy || moving}
              onClick={() => onAct("connect")}
            />
            <Verb
              glyph={ICONS.rotateCw}
              label={m.verbs.restart}
              why={m.verbs.restartWhy}
              disabled={busy || moving}
              onClick={() => onAct("restart")}
            />
            <Verb
              glyph={ICONS.signOut}
              label={m.verbs.disconnect}
              why={m.verbs.disconnectWhy}
              disabled={busy || machine.connection === null}
              onClick={() => onAct("disconnect")}
            />
            <Verb
              glyph={ICONS.boxArrowOut}
              label={m.verbs.release}
              why={m.verbs.releaseWhy}
              disabled={busy}
              onClick={() => onAct("release")}
            />
            <VerbRule />
            <Verb
              glyph={ICONS.gear}
              label={m.host.configure}
              disabled={busy}
              onClick={() => onAct("configure")}
            />
          </div>
        </RuledSection>
      )}
    </div>
  );
}

/**
 * The dialog itself: titled with the machine's alias, closed by its header's cross alone. `hostEpoch`
 * moves when the page saves the ssh host's form, so the Connection section reads the block again.
 */
export function MachineDetailDialog({
  projectId,
  hostEpoch,
  onClose,
  ...body
}: Omit<MachineDetailBodyProps, "host"> & {
  projectId: string;
  hostEpoch: number;
  onClose: () => void;
}) {
  const { alias, local } = body.machine;
  const [host, setHost] = useState<SshHostResponse | null>(null);
  useEffect(() => {
    setHost(null);
    if (local) return;
    let cancelled = false;
    api.getSshHost(projectId, alias).then(
      (found) => {
        if (!cancelled) setHost(found);
      },
      // A block that lives in an included file, or none at all: the section names the alias alone.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, alias, local, hostEpoch]);
  return (
    <Modal open title={alias} onClose={onClose} widthClass="sm:max-w-2xl">
      <MachineDetailBody {...body} host={host} />
    </Modal>
  );
}
