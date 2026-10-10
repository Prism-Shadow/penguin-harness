/**
 * The dialogs a channel needs: creating one (display name, then the id derived from it by
 * the field's own button, then the purpose) from the channel list's header, and the two
 * one-field edits its header menu opens — rename and purpose. Failures stay inside the
 * dialog: a rejected id lands under the id field, anything else in a strip above the footer,
 * so the fields never sit disabled behind a toast that has already gone. Create and Save are
 * live once there is something valid to write (an id that breaks the rule is said under it as
 * it is typed); closing a dialog with what was typed asks first, and nothing closes one while
 * its write is in flight.
 *
 * Plus the join prompt, which both entry points into joining raise — the channel view's
 * "you are not a member" notice and the sidebar row's own Join — so the two cannot ask
 * different questions.
 */
import { useState } from "react";
import type { OrgChannelItem } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  Input,
  Modal,
  Textarea,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { channelIdProblem } from "./channel-list";
import type { ChannelIdProblem } from "./channel-list";
import { SemanticIdField } from "../semantic-id/semantic-id-field";
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

interface NewChannelDialogProps {
  open: boolean;
  projectId: string;
  orgId: string;
  /** Every channel id the listing holds, so a duplicate is refused before it collides. */
  taken: readonly string[];
  onClose: () => void;
  onCreated: (channel: OrgChannelItem) => void;
}

export function NewChannelDialog({ open, ...props }: NewChannelDialogProps) {
  // No draft is kept: the form is mounted only while the dialog is open, so it starts empty.
  return open ? <NewChannelForm {...props} /> : null;
}

function NewChannelForm({
  projectId,
  orgId,
  taken,
  onClose,
  onCreated,
}: Omit<NewChannelDialogProps, "open">) {
  const form = useFormDraft({ channelId: "", name: "", purpose: "" });
  const { channelId, name, purpose } = form.draft;
  /** What the server refused about the id; cleared by the next edit of it. */
  const [refusedId, setRefusedId] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  const id = channelId.trim();
  const problem = channelIdProblem(id, taken);
  // A broken id is said as it is typed; an empty one is only marked required.
  const idError =
    refusedId ?? (problem !== null && problem !== "required" ? idProblemText(problem) : undefined);

  const submit = async () => {
    if (problem !== null || busy) return;
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
      if (e instanceof ApiError && ID_ERROR_CODES.has(e.code)) setRefusedId(text);
      else setFormError(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={S.company.channels.createTitle}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || problem !== null}
            onClick={() => void submit()}
          >
            {busy ? S.company.channels.creating : S.common.create}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* The name comes first and the id is derived from it: an id is the harder half to
            invent, and naming the channel is where anyone starts anyway. */}
        <Input
          label={S.company.channels.nameField}
          size="sm"
          value={name}
          info={S.company.channels.nameHint}
          autoFocus
          disabled={busy}
          onChange={(e) => form.patch({ name: e.target.value })}
        />
        <SemanticIdField
          projectId={projectId}
          kind="channel"
          label={S.company.channels.idField}
          hint={S.company.channels.idHint}
          value={channelId}
          source={name}
          taken={taken}
          error={idError}
          disabled={busy}
          onChange={(next) => {
            form.patch({ channelId: next });
            setRefusedId(undefined);
          }}
        />
        <Textarea
          label={S.company.channels.purpose}
          size="sm"
          rows={2}
          value={purpose}
          info={S.company.channels.purposeHint}
          disabled={busy}
          onChange={(e) => form.patch({ purpose: e.target.value })}
        />
        {formError !== null && <ErrorLine message={formError} onRetry={() => void submit()} />}
      </div>
    </Modal>
  );
}

interface ChannelTextDialogProps {
  open: boolean;
  title: string;
  label: string;
  /** What the field means, behind the "?" beside its label. */
  info?: string;
  initial: string;
  multiline?: boolean;
  required?: boolean;
  onClose: () => void;
  /** Writes the value; a rejection is shown inside the dialog and the field stays editable. */
  onSubmit: (value: string) => Promise<void>;
}

/**
 * One text field in a dialog: the channel's name (one line) or its purpose (a short
 * paragraph). The caller owns the request, so the same shell serves both edits.
 */
export function ChannelTextDialog({ open, ...props }: ChannelTextDialogProps) {
  // Mounted only while open: every opening starts from what is stored now.
  return open ? <ChannelTextForm {...props} /> : null;
}

function ChannelTextForm({
  title,
  label,
  info,
  initial,
  multiline = false,
  required = false,
  onClose,
  onSubmit,
}: Omit<ChannelTextDialogProps, "open">) {
  const form = useFormDraft(initial, { normalize: (text) => text.trim() });
  const value = form.draft;
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  const valid = !required || value.trim() !== "";

  const submit = async () => {
    const next = value.trim();
    if (!form.dirty || !valid || busy) return;
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
      open
      title={title}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !form.dirty || !valid}
            onClick={() => void submit()}
          >
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
            {...(info !== undefined ? { info } : {})}
            autoFocus
            disabled={busy}
            onChange={(e) => form.setDraft(e.target.value)}
          />
        ) : (
          <Input
            label={label}
            size="sm"
            required={required}
            value={value}
            {...(info !== undefined ? { info } : {})}
            autoFocus
            disabled={busy}
            onChange={(e) => form.setDraft(e.target.value)}
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

/**
 * "Join this channel?". Joining is not a destructive act but it is a standing one: from then
 * on this channel's @-mentions reach the reader, which is what the body says rather than
 * "are you sure".
 */
export function JoinChannelConfirm({
  open,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmModal
      open={open}
      title={S.company.channels.joinTitle}
      tone="primary"
      confirmLabel={S.company.channels.join}
      cancelLabel={S.common.cancel}
      busy={busy}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">{S.company.channels.joinConfirm}</p>
    </ConfirmModal>
  );
}
