/**
 * Sync the browser tab title (document.title): "{title} · PenguinHarness"
 * when a page title is set, falling back to the app name otherwise. Called
 * at the top level of each page component, updating instantly on route
 * changes or title changes (e.g. an auto-generated Session title delivered
 * via a session_title event).
 */
import { useEffect } from "react";
import { S } from "./strings";

export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · ${S.appName}` : S.appName;
  }, [title]);
}
