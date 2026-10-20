import { useState, type ReactNode } from "react";
import {
  Button,
  Input,
  Modal,
  discardUnsaved,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../../api/endpoints";
import { S } from "../../../lib/strings";
import {
  PROJECT_ID_MAX_LENGTH,
  PROJECT_SUFFIX_PATTERN,
  SEMANTIC_ID_PATTERN,
} from "../../../lib/semantic-id";
import { useProject } from "../../../state/project";
import { useAuth } from "../../../state/auth";
import { NAME_MAX_LENGTH } from "../../../lib/name-limits";
import { SemanticIdField } from "../../semantic-id";
import { failureNode } from "../../../lib/failure";

export function CreateProjectDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  // No draft is kept: the form is mounted only while the dialog is open, so it starts empty.
  return open ? <CreateProjectForm onClose={onClose} onCreated={onCreated} /> : null;
}

export function CreateProjectForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const { user } = useAuth();
  const { currentProject } = useProject();
  // Non-admin Project ids are forced to have a "<username>-" prefix: the input locks the prefix segment, only the rest is editable.
  const prefix = user && !user.isAdmin ? `${user.userId}-` : "";
  const form = useFormDraft({ name: "", idInput: "" });
  const { name, idInput } = form.draft;
  /** What the server refused about the id (a duplicate, say); cleared by the next edit of it. */
  const [refused, setRefused] = useState<ReactNode>(undefined);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });

  const suffix = idInput.trim();
  const id = prefix + suffix;
  // The id is the only validated field. Non-admin: the suffix segment (the hyphen is a reserved
  // separator, appearing only once at the prefix join); admin: the whole string. A broken id is
  // said under the field as it is typed; an empty one is only marked required.
  const idBroken =
    suffix !== "" &&
    !(prefix
      ? PROJECT_SUFFIX_PATTERN.test(suffix) && id.length <= PROJECT_ID_MAX_LENGTH
      : SEMANTIC_ID_PATTERN.test(id));
  // The name's ceiling is stated the same way as the id's rule — said under the field as it is
  // typed, Create held off — rather than clamped with maxLength: a silently truncated name
  // would still be what the person submitted (and the source the id generation reads), so the
  // limit must be told, not eaten. Trimmed, because that is what gets sent; the server enforces
  // the same 100 on what it receives (routes/projects.ts).
  const nameTooLong = name.trim().length > NAME_MAX_LENGTH;
  const valid = suffix !== "" && !idBroken && !nameTooLong;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setRefused(undefined);
    try {
      const res = await api.createProject({
        projectId: id,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      // Saved: forget the form now, not at unmount. The sidebar switches to the new Project next,
      // and the leave guard would hold that over a form with nothing left unsaved.
      discardUnsaved(form.scope);
      onCreated(res.project.projectId);
    } catch (e) {
      setRefused(failureNode(e, { what: "a Project could not be created" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={S.project.createTitle}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" disabled={busy} onClick={requestClose}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!form.dirty || !valid || busy}
            onClick={() => void submit()}
          >
            {S.common.create}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* The name comes first and the id is derived from it: an id is the harder half to
            invent, and naming the thing is where anyone starts anyway. */}
        <Input
          label={S.project.displayName}
          hint={S.project.displayNameHint}
          error={nameTooLong ? S.project.displayNameTooLong(NAME_MAX_LENGTH) : undefined}
          size="sm"
          value={name}
          autoFocus
          disabled={busy}
          onChange={(e) => form.patch({ name: e.target.value })}
        />
        {/* A Project is not inside a Project: the one this dialog was opened from lends its
            default model to the proposal. A non-admin types only what follows "<username>-". */}
        <SemanticIdField
          projectId={currentProject?.projectId ?? null}
          kind="project"
          label={S.project.id}
          hint={prefix ? S.project.idPrefixHint : S.project.idHint}
          value={idInput}
          source={name}
          error={
            refused ?? (idBroken ? (prefix ? S.project.idPrefixHint : S.project.idHint) : undefined)
          }
          disabled={busy}
          {...(prefix ? { lockedPrefix: prefix } : {})}
          onChange={(next) => {
            form.patch({ idInput: next });
            setRefused(undefined);
          }}
        />
      </div>
    </Modal>
  );
}
