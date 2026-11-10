/**
 * The add dialog: one way to put machines on this page, in the shape of the other add and import
 * dialogs — a title, one plain line saying what happens, a tab per way in, and a footer.
 *
 * - From the ssh config: the hosts this server's ssh config declares that are not on the page yet,
 *   one per row with a box to tick — the name, and muted beside it how its block reaches it
 *   (`user@host:port`) — under a search box. With nothing left to add, the tab says so and points
 *   at the other one.
 * - Fill in by hand: a new host — name, host, user name, port (22 unless said), and how it signs
 *   in: a private key (the default) or a password, which the server stores for it — which the
 *   server writes into its ssh config before adding it. Each field's hint says what it wants in
 *   the muted ink; only a value that is wrong is said in the danger ink, under its field, as it is
 *   typed — a name the page or the config already has among them.
 *
 * The footer: Cancel and Add, and a box ticked from the start, "Install and connect right after
 * adding". Ticked, Add enables the machines (`use`: install, start, connect, hand over the Model
 * config), and their cards show the progress; unticked, it only puts them on the page, each card
 * offering Enable. Add waits for a ticked host, or for a filled-in host with nothing wrong; Enter
 * does not press it.
 *
 * The dialog is one form, as every dialog that creates a record is: the hosts ticked, the host
 * typed in and the box are its draft (the search and the tab are not), so closing it with any of
 * them changed asks first, and nothing closes it while Add is in flight.
 *
 * How each part looks is the shared package's add-machine shell (`AddMachineShell`,
 * `MachineHostList`, `MachineHostRow`, `AddMachineFooter` in `@prismshadow/penguin-ui`);
 * `AddMachineBody` and `AddMachineFooter` here hand it this dialog's words and rows and are pure
 * functions of their props; the dialog around them holds the state, reads the hosts' lines once
 * when it opens, and makes the requests.
 */
import { useEffect, useState } from "react";
import type {
  MachinesResponse,
  MachinesUseResponse,
  SshHostSummary,
} from "@prismshadow/penguin-server/api";
import {
  AddMachineFooter as AddMachineFooterView,
  AddMachineShell,
  MachineHostList,
  MachineHostRow,
  Modal,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { ADD_TABS, addPlan, hostRows, type AddTab, type HostRow } from "./add-machine-view";
import { highlightSegments } from "./machines-match";
import {
  HostFields,
  NEW_HOST_FORM,
  hasErrors,
  hostErrorText,
  hostRequest,
  normalizeHostForm,
  shownErrors,
  validateHostForm,
  type HostErrors,
  type HostField,
  type HostForm,
  type SignIn,
} from "./ssh-host-dialog";

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
  /** What the fields say: each malformed value, or a name already taken, under its field. */
  errors: HostErrors;
  onField: (field: HostField, value: string) => void;
  onSignIn: (signIn: SignIn) => void;
  /** Why the last Add did not go through, when the server said so; null otherwise. */
  error: string | null;
}

/**
 * One host to tick: the shared row, with the search's matched characters picked out of its name,
 * how its block reaches it, and — when another Project already installed it — that it costs no
 * transfer.
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
    <MachineHostRow
      alias={machine.alias}
      segments={row.positions.length === 0 ? [] : highlightSegments(machine.alias, row.positions)}
      reach={row.reach}
      note={
        machine.elsewhere === undefined
          ? null
          : S.machines.addDialog.elsewhere(machine.elsewhere.version)
      }
      checked={on}
      onToggle={() => onPick(machine.id)}
    />
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
  return (
    <MachineHostList
      query={query}
      onQuery={onQuery}
      searchLabel={a.search}
      // Nothing left in the config: the other tab is how a machine gets here.
      exhausted={
        offered === 0
          ? { text: a.noHosts, actionLabel: a.tabs.manual, onAction: () => onTab("manual") }
          : null
      }
      noMatch={rows.length === 0 ? a.noMatch(query.trim()) : null}
    >
      {rows.map((row) => (
        <HostRowItem
          key={row.machine.id}
          row={row}
          on={picked.has(row.machine.id)}
          onPick={onPick}
        />
      ))}
    </MachineHostList>
  );
}

export function AddMachineBody(props: AddMachineBodyProps) {
  const a = S.machines.addDialog;
  const { tab, onTab, form, errors, onField, onSignIn, error } = props;
  return (
    <AddMachineShell
      intro={a.intro}
      tabs={ADD_TABS.map((key) => ({ key, label: a.tabs[key] }))}
      tab={tab}
      onTab={onTab}
      error={error}
    >
      {tab === "config" ? (
        <ConfigPanel {...props} />
      ) : (
        <HostFields form={form} errors={errors} onChange={onField} onSignIn={onSignIn} />
      )}
    </AddMachineShell>
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
export function AddMachineFooter(props: AddMachineFooterProps) {
  return (
    <AddMachineFooterView
      {...props}
      installNowLabel={S.machines.addDialog.installNow}
      cancelLabel={S.common.cancel}
    />
  );
}

/** What the dialog would add: the hosts ticked, the host typed in by hand, and the box. */
interface AddDraft {
  picked: readonly string[];
  host: HostForm;
  installNow: boolean;
}

