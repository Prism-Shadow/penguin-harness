/**
 * Password hashing (auth/password.ts) and the account check the login route runs on it.
 *
 * - A hash made without a cost argument is stored as `scrypt$N$r$p$salt$hash` at the
 *   production work factor; it verifies its own password and fails any other.
 * - The same password hashed twice differs (random salt), and both verify.
 * - A stored string that is not a checkable hash verifies as false instead of throwing.
 * - The check tells a mismatch apart from a hash it cannot check.
 * - An unknown username is checked against the dummy hash, once, and never signs anyone in.
 * - A real account is checked against its own hash, once, without the dummy.
 * - An account whose stored hash cannot be checked still spends its one derivation, on the dummy.
 *
 * The `password` cases hash at the production work factor: they are the one place it runs.
 * The account-check cases hash at a token cost and count derivations, never time them.
 */
import { describe, expect, it, vi } from "vitest";
import {
  SCRYPT_COST,
  checkPassword,
  hashPassword,
  verifyAccountPassword,
  verifyPassword,
} from "../src/auth/password.js";
import type { PasswordCheck } from "../src/auth/password.js";

describe("password", () => {
  it("stores an unparameterized hash at the production cost, verifying only its own password", async () => {
    const stored = await hashPassword("hello-world-123");
    const parts = stored.split("$");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    // `hashPassword`'s cost argument exists for the test suite and must never lower what an
    // unparameterized call writes.
    expect(Number(parts[1])).toBe(SCRYPT_COST);
    await expect(verifyPassword("hello-world-123", stored)).resolves.toBe(true);
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

describe("account password check", () => {
  /** A token work factor: nothing here depends on how long a derivation takes. */
  const COST = 2;
  /** Well-formed, but N = 3 is not a power of two: scrypt refuses it before deriving anything. */
  const REFUSED_PARAMETERS = "scrypt$3$8$1$c2FsdHNhbHQ=$aGFzaGhhc2g=";

  /** The real check, recording what each call checked against and what it found. */
  function recordingCheck() {
    const calls: Array<{ stored: string; outcome: PasswordCheck }> = [];
    const check = async (password: string, stored: string): Promise<PasswordCheck> => {
      const outcome = await checkPassword(password, stored);
      calls.push({ stored, outcome });
      return outcome;
    };
    /** The calls that ran a scrypt derivation. */
    const derivations = () => calls.filter((call) => call.outcome !== "unverifiable");
    return { calls, check, derivations };
  }

  it("checkPassword tells a mismatch from a hash it cannot check", async () => {
    const stored = await hashPassword("right-password", COST);
    await expect(checkPassword("right-password", stored)).resolves.toBe("match");
    await expect(checkPassword("wrong-password", stored)).resolves.toBe("mismatch");
    await expect(checkPassword("right-password", "")).resolves.toBe("unverifiable");
    await expect(checkPassword("right-password", "not-a-hash")).resolves.toBe("unverifiable");
    await expect(checkPassword("right-password", REFUSED_PARAMETERS)).resolves.toBe("unverifiable");
  });

  it("checks an unknown username against the dummy hash, once, and fails", async () => {
    const dummy = await hashPassword("held-by-nobody", COST);
    const dummyHash = vi.fn(async () => dummy);
    const { calls, check } = recordingCheck();
    await expect(verifyAccountPassword("guess-123", null, dummyHash, check)).resolves.toBe(false);
    expect(dummyHash).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([{ stored: dummy, outcome: "mismatch" }]);
    // The dummy never signs anyone in, even with the password it was made from.
    await expect(verifyAccountPassword("held-by-nobody", null, dummyHash, check)).resolves.toBe(
      false,
    );
  });

  it("checks a real account against its own hash, once, without the dummy", async () => {
    const stored = await hashPassword("right-password", COST);
    const dummyHash = vi.fn(async () => hashPassword("held-by-nobody", COST));
    const wrong = recordingCheck();
    await expect(
      verifyAccountPassword("wrong-password", stored, dummyHash, wrong.check),
    ).resolves.toBe(false);
    expect(wrong.calls).toEqual([{ stored, outcome: "mismatch" }]);
    const right = recordingCheck();
    await expect(
      verifyAccountPassword("right-password", stored, dummyHash, right.check),
    ).resolves.toBe(true);
    expect(right.calls).toEqual([{ stored, outcome: "match" }]);
    expect(dummyHash).not.toHaveBeenCalled();
  });

  it("spends the one derivation on the dummy when the stored hash cannot be checked", async () => {
    const dummy = await hashPassword("held-by-nobody", COST);
    for (const stored of ["", "not-a-hash", "bcrypt$a$b$c$d$e", REFUSED_PARAMETERS]) {
      const { check, derivations } = recordingCheck();
      await expect(
        verifyAccountPassword("right-password", stored, async () => dummy, check),
      ).resolves.toBe(false);
      expect(derivations(), `stored ${JSON.stringify(stored)}`).toEqual([
        { stored: dummy, outcome: "mismatch" },
      ]);
    }
  });
});
