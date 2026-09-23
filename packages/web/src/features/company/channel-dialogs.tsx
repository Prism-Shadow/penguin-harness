/**
 * The dialogs a channel needs: creating one (display name, then the id derived from it by
 * the field's own button, then the purpose) from the channel list's header, and the two
 * one-field edits its header menu opens — rename and purpose. Failures stay inside the
 * dialog: a rejected id lands under the id field, anything else in a strip above the footer,
 * so the fields never sit disabled behind a toast that has already gone.
 *
 * Plus the join prompt, which both entry points into joining raise — the channel view's
 * "you are not a member" notice and the sidebar row's own Join — so the two cannot ask
 * different questions.
 */
import { useEffect, useState } from "react";
import type { OrgChannelItem, OrgChannelMember } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
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
          <Button size="sm" onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit()}>
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
          hint={S.company.channels.nameHint}
          autoFocus
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
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
          onChange={(id) => {
            setChannelId(id);
            setIdError(undefined);
          }}
          onEnter={() => void submit()}
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
          <Button size="sm" onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit()}>
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

/**
 * The default recipients: the members a message with no @ at all counts as mentioning,
 * ticked off the channel's own member list — the server refuses anyone else, so the dialog
 * offers nobody else. The list is saved whole; unticking everyone clears it.
 */
export function ChannelNotifyDialog({
  open,
  members,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  members: readonly OrgChannelMember[];
  /** The principals currently on the list. */
  initial: readonly string[];
  onClose: () => void;
  onSubmit: (notify: string[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked(new Set(initial));
    setFormError(null);
  }, [open, initial]);

  const toggle = (principal: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(principal);
      else next.delete(principal);
      return next;
    });

  const submit = async () => {
    setBusy(true);
    setFormError(null);
    try {
      // In member order, so the stored list reads like the member list.
      await onSubmit(members.map((m) => m.principal).filter((p) => picked.has(p)));
    } catch (e) {
      setFormError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={S.company.channels.notifyTitle}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? S.common.saving : S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.company.channels.notifyHint}</p>
        {members.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {S.company.channels.notifyEmpty}
          </p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {members.map((m) => (
              <label
                key={m.principal}
                className={`flex cursor-pointer items-center ${ICON_GAP.row} rounded px-1.5 py-1 text-sm hover:bg-gray-50 dark:hover:bg-gray-800`}
              >
                <input
                  type="checkbox"
                  checked={picked.has(m.principal)}
                  disabled={busy}
                  onChange={(e) => toggle(m.principal, e.target.checked)}
                />
                {m.kind === "agent" ? (
                  <AgentAvatar
                    id={m.principal.slice("agent:".length)}
                    name={m.name}
                    size={ICON_SIZE.rowLead}
                    className="shrink-0 rounded"
                  />
                ) : (
                  <span
                    aria-hidden
                    style={{
                      width: ICON_SIZE.rowLead,
                      height: ICON_SIZE.rowLead,
                      fontSize: Math.round(ICON_SIZE.rowLead * 0.55),
                    }}
                    className="flex shrink-0 items-center justify-center rounded-full bg-gray-900 font-bold text-white dark:bg-gray-200 dark:text-gray-900"
                  >
                    {m.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                  {m.kind === "agent" ? S.company.channels.employees : S.company.channels.members}
                </span>
              </label>
            ))}
          </div>
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
      busy={busy}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">{S.company.channels.joinConfirm}</p>
    </ConfirmModal>
  );
}