const NEW_DRAFT: AddDraft = { picked: [], host: NEW_HOST_FORM, installNow: true };

/** The draft as Add would send it: the ticks in any order, the host trimmed. */
const normalizeDraft = (draft: AddDraft) => ({
  picked: [...draft.picked].sort(),
  host: normalizeHostForm(draft.host),
  installNow: draft.installNow,
});

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
  const draft = useFormDraft<AddDraft>(NEW_DRAFT, { normalize: normalizeDraft });
  const { host: form, installNow } = draft.draft;
  const picked: ReadonlySet<string> = new Set(draft.draft.picked);
  /** What the server refused, under its field (the name, the password); cleared on the next edit. */
  const [refused, setRefused] = useState<{ field: HostField; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The host this dialog wrote into the ssh config, when what followed failed: a second Add
  // rewrites that block with the form as it now stands instead of refusing the name it wrote.
  const [written, setWritten] = useState<string | null>(null);

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
  const requestClose = useGuardedClose(onClose, draft.scope, { locked: busy });

  const name = form.alias.trim();
  const found = validateHostForm(form);
  if (
    found.alias === undefined &&
    name !== written &&
    state.machines.some((machine) => machine.alias === name)
  ) {
    found.alias = S.machines.host.exists;
  }
  const errors = shownErrors(found);
  if (refused !== undefined) errors[refused.field] = refused.text;
  const canSubmit = tab === "manual" ? !hasErrors(found) : picked.size > 0;

  const pick = (id: string) =>
    draft.setDraft((prev) => ({
      ...prev,
      picked: prev.picked.includes(id)
        ? prev.picked.filter((one) => one !== id)
        : [...prev.picked, id],
    }));
  const field = (key: HostField, value: string) => {
    draft.setDraft((prev) => ({ ...prev, host: { ...prev.host, [key]: value } }));
    setRefused(undefined);
  };
  const signIn = (next: SignIn) => {
    draft.setDraft((prev) => ({ ...prev, host: { ...prev.host, signIn: next } }));
    setRefused(undefined);
  };

  const submit = async () => {
    if (busy || !canSubmit) return;
    setError(null);
    const plan = addPlan(tab, [...picked], form.alias, installNow);
    setBusy(true);
    try {
      if (plan.writeHost && name === written) {
        const { alias, ...block } = hostRequest(form);
        await api.updateSshHost(projectId, alias, block);
      } else if (plan.writeHost) {
        await api.addSshHost(projectId, hostRequest(form));
        setWritten(name);
      }
      const answer =
        plan.verb === "use"
          ? await api.useMachines(projectId, plan.machines)
          : await api.addMachines(projectId, plan.machines);
      onAdded({ state: answer, verb: plan.verb, count: plan.machines.length });
      onClose();
    } catch (err) {
      // A name the config already has belongs under its field, and so does a password the
      // server cannot use; anything else under the form.
      if (err instanceof ApiError && err.code === "ssh_host_exists") {
        setRefused({ field: "alias", text: S.machines.host.exists });
      } else if (
        err instanceof ApiError &&
        (err.code === "ssh_password_invalid" || err.code === "ssh_password_unsupported")
      ) {
        setRefused({ field: "password", text: hostErrorText(err) });
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
      onClose={requestClose}
      widthClass="sm:max-w-lg"
      footer={
        <AddMachineFooter
          installNow={installNow}
          onInstallNow={(on) => draft.patch({ installNow: on })}
          submitLabel={count > 1 ? a.submitCount(count) : a.submit}
          canSubmit={canSubmit}
          busy={busy}
          onCancel={requestClose}
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
        onSignIn={signIn}
        error={error}
      />
    </Modal>
  );
}
