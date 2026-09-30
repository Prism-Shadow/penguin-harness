/**
 * Content redaction (services/redact.ts): credential-shaped fields and values come back as
 * `[redacted]`, and the look-alikes a Trace is full of — token counters, a public key path,
 * prose — come back untouched.
 */
import { describe, expect, it } from "vitest";
import { isCredentialName, REDACTED, redactText, redactValue } from "../src/services/redact.js";

describe("isCredentialName", () => {
  it("matches credential field names in any case style", () => {
    for (const name of [
      "token",
      "access_token",
      "refreshToken",
      "api_key",
      "apiKey",
      "OPENAI_API_KEY",
      "password",
      "client_secret",
      "Authorization",
      "private_key",
      "aws-access-key",
    ]) {
      expect(isCredentialName(name), name).toBe(true);
    }
  });

  it("leaves counters and other look-alikes alone", () => {
    for (const name of ["input_tokens", "max_tokens", "tokenCount", "token_usage", "keys", "passwordIsInitial"]) {
      expect(isCredentialName(name), name).toBe(false);
    }
  });
});

describe("redactText", () => {
  it("redacts provider key formats and bearer values", () => {
    expect(redactText("key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123")).toBe(`key ${REDACTED}`);
    expect(redactText("gh token ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toBe(`gh token ${REDACTED}`);
    expect(redactText("Authorization: Bearer abc.def.ghi-jkl_mno")).toContain(`Bearer ${REDACTED}`);
    expect(redactText("AKIAABCDEFGHIJKLMNOP")).toBe(REDACTED);
  });

  it("redacts named values in env, shell and JSON forms, keeping the name", () => {
    expect(redactText("export DEEPSEEK_API_KEY=abc123def456")).toBe(
      `export DEEPSEEK_API_KEY=${REDACTED}`,
    );
    expect(redactText(`{"password": "hunter22", "user": "k"}`)).toBe(
      `{"password": "${REDACTED}", "user": "k"}`,
    );
    expect(redactText("curl -H 'x' --data token=abcd1234")).toContain(`token=${REDACTED}`);
  });

  it("leaves token counts and ordinary prose alone", () => {
    const text = `{"max_tokens": 4096, "input_tokens": 12} the token budget is fine`;
    expect(redactText(text)).toBe(text);
  });

  it("redacts PEM private key blocks and ssh private key paths, not public keys", () => {
    const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----";
    expect(redactText(`key:\n${pem}\nend`)).toBe(`key:\n${REDACTED}\nend`);
    expect(redactText("ssh -i ~/.ssh/id_ed25519 host")).toBe(`ssh -i ${REDACTED} host`);
    expect(redactText("  IdentityFile /home/k/.ssh/id_rsa")).toBe(`  IdentityFile ${REDACTED}`);
    expect(redactText("cat ~/.ssh/id_ed25519.pub")).toBe("cat ~/.ssh/id_ed25519.pub");
  });
});

describe("redactValue", () => {
  it("walks objects and arrays, redacting credential fields and credential-shaped strings", () => {
    const events = {
      events: [
        { type: "tool_call", payload: { name: "bash", arguments: `{"command":"echo sk-proj-abcdefghijklmnopqrstuvwx"}` } },
        { type: "session_meta", payload: { apiKey: "plain-value", provider: "deepseek" } },
        { type: "token_usage", payload: { input_tokens: 10, output_tokens: 2 } },
      ],
      total: 3,
    };
    const out = redactValue(events);
    expect(out.events[0]!.payload).toEqual({
      name: "bash",
      arguments: `{"command":"echo ${REDACTED}"}`,
    });
    expect(out.events[1]!.payload).toEqual({ apiKey: REDACTED, provider: "deepseek" });
    expect(out.events[2]!.payload).toEqual({ input_tokens: 10, output_tokens: 2 });
    expect(out.total).toBe(3);
    // A copy: the input is untouched.
    expect(events.events[1]!.payload).toEqual({ apiKey: "plain-value", provider: "deepseek" });
  });
});
