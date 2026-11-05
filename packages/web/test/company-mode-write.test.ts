/**
 * The company-mode master switch in System settings › Server (features/settings/
 * company-mode-write.ts): it applies on the flip, so the write is the whole save path.
 *
 * - A flip either way sends that one field alone and settles on what the server answers, even
 *   when the server stored something other than what was asked.
 * - A failed write reverts the switch to the stored value (on stays on, off stays off) and
 *   carries the described reason.
 */
import { describe, expect, it } from "vitest";
import type {
  ServerSettings,
  ServerSettingsResponse,
  ServerSettingsUpdateRequest,
} from "@prismshadow/penguin-server/api";
import { writeCompanyMode } from "../src/features/settings/company-mode-write";

const settings = (companyMode: boolean): ServerSettings => ({
  proxyForApp: true,
  proxyForAgent: true,
  proxyUrl: null,
  attachmentMaxMb: 100,
  attachmentTotalMb: 500,
  companyMode,
  browserExtensionsEnabled: true,
  agentApiEnabled: true,
});

/** Records what the switch sent and answers with the server's stored settings. */
const recorder = (answer: boolean) => {
  const sent: ServerSettingsUpdateRequest[] = [];
  return {
    sent,
    put: (body: ServerSettingsUpdateRequest): Promise<ServerSettingsResponse> => {
      sent.push(body);
      return Promise.resolve({ settings: settings(answer) });
    },
  };
};

const describeError = (error: unknown) => `described: ${String(error)}`;

describe("writeCompanyMode", () => {
  it("sends the flipped value alone, either way, and settles on what the server answers", async () => {
    for (const next of [true, false]) {
      const api = recorder(next);
      const result = await writeCompanyMode(next, !next, { put: api.put, describeError });
      // Only the one field: every other server setting keeps its stored value.
      expect(api.sent).toEqual([{ companyMode: next }]);
      expect(result).toEqual({ status: "applied", companyMode: next });
    }
  });

  it("adopts the server's answer rather than the value that was asked for", async () => {
    // A server that stored something else is what the switch must show; assuming the request
    // won would leave the knob lying about the server's state until the next reload.
    const api = recorder(false);
    const result = await writeCompanyMode(true, false, { put: api.put, describeError });
    expect(result).toEqual({ status: "applied", companyMode: false });
  });

  it("reverts to the stored value and carries the described reason when the write fails", async () => {
    const result = await writeCompanyMode(true, false, {
      put: () => Promise.reject(new Error("403")),
      describeError,
    });
    expect(result).toEqual({
      status: "failed",
      revertTo: false,
      error: "described: Error: 403",
    });
    // The revert target is the stored value, never a default: a failed turn-off on an enabled
    // server has to leave the switch on.
    const off = await writeCompanyMode(false, true, {
      put: () => Promise.reject(new Error("boom")),
      describeError,
    });
    expect(off).toMatchObject({ status: "failed", revertTo: true });
  });
});
