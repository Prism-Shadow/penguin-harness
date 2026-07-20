/**
 * Unit tests for scrypt password hashing: format, verification, salt randomness,
 * and fallback behavior for invalid stored strings.
 */
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

describe("password", () => {
  it("hash format is scrypt$N$r$p$salt$hash and verifies", async () => {
    const stored = await hashPassword("hello-world-123");
    const parts = stored.split("$");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(Number(parts[1])).toBeGreaterThan(0);
    await expect(verifyPassword("hello-world-123", stored)).resolves.toBe(true);
  });

  it("a wrong password fails verification", async () => {
    const stored = await hashPassword("correct-password");
    await expect(verifyPassword("wrong-password", stored)).resolves.toBe(false);
  });

  it("hashing the same password twice differs (random salt)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    await expect(verifyPassword("same-password", a)).resolves.toBe(true);
    await expect(verifyPassword("same-password", b)).resolves.toBe(true);
  });

  it("invalid stored strings return false instead of throwing", async () => {
    await expect(verifyPassword("x", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt$a$b$c$d$e")).resolves.toBe(false);
    await expect(verifyPassword("x", "scrypt$abc$8$1$!!$!!")).resolves.toBe(false);
  });
});
