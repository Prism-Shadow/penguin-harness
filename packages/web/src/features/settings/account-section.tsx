/**
 * Account page of the Settings dialog: the credentials the signed-in account can change. Only
 * mounted where a password exists to change — the desktop shell's own window signs in
 * through a one-shot token and is filtered out by the section registry (see
 * offersChangePassword for the full rule).
 */
import { useState } from "react";
import { Button, PrefRow, SettingsGroup } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { ChangePasswordDialog } from "../../components/account/change-password-dialog";

export function AccountSection() {
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  return (
    <>
      <SettingsGroup>
        <PrefRow label={S.account.changePassword} info={S.settings.changePasswordInfo}>
          <Button size="sm" variant="secondary" onClick={() => setChangePasswordOpen(true)}>
            {S.account.changePassword}
          </Button>
        </PrefRow>
      </SettingsGroup>
      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />
    </>
  );
}
