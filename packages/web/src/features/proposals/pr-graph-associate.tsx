/**
 * "Associate …" in a graph row's menu: add an action of one's own. An action is a deploy script
 * registered with the organization — a name, and a command that is either a registered script's
 * command with extra arguments, or a command written out whole — and once saved it is one more
 * "Deploy to <name>" in every row's menu. Registering is a server admin's; the server says so.
 */
import { useState } from "react";
import type { ProposalDeployScript } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import { Button, Input, Modal, Select } from "@prismshadow/penguin-ui";
import { splitArgs } from "./pr-graph-model";
import { scriptName } from "./pr-graph-deploy";

/** A script id from the name a person gave: lower case, `[a-z0-9_.-]`, at most 64. */
export function scriptIdOf(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
}

/** The command an action runs: the base script's with the arguments after it, or the one written out. */
export function associatedCommand(
  base: ProposalDeployScript | null,
  args: string,
  command: string,
): string[] {
  return base === null ? splitArgs(command) : [...base.command, ...splitArgs(args)];
}

export function AssociateDialog({
  projectId,
  orgId,
  scripts,
  onClose,
  onSaved,
}: {
  projectId: string;
  orgId: string;
  scripts: readonly ProposalDeployScript[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = S.company.proposals.graph.deploy;
  const [name, setName] = useState("");
  const [baseId, setBaseId] = useState(scripts[0]?.id ?? "");
  const [args, setArgs] = useState("");
  const [command, setCommand] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = scripts.find((s) => s.id === baseId) ?? null;
  const id = scriptIdOf(name);
  const runs = associatedCommand(base, args, command);
  const ready = id !== "" && runs.length > 0 && !saving;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.createOrgDeployScript(projectId, orgId, {
        id,
        command: runs,
        description: name.trim(),
      });
      onSaved();
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={t.associateTitle}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={!ready} onClick={() => void save()}>
            {t.associateSave}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <Input
          size="sm"
          label={t.associateName}
          hint={id !== "" ? t.associateId(id) : t.associateNameHint}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Select
          size="sm"
          label={t.associateBase}
          value={baseId}
          onChange={(e) => setBaseId(e.target.value)}
        >
          {scripts.map((s) => (
            <option key={s.id} value={s.id}>
              {scriptName(s)}
            </option>
          ))}
          <option value="">{t.associateCustom}</option>
        </Select>
        {base !== null ? (
          <Input
            size="sm"
            label={t.args}
            hint={t.argsHint}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            className="font-mono"
          />
        ) : (
          <Input
            size="sm"
            label={t.command}
            hint={t.argsHint}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className="font-mono"
          />
        )}
        {runs.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t.command}: <code className="font-mono break-all">{runs.join(" ")}</code>
          </p>
        )}
        {error !== null && <p className={`text-xs ${toneInk.danger}`}>{error}</p>}
      </div>
    </Modal>
  );
}
