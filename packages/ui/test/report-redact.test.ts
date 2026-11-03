/**
 * What a shared text — a provider's message, an exception's stack — loses before it leaves the
 * app (src/components/report/redact.ts).
 *
 * - Given a key, whole or masked, a bearer token, a secret named in a query, a header or a JSON
 *   body, a URL's credentials, a UUID or a long random token, none of it is left, and
 *   `[redacted]` stands in its place.
 * - Given the words around them — the error, a model id, a URL's host and path, a status, a basic
 *   scheme named in prose — they stay as they were.
 * - Given a value the caller keeps (the provider's request id), it stays though it looks random.
 * - Given a path through a home directory on macOS, Linux or Windows, the account name is gone and
 *   the rest of the path stays.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactHomePaths, redactSecrets } from "../src/components/report/redact";

const SECRETS: [string, string, string][] = [
  [
    "an OpenAI key",
    "Incorrect API key provided: sk-proj-Ab3dEf6hIj9kLm2nOp5q.",
    "sk-proj-Ab3dEf6hIj9kLm2nOp5q",
  ],
  ["a masked key", "Incorrect API key provided: sk-ant-api03-****************wxyz", "****wxyz"],
  [
    "a Google key",
    "key=AIzaSyD3x4mpl3Xk3yV4lu3Abcdefghijk&alt=sse",
    "AIzaSyD3x4mpl3Xk3yV4lu3Abcdefghijk",
  ],
  [
    "a bearer token",
    "upstream said 401 for Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc",
    "eyJhbGciOiJIUzI1NiJ9",
  ],
  ["a header", "Authorization: Bearer 9f8e7d6c5b4a39281706f5e4d3c2b1a0", "9f8e7d6c5b4a"],
  ["a JSON secret", '{"error":"bad","api_key":"live-key-123"}', "live-key-123"],
  ["a query secret", "GET /v1/models?token=abc123def&page=2", "abc123def"],
  ["a URL's credentials", "connect to https://bob:hunter2@gw.example.com/v1 failed", "hunter2"],
  ["a UUID", "key 3f2a9e7d-0d41-4b8f-9a6e-2c1d5e8f0a37 is disabled", "3f2a9e7d-0d41"],
  [
    "a long random token",
    "token mismatch for a8F3kQ9zL2xP7mN4vB6cR1tY5wE8uI0o",
    "a8F3kQ9zL2xP7mN4vB6cR1tY5wE8uI0o",
  ],
];

describe("redacting a shared message", () => {
  it.each(SECRETS)("takes out %s and marks where it stood", (_, message, secret) => {
    const shared = redactSecrets(message);
    expect(shared).not.toContain(secret);
    expect(shared).toContain(REDACTED);
  });

  it("leaves the words around them as they were", () => {
    const plain =
      '503 {"type":"error","error":{"type":"overloaded_error","message":"model claude-sonnet-4-5-20250929 is overloaded at https://api.example.com/v1/messages; Basic authentication is not supported"}}';
    expect(redactSecrets(plain)).toBe(plain);
  });

  it("keeps a value the caller keeps, though it looks random", () => {
    const id = "req_011CUz3tF8eJ2dQx6Q9pY7LnA8b2c4d";
    expect(redactSecrets(`overloaded (request_id: ${id})`, [id])).toBe(
      `overloaded (request_id: ${id})`,
    );
    expect(redactSecrets(`overloaded (request_id: ${id})`)).not.toContain(id);
  });

  it.each([
    ["/Users/alice/penguin/src/a.ts:12:5", "/Users/<user>/penguin/src/a.ts:12:5"],
    ["at f (/home/bob/work/x.js:1:2)", "at f (/home/<user>/work/x.js:1:2)"],
    ["C:\\Users\\carol\\AppData\\x.js", "C:\\Users\\<user>\\AppData\\x.js"],
    ["file:///C:/Users/dave/app/y.js", "file:///C:/Users/<user>/app/y.js"],
  ])("takes the account name out of %s", (path, shared) => {
    expect(redactHomePaths(path)).toBe(shared);
  });
});
