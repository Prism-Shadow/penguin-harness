/**
 * The form that adds a host to this server's `~/.ssh/config` from the Machines page: the
 * alias, and what ssh needs to reach it. Validated here the way the server validates it —
 * one word per value, a port in range — so the person hears about a bad value under the
 * field rather than in a toast after a round trip. Writing goes through the server, which
 * appends the block and answers the machines list; the caller takes that list as its state.
 */
import { useState } from "react";
import type { MachinesResponse, SshHostRequest } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { toastSuccess } from "../../components/ui/toast";

type Field = "alias" | "hostName" | "user" | "port" | "identityFile";

const EMPTY: Record<Field, string> = {
  alias: "",
  hostName: "",
  user: "",
  port: "",
  identityFile: "",
};

/** One word: no whitespace and no `#`, which would comment out the rest of the config line. */
const isToken = (value: string) => value !== "" && !/[\s#]/.test(value);

/** The first thing wrong with the form, per field, or nothing. */
export function validateHostForm(form: Record<Field, string>): Partial<Record<Field, string>> {
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
export function hostRequest(form: Record<Field, string>): SshHostRequest {
  const request: SshHostRequest = { alias: form.alias.trim(), hostName: form.hostName.trim() };
  if (form.user.trim() !== "") request.user = form.user.trim();
  if (form.port.trim() !== "") request.port = Number(form.port);
  if (form.identityFile.trim() !== "") request.identityFile = form.identityFile.trim();
  return request;
}

export function SshHostDialog({
  open,
  projectId,
  onClose,
  onAdded,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  /** The machines list as the server answered it, with the new host in it. */
  onAdded: (state: MachinesResponse, alias: string) => void;
}) {
  const m = S.machines.host;
  const [form, setForm] = useState<Record<Field, string>>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);

  const set = (field: Field) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    setErrors((prev) => (prev[field] === undefined ? prev : { ...prev, [field]: undefined }));
  };

  const close = () => {
    onClose();
    setForm(EMPTY);
    setErrors({});
  };

  const submit = async () => {
    const found = validateHostForm(form);
    if (Object.values(found).some((error) => error !== undefined)) {
      setErrors(found);
      return;
    }
    setBusy(true);
    try {
      const request = hostRequest(form);
      const state = await api.addSshHost(projectId, request);
      toastSuccess(m.added(request.alias));
      onAdded(state, request.alias);
      close();
    } catch (err) {
      // A refused alias lands under its field; anything else under the form.
      const text = apiErrorText(err);
      setErrors(
        text.includes("already") || text.includes("已") ? { alias: m.exists } : { alias: text },
      );
    } finally {
      setBusy(false);
    }
  };

  const onEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !busy) void submit();
  };

  return (
    <Modal
      open={open}
      title={m.addTitle}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{S.common.cancel}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? S.common.saving : m.add}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          size="sm"
          label={m.alias}
          required
          hint={m.aliasHint}
          error={errors.alias}
          value={form.alias}
          onChange={set("alias")}
          onKeyDown={onEnter}
          className="font-mono"
          placeholder="build-box"
          autoComplete="off"
          autoFocus
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
        />
      </div>
    </Modal>
  );
}
