/**
 * The form that adds a host to this server's `~/.ssh/config` from the Machines page, or
 * rewrites one this app wrote: the alias, and what ssh needs to reach it. Validated here
 * the way the server validates it — one word per value, a port in range — so the person
 * hears about a bad value under the field rather than in a toast after a round trip.
 * Writing goes through the server, which appends or rewrites the block and answers the
 * machines list; the caller takes that list as its state.
 *
 * A block written by hand is shown but not saved: it may carry options this form does not
 * know, and rewriting it would drop them. The form says so and points at the file.
 */
import { useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type {
  MachinesResponse,
  SshHostRequest,
  SshHostResponse,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneStrip } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { toastSuccess } from "../../components/ui/toast";

type Field = "alias" | "hostName" | "user" | "port" | "identityFile";
type Form = Record<Field, string>;

/** Adding a new host, or configuring one the server read back. */
export type HostFormMode = { kind: "add" } | { kind: "edit"; host: SshHostResponse };

const EMPTY: Form = { alias: "", hostName: "", user: "", port: "", identityFile: "" };

function initialForm(mode: HostFormMode): Form {
  if (mode.kind === "add") return EMPTY;
  const { host } = mode;
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
export function validateHostForm(form: Form): Partial<Record<Field, string>> {
  const m = S.machines.host;
  const errors: Partial<Record<Field, string>> = {};
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

/** The request the server takes, from a form that passed validation. */
export function hostRequest(form: Form): SshHostRequest {
  const request: SshHostRequest = { alias: form.alias.trim(), hostName: form.hostName.trim() };
  if (form.user.trim() !== "") request.user = form.user.trim();
  if (form.port.trim() !== "") request.port = Number(form.port);
  if (form.identityFile.trim() !== "") request.identityFile = form.identityFile.trim();
  return request;
}

/**
 * Mount with a `key` that changes with the mode (the alias being configured, or "add"), so
 * the form starts from the right values each time it opens; it keeps no state across modes.
 */
export function SshHostDialog({
  mode,
  projectId,
  onClose,
  onSaved,
}: {
  mode: HostFormMode;
  projectId: string;
  onClose: () => void;
  /** The machines list as the server answered it after the write. */
  onSaved: (state: MachinesResponse) => void;
}) {
  const m = S.machines.host;
  const editing = mode.kind === "edit";
  const locked = mode.kind === "edit" && !mode.host.editable;
  const [form, setForm] = useState<Form>(() => initialForm(mode));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);

  const set = (field: Field) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    setErrors((prev) => (prev[field] === undefined ? prev : { ...prev, [field]: undefined }));
  };

  const submit = async () => {
    if (locked) return;
    const found = validateHostForm(form);
    if (Object.values(found).some((error) => error !== undefined)) {
      setErrors(found);
      return;
    }
    setBusy(true);
    try {
      const request = hostRequest(form);
      if (mode.kind === "edit") {
        const { alias, ...rest } = request;
        const state = await api.updateSshHost(projectId, alias, rest);
        toastSuccess(m.saved(alias));
        onSaved(state);
      } else {
        const state = await api.addSshHost(projectId, request);
        toastSuccess(m.added(request.alias));
        onSaved(state);
      }
      onClose();
    } catch (err) {
      // A refused alias lands under its field; anything else under the form's first field.
      const text = apiErrorText(err);
      setErrors(
        text.includes("already") || text.includes("已") ? { alias: m.exists } : { alias: text },
      );
    } finally {
      setBusy(false);
    }
  };

  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !busy) void submit();
  };

  return (
    <Modal
      open
      title={editing ? m.editTitle : m.addTitle}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          <Button variant="primary" disabled={busy || locked} onClick={() => void submit()}>
            {busy ? S.common.saving : editing ? S.common.save : m.add}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {locked && (
          <div className={`rounded-md border px-3 py-2 text-xs ${toneStrip.attention}`}>
            {m.foreign}
          </div>
        )}
        <Input
          size="sm"
          label={m.alias}
          required
          hint={editing ? undefined : m.aliasHint}
          error={errors.alias}
          value={form.alias}
          onChange={set("alias")}
          onKeyDown={onEnter}
          className="font-mono"
          placeholder="build-box"
          autoComplete="off"
          autoFocus={!editing}
          disabled={editing}
        />
        <Input
          size="sm"
          label={m.hostName}
          required
          hint={m.hostNameHint}
          error={errors.hostName}
          value={form.hostName}
          onChange={set("hostName")}
          onKeyDown={onEnter}
          className="font-mono"
          placeholder="192.168.1.20"
          autoComplete="off"
          autoFocus={editing}
          disabled={locked}
        />
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Input
            size="sm"
            label={m.user}
            hint={m.userHint}
            error={errors.user}
            value={form.user}
            onChange={set("user")}
            onKeyDown={onEnter}
            className="font-mono"
            placeholder="deploy"
            autoComplete="off"
            disabled={locked}
          />
          <Input
            size="sm"
            label={m.port}
            hint={m.portHint}
            error={errors.port}
            value={form.port}
            onChange={set("port")}
            onKeyDown={onEnter}
            className="font-mono"
            placeholder="22"
            inputMode="numeric"
            autoComplete="off"
            disabled={locked}
          />
        </div>
        <Input
          size="sm"
          label={m.identityFile}
          hint={m.identityFileHint}
          error={errors.identityFile}
          value={form.identityFile}
          onChange={set("identityFile")}
          onKeyDown={onEnter}
          className="font-mono"
          placeholder="~/.ssh/id_ed25519"
          autoComplete="off"
          disabled={locked}
        />
      </div>
    </Modal>
  );
}
