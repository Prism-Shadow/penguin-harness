/**
 * The facts a provider's error message states in its own words (features/chat/provider-error.ts).
 *
 * - Given a message an SDK leads with its HTTP status, or one naming the status, that status is
 *   read; given one that names none — a date or a count at its start included — there is none.
 * - Given a message naming the provider's request id in any of its usual spellings, that id is
 *   read, without the sentence's stop; given none, there is none.
 * - Given a message that is a JSON body, alone or after its status, the sentence it holds for a
 *   person is read from where providers put it; given plain text, prose with a body inside it, a
 *   body with no such sentence, or one that does not parse, the message comes back as it came.
 */
import { describe, expect, it } from "vitest";
import {
  httpStatusOf,
  providerWordsOf,
  requestIdOf,
} from "@prismshadow/penguin-library-session/web/chat/provider-error";

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

  const TOO_LONG = "prompt is too long: 140211 tokens > 131072 maximum";
  it.each<[string, string]>([
    // An SDK's status, then the provider's body: the sentence inside it.
    [
      `400 {"type":"error","error":{"type":"invalid_request_error","message":"${TOO_LONG}"},"request_id":"req_011CUz3tF8eJ2dQx6Q9pY7Ln"}`,
      TOO_LONG,
    ],
    [`HTTP 400: {"error":{"message":"${TOO_LONG}","code":"context_length_exceeded"}}`, TOO_LONG],
    [`{"message":"${TOO_LONG}"}`, TOO_LONG],
    [`422 {"detail":"${TOO_LONG}"}`, TOO_LONG],
    [`400 {"error":"${TOO_LONG}"}`, TOO_LONG],
    // Nothing to read: the message as it came.
    [`400 Bad Request: ${TOO_LONG}`, `400 Bad Request: ${TOO_LONG}`],
    ['upstream said {"message":"busy"}', 'upstream said {"message":"busy"}'],
    ['400 {"error":{"code":400},"message":""}', '400 {"error":{"code":400},"message":""}'],
    ['400 {"error":{"message":"cut', '400 {"error":{"message":"cut'],
    ['400 [{"message":"busy"}]', '400 [{"message":"busy"}]'],
  ])("%s says %s to a person", (message, words) => {
    expect(providerWordsOf(message)).toBe(words);
  });
});
