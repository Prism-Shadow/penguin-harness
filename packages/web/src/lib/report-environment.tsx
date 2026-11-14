/**
 * What every problem report knows of where it ran, handed to the UI package's report store from
 * the app's root: the version report the sidebar footer and Settings read (`useVersionInfo`) for
 * the version and the OS of the machine serving this window, and how it is installed — a source
 * build says so, otherwise the desktop shell's server (`desktopMode`) or a server started by hand.
 * Until the version report arrives a report says "unknown" for them.
 */
import { useEffect } from "react";
import {
  UNKNOWN_ENVIRONMENT,
  installKindOf,
  osName,
  setReportEnvironment,
} from "@prismshadow/penguin-ui";
import { useAuth } from "../state/auth";
import { useVersionInfo } from "./use-version-info";

export function ReportEnvironmentSync(): null {
  const { version } = useVersionInfo(true);
  const { desktopMode } = useAuth();
  useEffect(() => {
    setReportEnvironment(
      version === null
        ? UNKNOWN_ENVIRONMENT
        : {
            version: version.describe,
            install: installKindOf({ channel: version.channel, desktopMode }),
            os: osName(version.runtime),
          },
    );
  }, [version, desktopMode]);
  return null;
}
