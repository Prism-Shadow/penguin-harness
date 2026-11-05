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
 * How the machine signs in is a choice of its own: a key (the default, the private key file
 * field) or a password, which the server stores for the alias — never in the ssh config — and
 * never sends back. A stored password shows as saved: the field starts empty, typing replaces it,
 * and choosing the key deletes it on Save.
 *
 * Writing goes through the server, which appends or rewrites the block and answers the machines
 * list; the caller takes that list as its state. A block written by hand is shown but not saved:
 * it may carry options this form does not know, and rewriting it would drop them. The dialog says
 * so and points at the file; how such a host signs in can still be set, since that is not in it.
 */
import { useState } from "react";
import type {
  MachinesResponse,
  SshHostRequest,
  SshHostResponse,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  FieldLabel,
  Input,
  Modal,
  NoticeStrip,
  PasswordInput,
  Segmented,
  toastSuccess,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";

export type HostField = "alias" | "hostName" | "user" | "port" | "identityFile" | "password";
/** How the machine signs in: a key, or a password the server stores for it. */
export type SignIn = "key" | "password";
export type HostForm = Record<HostField, string> & { signIn: SignIn };
export type HostErrors = Partial<Record<HostField, string>>;

/** A new host's form: the port filled in with ssh's own default, so the default is said. */
export const NEW_HOST_FORM: HostForm = {
  alias: "",
  hostName: "",
  user: "",
  port: "22",
  identityFile: "",
  signIn: "key",
  password: "",
};

/** The form a host starts from: what its block says, and a password only as "saved". */
export function hostForm(host: SshHostResponse): HostForm {
  return {
    alias: host.alias,
    hostName: host.hostName,
    user: host.user ?? "",
    port: host.port === undefined ? "" : String(host.port),
    identityFile: host.identityFile ?? "",
    signIn: host.passwordSaved === true ? "password" : "key",
    password: "",
  };
}

/**
 * The form as a write would send it, every value trimmed — typing a space is not an edit — but
 * the password, whose every character counts.
 */
export function normalizeHostForm(form: HostForm): HostForm {
  return {
    alias: form.alias.trim(),
    hostName: form.hostName.trim(),
    user: form.user.trim(),
    port: form.port.trim(),
    identityFile: form.identityFile.trim(),
    signIn: form.signIn,
    password: form.password,
  };
}

/** One word: no whitespace and no `#`, which would comment out the rest of the config line. */
const isToken = (value: string) => value !== "" && !/[\s#]/.test(value);

/** What the server keeps as a password: one line, not empty, at most this long. */
const MAX_PASSWORD = 1024;

/**
 * The first thing wrong with the form, per field, or nothing. `passwordSaved`: a password is
 * stored for the host already, so password sign-in needs none typed.
 */
export function validateHostForm(form: HostForm, passwordSaved = false): HostErrors {
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
  if (form.signIn === "key") {
    if (form.identityFile.trim() !== "" && !isToken(form.identityFile.trim())) {
      errors.identityFile = m.oneWord;
    }
  } else if (form.password === "") {
    if (!passwordSaved) errors.password = S.common.requiredField;
  } else if (/[\0\r\n]/.test(form.password) || form.password.length > MAX_PASSWORD) {
    errors.password = m.passwordOneLine;
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

/**
 * What a write does to the stored password: a password typed is stored; the key chosen over a
 * saved password deletes it (null); otherwise it is left as it is (absent).
 */
export function passwordChange(
  form: HostForm,
  passwordSaved: boolean,
): Pick<SshHostRequest, "password"> {
  if (form.signIn === "password") return form.password === "" ? {} : { password: form.password };
  return passwordSaved ? { password: null } : {};
}

/**
 * The request the server takes, from a form that passed validation. A host that signs in with a
 * password names no private key: the form's key field is not on screen then.
 */
export function hostRequest(form: HostForm, passwordSaved = false): SshHostRequest {
  const request: SshHostRequest = { alias: form.alias.trim(), hostName: form.hostName.trim() };
  if (form.user.trim() !== "") request.user = form.user.trim();
  if (form.port.trim() !== "") request.port = Number(form.port);
  if (form.signIn === "key" && form.identityFile.trim() !== "") {
    request.identityFile = form.identityFile.trim();
  }
  return { ...request, ...passwordChange(form, passwordSaved) };
}

/** Why the server would not write a host, as the page says it. */
export function hostErrorText(err: unknown): string {
  if (err instanceof ApiError && err.code === "ssh_password_unsupported") {
    return S.machines.host.passwordUnsupported(err.details?.ssh ?? "");
  }
  return apiErrorText(err);
}

/**
 * The form's fields: the name, the host and the user name, the port beside the user, then how it
 * signs in — the key file, or the password. `fixedName` shows the name but does not take it (a
 * host being configured keeps its name); `locked` takes none of the block's fields (a block
 * written by hand), while the sign-in stays open. `passwordSaved`: a password is stored for the
 * host. `data-field` names each field for whatever reads the markup.
 */
export function HostFields({
  form,
  errors,
  onChange,
  onSignIn,
  passwordSaved = false,
  fixedName = false,
  locked = false,
  autoFocus = "alias",
}: {
  form: HostForm;
  errors: HostErrors;
  onChange: (field: HostField, value: string) => void;
  onSignIn: (signIn: SignIn) => void;
  passwordSaved?: boolean;
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
        placeholder={m.namePlaceholder}
        disabled={fixedName || locked}
        {...field("alias")}
      />
      <Input
        size="sm"
        label={m.hostName}
        required
        hint={m.hostNameHint}
        placeholder={m.hostNamePlaceholder}
        disabled={locked}
        {...field("hostName")}
      />
      {/* The user name and the port share a line from sm up; a phone gives each its own. */}
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <Input
          size="sm"
          label={m.user}
          placeholder={m.userPlaceholder}
          disabled={locked}
          {...field("user")}
        />
        <Input
          size="sm"
          label={m.port}
          placeholder={m.portPlaceholder}
          inputMode="numeric"
          disabled={locked}
          {...field("port")}
        />
      </div>
      <div data-option="sign-in" role="group" aria-label={m.signIn}>
        <FieldLabel>{m.signIn}</FieldLabel>
        <Segmented
          cols={2}
          options={[
            { value: "key" as const, label: m.signInKey },
            { value: "password" as const, label: m.signInPassword },
          ]}
          value={form.signIn}
          onChange={onSignIn}
        />
      </div>
      {form.signIn === "key" ? (
        <Input
          size="sm"
          label={m.identityFile}
          hint={passwordSaved ? m.passwordDropped : m.identityFileHint}
          placeholder={m.identityFilePlaceholder}
          disabled={locked}
          {...field("identityFile")}
        />
      ) : (
        <PasswordInput
          size="sm"
          label={m.password}
          required={!passwordSaved}
          placeholder={passwordSaved ? m.passwordSavedPlaceholder : m.passwordPlaceholder}
          {...field("password")}
          // Never the browser's saved password for this site: this one is another machine's.
          autoComplete="new-password"
        />
      )}
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
  const saved = host.passwordSaved === true;
  const draft = useFormDraft<HostForm>(hostForm(host), { normalize: normalizeHostForm });
  const form = draft.draft;
  /**
   * What the server refused, under the field it concerns — the password's own refusals under the
   * password, the rest under the host (the name is fixed); cleared by the next keystroke.
   */
  const [refused, setRefused] = useState<{ field: HostField; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, draft.scope, { locked: busy });
  const found = validateHostForm(form, saved);
  // A block written by hand takes no edit of its own lines, but how it signs in may change.
  const canSave = draft.dirty && !hasErrors(found) && !busy;
  const errors = shownErrors(found);
  if (refused !== undefined) errors[refused.field] = refused.text;

  const change = (field: HostField, value: string) => {
    draft.patch({ [field]: value } as Partial<HostForm>);
    setRefused(undefined);
  };
  const signIn = (next: SignIn) => {
    draft.patch({ signIn: next });
    setRefused(undefined);
  };

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      // A block written by hand goes back as it stands, so the server rewrites none of it.
      const { alias, ...rest } = locked
        ? { ...hostRequest({ ...hostForm(host), signIn: "key" }), ...passwordChange(form, saved) }
        : hostRequest(form, saved);
      const state = await api.updateSshHost(projectId, alias, rest);
      toastSuccess(m.saved(alias));
      onSaved(state);
      onClose();
    } catch (err) {
      const password =
        err instanceof ApiError &&
        (err.code === "ssh_password_invalid" || err.code === "ssh_password_unsupported");
      setRefused({ field: password ? "password" : "hostName", text: hostErrorText(err) });
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
          onSignIn={signIn}
          passwordSaved={saved}
          fixedName
          locked={locked}
          autoFocus={locked ? null : "hostName"}
        />
      </div>
    </Modal>
  );
}
