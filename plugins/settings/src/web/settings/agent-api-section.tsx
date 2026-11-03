import {
  ConfirmModal,
  SettingsGroup,
  SettingsSection,
  ToggleRow,
  toastError,
} from "@prismshadow/penguin-ui";
import * as api from "@prismshadow/penguin-web/internal";
import { apiErrorText } from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";
import { toneInk } from "@prismshadow/penguin-web/internal";


/** Turns the switch off on the server. Reached only through the confirm. */
const switchOffAgentApiServer = (): Promise<ServerSettingsResponse> =>
  api.adminPutSettings({ agentApiEnabled: false });

/**
 * The question before the switch goes off: the danger tone and what follows. Answered yes, it
 * says the write began, writes the switch off, and hands the outcome on: the stored value, or
 * the failure.
 */
export function AgentApiServerOffConfirm({
  open,
  onClose,
  onWriting,
  onSettled,
}: {
  open: boolean;
  onClose: () => void;
  onWriting: () => void;
  onSettled: (outcome: { enabled: boolean } | { error: unknown }) => void;
}) {
  return (
    <ConfirmModal
      open={open}
      title={S.settings.agentApiOffTitle}
      onClose={onClose}
      onConfirm={() => {
        onClose();
        onWriting();
        switchOffAgentApiServer().then(
          (res) => onSettled({ enabled: res.settings.agentApiEnabled }),
          (error: unknown) => onSettled({ error }),
        );
      }}
      confirmLabel={S.settings.agentApiOff}
      cancelLabel={S.common.cancel}
    >
      <p className="text-sm text-fg-muted">{S.settings.agentApiOffConfirm}</p>
    </ConfirmModal>
  );
}

export function AgentApiSection() {
  /** The last value the server confirmed; null until the settings load. */
  const [stored, setStored] = useState<boolean | null>(null);
  /** What the switch shows: the stored value, or the pending one while a write is in flight. */
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .adminGetSettings()
      .then((res) => {
        if (cancelled) return;
        setStored(res.settings.agentApiEnabled);
        setEnabled(res.settings.agentApiEnabled);
      })
      .catch((e: unknown) => {
        if (!cancelled) toastApiError(e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Where a write landed: the stored value, or back to the last one with the reason. */
  const settle = (outcome: { enabled: boolean } | { error: unknown }, previous: boolean) => {
    if ("enabled" in outcome) {
      setStored(outcome.enabled);
      setEnabled(outcome.enabled);
    } else {
      setEnabled(previous);
      setError(apiErrorText(outcome.error));
    }
    setBusy(false);
  };

  const turnOn = () => {
    if (stored === null || busy) return;
    setEnabled(true);
    setError(undefined);
    setBusy(true);
    api.adminPutSettings({ agentApiEnabled: true }).then(
      (res) => settle({ enabled: res.settings.agentApiEnabled }, stored),
      (err: unknown) => settle({ error: err }, stored),
    );
  };

  return (
    <SettingsSection>
      <div>
        <SettingsGroup>
          <ToggleRow
            label={S.settings.agentApiToggle}
            checked={enabled}
            onChange={(next) => {
              if (next) turnOn();
              else setConfirmOff(true);
            }}
            disabled={stored === null || busy}
          />
        </SettingsGroup>
        {error !== undefined && <p className={`mt-2 text-xs ${toneInk.danger}`}>{error}</p>}
      </div>
      <AgentApiServerOffConfirm
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        onWriting={() => {
          setEnabled(false);
          setError(undefined);
          setBusy(true);
        }}
        onSettled={(outcome) => settle(outcome, stored ?? true)}
      />
    </SettingsSection>
  );
}
