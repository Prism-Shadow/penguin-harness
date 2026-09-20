/**
 * company-mode-write.ts unit tests: the master switch in System settings › Server applies on the
 * flip, so the write is the whole save path and there is no Save button to retry with. Both
 * outcomes are pinned here — the request a flip sends and the value it settles on, and the
 * revert-with-a-reason that a rejected write has to produce, since a switch left showing a state
 * the server does not hold is the failure mode this replaced.
 *
 * vitest runs node-only in this package (`environment: "node"`, no jsdom), which is why the
 * sequence lives in its own module and the component is the thin caller.
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
  imageCompression: true,
  imageCompressionOverMb: 4,
  companyMode,
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
  it("sends the flipped value alone and settles on what the server answers", async () => {
    const api = recorder(true);
    const result = await writeCompanyMode(true, false, { put: api.put, describeError });
    // Only the one field: every other server setting keeps its stored value.
    expect(api.sent).toEqual([{ companyMode: true }]);
    expect(result).toEqual({ status: "applied", companyMode: true });
  });

  it("turning it off is the same single write", async () => {
    const api = recorder(false);
    const result = await writeCompanyMode(false, true, { put: api.put, describeError });
    expect(api.sent).toEqual([{ companyMode: false }]);
    expect(result).toEqual({ status: "applied", companyMode: false });
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
  });

  it("reverts to on, not to off, when turning it off fails", async () => {
    // The revert target is the stored value, never a default: a failed turn-off on an enabled
    // server has to leave the switch on.
    const result = await writeCompanyMode(false, true, {
      put: () => Promise.reject(new Error("boom")),
      describeError,
    });
    expect(result).toMatchObject({ status: "failed", revertTo: true });
  });
});
