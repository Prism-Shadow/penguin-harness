/**
 * The write behind the company-mode master switch, kept out of the component because this
 * package's unit tests run without a DOM. It is where "the flip is the save" lives: the PUT a
 * flipped switch fires at once, the server's answer as the value to settle on, and — when the
 * request fails — the value to put the switch back to, with the reason to name under it.
 *
 * The answer is adopted rather than assumed: a server that stored something other than what was
 * asked for is what the switch must show.
 */
import type {
  ServerSettingsResponse,
  ServerSettingsUpdateRequest,
} from "@prismshadow/penguin-server/api";

/** What a flip settled on: the stored value now, or the value to revert to and why. */
export type CompanyModeWriteResult =
  | { status: "applied"; companyMode: boolean }
  | { status: "failed"; revertTo: boolean; error: string };

export interface CompanyModeWriteDeps {
  /** `api.adminPutSettings` in the app; a stub in tests. */
  put: (body: ServerSettingsUpdateRequest) => Promise<ServerSettingsResponse>;
  /** Turns a rejection into the line shown under the switch (`apiErrorText` in the app). */
  describeError: (error: unknown) => string;
}

/**
 * Writes `next` as the master switch. `stored` is the last value the server confirmed — the one
 * a failed write reverts to, so the switch never sits on a state the server does not hold.
 */
export async function writeCompanyMode(
  next: boolean,
  stored: boolean,
  deps: CompanyModeWriteDeps,
): Promise<CompanyModeWriteResult> {
  try {
    const res = await deps.put({ companyMode: next });
    return { status: "applied", companyMode: res.settings.companyMode };
  } catch (error) {
    return { status: "failed", revertTo: stored, error: deps.describeError(error) };
  }
}
