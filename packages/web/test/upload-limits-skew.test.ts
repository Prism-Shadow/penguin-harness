/**
 * Upload limits across a version boundary (state/auth.tsx).
 *
 * The Web App and the runtime serving it are routinely different versions: a hot update
 * pushes the dist without restarting the server, and the desktop shell attaches to whatever
 * server is already running. A `/api/me` payload from the other side of such a boundary is
 * missing whatever the two sides do not both know about — and assigning it straight through
 * replaced the whole defaults object, so the first component to read a limit off it crashed
 * the page with `Cannot read properties of undefined (reading 'attachmentLimitMinMb')`.
 */
import { describe, expect, it } from "vitest";
import { withDefaultUploadLimits } from "../src/state/auth";

describe("withDefaultUploadLimits", () => {
  it("survives a server that predates the field entirely", () => {
    // What a runtime older than the admin-settable limits returns: no uploadLimits at all.
    const limits = withDefaultUploadLimits(undefined);
    expect(limits.attachmentLimitMinMb).toBeTypeOf("number");
    expect(limits.attachmentMaxMb).toBeGreaterThan(0);
  });

  it("fills in only the fields a partial payload is missing", () => {
    // A runtime that knows the older limits but not the newer range.
    const limits = withDefaultUploadLimits({
      attachmentMaxMb: 25,
      attachmentTotalMb: 50,
      attachmentMaxCount: 5,
      imageMaxMb: 10,
    });
    expect(limits.attachmentMaxMb).toBe(25); // the server's answer wins where it has one
    expect(limits.attachmentLimitMinMb).toBeTypeOf("number"); // and the gap is filled
    expect(limits.attachmentLimitMaxMb).toBeGreaterThanOrEqual(limits.attachmentLimitMinMb);
  });

  it("passes a complete payload through unchanged", () => {
    const wire = {
      attachmentMaxMb: 7,
      attachmentTotalMb: 8,
      attachmentMaxCount: 9,
      imageMaxMb: 10,
      attachmentLimitMinMb: 11,
      attachmentLimitMaxMb: 12,
    };
    expect(withDefaultUploadLimits(wire)).toEqual(wire);
  });
});
