/**
 * The add dialog: one way to put machines on this page, in the shape of the other add and import
 * dialogs — a title, one plain line saying what happens, a tab per way in, and a footer.
 *
 * - From the ssh config: the hosts this server's ssh config declares that are not on the page yet,
 *   one per row with a box to tick — the name, and muted beside it how its block reaches it
 *   (`user@host:port`) — under a search box. With nothing left to add, the tab says so and points
 *   at the other one.
 * - Fill in by hand: a new host — name, host, user name, port (22 unless said), private key — which
 *   the server writes into its ssh config before adding it. Each field's hint says what it wants
 *   in the muted ink; only a value that is wrong is said in the danger ink, under its field.
 *
 * The footer: Cancel and Add, and a box ticked from the start, "Install and connect right after
 * adding". Ticked, Add enables the machines (`use`: install, start, connect, hand over the Model
 * config), and their cards show the progress; unticked, it only puts them on the page, each card
 * offering Enable.
 *
 * `AddMachineBody` and `AddMachineFooter` are pure functions of their props; the dialog around them
 * holds the state, reads the hosts' lines once when it opens, and makes the requests.
 */
import { useEffect, useState } from "react";
import type {
  MachinesResponse,
  MachinesUseResponse,
  SshHostSummary,
} from "@prismshadow/penguin-server/api";
import {
  Badge,
  Button,
  Checkbox,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Modal,
  NoticeStrip,
  SearchInput,
  Tabs,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import { ADD_TABS, addPlan, hostRows } from "./add-machine-view";
import type { AddTab, HostRow } from "./add-machine-view";
import { highlightSegments } from "./machines-match";
import {
  HostFields,
  NEW_HOST_FORM,
  hasErrors,
  hostRequest,
  validateHostForm,
} from "./ssh-host-dialog";
import type { HostField, HostForm } from "./ssh-host-dialog";

export interface AddMachineBodyProps {
  tab: AddTab;
  onTab: (tab: AddTab) => void;
  /** The first tab's rows: the hosts not on the page yet that match the search. */
  rows: readonly HostRow[];
  /** How many hosts there are to offer before the search narrows them. */
  offered: number;
  query: string;
  onQuery: (query: string) => void;
  /** The ticked hosts, by machine id. */
  picked: ReadonlySet<string>;
  onPick: (id: string) => void;
  form: HostForm;
  errors: Partial<Record<HostField, string>>;
  onField: (field: HostField, value: string) => void;
  /** Enter in a field: the same as pressing Add. */
  onEnter: () => void;
  /** Why the last Add did not go through, when the server said so; null otherwise. */
  error: string | null;
}

/** An alias with the search's matched characters in the strong ink and the rest muted. */
function Alias({ row }: { row: HostRow }) {
  const { alias } = row.machine;
  if (row.positions.length === 0) return <>{alias}</>;
  return (
    <>
      {highlightSegments(alias, row.positions).map((segment, i) => (
        <span key={i} className={segment.hit ? "font-semibold text-fg" : "text-fg-muted"}>
          {segment.text}
        </span>
      ))}
    </>
  );
}

/**
 * One host to tick: the whole row toggles. The server glyph leads it, the name follows with its
 * reach muted beside it, and a host another Project already installed says so at the end — adding
 * it costs no transfer.
 */
function HostRowItem({
  row,
  on,
  onPick,
}: {
  row: HostRow;
  on: boolean;
  onPick: (id: string) => void;
}) {
  const { machine } = row;
  return (
    <li data-host={machine.alias} data-picked={on ? "true" : "false"}>
      <label
        className={`flex min-w-0 cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-surface-muted ${
          on ? "bg-surface-muted" : ""
        }`}
      >
        <Checkbox checked={on} onChange={() => onPick(machine.id)} aria-label={machine.alias} />
        <GlyphIcon d={ICONS.server} size={ICON_SIZE.rowLead} className="shrink-0 text-fg-subtle" />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate font-mono text-sm">
            <Alias row={row} />
          </span>
          {row.reach !== null && (
            <span className="min-w-0 truncate font-mono text-xs text-fg-muted">{row.reach}</span>
          )}
        </span>
        {machine.elsewhere !== undefined && (
          <Badge variant="soft" tone="neutral">
            {S.machines.addDialog.elsewhere(machine.elsewhere.version)}
          </Badge>
        )}
      </label>
    </li>
  );
}

/** The first tab: a search over the hosts not on the page yet, and a row to tick per host. */
function ConfigPanel({
  rows,
  offered,
  query,
  onQuery,
  picked,
  onPick,
  onTab,
}: Pick<
  AddMachineBodyProps,
  "rows" | "offered" | "query" | "onQuery" | "picked" | "onPick" | "onTab"
>) {
  const a = S.machines.addDialog;
  if (offered === 0) {
    // Nothing left in the config: the other tab is how a machine gets here.
    return (
      <div data-empty="no-hosts" className="flex flex-col items-start gap-3 py-2">
        <p className="flex items-start gap-2 text-sm text-fg-muted">
          <GlyphIcon
            d={ICONS.info}
            size={ICON_SIZE.inlineGlyph}
            className="mt-1 shrink-0 text-fg-subtle"
          />
          {a.noHosts}
        </p>
        <Button
          size="sm"
          variant="secondary"
          data-action="to-manual"
          onClick={() => onTab("manual")}
        >
          <GlyphIcon d={ICONS.penLine} size={ICON_SIZE.inlineGlyph} />
          {a.tabs.manual}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <SearchInput value={query} onChange={onQuery} placeholder={a.search} aria-label={a.search} />
      {rows.length === 0 ? (
        <p data-empty="no-match" className="py-2 text-sm text-fg-muted">
          {a.noMatch(query.trim())}
        </p>
      ) : (
        <ul className="max-h-72 divide-y divide-line overflow-y-auto border-y border-line">
          {rows.map((row) => (
            <HostRowItem
              key={row.machine.id}
              row={row}
              on={picked.has(row.machine.id)}
              onPick={onPick}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function AddMachineBody(props: AddMachineBodyProps) {
  const a = S.machines.addDialog;
  const { tab, onTab, form, errors, onField, onEnter, error } = props;
  return (
    <div className="space-y-4">
      <p className="text-sm">{a.intro}</p>
      <div>
        <Tabs
          items={ADD_TABS.map((key) => ({ key, label: a.tabs[key] }))}
          active={tab}
          onChange={onTab}
        />
        <div role="tabpanel" aria-label={a.tabs[tab]} data-tab={tab} className="pt-4">
          {tab === "config" ? (
            <ConfigPanel {...props} />
          ) : (
            <HostFields form={form} errors={errors} onChange={onField} onEnter={onEnter} />
          )}
        </div>
      </div>
      {error !== null && (
        <NoticeStrip
          tone="attention"
          className="flex items-start gap-1.5 rounded-md border px-3 py-2 text-sm"
        >
          <span data-slot="icon" className="mt-1 shrink-0">
            <GlyphIcon
              d={ICONS.alertCircle}
              size={ICON_SIZE.inlineGlyph}
              className={toneInk.attention}
            />
          </span>
          <span>{error}</span>
        </NoticeStrip>
      )}
    </div>
  );
}

export interface AddMachineFooterProps {
  installNow: boolean;
  onInstallNow: (on: boolean) => void;
  /** Add's word: how many the first tab has ticked, when more than one. */
  submitLabel: string;
  canSubmit: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}

/**
 * The footer: the box at the start of the row, Cancel and Add at its end; on a phone the box takes
 * a line of its own above them.
 */
export function AddMachineFooter({
  installNow,
  onInstallNow,
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
        label={S.machines.addDialog.installNow}
        data-option="install-now"
        className="mr-auto basis-full self-center sm:basis-auto"
      />
      <Button size="sm" onClick={onCancel}>
        {S.common.cancel}
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

/** What the page hears once machines are on it: the list as the server answered, and how they came. */
export interface AddedMachines {
  state: MachinesUseResponse;
  verb: "use" | "add";
  count: number;
}

export function AddMachineDialog({
  projectId,
  state,
  onClose,
  onAdded,
}: {
  projectId: string;
  /** The machines list the page holds: which hosts are on it already. */
  state: MachinesResponse;
  onClose: () => void;
  onAdded: (added: AddedMachines) => void;
}) {
  const a = S.machines.addDialog;
  const [tab, setTab] = useState<AddTab>(ADD_TABS[0]);
  const [hosts, setHosts] = useState<SshHostSummary[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [form, setForm] = useState<HostForm>(NEW_HOST_FORM);
  const [errors, setErrors] = useState<Partial<Record<HostField, string>>>({});
  const [installNow, setInstallNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The lines beside each name come from the config once, when the dialog opens; the rows
  // themselves are the page's list, so a host without them still shows by its name.
  useEffect(() => {
    let cancelled = false;
    api.getSshHosts(projectId).then(
      (answer) => {
        if (!cancelled) setHosts(answer.hosts);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const rows = hostRows(state, hosts, query);
  const offered = hostRows(state, hosts, "").length;

  const pick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const field = (name: HostField, value: string) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] === undefined ? prev : { ...prev, [name]: undefined }));
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (tab === "manual") {
      const found = validateHostForm(form);
      const name = form.alias.trim();
      if (found.alias === undefined && state.machines.some((machine) => machine.alias === name)) {
        found.alias = S.machines.host.exists;
      }
      if (hasErrors(found)) {
        setErrors(found);
        return;
      }
    } else if (picked.size === 0) {
      return;
    }
    const plan = addPlan(tab, [...picked], form.alias, installNow);
    setBusy(true);
    try {
      if (plan.writeHost) await api.addSshHost(projectId, hostRequest(form));
      const answer =
        plan.verb === "use"
          ? await api.useMachines(projectId, plan.machines)
          : await api.addMachines(projectId, plan.machines);
      onAdded({ state: answer, verb: plan.verb, count: plan.machines.length });
      onClose();
    } catch (err) {
      // A name the config already has belongs under its field; anything else under the form.
      if (err instanceof ApiError && err.code === "ssh_host_exists") {
        setErrors({ alias: S.machines.host.exists });
      } else {
        setError(apiErrorText(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const count = tab === "config" ? picked.size : 1;
  return (
    <Modal
      open
      title={a.title}
      onClose={onClose}
      widthClass="sm:max-w-lg"
      footer={
        <AddMachineFooter
          installNow={installNow}
          onInstallNow={setInstallNow}
          submitLabel={count > 1 ? a.submitCount(count) : a.submit}
          canSubmit={tab === "manual" || picked.size > 0}
          busy={busy}
          onCancel={onClose}
          onSubmit={() => void submit()}
        />
      }
    >
      <AddMachineBody
        tab={tab}
        onTab={(next) => {
          setTab(next);
          setError(null);
        }}
        rows={rows}
        offered={offered}
        query={query}
        onQuery={setQuery}
        picked={picked}
        onPick={pick}
        form={form}
        errors={errors}
        onField={field}
        onEnter={() => void submit()}
        error={error}
      />
    </Modal>
  );
}
