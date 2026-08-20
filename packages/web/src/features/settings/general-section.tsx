/**
 * Personal sub-page of System settings: preferences that belong to the signed-in account and
 * nobody else. Everything here applies the moment it is touched — the store persists it per
 * user (PUT /me/prefs) and re-derives whatever depends on it — so the section carries no Save
 * button and no draft state to lose.
 */
import { S } from "../../lib/strings";
import { useSessions } from "../../state/sessions";
import { Switch } from "../../components/ui/switch";
import { SectionShell } from "./section-shell";

export function GeneralSection() {
  const { showCliSessions, setShowCliSessions } = useSessions();
  return (
    <SectionShell title={S.settings.generalTitle}>
      <div className="flex items-start justify-between gap-4">
        <label className="min-w-0 cursor-pointer">
          <span className="block text-sm font-medium">{S.settings.showCliSessions}</span>
          <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
            {S.settings.showCliSessionsHint}
          </span>
        </label>
        {/* Flipping this refetches the whole conversation list under the new filter, so the
            sidebar behind the page updates without a reload. */}
        <Switch checked={showCliSessions} onChange={setShowCliSessions} />
      </div>
    </SectionShell>
  );
}
