/**
 * Account page of System settings: the credentials the signed-in account can change. Only
 * mounted where a password exists to change — the desktop shell's own window signs in
 * through a one-shot token and is filtered out by the section registry (see
 * offersChangePassword for the full rule).
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { ChangePasswordDialog } from "../../components/account/change-password-dialog";
import { PrefRow } from "./setting-row";

export function AccountSection() {
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
      <PrefRow label={S.account.changePassword} info={S.settings.changePasswordInfo}>
        <Button variant="secondary" onClick={() => setChangePasswordOpen(true)}>
          {S.account.changePassword}
        </Button>
      </PrefRow>
      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />
    </div>
  );
}
