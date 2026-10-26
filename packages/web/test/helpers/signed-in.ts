/**
 * The shell's own sign-in gate, for the test worlds that mount the app's providers under a router
 * of their own: nothing under it renders until the auth provider has adopted a user, as nothing
 * under the app's RequireAuth does (router.tsx). Without it the Project, machine and Session
 * providers would start their first reads while the user is still unknown — which the app never
 * does, since a user is adopted only once the account's preferences and drafts are cached.
 */
import { Fragment, createElement as h } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../../src/state/auth";

export function SignedIn({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  return user ? h(Fragment, null, children) : null;
}
