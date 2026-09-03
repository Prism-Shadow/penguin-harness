/**
 * The dialogs a channel needs: creating one (id, display name, purpose) from the sidebar,
 * and the two one-field edits its header menu opens — rename and purpose. Failures stay
 * inside the dialog: a rejected id lands under the id field, anything else in a strip above
 * the footer, so the fields never sit disabled behind a toast that has already gone.
 */
import { useEffect, useState } from "react";
import type { OrgChannelItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { channelIdProblem } from "./channel-list";
import type { ChannelIdProblem } from "./channel-list";
import { ErrorLine } from "./shared";

/** The error codes that are about the id the user typed; every other failure is the form's. */
const ID_ERROR_CODES = new Set(["channel_exists", "bad_request"]);

/** What the id field says about what was typed, in the reader's language. */
function idProblemText(problem: ChannelIdProblem): string {
  if (problem === "required") return S.common.requiredField;
  if (problem === "reserved") return S.company.channels.idReserved;
  if (problem === "taken") return S.company.channels.idTaken;
  return S.company.channels.idHint;
}

export function NewChannelDialog({
  open,
  projectId,
  orgId,
  taken,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  orgId: string;
  /** Every channel id the listing holds, so a duplicate is refused before it collides. */
  taken: readonly string[];
  onClose: () => void;
  onCreated: (channel: OrgChannelItem) => void;
}) {
  const [channelId, setChannelId] = useState("");
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [idError, setIdError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // No draft is kept: the form starts empty every time it opens.
  useEffect(() => {
    if (!open) return;
    setChannelId("");
    setName("");
    setPurpose("");
    setIdError(undefined);
    setFormError(null);
  }, [open]);

  const submit = async () => {
    const id = channelId.trim();
    const problem = channelIdProblem(id, taken);
    if (problem !== null) {
      setIdError(idProblemText(problem));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const created = await api.createOrgChannel(projectId, orgId, {
        channelId: id,
        ...(name.trim() !== "" ? { name: name.trim() } : {}),
        ...(purpose.trim() !== "" ? { purpose: purpose.trim() } : {}),
      });
      onCreated(created);
    } catch (e) {
      const text = apiErrorText(e);
      if (e instanceof ApiError && ID_ERROR_CODES.has(e.code)) setIdError(text);
      else setFormError(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={S.company.channels.createTitle}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? S.company.channels.creating : S.common.create}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label={S.company.channels.idField}
          required
          size="sm"
          value={channelId}
          error={idError}
          hint={S.company.channels.idHint}
          className="font-mono"
          autoFocus
          disabled={busy}
          onChange={(e) => {
            setChannelId(e.target.value);
            setIdError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Input
          label={S.company.channels.nameField}
          size="sm"
          value={name}
          hint={S.company.channels.nameHint}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          label={S.company.channels.purpose}
          size="sm"
          rows={2}
          value={purpose}
          hint={S.company.channels.purposeHint}
          disabled={busy}
          onChange={(e) => setPurpose(e.target.value)}
        />
        {formError !== null && <ErrorLine message={formError} onRetry={() => void submit()} />}
      </div>
    </Modal>
  );
}

/**
 * One text field in a dialog: the channel's name (one line) or its purpose (a short
 * paragraph). The caller owns the request, so the same shell serves both edits.
 */
export function ChannelTextDialog({
  open,
  title,
  label,
  hint,
  initial,
  multiline = false,
  required = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  hint?: string;
  initial: string;
  multiline?: boolean;
  required?: boolean;
  onClose: () => void;
  /** Writes the value; a rejection is shown inside the dialog and the field stays editable. */
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Every opening starts from what is stored now, not from the last edit's leftovers.
  useEffect(() => {
    if (!open) return;
    setValue(initial);
    setFieldError(undefined);
    setFormError(null);
  }, [open, initial]);

  const submit = async () => {
    const next = value.trim();
    if (required && next === "") {
      setFieldError(S.common.requiredField);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await onSubmit(next);
    } catch (e) {
      setFormError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? S.common.saving : S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {multiline ? (
          <Textarea
            label={label}
            size="sm"
            rows={3}
            value={value}
            {...(hint !== undefined ? { hint } : {})}
            autoFocus
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <Input
            label={label}
            size="sm"
            required={required}
            value={value}
            error={fieldError}
            {...(hint !== undefined ? { hint } : {})}
            autoFocus
            disabled={busy}
            onChange={(e) => {
              setValue(e.target.value);
              setFieldError(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          />
        )}
        {formError !== null && <ErrorLine message={formError} onRetry={() => void submit()} />}
      </div>
    </Modal>
  );
}
