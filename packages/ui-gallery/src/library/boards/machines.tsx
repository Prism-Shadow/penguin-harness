/**
 * 机器: the Machines page's presentation from the package — the status pill in every state, the
 * machine card in each state a machine can stand in (this server, running, a job under way or
 * queued, coming back with its retry line, stopped coming back, failed, refused, on another build,
 * stopped, out of reach, nothing installed), the list loading, the Machine dialog's toolbar with a held verb, and the add
 * dialog's shell with its host rows and footer.
 */
import { useState } from "react";
import {
  AddMachineFooter,
  AddMachineShell,
  ICONS,
  MACHINE_STATES,
  MachineCard,
  MachineHostList,
  MachineHostRow,
  MachineList,
  MachineStatusPill,
  MachineToolbar,
} from "@prismshadow/penguin-ui";
import type {
  MachineCardFact,
  MachineCardProps,
  MachineState,
  MachineStepState,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

/** Aliases, paths, versions, ports and ssh's own words are data: the same in both languages. */
const ROOT = "/home/ubuntu/.penguin/data";
const VERSION = "v0.2.16";
const OLD_VERSION = "v0.2.15";
const PORT = "7364";
const SSH_SAID = "ssh: connect to host 10.0.0.12 port 22: Connection timed out";
const JOB_LINE = "Downloading penguin-harness 0.2.16…";
const STEPS_RUNNING: MachineStepState[] = [
  "done",
  "done",
  "current",
  "pending",
  "pending",
  "pending",
];
const STEPS_QUEUED: MachineStepState[] = [
  "pending",
  "pending",
  "pending",
  "pending",
  "pending",
  "pending",
];
const HOSTS = [
  { alias: "gpu-a100", reach: "ubuntu@10.0.0.21:2222", note: null },
  { alias: "gpu-h200", reach: "ubuntu@10.0.0.22", note: VERSION },
  { alias: "nas", reach: null, note: null },
];

export function MachinesBoard() {
  const { S } = useGallery();
  const t = S.library.machines;
  const r = S.library.retry;
  // The coming-back card's next attempt, fixed when the board mounts so its countdown runs down.
  const [nextAt] = useState(() => Date.now() + 80_000);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(["gpu-a100"]));
  const [query, setQuery] = useState("");
  const [installNow, setInstallNow] = useState(true);
  const [tab, setTab] = useState<"config" | "manual">("config");
  // Only some states have more to say than their word.
  const reasonOf = (state: MachineState): string | null =>
    (t.reasons as Partial<Record<MachineState, string>>)[state] ?? null;

  const facts = (local: boolean, extra: { port?: boolean; version?: string | null } = {}) => {
    const list: MachineCardFact[] = [
      local
        ? { glyph: ICONS.house, value: t.card.local }
        : { glyph: ICONS.terminalPrompt, value: "ssh" },
    ];
    if (extra.version !== null) {
      list.push({ glyph: ICONS.hardDrive, value: extra.version ?? VERSION });
    }
    if (extra.port === true) list.push({ glyph: ICONS.network, value: PORT });
    list.push({ glyph: ICONS.clock, value: t.card.checked });
    return list;
  };
  const card = (
    id: string,
    state: MachineState,
    over: Partial<MachineCardProps> = {},
  ): MachineCardProps => ({
    id,
    alias: id,
    status: { state, label: t.states[state], reason: reasonOf(state) },
    root: ROOT,
    facts: facts(false),
    onOpen: noop,
    use: { label: t.card.use, disabled: true, onClick: noop },
    settingsLabel: t.card.settings,
    remove: { label: t.card.remove, onClick: noop },
    ...over,
  });
  const cards: MachineCardProps[] = [
    card("penguin-dev", "serving", {
      local: { tag: t.card.thisServer, undeletable: t.card.undeletable },
      facts: facts(true, { port: true }),
      use: { label: t.card.use, onClick: noop },
    }),
    card("gpu-a100", "ready", {
      facts: facts(false, { port: true }),
      use: { label: t.card.use, onClick: noop },
      sync: { label: t.card.sync, onClick: noop },
    }),
    card("build-box", "ready", {
      facts: facts(false, { port: true, version: OLD_VERSION }),
      update: { label: t.card.update, onClick: noop },
      use: { label: t.card.use, onClick: noop },
    }),
    card("gpu-h200", "working", {
      status: { state: "working", label: t.states.working, reason: JOB_LINE },
      progress: { steps: STEPS_RUNNING, caption: t.card.installing, running: true },
      remove: { label: t.card.remove, disabled: true, onClick: noop },
    }),
    card("lab-mac", "queued", {
      progress: { steps: STEPS_QUEUED, caption: t.states.queued, running: false },
      remove: { label: t.card.remove, disabled: true, onClick: noop },
    }),
    card("mini", "reconnecting", {
      retry: {
        phase: "waiting",
        label: r.trying(4, 5),
        nextAt,
        countdown: (s) => r.waiting(s, 4, 5),
        reason: r.refused("mini"),
        reasonTitle: r.lastFailure,
        retry: { label: r.retryNow, onClick: noop },
        secondary: { label: r.stop, onClick: noop },
      },
    }),
    card("lab-2", "reconnectFailed", {
      retry: {
        phase: "gaveUp",
        label: r.gaveUp(5),
        reason: r.refused("lab-2"),
        reasonTitle: r.lastFailure,
        retry: { label: r.retry, onClick: noop },
      },
    }),
    card("edge-1", "unreachable", {
      status: { state: "unreachable", label: t.states.unreachable, reason: SSH_SAID },
      waits: t.waits.notConnected,
    }),
    card("office-2", "notConnected", {
      facts: facts(false, { port: true }),
      waits: t.waits.notConnected,
    }),
    card("lab-pc", "stopped", { waits: t.waits.stopped }),
    card("old-box", "behind", {
      facts: facts(false, { port: true, version: OLD_VERSION }),
      update: { label: t.card.update, onClick: noop },
      waits: t.waits.notConnected,
    }),
    card("gpu-v100", "failed", {
      status: { state: "failed", label: t.states.failed, reason: reasonOf("failed") },
      waits: t.waits.failed,
    }),
    card("vault", "signInRefused", {
      retry: { phase: "blocked", label: r.stoppedPassword, reason: r.password },
    }),
    card("spare", "notInstalled", {
      facts: facts(false, { version: null }),
      waits: t.waits.notInstalled,
    }),
    card("win-box", "installedOnly", { waits: t.waits.windows }),
    card("fresh", "unknown", { waits: t.waits.notConnected }),
  ];

  return (
    <div className="gf-board">
      <BoardGroup title={t.pills} aside={t.pillsHint}>
        <div className="flex flex-wrap items-center gap-2">
          {MACHINE_STATES.map((state) => (
            <MachineStatusPill
              key={state}
              state={state}
              label={t.states[state]}
              reason={reasonOf(state)}
            />
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.cards} aside={t.cardsHint}>
        <MachineList>
          {cards.map((props) => (
            <MachineCard key={props.id} {...props} />
          ))}
        </MachineList>
      </BoardGroup>
      <BoardGroup title={t.loading}>
        <MachineList loading />
      </BoardGroup>
      <BoardGroup title={t.toolbar} aside={t.toolbarHint}>
        <MachineToolbar
          label={t.toolbarLabel}
          busy={false}
          note={t.held}
          onAct={noop}
          items={[
            {
              verb: "update",
              label: t.verbs.update,
              glyph: ICONS.refresh,
              primary: true,
              held: false,
            },
            {
              verb: "stop",
              label: t.verbs.stop,
              glyph: ICONS.stopCircle,
              primary: false,
              held: true,
            },
            {
              verb: "restart",
              label: t.verbs.restart,
              glyph: ICONS.rotateCw,
              primary: false,
              held: true,
            },
            {
              verb: "configure",
              label: t.verbs.configure,
              glyph: ICONS.slidersHorizontal,
              primary: false,
              held: false,
            },
            {
              verb: "reinstall",
              label: t.verbs.reinstall,
              glyph: ICONS.download,
              primary: false,
              held: false,
            },
            {
              verb: "uninstall",
              label: t.verbs.uninstall,
              glyph: ICONS.trash,
              primary: false,
              held: true,
            },
          ]}
        />
      </BoardGroup>
      <BoardGroup title={t.add} aside={t.addHint}>
        <div className="lib-stack">
          <div className="lib-box">
            <AddMachineShell
              intro={t.addIntro}
              tabs={[
                { key: "config", label: t.tabs.config },
                { key: "manual", label: t.tabs.manual },
              ]}
              tab={tab}
              onTab={setTab}
              error={t.addError}
            >
              <MachineHostList query={query} onQuery={setQuery} searchLabel={t.search}>
                {HOSTS.map((host) => (
                  <MachineHostRow
                    key={host.alias}
                    alias={host.alias}
                    reach={host.reach}
                    note={host.note === null ? null : t.elsewhere(host.note)}
                    checked={picked.has(host.alias)}
                    onToggle={() =>
                      setPicked((was) => {
                        const next = new Set(was);
                        if (next.has(host.alias)) next.delete(host.alias);
                        else next.add(host.alias);
                        return next;
                      })
                    }
                  />
                ))}
              </MachineHostList>
            </AddMachineShell>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <AddMachineFooter
                installNow={installNow}
                onInstallNow={setInstallNow}
                installNowLabel={t.installNow}
                cancelLabel={t.cancel}
                submitLabel={picked.size > 1 ? t.submitCount(picked.size) : t.submit}
                canSubmit={picked.size > 0}
                busy={false}
                onCancel={noop}
                onSubmit={noop}
              />
            </div>
          </div>
          <span className="lib-caption">{t.exhaustedCaption}</span>
          <div className="lib-box">
            <MachineHostList
              query=""
              onQuery={noop}
              searchLabel={t.search}
              exhausted={{ text: t.noHosts, actionLabel: t.tabs.manual, onAction: noop }}
            />
          </div>
        </div>
      </BoardGroup>
    </div>
  );
}

function noop() {}
