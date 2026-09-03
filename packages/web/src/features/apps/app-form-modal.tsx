/**
 * Register an app by hand, or edit a registered one: the fields of the registry file — name,
 * description, URL, health URL, start / stop commands, kind — and, when registering, the
 * owning Session picked from the Project's recent Sessions (the sidebar's loaded list, newest
 * first). Editing keeps the owning Session: the request is a full replacement, so the stored
 * sessionId rides along unchanged. Mounted only while open, so a reopened dialog starts clean.
 */
import { useState } from "react";
import type {
  AppItem,
  AppKind,
  AppUpsertRequest,
  SessionInfo,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Select } from "../../components/ui/select";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { APP_KINDS } from "./apps-model";

export interface AppFormModalProps {
  open: boolean;
  projectId: string;
  /** The app being edited; null registers a new one. */
  app: AppItem | null;
  /** Candidate owning Sessions for a new registration (archived ones are left out here). */
  sessions: readonly SessionInfo[];
  onClose: () => void;
  /** Called after a successful write, before the dialog closes. */
  onSaved: () => void;
}

export function AppFormModal(props: AppFormModalProps) {
  return props.open ? <AppFormDialog {...props} /> : null;
}

/** A trimmed field, or undefined when empty — the registry stores no empty strings. */
function opt(value: string): string | undefined {
  const v = value.trim();
  return v === "" ? undefined : v;
}

function AppFormDialog({ open, projectId, app, sessions, onClose, onSaved }: AppFormModalProps) {
  const candidates = sessions
    .filter((s) => !s.archived)
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  const [name, setName] = useState(app?.name ?? "");
  const [description, setDescription] = useState(app?.description ?? "");
  const [url, setUrl] = useState(app?.url ?? "");
  const [healthUrl, setHealthUrl] = useState(app?.healthUrl ?? "");
  const [startCommand, setStartCommand] = useState(app?.startCommand ?? "");
  const [stopCommand, setStopCommand] = useState(app?.stopCommand ?? "");
  const [kind, setKind] = useState<AppKind>(app?.kind ?? "web");
  const [sessionId, setSessionId] = useState(app?.sessionId ?? "");
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Falling back at render, not at mount: the sidebar's Session list may still be loading when
  // the dialog opens, and a mount-time default would then stay "" after it arrives, leaving the
  // select showing a Session that Save refuses.
  const selected = sessionId || (candidates[0]?.sessionId ?? "");
  const ready = !saving && selected !== "";

  const submit = async () => {
    if (name.trim() === "") {
      setNameError(S.common.requiredField);
      return;
    }
    const body: AppUpsertRequest = {
      name: name.trim(),
      sessionId: selected,
      kind,
      ...(opt(description) !== undefined ? { description: opt(description) } : {}),
      ...(opt(url) !== undefined ? { url: opt(url) } : {}),
      ...(opt(healthUrl) !== undefined ? { healthUrl: opt(healthUrl) } : {}),
      ...(opt(startCommand) !== undefined ? { startCommand: opt(startCommand) } : {}),
      ...(opt(stopCommand) !== undefined ? { stopCommand: opt(stopCommand) } : {}),
    };
    setSaving(true);
    try {
      if (app) await api.updateApp(projectId, app.id, body);
      else await api.createApp(projectId, body);
      toastSuccess(app ? S.apps.form.saved : S.apps.form.registered);
      onSaved();
      onClose();
    } catch (err) {
      toastError(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={app ? S.apps.form.editTitle(app.name) : S.apps.form.createTitle}
      onClose={onClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          <Button variant="primary" disabled={!ready} onClick={() => void submit()}>
            {saving ? S.common.saving : S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label={S.apps.form.name}
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
          {...(nameError !== null ? { error: nameError } : {})}
        />
        <Input
          label={S.apps.form.description}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {app ? (
          <Field label={S.apps.form.session} hint={S.apps.form.sessionHint}>
            <p className="truncate text-sm text-gray-700 dark:text-gray-300">
              {app.sessionExists
                ? (app.sessionTitle ?? S.chat.defaultSessionTitle)
                : S.apps.fromDeletedSession}
              <span className="ml-2 font-mono text-[11px] text-gray-400 dark:text-gray-500">
                {app.sessionId.slice(-8)}
              </span>
            </p>
          </Field>
        ) : (
          <Select
            label={S.apps.form.session}
            required
            hint={candidates.length === 0 ? S.apps.form.noSessions : S.apps.form.sessionHint}
            value={selected}
            onChange={(e) => setSessionId(e.target.value)}
            disabled={candidates.length === 0}
          >
            {candidates.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {`${s.title ?? S.chat.defaultSessionTitle} · ${s.agentId} · ${s.sessionId.slice(-6)}`}
              </option>
            ))}
          </Select>
        )}
        <Input
          label={S.apps.form.url}
          hint={S.apps.form.urlHint}
          placeholder="http://localhost:3000"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Input
          label={S.apps.form.healthUrl}
          hint={S.apps.form.healthUrlHint}
          value={healthUrl}
          onChange={(e) => setHealthUrl(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={S.apps.form.startCommand}
            placeholder="npm start"
            value={startCommand}
            onChange={(e) => setStartCommand(e.target.value)}
          />
          <Input
            label={S.apps.form.stopCommand}
            placeholder="fuser -k 3000/tcp"
            value={stopCommand}
            onChange={(e) => setStopCommand(e.target.value)}
          />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-500">{S.apps.form.commandsHint}</p>
        <Select
          label={S.apps.form.kind}
          value={kind}
          onChange={(e) => setKind(e.target.value as AppKind)}
        >
          {APP_KINDS.map((k) => (
            <option key={k} value={k}>
              {S.apps.kindNames[k]}
            </option>
          ))}
        </Select>
      </div>
    </Modal>
  );
}
