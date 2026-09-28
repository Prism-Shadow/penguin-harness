/**
 * A Local CLI card's Environment section: the agent's variables as name + masked value, added
 * and removed like the Agent Vault's entries (each change saves at once, a replace or removal is
 * confirmed first). Admin-only; values never come back from the server.
 */
import { useState } from "react";
import type {
  CodingAgentEnvEntryInfo,
  CodingAgentEnvRequest,
} from "@prismshadow/penguin-server/api";
import { setCodingAgentEnv } from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { PasswordInput } from "../../components/ui/password-input";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { envKeyProblem, keepAllExcept } from "./agent-env";

export function AgentEnvEditor({
  agentId,
  entries,
  pending,
  onChanged,
}: {
  agentId: string;
  entries: CodingAgentEnvEntryInfo[];
  pending: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [errors, setErrors] = useState<{ key?: string; value?: string }>({});
  const [overwriting, setOverwriting] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const persist = async (body: CodingAgentEnvRequest): Promise<string | null> => {
    setBusy(true);
    try {
      await setCodingAgentEnv(agentId, body);
      toastSuccess(S.models.cliEnvSaved);
      onChanged();
      return null;
    } catch (e) {
      return apiErrorText(e);
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const name = key.trim();
    const keyProblem = envKeyProblem(name);
    const next = {
      ...(keyProblem !== null ? { key: keyProblem } : {}),
      ...(value === "" ? { value: S.models.cliEnvValueRequired } : {}),
    };
    if (next.key || next.value) {
      setErrors(next);
      return;
    }
    if (overwriting !== name && entries.some((e) => e.key === name)) {
      setOverwriting(name);
      return;
    }
    setOverwriting(null);
    const error = await persist({
      entries: [...keepAllExcept(entries, name), { key: name, value }],
    });
    if (error !== null) {
      setErrors({ key: error });
      return;
    }
    setAdding(false);
  };

  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {S.models.cliEnv}
      </span>
      <p className="text-xs text-gray-500 dark:text-gray-400">{S.models.cliEnvHint}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.models.cliEnvEmpty}</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {entries.map((entry) => (
            <li key={entry.key} className="flex min-w-0 items-center gap-3 px-3 py-1.5">
              <span className="truncate font-mono text-xs text-gray-900 dark:text-gray-100">
                {entry.key}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                {entry.valueMasked}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setRemoving(entry.key)}
              >
                {S.models.cliEnvRemove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {pending && <p className={`text-xs ${toneInk.attention}`}>{S.models.cliEnvPending}</p>}
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          setKey("");
          setValue("");
          setErrors({});
          setAdding(true);
        }}
      >
        {S.models.cliEnvAdd}
      </Button>

      <Modal
        open={adding}
        title={S.models.cliEnvAddTitle}
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button size="sm" onClick={() => setAdding(false)}>
              {S.common.cancel}
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void add()}>
              {S.common.save}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            size="sm"
            label={S.models.cliEnvKey}
            required
            error={errors.key}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setErrors({});
            }}
            className="font-mono"
            placeholder="GEMINI_API_KEY"
            autoComplete="off"
          />
          <PasswordInput
            size="sm"
            label={S.models.cliEnvValue}
            required
            error={errors.value}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setErrors({});
            }}
            className="font-mono"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void add();
            }}
          />
        </div>
      </Modal>

      <ConfirmModal
        open={overwriting !== null}
        title={S.models.cliEnvOverwriteTitle}
        tone="primary"
        confirmLabel={S.common.save}
        busy={busy}
        onClose={() => setOverwriting(null)}
        onConfirm={() => void add()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {overwriting !== null ? S.models.cliEnvOverwriteBody(overwriting) : ""}
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={removing !== null}
        title={S.models.cliEnvRemoveTitle}
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing === null) return;
          void persist({ entries: keepAllExcept(entries, removing) }).then((error) => {
            if (error !== null) toastError(error);
            setRemoving(null);
          });
        }}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {removing !== null ? S.models.cliEnvRemoveBody(removing) : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}
