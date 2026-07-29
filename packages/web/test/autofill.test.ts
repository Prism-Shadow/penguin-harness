/**
 * Autofill policy of the shared form controls (autofillProps in components/ui/input.tsx):
 * fields opt out by default, a declared credential role passes through, and an opted-out
 * password box goes out as "new-password" — plain "off" is ignored by Chrome/Safari there,
 * which is how the account's saved login used to land in an API-key field.
 */
import { describe, it, expect } from "vitest";
import { autofillProps } from "../src/components/ui/input";

const IGNORES = {
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "",
  "data-form-type": "other",
};

describe("autofillProps", () => {
  it("opts an undeclared field out, extension attributes included", () => {
    expect(autofillProps(undefined, false)).toEqual({ autoComplete: "off", ...IGNORES });
  });

  it("emits new-password for a secret field, never a bare off", () => {
    // Chrome and Safari ignore autocomplete="off" on a password box and offer the saved
    // login anyway; "new-password" is the only value they read as "not the account password".
    expect(autofillProps(undefined, true)).toEqual({ autoComplete: "new-password", ...IGNORES });
    expect(autofillProps("off", true)).toEqual({ autoComplete: "new-password", ...IGNORES });
  });

  it("treats an explicit off as the same opt-out as no value at all", () => {
    expect(autofillProps("off", false)).toEqual(autofillProps(undefined, false));
  });

  it("passes a declared credential role through untouched (login, password dialogs)", () => {
    for (const role of ["username", "current-password", "new-password"]) {
      expect(autofillProps(role, role.endsWith("password"))).toEqual({ autoComplete: role });
    }
  });
});
