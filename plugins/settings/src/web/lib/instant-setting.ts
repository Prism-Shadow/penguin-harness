import { toastError } from "@prismshadow/penguin-ui";
import { apiErrorText } from "@prismshadow/penguin-web/internal";

||||||| parent of 53df88c5aa (settings/pref cluster: settings-request, settings-sections, notification-pref, instant-setting move to plugin-settings web/lib; host reads via internal):packages/web/src/lib/instant-setting.ts

export interface InstantSetting<T> {
  /** What the control shows: the value being written, else the stored one. */
  value: T;
  /** A write is in flight; a second flip waits for it. */
  busy: boolean;
  /** Writes `next`. Resolves with whether it was stored. Ignored while a write is in flight. */
  set: (next: T) => Promise<boolean>;
}

export function useInstantSetting<T>(
  stored: T,
  write: (next: T) => Promise<unknown>,
): InstantSetting<T> {
  const [pending, setPending] = useState<{ value: T } | null>(null);
  const set = async (next: T): Promise<boolean> => {
    if (pending !== null) return false;
    setPending({ value: next });
    try {
      await write(next);
      return true;
    } catch (e) {
      toastApiError(e);
      return false;
    } finally {
      setPending(null);
    }
  };
  return { value: pending === null ? stored : pending.value, busy: pending !== null, set };
}
