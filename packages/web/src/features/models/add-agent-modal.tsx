/**
 * Add a custom coding agent: any command that speaks the Agent Client Protocol over stdio,
 * with its arguments; its environment variables are added on its card afterwards. Known agents
 * need no entry here — Models → Local CLI finds them on the server machine — so this is for
 * everything else. Admin-only, like the route it posts to.
 */
import { useState } from "react";
import { saveCodingAgent } from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { toastError, toastSuccess } from "../../components/ui/toast";

export function AddAgentModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");

  const reset = () => {
    setId("");
    setTitle("");
    setCommand("");
    setArgs("");
  };

  const save = () => {
    saveCodingAgent({
      id: id.trim(),
      ...(title.trim() === "" ? {} : { title: title.trim() }),
      command: command.trim(),
      args: args
        .split("\n")
        .map((a) => a.trim())
        .filter((a) => a !== ""),
    })
      .then(() => {
        toastSuccess(S.codingAgents.save);
        reset();
        onSaved();
        onClose();
      })
      .catch((e: unknown) => toastError(apiErrorText(e)));
  };

  return (
    <Modal
      open={open}
      title={S.codingAgents.addAgent}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {S.codingAgents.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={id.trim() === "" || command.trim() === ""}
            onClick={save}
          >
            {S.codingAgents.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={S.codingAgents.idLabel} hint={S.codingAgents.idHint} required>
          <Input size="sm" value={id} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field label={S.codingAgents.titleLabel}>
          <Input size="sm" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={S.codingAgents.commandLabel} hint={S.codingAgents.commandHint} required>
          <Input size="sm" value={command} onChange={(e) => setCommand(e.target.value)} />
        </Field>
        <Field label={S.codingAgents.argsLabel} hint={S.codingAgents.argsHint}>
          <Textarea size="sm" value={args} onChange={(e) => setArgs(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
