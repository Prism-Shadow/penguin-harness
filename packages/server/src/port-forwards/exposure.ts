/**
 * Whether a machine may carry `out` forwards its sshd would expose (commands.ts
 * ForwardExposure): a per-machine consent, given by an admin under Settings > Ports, kept in
 * server_settings as one JSON list of machine ids. Absent means nobody consented — the safe
 * reading of a setting that did not exist when the database was formed.
 */

/** server_settings key: `["<machineId>", …]`. */
const KEY = "port_forward_exposure_allowed";

export interface ExposureConsent {
  allowed(machineId: string): boolean;
  setAllowed(machineId: string, allowed: boolean): void;
}

/** What this store needs of the settings repo: the raw pair, nothing typed to this feature. */
export interface RawSettings {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export class SettingsExposureConsent implements ExposureConsent {
  constructor(private readonly settings: RawSettings) {}

  #read(): string[] {
    const raw = this.settings.get(KEY);
    if (raw === null) return [];
    try {
      const value: unknown = JSON.parse(raw);
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  }

  allowed(machineId: string): boolean {
    return this.#read().includes(machineId);
  }

  setAllowed(machineId: string, allowed: boolean): void {
    const ids = new Set(this.#read());
    if (allowed) ids.add(machineId);
    else ids.delete(machineId);
    this.settings.set(KEY, JSON.stringify([...ids]));
  }
}
