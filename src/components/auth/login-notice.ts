/** Plain-language text for the ?message= values other pages send to /login after an account action; null for anything else. */
export function loginNotice(code: unknown): string | null {
  switch (code) {
    case "password-changed":
      return "Password changed. Log in again with your new password.";
    case "account-deleted":
      return "Account deleted.";
    case "signed-out":
      return "You have been signed out.";
    default:
      return null;
  }
}
