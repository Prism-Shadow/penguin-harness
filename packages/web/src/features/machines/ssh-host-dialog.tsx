/**
 * The ssh host form: the name a machine goes by and what ssh needs to reach it — the fields the
 * add dialog's manual tab writes a new host with, and the dialog that configures a host this app
 * wrote. Validated here the way the server validates it — one word per value, a port in range —
 * so a bad value is said under its field rather than in a toast after a round trip. Only an
 * invalid value is said in the danger ink; what a field wants is its muted hint.
 *
 * Writing goes through the server, which appends or rewrites the block and answers the machines
 * list; the caller takes that list as its state. A block written by hand is shown but not saved:
 * it may carry options this form does not know, and rewriting it would drop them. The dialog says
 * so and points at the file.
 */
import { useState } from "react";
import type { KeyboardEvent } from "react";
import type {
  MachinesResponse,
  SshHostRequest,
  SshHostResponse,
} from "@prismshadow/penguin-server/api";
import { Button, Input, Modal, NoticeStrip, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";

export type HostField = "alias" | "hostName" | "user" | "port" | "identityFile";
export type HostForm = Record<HostField, string>;

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

/** One word: no whitespace and no `#`, which would comment out the rest of the config line. */
const isToken = (value: string) => value !== "" && !/[\s#]/.test(value);

/** The first thing wrong with the form, per field, or nothing. */
export function validateHostForm(form: HostForm): Partial<Record<HostField, string>> {
  const m = S.machines.host;
  const errors: Partial<Record<HostField, string>> = {};
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
export const hasErrors = (errors: Partial<Record<HostField, string>>) =>
  Object.values(errors).some((error) => error !== undefined);

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
  onEnter,
  fixedName = false,
  locked = false,
  autoFocus = "alias",
}: {
  form: HostForm;
  errors: Partial<Record<HostField, string>>;
  onChange: (field: HostField, value: string) => void;
  onEnter: () => void;
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
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") onEnter();
    },
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
  const [form, setForm] = useState<HostForm>(() => hostForm(host));
  const [errors, setErrors] = useState<Partial<Record<HostField, string>>>({});
  const [busy, setBusy] = useState(false);

  const change = (field: HostField, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] === undefined ? prev : { ...prev, [field]: undefined }));
  };

  const submit = async () => {
    if (locked || busy) return;
    const found = validateHostForm(form);
    if (hasErrors(found)) {
      setErrors(found);
      return;
    }
    setBusy(true);
    try {
      const { alias, ...rest } = hostRequest(form);
      const state = await api.updateSshHost(projectId, alias, rest);
      toastSuccess(m.saved(alias));
      onSaved(state);
      onClose();
    } catch (err) {
      setErrors({ hostName: apiErrorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={m.editTitle}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || locked}
            onClick={() => void submit()}
          >
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
          onEnter={() => void submit()}
          fixedName
          locked={locked}
          autoFocus="hostName"
        />
      </div>
    </Modal>
  );
}
