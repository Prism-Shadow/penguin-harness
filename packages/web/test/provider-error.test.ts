/**
 * The facts a provider's error message states in its own words (features/chat/provider-error.ts).
 *
 * - Given a message an SDK leads with its HTTP status, or one naming the status, that status is
 *   read; given one that names none — a date or a count at its start included — there is none.
 * - Given a message naming the provider's request id in any of its usual spellings, that id is
 *   read, without the sentence's stop; given none, there is none.
 */
import { describe, expect, it } from "vitest";
import { httpStatusOf, requestIdOf } from "../src/features/chat/provider-error";

describe("a provider's error message", () => {
  it.each<[string | undefined, number | null]>([
    ['503 {"type":"error"}', 503],
    ["HTTP 429 Too Many Requests", 429],
    ["upstream failed with status code 502", 502],
    ['{"status": 500, "message": "internal"}', 500],
    ["2024-10-01 upstream error", null],
    ["terminated: other side closed (UND_ERR_SOCKET)", null],
    [undefined, null],
  ])("%s names HTTP status %s", (message, status) => {
    expect(httpStatusOf(message)).toBe(status);
  });

  it.each<[string | undefined, string | null]>([
    [
      '{"type":"error","request_id":"req_011CUz3tF8eJ2dQx6Q9pY7Ln"}',
      "req_011CUz3tF8eJ2dQx6Q9pY7Ln",
    ],
    ["Please include the request ID req_abc123def456 in your message.", "req_abc123def456"],
    ["overloaded; request id: req_abc123def456.", "req_abc123def456"],
    ["x-request-id: 3f2a9e7d-0d41-4b8f-9a6e-2c1d5e8f0a37", "3f2a9e7d-0d41-4b8f-9a6e-2c1d5e8f0a37"],
    ["the request id is missing", null],
    [undefined, null],
  ])("%s names request id %s", (message, id) => {
    expect(requestIdOf(message)).toBe(id);
  });
});
