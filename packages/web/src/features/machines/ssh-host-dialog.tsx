/**
 * The ssh host form: the name a machine goes by and what ssh needs to reach it — the fields the
 * add dialog's manual tab writes a new host with, and the dialog that configures a host this app
 * wrote. Validated here the way the server validates it — one word per value, a port in range —
 * so a bad value is said under its field as it is typed rather than in a toast after a round
 * trip. Only an invalid value is said in the danger ink; what a field wants is its muted hint, and
 * an empty required field is marked by its asterisk alone.
 *
 * The verb (Add, Save) is live once a field changed and nothing in the form is wrong; Enter does
 * not press it, the form having more than one field. Closing a dialog with edits asks first, and
 * nothing closes it while its write is in flight.
 *
 * Writing goes through the server, which appends or rewrites the block and answers the machines
 * list; the caller takes that list as its state. A block written by hand is shown but not saved:
 * it may carry options this form does not know, and rewriting it would drop them. The dialog says
 * so and points at the file.
 */
import { useState } from "react";
import type {
  MachinesResponse,
  SshHostRequest,
  SshHostResponse,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  Input,
  Modal,
  NoticeStrip,
  toastSuccess,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";

export type HostField = "alias" | "hostName" | "user" | "port" | "identityFile";
export type HostForm = Record<HostField, string>;
export type HostErrors = Partial<Record<HostField, string>>;

/** A new host's form: the port filled in with ssh's own default, so the default is said. */
export const NEW_HOST_FORM: HostForm = {
  alias: "",
  hostName: "",
  user: "",
  port: "22",
  identityFile: "",
};

/** The form a host this app wrote starts from: what its block says. */
export function hostForm(host: SshHostResponse): HostForm {
  return {
    alias: host.alias,
    hostName: host.hostName,
    user: host.user ?? "",
    port: host.port === undefined ? "" : String(host.port),
    identityFile: host.identityFile ?? "",
  };
}

/** The form as a write would send it, every value trimmed: typing a space is not an edit. */
export function normalizeHostForm(form: HostForm): HostForm {
  return {
    alias: form.alias.trim(),
    hostName: form.hostName.trim(),
    user: form.user.trim(),
    port: form.port.trim(),
    identityFile: form.identityFile.trim(),
  };
}

/** One word: no whitespace and no `#`, which would comment out the rest of the config line. */
const isToken = (value: string) => value !== "" && !/[\s#]/.test(value);

/** The first thing wrong with the form, per field, or nothing. */
export function validateHostForm(form: HostForm): HostErrors {
  const m = S.machines.host;
  const errors: HostErrors = {};
  if (form.alias.trim() === "") errors.alias = S.common.requiredField;
  else if (!isToken(form.alias.trim()) || /[*?!]/.test(form.alias)) errors.alias = m.oneWord;
  if (form.hostName.trim() === "") errors.hostName = S.common.requiredField;
  else if (!isToken(form.hostName.trim())) errors.hostName = m.oneWord;
  if (form.user.trim() !== "" && !isToken(form.user.trim())) errors.user = m.oneWord;
  if (form.port.trim() !== "") {
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = m.portRange;
  }
  if (form.identityFile.trim() !== "" && !isToken(form.identityFile.trim())) {
    errors.identityFile = m.oneWord;
  }
  return errors;
}

/** Whether a validation found anything. */
export const hasErrors = (errors: HostErrors) =>
  Object.values(errors).some((error) => error !== undefined);

/**
 * What the fields say as the form is typed: each malformed value under its field. An empty
 * required field is left to its asterisk, so a blank form does not open in the danger ink.
 */
export function shownErrors(found: HostErrors): HostErrors {
  const shown: HostErrors = {};
  for (const [field, error] of Object.entries(found) as Array<[HostField, string | undefined]>) {
    if (error !== undefined && error !== S.common.requiredField) shown[field] = error;
  }
  return shown;
}

/** The request the server takes, from a form that passed validation. */
export function hostRequest(form: HostForm): SshHostRequest {
  const request: SshHostRequest = { alias: form.alias.trim(), hostName: form.hostName.trim() };
  if (form.user.trim() !== "") request.user = form.user.trim();
  if (form.port.trim() !== "") request.port = Number(form.port);
  if (form.identityFile.trim() !== "") request.identityFile = form.identityFile.trim();
  return request;
}

/**
 * The form's fields: the name, the host and the user name, the port beside the user, the key.
 * `fixedName` shows the name but does not take it (a host being configured keeps its name);
 * `locked` takes nothing (a block written by hand). `data-field` names each for whatever reads
 * the markup.
 */
export function HostFields({
  form,
  errors,
  onChange,
  fixedName = false,
  locked = false,
  autoFocus = "alias",
}: {
  form: HostForm;
  errors: HostErrors;
  onChange: (field: HostField, value: string) => void;
  fixedName?: boolean;
  locked?: boolean;
  autoFocus?: HostField | null;
}) {
  const m = S.machines.host;
  const field = (name: HostField) => ({
    "data-field": name,
    value: form[name],
    error: errors[name],
    onChange: (event: { target: { value: string } }) => onChange(name, event.target.value),
    autoFocus: autoFocus === name,
    autoComplete: "off",
    spellCheck: false,
    className: "font-mono",
  });
  return (
    <div className="space-y-3">
      <Input
        size="sm"
        label={m.name}
        required
        hint={fixedName ? undefined : m.nameHint}
        placeholder="build-box"
        disabled={fixedName || locked}
        {...field("alias")}
      />
      <Input
        size="sm"
        label={m.hostName}
        required
        hint={m.hostNameHint}
        placeholder="192.168.1.20"
        disabled={locked}
        {...field("hostName")}
      />
      {/* The user name and the port share a line from sm up; a phone gives each its own. */}
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <Input
          size="sm"
          label={m.user}
          hint={m.userHint}
          placeholder="ubuntu"
          disabled={locked}
          {...field("user")}
        />
        <Input
          size="sm"
          label={m.port}
          placeholder="22"
          inputMode="numeric"
          disabled={locked}
          {...field("port")}
        />
      </div>
      <Input
        size="sm"
        label={m.identityFile}
        hint={m.identityFileHint}
        placeholder="~/.ssh/id_ed25519"
        disabled={locked}
        {...field("identityFile")}
      />
    </div>
  );
}

/**
 * The dialog that configures a host this app wrote: the same fields, its name fixed. Mount it with
 * a `key` of the host's name, so it starts from that host's block each time it opens.
 */
export function SshHostDialog({
  host,
  projectId,
  onClose,
  onSaved,
}: {
  host: SshHostResponse;
  projectId: string;
  onClose: () => void;
  /** The machines list as the server answered it after the write. */
  onSaved: (state: MachinesResponse) => void;
}) {
  const m = S.machines.host;
  const locked = !host.editable;
  const draft = useFormDraft<HostForm>(hostForm(host), { normalize: normalizeHostForm });
  const form = draft.draft;
  /** What the server refused, under the host (the name is fixed); cleared by the next keystroke. */
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, draft.scope, { locked: busy });
  const found = validateHostForm(form);
  const canSave = draft.dirty && !hasErrors(found) && !busy && !locked;
  const errors = shownErrors(found);
  if (refused !== undefined) errors.hostName = refused;

  const change = (field: HostField, value: string) => {
    draft.patch({ [field]: value } as Partial<HostForm>);
    setRefused(undefined);
  };

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const { alias, ...rest } = hostRequest(form);
      const state = await api.updateSshHost(projectId, alias, rest);
      toastSuccess(m.saved(alias));
      onSaved(state);
      onClose();
    } catch (err) {
      setRefused(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={m.editTitle}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" disabled={busy} onClick={requestClose}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={!canSave} onClick={() => void submit()}>
            {busy ? S.common.saving : S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {locked && (
          <NoticeStrip tone="attention" className="rounded-md border px-3 py-2 text-xs">
            {m.foreign}
          </NoticeStrip>
        )}
        <HostFields
          form={form}
          errors={errors}
          onChange={change}
          fixedName
          locked={locked}
          autoFocus="hostName"
        />
      </div>
    </Modal>
  );
}
