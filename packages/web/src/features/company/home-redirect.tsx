/**
 * `/` and every path nothing else matches: the home of the mode the shell stands in
 * (`homePath`) — the organizations in company mode, the conversations in development mode. A
 * sign-in and the desktop shell's start both arrive at `/`. Company mode owns the mode, so it
 * contributes this page (path `*`, which matches `/` too) rather than the router reading the
 * company state.
 */
import { Navigate } from "react-router";
import { useCompany } from "./company-state";

export function HomeRedirect() {
  return <Navigate to={useCompany().homePath} replace />;
}
